// Renders one ballot page as an SVG string, in real millimeters, for
// printing or PDF export. Pure string generation so it can be tested
// in Node.

import qrcode from '../vendor/qrcode.mjs';
import { GEOM, FONT, qrPayload, wrapName } from './layout.js';
import { groupCode } from './codec.js';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function qrModules(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

function qrSvg(text, x, y, size) {
  const mods = qrModules(text);
  const n = mods.length;
  // Quiet zone of 2 modules inside the allotted square.
  const cell = size / (n + 4);
  const ox = x + 2 * cell;
  const oy = y + 2 * cell;
  const parts = [`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff"/>`];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (mods[r][c]) {
        let run = 1;
        while (c + run < n && mods[r][c + run]) run += 1;
        parts.push(
          `<rect x="${(ox + c * cell).toFixed(3)}" y="${(oy + r * cell).toFixed(3)}" `
          + `width="${(run * cell + 0.02).toFixed(3)}" height="${(cell + 0.02).toFixed(3)}" fill="#000"/>`,
        );
        c += run;
      } else c += 1;
    }
  }
  return parts.join('');
}

function bubble(cx, cy, label) {
  return `<circle cx="${cx}" cy="${cy}" r="${GEOM.bubbleR}" fill="none" stroke="#111" stroke-width="0.35"/>`
    + `<text x="${cx}" y="${cy + 1.05}" font-size="2.9" fill="#999" text-anchor="middle">${esc(label)}</text>`;
}

// A stack of text lines. y is the baseline of the first line; each
// further line steps down by lineH.
function textLines(lines, x, y, lineH, attrs) {
  return lines.map((line, i) => (
    `<text x="${x}" y="${(y + i * lineH).toFixed(2)}" ${attrs}>${esc(line)}</text>`
  )).join('');
}

// Lines centered vertically around cy, as a group. The single-line
// case puts the baseline at cy + 1.05ish like the bubbles expect.
function centeredLines(lines, x, cy, fs, lineH, attrs) {
  const y0 = cy + 1.2 - ((lines.length - 1) * lineH) / 2;
  return textLines(lines, x, y0, lineH, `font-size="${fs}" ${attrs}`);
}

// One page of one ballot.
// opts: { election, layout, page, serial, code, orders, electionIdCode }
export function renderPageSvg(opts) {
  const { election, layout, page, code, orders, electionIdCode } = opts;
  const { paper, header } = layout;
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paper.w} ${paper.h}" `
    + `font-family="Helvetica, Arial, sans-serif" class="ballot-page">`);
  p.push(`<rect x="0" y="0" width="${paper.w}" height="${paper.h}" fill="#fff"/>`);

  // Registration marks.
  for (const m of layout.marks) {
    p.push(`<rect x="${m.x - GEOM.markSize / 2}" y="${m.y - GEOM.markSize / 2}" `
      + `width="${GEOM.markSize}" height="${GEOM.markSize}" fill="#000"/>`);
  }

  // Header.
  const left = GEOM.leftMargin;
  const right = paper.w - GEOM.leftMargin;
  if (header.logo && election.logo) {
    p.push(`<image x="${header.logo.x.toFixed(2)}" y="${header.logo.y}" `
      + `width="${header.logo.w.toFixed(2)}" height="${header.logo.h.toFixed(2)}" `
      + `preserveAspectRatio="xMidYMid meet" href="${esc(election.logo.data)}"/>`);
  }
  p.push(textLines(header.titleLines, left, header.titleY, FONT.titleLineH,
    `font-size="${FONT.title}" font-weight="bold" fill="#000"`));
  p.push(`<text x="${right}" y="${header.titleY}" font-size="${FONT.pageLabel}" fill="#000" text-anchor="end">OFFICIAL BALLOT`
    + (layout.pageCount > 1 ? ` - PAGE ${page.number} OF ${layout.pageCount}` : '') + `</text>`);
  p.push(textLines(header.instrLines, left, header.instrY, FONT.instrLineH,
    `font-size="${FONT.instr}" fill="#444"`));
  p.push(`<line x1="${left}" y1="${header.ruleY}" x2="${right}" y2="${header.ruleY}" stroke="#000" stroke-width="0.4"/>`);

  // Content blocks.
  for (const block of page.blocks) {
    p.push(textLines(block.titleLines, left, block.headerY, FONT.blockLineH,
      `font-size="${FONT.block}" font-weight="bold" fill="#000"`));
    const lastTitleY = block.headerY + (block.titleLines.length - 1) * FONT.blockLineH;
    if (block.type === 'race') {
      p.push(`<text x="${layout.cols[0] - 2}" y="${lastTitleY}" font-size="2.6" fill="#666">`
        + `oppose</text>`);
      p.push(`<text x="${layout.cols[5] + 3}" y="${lastTitleY}" font-size="2.6" fill="#666" text-anchor="end">`
        + `support</text>`);
      const race = election.races.find((r) => r.id === block.raceId);
      const order = orders[block.raceId];
      for (const row of block.rows) {
        const name = race.candidates[order[row.printedRow]];
        p.push(centeredLines(wrapName(name, layout.cols), left, row.y,
          FONT.name, FONT.nameLineH, 'fill="#000"'));
        const sepY = (row.y + block.rowH / 2 - 0.5).toFixed(2);
        p.push(`<line x1="${left}" y1="${sepY}" x2="${right}" y2="${sepY}" stroke="#ddd" stroke-width="0.2"/>`);
        for (let s = 0; s <= 5; s++) {
          p.push(bubble(layout.cols[s], row.y, String(s)));
        }
      }
    } else {
      for (const opt of block.row.options) {
        p.push(bubble(opt.x, block.row.y, ''));
        p.push(centeredLines(opt.labelLines, opt.x - 4, block.row.y,
          FONT.label, FONT.labelLineH, 'fill="#000" text-anchor="end"'));
      }
    }
  }

  // Footer: QR left, ballot code right.
  const payload = qrPayload(electionIdCode, code, page.number, layout.pageCount);
  p.push(qrSvg(payload, layout.qr.x, layout.qr.y, layout.qr.size));
  const fy = paper.h - 32;
  p.push(`<text x="${right}" y="${fy}" font-size="5.4" font-weight="bold" font-family="monospace" `
    + `text-anchor="end" fill="#000">${esc(code)}</text>`);
  p.push(`<text x="${right}" y="${fy + 5.5}" font-size="3.2" font-family="monospace" text-anchor="end" fill="#333">`
    + `ELECTION ${esc(groupCode(electionIdCode))}</text>`);
  p.push(`<text x="${right}" y="${fy + 10}" font-size="2.6" text-anchor="end" fill="#888">`
    + `Keep this code private until scanned. Ocellus STAR ballot.</text>`);

  p.push('</svg>');
  return p.join('\n');
}

// All pages for one ballot serial.
export function renderBallotSvgs(opts) {
  return opts.layout.pages.map((page) => renderPageSvg({ ...opts, page }));
}
