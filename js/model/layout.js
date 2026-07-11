// Ballot page geometry, in millimeters.
//
// The printer and the scanner both call layoutPages() so bubble
// positions always agree. Geometry depends only on the election
// definition, never on the ballot serial: randomizing candidate order
// swaps the printed names between rows but leaves every bubble where
// it is. That is also why a race's row height comes from its longest
// candidate name, not the name printed in the row: every serial must
// produce the same geometry.
//
// Long text wraps instead of overlapping the score columns. Layout
// measures with the same font metrics render.js draws with (text.js),
// so every wrapped line stays inside the space reserved for it. An
// election with a one-line title, no logo, and short names lays out
// exactly as LAYOUT_VERSION 1 did, so ballots printed before wrapping
// existed still scan.

import { textWidth, wrapLines } from './text.js';

export const LAYOUT_VERSION = 2;

export const PAPERS = {
  letter: { w: 215.9, h: 279.4, label: 'US Letter' },
  a4: { w: 210, h: 297, label: 'A4' },
};

export const GEOM = {
  markSize: 6,          // registration square side
  markInset: 12,        // center distance from page edges
  contentTop: 34,       // minimum; the real value is layout.contentTop
  footerReserve: 46,    // space kept for QR, ballot code, marks
  leftMargin: 20,
  raceHeaderH: 9,
  rowH: 9,
  blockGap: 7,
  questionHeaderH: 9,
  bubbleR: 2.4,         // bubble radius
  colSpacing: 11,       // distance between score columns
  colRightInset: 26,    // rightmost column center from right edge
  qrSize: 26,
  qrX: 16,
};

// Font sizes and line advances shared with render.js, in mm.
export const FONT = {
  title: 5.2, titleLineH: 6.2,
  instr: 3, instrLineH: 3.8,
  block: 4.2, blockLineH: 5,   // race and question titles
  name: 3.6, nameLineH: 4.2,
  label: 3.4, labelLineH: 4,   // question option labels
  pageLabel: 3.6,
};

export const LOGO_BOX = { maxW: 45, maxH: 16 };

export const INSTRUCTIONS = 'Fill bubbles completely with dark ink. '
  + 'Score each candidate 0 (oppose) to 5 (strongest support). '
  + 'Blank rows count as 0.';

export function paperFor(election) {
  return PAPERS[election.paper] || PAPERS.letter;
}

// Score bubble column centers, index 0..5.
export function scoreCols(paper) {
  const cols = [];
  for (let s = 0; s <= 5; s++) {
    cols.push(paper.w - GEOM.colRightInset - (5 - s) * GEOM.colSpacing);
  }
  return cols;
}

export function markCenters(paper) {
  const m = GEOM.markInset;
  return [
    { x: m, y: m },
    { x: paper.w - m, y: m },
    { x: paper.w - m, y: paper.h - m },
    { x: m, y: paper.h - m },
  ];
}

// Width available to a candidate name before the first score column.
export function nameMaxWidth(cols) {
  return cols[0] - GEOM.bubbleR - 2 - GEOM.leftMargin;
}

export function wrapName(name, cols) {
  return wrapLines(name, FONT.name, nameMaxWidth(cols), { maxLines: 2 });
}

// Race and question titles stop short of the "oppose" column label.
function blockTitleMaxWidth(cols) {
  return cols[0] - 4 - GEOM.leftMargin;
}

// The page header: optional logo, election title, instructions, rule.
// The logo sits at the left margin like a letterhead seal, with the
// title and instructions indented past it. The right side of the
// first title line is reserved for the "OFFICIAL BALLOT - PAGE X OF Y"
// label at its widest. Indenting the text column can wrap the title
// or instructions onto extra lines, so adding a logo may move the
// content area down; the layout stays deterministic either way.
function layoutHeader(election, paper) {
  const left = GEOM.leftMargin;
  const reserve = textWidth('OFFICIAL BALLOT - PAGE 88 OF 88', FONT.pageLabel) + 4;

  let logo = null;
  let textLeft = left;
  if (election.logo) {
    const s = Math.min(LOGO_BOX.maxW / election.logo.w, LOGO_BOX.maxH / election.logo.h);
    const w = election.logo.w * s;
    const h = election.logo.h * s;
    logo = { x: left, y: 7, w, h };
    textLeft = left + w + 5;
  }

  const titleY = 16; // first title baseline, LAYOUT_VERSION 1 position
  const titleLines = wrapLines(election.title, FONT.title,
    paper.w - left - reserve - textLeft, { bold: true, maxLines: 3 });
  const lastTitleY = titleY + (titleLines.length - 1) * FONT.titleLineH;
  const instrLines = wrapLines(INSTRUCTIONS, FONT.instr,
    paper.w - left - textLeft, { maxLines: 2 });
  const instrY = lastTitleY + 6.5;
  const textBottom = instrY + (instrLines.length - 1) * FONT.instrLineH + 3.5;
  const ruleY = Math.max(textBottom, logo ? logo.y + logo.h + 3 : 0);
  return {
    logo, textLeft, titleY, titleLines, instrY, instrLines, ruleY,
    contentTop: ruleY + 8,
  };
}

