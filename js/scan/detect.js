// Optical mark reading for a photographed ballot page.
//
// Pipeline: decode the QR (which carries election ID, ballot code,
// and page number), verify the ballot code against the election key,
// build a rough page-to-image homography from the QR's own corners,
// refine it using the four registration squares, then sample the
// darkness of every bubble the layout says exists on that page.

import { parseQrPayload, pageBubbles, GEOM } from '../model/layout.js';
import { verifyBallotCode } from '../model/ballotid.js';
import { qrModules } from '../model/render.js';
import { computeHomography, applyH, invertH, localScale } from './homography.js';

// Every bubble gets an ink fill fraction between 0 (clean paper) and
// 1 (as dark as the registration marks).
//
// Classification is RELATIVE within each row: a marked bubble is one
// that stands out from its row's baseline (the median of its
// siblings). Real voters make checkmarks, dots, and ballpoint
// scribbles that cover only part of the bubble and can read as
// little as 25-40% ink in absolute terms, and lighting shifts the
// absolute numbers anyway; relative comparison survives both.
// Absolute levels still gate the confidence flags.
const MARK_MARGIN = 0.18;     // fill above row baseline that means "marked"
const FAINT_MARGIN = 0.10;    // above this but below MARK_MARGIN: flag as faint
const CONFIDENT = 0.62;       // absolute fill below this flags for review
const FILL_THRESHOLD = 0.45;  // absolute fill that always counts as marked
const MESSY_BASELINE = 0.35;  // whole row this dark means scribbles everywhere

// image: {data: Uint8ClampedArray RGBA, width, height}
// ctx: {election, electionIdCode, layout, jsQR}
// Returns { ok, serial, page, pageCount, votesByRow, questions,
//           fills, flags } or { error }.
export async function detectPage(image, ctx) {
  const { election, electionIdCode, layout, jsQR } = ctx;

  const qr = jsQR(image.data, image.width, image.height);
  if (!qr) return { error: 'No QR code found.', transient: true };
  const payload = parseQrPayload(qr.data);
  if (!payload) return { error: 'QR code is not an Ocellus ballot.' };
  if (payload.electionId !== electionIdCode) {
    return { error: 'This ballot belongs to a different election.' };
  }
  const verdict = await verifyBallotCode(election, payload.ballotCode);
  if (verdict.error) return { error: verdict.error };
  const serial = verdict.serial;

  const gray = toGray(image);

  // Page-space corners of the QR symbol (inside its quiet zone).
  const mods = qrModules(qr.data);
  const n = mods.length;
  const cell = layout.qr.size / (n + 4);
  const ox = layout.qr.x + 2 * cell;
  const oy = layout.qr.y + 2 * cell;
  const sz = n * cell;
  const srcQr = [
    { x: ox, y: oy }, { x: ox + sz, y: oy },
    { x: ox + sz, y: oy + sz }, { x: ox, y: oy + sz },
  ];
  const loc = qr.location;
  const dstQr = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
  const rough = computeHomography(srcQr, dstQr);
  if (!rough) return { error: 'Could not orient the ballot.', transient: true };

  // Refine with the four registration marks, in two passes. The QR
  // sits in one corner, so extrapolating its homography to the far
  // corners can be off by many pixels; the first pass searches a wide
  // window with a square-template score, the second recomputes the
  // homography and pins each mark tightly by centroid.
  const integral = buildIntegral(gray);
  const qrCenterPage = { x: layout.qr.x + layout.qr.size / 2, y: layout.qr.y + layout.qr.size / 2 };
  const coarse = [];
  for (const m of layout.marks) {
    const scale = localScale(rough, m.x, m.y);
    const distMm = Math.hypot(m.x - qrCenterPage.x, m.y - qrCenterPage.y);
    // Generous windows: QR corner noise amplifies unpredictably when
    // extrapolated across the page, and the integral-image search
    // makes big windows cheap. The square-on-light template keeps
    // nearby QR modules or text from winning.
    const half = Math.max(4 * GEOM.markSize, distMm * 0.2) * scale;
    const c = findMarkCoarse(gray, integral, rough, m, half);
    if (!c) return { error: 'Registration marks not fully visible.', transient: true };
    coarse.push(c);
  }
  const H1 = computeHomography(layout.marks, coarse);
  if (!H1) return { error: 'Could not orient the ballot.', transient: true };
  const refined = [];
  for (let i = 0; i < layout.marks.length; i++) {
    const m = layout.marks[i];
    const c = findMarkFine(gray, H1, m) || coarse[i];
    refined.push(c);
  }
  const H = computeHomography(layout.marks, refined);
  if (!H) return { error: 'Could not orient the ballot.', transient: true };
  if (!invertH(H)) return { error: 'Could not orient the ballot.', transient: true };

  // Ink and paper references: inside a registration mark vs beside it.
  const inkRef = sampleDisk(gray, applyH(H, layout.marks[0].x, layout.marks[0].y),
    localScale(H, layout.marks[0].x, layout.marks[0].y) * GEOM.markSize * 0.3);
  const paperRef = samplePaper(gray, H, layout);
  if (paperRef - inkRef < 25) {
    return { error: 'Image too dark or washed out. Adjust lighting.', transient: true };
  }

  const page = layout.pages[payload.page - 1];
  if (!page) return { error: 'QR page number out of range.' };

  // No explicit distance gate is needed: the QR stops decoding well
  // before the page gets too small to read bubbles, so any frame
  // that reaches this point has workable resolution.

  // Sample each bubble at its center and at four slight offsets, and
  // keep the darkest reading. Checkmarks and dots rarely sit dead
  // center, and slightly bent paper shifts the projected centers by a
  // pixel or two; the darkest of five positions catches both.
  const fills = [];
  const offsets = [
    [0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6],
  ];
  for (const b of pageBubbles(layout, page)) {
    const scale = localScale(H, b.x, b.y);
    let inner = 255;
    for (const [dx, dy] of offsets) {
      const c = applyH(H, b.x + dx, b.y + dy);
      const v = sampleDisk(gray, c, scale * GEOM.bubbleR * 0.62);
      if (v < inner) inner = v;
    }
    const center = applyH(H, b.x, b.y);
    const fill = (paperRef - inner) / (paperRef - inkRef);
    fills.push({ ...b, cx: center.x, cy: center.y, fill: clamp01(fill) });
  }

  const { votesByRow, questions, flags } = classify(fills, election, page);
  return {
    ok: true,
    serial,
    ballotCode: payload.ballotCode,
    page: payload.page,
    pageCount: payload.pageCount,
    votesByRow,
    questions,
    fills,
    flags,
    confidence: scanConfidence(flags),
    homography: H,
  };
}

