// Renders one ballot page as an SVG string, in real millimeters, for
// printing or PDF export. Pure string generation so it can be tested
// in Node.

import qrcode from '../vendor/qrcode.mjs';
import { GEOM, qrPayload } from './layout.js';
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

// One page of one ballot.
// opts: { election, layout, page, serial, code, orders, electionIdCode }
export function renderPageSvg(opts) {
  const { election, layout, page, code, orders, electionIdCode } = opts;
  const { paper } = layout;
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
  p.push(`<text x="${left}" y="16" font-size="5.2" font-weight="bold" fill="#000">${esc(election.title)}</text>`);
  p.push(`<text x="${right}" y="16" font-size="3.6" fill="#000" text-anchor="end">OFFICIAL BALLOT`
    + (layout.pageCount > 1 ? ` - PAGE ${page.number} OF ${layout.pageCount}` : '') + `</text>`);
  p.push(`<text x="${left}" y="22.5" font-size="3" fill="#444">`
    + `Fill bubbles completely with dark ink. Score each candidate 0 (oppose) to 5 (strongest support). `
    + `Blank rows count as 0.</text>`);
  p.push(`<line x1="${left}" y1="26" x2="${right}" y2="26" stroke="#000" stroke-width="0.4"/>`);

  // Content blocks.
  for (const block of page.blocks) {
    if (block.type === 'race') {
      const title = block.title + (block.continued ? ' (continued)' : '');
      p.push(`<text x="${left}" y="${block.headerY}" font-size="4.2" font-weight="bold" fill="#000">${esc(title)}</text>`);
      p.push(`<text x="${layout.cols[0] - 2}" y="${block.headerY}" font-size="2.6" fill="#666">`
        + `oppose</text>`);
      p.push(`<text x="${layout.cols[5] + 3}" y="${block.headerY}" font-size="2.6" fill="#666" text-anchor="end">`
        + `support</text>`);
      const race = election.races.find((r) => r.id === block.raceId);
      const order = orders[block.raceId];
      for (const row of block.rows) {
        const name = race.candidates[order[row.printedRow]];
        p.push(`<text x="${left}" y="${row.y + 1.2}" font-size="3.6" fill="#000">${esc(name)}</text>`);
        p.push(`<line x1="${left}" y1="${row.y + 4}" x2="${right}" y2="${row.y + 4}" stroke="#ddd" stroke-width="0.2"/>`);
        for (let s = 0; s <= 5; s++) {
          p.push(bubble(layout.cols[s], row.y, String(s)));
        }
      }
    } else {
      p.push(`<text x="${left}" y="${block.headerY}" font-size="4.2" font-weight="bold" fill="#000">${esc(block.title)}</text>`);
      for (const opt of block.row.options) {
        p.push(bubble(opt.x, block.row.y, ''));
        p.push(`<text x="${opt.x - 4}" y="${block.row.y + 1.2}" font-size="3.4" fill="#000" text-anchor="end">${esc(opt.label)}</text>`);
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
