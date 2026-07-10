// Ballot page geometry, in millimeters.
//
// The printer and the scanner both call layoutPages() so bubble
// positions always agree. Geometry depends only on the election
// definition, never on the ballot serial: randomizing candidate order
// swaps the printed names between rows but leaves every bubble where
// it is.

export const LAYOUT_VERSION = 1;

export const PAPERS = {
  letter: { w: 215.9, h: 279.4, label: 'US Letter' },
  a4: { w: 210, h: 297, label: 'A4' },
};

export const GEOM = {
  markSize: 6,          // registration square side
  markInset: 12,        // center distance from page edges
  contentTop: 34,
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

// Lays races and questions onto pages. Returns:
// {
//   paper, cols, marks, pageCount,
//   qr: {x, y, size},
//   pages: [{ number, blocks: [block] }],
// }
// Race block: { type:'race', raceId, title, continued,
//               headerY, rows: [{ printedRow, y }] }
// Question block: { type:'question', qId, title, headerY,
//                   row: { y, options: [{x, value, label}] } }
export function layoutPages(election) {
  const paper = paperFor(election);
  const cols = scoreCols(paper);
  const bottomLimit = paper.h - GEOM.footerReserve;

  const pages = [];
  let blocks = [];
  let y = GEOM.contentTop;

  const newPage = () => {
    pages.push({ number: pages.length + 1, blocks });
    blocks = [];
    y = GEOM.contentTop;
  };

  for (const race of election.races) {
    let rowsPlaced = 0;
    let continued = false;
    while (rowsPlaced < race.candidates.length) {
      const headerNeed = GEOM.raceHeaderH;
      const roomRows = Math.floor((bottomLimit - y - headerNeed) / GEOM.rowH);
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
        headerY: y + 5,
        rows: [],
      };
      y += headerNeed;
      for (let k = 0; k < take; k++) {
        block.rows.push({ printedRow: rowsPlaced + k, y: y + GEOM.rowH / 2 });
        y += GEOM.rowH;
      }
      blocks.push(block);
      rowsPlaced += take;
      continued = true;
      if (rowsPlaced < race.candidates.length) newPage();
      else y += GEOM.blockGap;
    }
  }

  for (const q of election.questions) {
    const need = GEOM.questionHeaderH + GEOM.rowH;
    if (y + need > bottomLimit && blocks.length > 0) newPage();
    const block = {
      type: 'question',
      qId: q.id,
      title: q.title,
      headerY: y + 5,
      row: {
        y: y + GEOM.questionHeaderH + GEOM.rowH / 2,
        options: [
          { x: cols[3], value: 1, label: q.labels ? q.labels[0] : 'Yes' },
          { x: cols[5], value: 0, label: q.labels ? q.labels[1] : 'No' },
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