// Whole-scan confidence, derived from the row verdicts: 1 when every
// row read cleanly, lower when anything needed a flag. Blank rows
// are flagged only so the official confirms them; they are not a
// sign of a doubtful read.
function scanConfidence(flags) {
  let min = 1;
  for (const f of flags) {
    if (f.kind === 'blank') continue;
    const c = f.kind === 'multiple' || f.kind === 'overvote' || f.kind === 'messy' ? 0.4 : 0.6;
    if (c < min) min = c;
  }
  return min;
}

function pct(fill) {
  return Math.round(fill * 100);
}

// Turns bubble fill fractions into per-row scores. Rows are printed
// rows here; mapping to canonical candidate order happens later
// because it needs the async shuffle.
function classify(fills, election, page) {
  const flags = [];
  const votesByRow = {};
  const questions = {};

  const byRow = new Map();
  for (const f of fills) {
    if (f.kind !== 'score') continue;
    const key = f.raceId + '|' + f.printedRow;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(f);
  }
  for (const [key, cells] of byRow) {
    const [raceId, rowStr] = key.split('|');
    const row = Number(rowStr);
    const verdict = judgeRow(cells);
    if (verdict.flag) {
      flags.push({
        raceId, printedRow: row, kind: verdict.flag,
        message: verdict.message.replace('%WHAT%', 'score'),
      });
    }
    votesByRow[raceId] = votesByRow[raceId] || {};
    // null means the row is blank; tallies and the EIC count it as 0,
    // but the review screen shows it honestly as no selection.
    votesByRow[raceId][row] = verdict.chosen ? verdict.chosen.score : null;
  }

  for (const block of page.blocks) {
    if (block.type !== 'question') continue;
    const cells = fills.filter((f) => f.kind === 'option' && f.qId === block.qId);
    const verdict = judgeRow(cells);
    if (verdict.flag) {
      flags.push({
        qId: block.qId,
        kind: verdict.flag === 'multiple' ? 'overvote' : verdict.flag,
        message: verdict.message.replace('%WHAT%', 'answer'),
      });
    }
    if (verdict.flag === 'multiple') {
      questions[block.qId] = null; // an overvoted question counts as blank
    } else {
      questions[block.qId] = verdict.chosen ? verdict.chosen.value : null;
    }
  }
  return { votesByRow, questions, flags };
}

