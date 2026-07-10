// Test-only rasterizer: draws a ballot page into an RGBA buffer as if
// photographed under a perspective transform. Only the elements the
// detector cares about are drawn: registration marks, QR modules,
// bubble outlines, and voter-filled bubbles.

import { GEOM, pageBubbles } from '../../js/model/layout.js';
import { qrModules } from '../../js/model/render.js';
import { qrPayload } from '../../js/model/layout.js';
import { computeHomography, applyH, invertH } from '../../js/scan/homography.js';

export function makeImage(width, height, background = 235) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = background;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

// Simulates uneven lighting: brightness falls off linearly from the
// top-left corner to the bottom-right, like a shadowed photo.
export function addLightingGradient(image, drop = 60) {
  const { data, width, height } = image;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const factor = 1 - (drop / 255) * t;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * factor);
    }
  }
}

// Deterministic light noise so tests exercise non-uniform paper.
export function addNoise(image, amplitude = 6, seed = 12345) {
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < image.data.length; i += 4) {
    const d = Math.round((next() - 0.5) * 2 * amplitude);
    for (let c = 0; c < 3; c++) {
      image.data[i + c] = Math.max(0, Math.min(255, image.data[i + c] + d));
    }
  }
}

// Draws a shape into the image. `test(px, py)` answers whether a
// page-space point is inside the shape; bbox is its page-space
// bounding box {x0, y0, x1, y1}.
function drawShape(image, H, Hinv, bbox, test, shade = 30) {
  const corners = [
    applyH(H, bbox.x0, bbox.y0), applyH(H, bbox.x1, bbox.y0),
    applyH(H, bbox.x1, bbox.y1), applyH(H, bbox.x0, bbox.y1),
  ];
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - 1);
  const x1 = Math.min(image.width - 1, Math.ceil(Math.max(...corners.map((c) => c.x))) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - 1);
  const y1 = Math.min(image.height - 1, Math.ceil(Math.max(...corners.map((c) => c.y))) + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = applyH(Hinv, x + 0.5, y + 0.5);
      if (p.x >= bbox.x0 && p.x <= bbox.x1 && p.y >= bbox.y0 && p.y <= bbox.y1 && test(p.x, p.y)) {
        const i = (y * image.width + x) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = shade;
      }
    }
  }
}

function rect(image, H, Hinv, cx, cy, w, h, shade = 30) {
  const bbox = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
  drawShape(image, H, Hinv, bbox, () => true, shade);
}

function disk(image, H, Hinv, cx, cy, r, shade = 30) {
  const bbox = { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
  drawShape(image, H, Hinv, bbox,
    (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, shade);
}

function ring(image, H, Hinv, cx, cy, r, width, shade = 60) {
  const bbox = { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
  drawShape(image, H, Hinv, bbox, (x, y) => {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    return d2 <= r * r && d2 >= (r - width) ** 2;
  }, shade);
}

// Renders one ballot page.
// marks: { 'raceId|printedRow': score, ... } bubbles to fill,
// answers: { qId: 1|0 } question options to fill.
// quad: four image-space corners the page maps onto, in page corner
// order TL TR BR BL.
export function rasterPage(opts) {
  const { election, layout, page, electionIdCode, ballotCodeStr,
    marks = {}, answers = {}, image, quad, fillShade = 40 } = opts;
  const { paper } = layout;
  const src = [
    { x: 0, y: 0 }, { x: paper.w, y: 0 },
    { x: paper.w, y: paper.h }, { x: 0, y: paper.h },
  ];
  const H = computeHomography(src, quad);
  const Hinv = invertH(H);

  // Paper: white the page area itself so it contrasts the backdrop.
  drawShape(image, H, Hinv, { x0: 0, y0: 0, x1: paper.w, y1: paper.h }, () => true, 250);

  // Registration marks.
  for (const m of layout.marks) {
    rect(image, H, Hinv, m.x, m.y, GEOM.markSize, GEOM.markSize, 15);
  }

  // QR code.
  const payload = qrPayload(electionIdCode, ballotCodeStr, page.number, layout.pageCount);
  const mods = qrModules(payload);
  const n = mods.length;
  const cell = layout.qr.size / (n + 4);
  const ox = layout.qr.x + 2 * cell;
  const oy = layout.qr.y + 2 * cell;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mods[r][c]) {
        rect(image, H, Hinv, ox + (c + 0.5) * cell, oy + (r + 0.5) * cell, cell * 1.04, cell * 1.04, 15);
      }
    }
  }

  // Bubbles: outlines always, fills where the voter marked.
  for (const b of pageBubbles(layout, page)) {
    ring(image, H, Hinv, b.x, b.y, GEOM.bubbleR, 0.4, 90);
    let filled = false;
    if (b.kind === 'score') {
      filled = marks[b.raceId + '|' + b.printedRow] === b.score;
    } else {
      filled = answers[b.qId] === b.value;
    }
    if (filled) {
      disk(image, H, Hinv, b.x, b.y, GEOM.bubbleR * 0.95, fillShade);
    }
  }
  return H;
}

// Draws one extra filled bubble onto an already-rendered page, for
// simulating stray or double marks.
export function fillExtraBubble(image, H, layout, page, match, shade = 40) {
  const Hinv = invertH(H);
  for (const b of pageBubbles(layout, page)) {
    const hit = b.kind === 'score'
      ? b.raceId === match.raceId && b.printedRow === match.printedRow && b.score === match.score
      : b.qId === match.qId && b.value === match.value;
    if (hit) disk(image, H, Hinv, b.x, b.y, GEOM.bubbleR * 0.95, shade);
  }
}

// Draws a small off-center blot instead of a neat fill: the way real
// voters mark with a checkmark tick or a quick dot. Covers only part
// of the bubble and misses its center.
export function partialMark(image, H, layout, page, match, shade = 55) {
  const Hinv = invertH(H);
  for (const b of pageBubbles(layout, page)) {
    const hit = b.kind === 'score'
      && b.raceId === match.raceId && b.printedRow === match.printedRow && b.score === match.score;
    if (hit) {
      disk(image, H, Hinv, b.x + 0.9, b.y + 0.6, GEOM.bubbleR * 0.5, shade);
    }
  }
}