// Lays races and questions onto pages. Returns:
// {
//   paper, cols, marks, pageCount, header, contentTop,
//   qr: {x, y, size},
//   pages: [{ number, blocks: [block] }],
// }
// Race block: { type:'race', raceId, title, continued, titleLines,
//               headerY, rowH, rows: [{ printedRow, y }] }
// Question block: { type:'question', qId, title, titleLines, headerY,
//                   rowH, row: { y, options:
//                     [{x, value, label, labelLines}] } }
// headerY is the baseline of the first title line; later lines step
// down by FONT.blockLineH. Bubbles sit at the vertical center y of
// each row, and rowH is uniform within a race.
export function layoutPages(election) {
  const paper = paperFor(election);
  const cols = scoreCols(paper);
  const header = layoutHeader(election, paper);
  const bottomLimit = paper.h - GEOM.footerReserve;
  const titleMaxW = blockTitleMaxWidth(cols);

  const pages = [];
  let blocks = [];
  let y = header.contentTop;

  const newPage = () => {
    pages.push({ number: pages.length + 1, blocks });
    blocks = [];
    y = header.contentTop;
  };

  for (const race of election.races) {
    const nameLines = race.candidates.length === 0 ? 1 : Math.max(
      ...race.candidates.map((c) => wrapName(c, cols).length));
    const rowH = GEOM.rowH + (nameLines - 1) * FONT.nameLineH;
    let rowsPlaced = 0;
    let continued = false;
    while (rowsPlaced < race.candidates.length) {
      const titleLines = wrapLines(
        race.title + (continued ? ' (continued)' : ''),
        FONT.block, titleMaxW, { bold: true, maxLines: 3 });
      const headerNeed = GEOM.raceHeaderH + (titleLines.length - 1) * FONT.blockLineH;
      const roomRows = Math.floor((bottomLimit - y - headerNeed) / rowH);
      if (roomRows < 1) {
        if (blocks.length === 0) break; // page can never fit anything
        newPage();
        continue;
      }
      const take = Math.min(roomRows, race.candidates.length - rowsPlaced);
      const block = {
        type: 'race',
        raceId: race.id,
        title: race.title,
        continued,
        titleLines,
        headerY: y + 5,
        rowH,
        rows: [],
      };
      y += headerNeed;
      for (let k = 0; k < take; k++) {
        block.rows.push({ printedRow: rowsPlaced + k, y: y + rowH / 2 });
        y += rowH;
      }
      blocks.push(block);
      rowsPlaced += take;
      continued = true;
      if (rowsPlaced < race.candidates.length) newPage();
      else y += GEOM.blockGap;
    }
  }

  for (const q of election.questions) {
    // Question titles get the full content width: unlike race titles
    // they share their lines with nothing, the options row is below.
    const titleLines = wrapLines(q.title, FONT.block,
      paper.w - 2 * GEOM.leftMargin, { bold: true, maxLines: 4 });
    const headerNeed = GEOM.questionHeaderH + (titleLines.length - 1) * FONT.blockLineH;
    const labels = [q.labels ? q.labels[0] : 'Yes', q.labels ? q.labels[1] : 'No'];
    // Yes labels run left from their bubble toward the margin; No
    // labels only have the gap between the two bubbles.
    const yesLines = wrapLines(labels[0], FONT.label,
      cols[3] - 4 - GEOM.leftMargin, { maxLines: 3 });
    const noLines = wrapLines(labels[1], FONT.label,
      cols[5] - 4 - (cols[3] + GEOM.bubbleR + 2), { maxLines: 3 });
    const labelLines = Math.max(yesLines.length, noLines.length);
    const rowH = GEOM.rowH + (labelLines - 1) * FONT.labelLineH;
    const need = headerNeed + rowH;
    if (y + need > bottomLimit && blocks.length > 0) newPage();
    const block = {
      type: 'question',
      qId: q.id,
      title: q.title,
      titleLines,
      headerY: y + 5,
      rowH,
      row: {
        y: y + headerNeed + rowH / 2,
        options: [
          { x: cols[3], value: 1, label: labels[0], labelLines: yesLines },
          { x: cols[5], value: 0, label: labels[1], labelLines: noLines },
        ],
      },
    };
    blocks.push(block);
    y += need + GEOM.blockGap;
  }

  if (blocks.length > 0) pages.push({ number: pages.length + 1, blocks });
  if (pages.length === 0) pages.push({ number: 1, blocks: [] });

  return {
    paper,
    cols,
    marks: markCenters(paper),
    header,
    contentTop: header.contentTop,
    qr: { x: GEOM.qrX, y: paper.h - GEOM.qrSize - 14, size: GEOM.qrSize },
    pageCount: pages.length,
    pages,
  };
}

// The QR payload printed on each page.
export function qrPayload(electionIdCode, ballotCodeStr, page, pageCount) {
  return ['OC1', electionIdCode, ballotCodeStr, page, pageCount].join('|');
}

export function parseQrPayload(text) {
  const parts = String(text).trim().split('|');
  if (parts.length !== 5 || parts[0] !== 'OC1') return null;
  const page = Number(parts[3]);
  const pageCount = Number(parts[4]);
  if (!Number.isInteger(page) || !Number.isInteger(pageCount)
      || page < 1 || pageCount < 1 || page > pageCount) return null;
  return { electionId: parts[1], ballotCode: parts[2], page, pageCount };
}

// Every fillable bubble on a page, for the scanner. Returns
// [{ x, y, kind: 'score'|'option', raceId?, printedRow?, score?,
//    qId?, value? }]
export function pageBubbles(layout, page) {
  const out = [];
  for (const block of page.blocks) {
    if (block.type === 'race') {
      for (const row of block.rows) {
        for (let s = 0; s <= 5; s++) {
          out.push({
            x: layout.cols[s], y: row.y, kind: 'score',
            raceId: block.raceId, printedRow: row.printedRow, score: s,
          });
        }
      }
    } else {
      for (const opt of block.row.options) {
        out.push({
          x: opt.x, y: block.row.y, kind: 'option',
          qId: block.qId, value: opt.value,
        });
      }
    }
  }
  return out;
}