// Decides which bubble in a row (if any) is marked. Returns
// { chosen, flag, message } where chosen is the winning cell or null
// for a blank row. The %WHAT% token in messages becomes "score" or
// "answer" at the call site.
function judgeRow(cells) {
  const sorted = [...cells].sort((a, b) => b.fill - a.fill);
  const baseline = median(cells.length === 2
    ? [sorted[1].fill]
    : sorted.slice(1).map((c) => c.fill));
  const signal = (c) => c.fill - baseline;
  const marked = sorted.filter((c) => signal(c) >= MARK_MARGIN || c.fill >= FILL_THRESHOLD);

  if (baseline >= MESSY_BASELINE) {
    return {
      chosen: marked[0] || sorted[0],
      flag: 'messy',
      message: 'This whole row reads heavily marked; check the %WHAT%.',
    };
  }
  if (marked.length > 1) {
    return {
      chosen: marked[0],
      flag: 'multiple',
      message: 'More than one bubble marked; kept the darkest.',
    };
  }
  if (marked.length === 1) {
    const top = marked[0];
    if (top.fill < CONFIDENT) {
      return {
        chosen: top,
        flag: 'uncertain',
        message: 'Mark read at only ' + pct(top.fill) + '% ink; confirm the %WHAT%.',
      };
    }
    const runnerUp = sorted.find((c) => c !== top);
    if (runnerUp && signal(runnerUp) >= FAINT_MARGIN) {
      return {
        chosen: top,
        flag: 'stray',
        message: 'Another bubble shows partial marking ('
          + pct(runnerUp.fill) + '% ink); confirm the %WHAT%.',
      };
    }
    return { chosen: top, flag: null };
  }
  // Nothing cleared the mark threshold. A near-miss gets flagged but
  // is NOT chosen: the scanner never picks a value the voter did not
  // clearly make, and a blank row stays blank. Even a clean blank is
  // flagged, because a blank row is exactly where a missed mark
  // would hide; the official confirms it during review.
  if (sorted[0] && signal(sorted[0]) >= FAINT_MARGIN) {
    return {
      chosen: null,
      flag: 'faint',
      message: 'Possible faint mark (' + pct(sorted[0].fill)
        + '% ink) left blank; confirm the %WHAT%.',
    };
  }
  return {
    chosen: null,
    flag: 'blank',
    message: 'Read as blank; confirm.',
  };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Summed-area table for fast box means. sums has (w+1) x (h+1)
// entries; boxSum(x0,y0,x1,y1) is inclusive of x0,y0 and exclusive of
// x1,y1.
function buildIntegral(gray) {
  const { width: w, height: h, data } = gray;
  const sums = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x];
      sums[(y + 1) * (w + 1) + (x + 1)] = sums[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  return { sums, w, h };
}

function boxMean(integral, x0, y0, x1, y1) {
  const { sums, w, h } = integral;
  x0 = Math.max(0, Math.min(w, Math.round(x0)));
  x1 = Math.max(0, Math.min(w, Math.round(x1)));
  y0 = Math.max(0, Math.min(h, Math.round(y0)));
  y1 = Math.max(0, Math.min(h, Math.round(y1)));
  const area = (x1 - x0) * (y1 - y0);
  if (area <= 0) return 255;
  const W = w + 1;
  const s = sums[y1 * W + x1] - sums[y0 * W + x1] - sums[y1 * W + x0] + sums[y0 * W + x0];
  return s / area;
}

// Wide search: slides a mark-sized box over the window and scores
// "dark square on light surround". Returns the best center, refined
// to the dark centroid, or null when nothing square-ish is found.
function findMarkCoarse(gray, integral, H, mark, half) {
  const predicted = applyH(H, mark.x, mark.y);
  const scale = localScale(H, mark.x, mark.y);
  const s = Math.max(3, GEOM.markSize * scale);
  const x0 = Math.max(0, Math.round(predicted.x - half));
  const x1 = Math.min(gray.width - 1, Math.round(predicted.x + half));
  const y0 = Math.max(0, Math.round(predicted.y - half));
  const y1 = Math.min(gray.height - 1, Math.round(predicted.y + half));
  if (x1 - x0 < s || y1 - y0 < s) return null;

  const step = Math.max(1, Math.floor(s / 4));
  let best = null;
  let bestScore = -Infinity;
  for (let cy = y0 + s / 2; cy <= y1 - s / 2; cy += step) {
    for (let cx = x0 + s / 2; cx <= x1 - s / 2; cx += step) {
      const inner = boxMean(integral, cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2);
      const outerMean = boxMean(integral, cx - s, cy - s, cx + s, cy + s);
      // Surround-only mean from the two box means.
      const surround = (outerMean * 4 - inner) / 3;
      const score = surround - inner;
      if (score > bestScore) {
        bestScore = score;
        best = { x: cx, y: cy };
      }
    }
  }
  if (!best || bestScore < 25) return null;
  return centroidNear(gray, best, s) || best;
}

// Tight pass once the four marks have anchored a good homography.
function findMarkFine(gray, H, mark) {
  const predicted = applyH(H, mark.x, mark.y);
  const scale = localScale(H, mark.x, mark.y);
  const s = Math.max(3, GEOM.markSize * scale);
  return centroidNear(gray, predicted, s * 1.4);
}

// Dark-pixel centroid within a square window of half-size `half`.
function centroidNear(gray, center, half) {
  const x0 = Math.max(0, Math.round(center.x - half));
  const x1 = Math.min(gray.width - 1, Math.round(center.x + half));
  const y0 = Math.max(0, Math.round(center.y - half));
  const y1 = Math.min(gray.height - 1, Math.round(center.y + half));
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  let min = 255;
  let max = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = gray.data[y * gray.width + x];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (max - min < 30) return null;
  const thr = (min + max) / 2;
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (gray.data[y * gray.width + x] < thr) {
        sx += x; sy += y; count += 1;
      }
    }
  }
  if (count < 6) return null;
  return { x: sx / count, y: sy / count };
}

function toGray(image) {
  const { data, width, height } = image;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p] * 2 + data[p + 1] * 3 + data[p + 2]) / 6;
  }
  return { data: out, width, height };
}

// Mean gray level inside a disk.
function sampleDisk(gray, center, radius) {
  const r = Math.max(1.5, radius);
  const x0 = Math.max(0, Math.floor(center.x - r));
  const x1 = Math.min(gray.width - 1, Math.ceil(center.x + r));
  const y0 = Math.max(0, Math.floor(center.y - r));
  const y1 = Math.min(gray.height - 1, Math.ceil(center.y + r));
  let sum = 0;
  let count = 0;
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - center.x;
      const dy = y - center.y;
      if (dx * dx + dy * dy <= r2) {
        sum += gray.data[y * gray.width + x];
        count += 1;
      }
    }
  }
  return count > 0 ? sum / count : 255;
}

// Paper brightness estimate: median of small patches at quiet spots
// spread over the content area.
function samplePaper(gray, H, layout) {
  const { paper } = layout;
  const xs = [paper.w * 0.5, paper.w * 0.28, paper.w * 0.72];
  const ys = [layout.contentTop - 5, paper.h - GEOM.footerReserve + 8, paper.h * 0.5];
  const samples = [];
  for (const px of xs) {
    for (const py of ys) {
      const c = applyH(H, px, py);
      if (c.x < 2 || c.y < 2 || c.x > gray.width - 3 || c.y > gray.height - 3) continue;
      samples.push(sampleDisk(gray, c, 2.5));
    }
  }
  samples.sort((a, b) => a - b);
  return samples.length > 0 ? samples[Math.floor(samples.length / 2)] : 255;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Maps printed-row scores to canonical candidate indexes using the
// per-ballot shuffle. Returns the sparse vote maps records.js expects.
export async function toCanonicalVotes(election, serial, votesByRow, candidateOrderFn) {
  const votes = {};
  for (const [raceId, rows] of Object.entries(votesByRow)) {
    const race = election.races.find((r) => r.id === raceId);
    const order = await candidateOrderFn(election, serial, race);
    votes[raceId] = {};
    for (const [rowStr, score] of Object.entries(rows)) {
      votes[raceId][order[Number(rowStr)]] = score;
    }
  }
  return votes;
}
