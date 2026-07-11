import test from 'node:test';
import assert from 'node:assert/strict';

import { newElection, addRace, addQuestion, electionId } from '../js/model/election.js';
import { ballotCode, candidateOrder } from '../js/model/ballotid.js';
import { layoutPages, pageBubbles, qrPayload, parseQrPayload, GEOM } from '../js/model/layout.js';
import { renderBallotSvgs, qrModules } from '../js/model/render.js';

async function bigElection() {
  const e = newElection('Annual Meeting');
  const pres = addRace(e, 'President');
  pres.candidates = ['Alice', 'Bob', 'Carol', 'Dave'];
  const treas = addRace(e, 'Treasurer');
  treas.candidates = Array.from({ length: 30 }, (_, i) => 'Candidate ' + (i + 1));
  const q = addQuestion(e, 'Adopt the new bylaws?');
  q.num = 2; q.den = 3;
  return e;
}

test('layout flows long races across pages and stays deterministic', async () => {
  const e = await bigElection();
  const layout = layoutPages(e);
  assert.ok(layout.pageCount >= 2, 'thirty candidates should overflow one page');
  const layout2 = layoutPages(e);
  assert.deepEqual(layout, layout2);

  // Every candidate row exists exactly once per race.
  const rowsByRace = {};
  for (const page of layout.pages) {
    for (const block of page.blocks) {
      if (block.type !== 'race') continue;
      rowsByRace[block.raceId] = rowsByRace[block.raceId] || [];
      for (const row of block.rows) rowsByRace[block.raceId].push(row.printedRow);
    }
  }
  assert.deepEqual(rowsByRace.r1.sort((a, b) => a - b), [0, 1, 2, 3]);
  assert.equal(rowsByRace.r2.length, 30);
  assert.equal(new Set(rowsByRace.r2).size, 30);

  // All bubbles stay inside the content area.
  for (const page of layout.pages) {
    for (const b of pageBubbles(layout, page)) {
      assert.ok(b.y > layout.contentTop - 1 && b.y < layout.paper.h - GEOM.footerReserve + 1,
        `bubble y ${b.y} out of range`);
      assert.ok(b.x > 0 && b.x < layout.paper.w);
    }
  }
});

test('untitled elections, races, and questions block printing', async () => {
  const { readyToPrint, addQuestion: addQ } = await import('../js/model/election.js');
  const e = newElection(); // no election title
  const r = addRace(e); // no race title
  r.candidates = ['A', 'B'];
  assert.equal(readyToPrint(e), false);
  r.title = 'Chair';
  assert.equal(readyToPrint(e), false, 'election title still missing');
  e.title = 'Spring Vote';
  assert.equal(readyToPrint(e), true);
  const q = addQ(e);
  assert.equal(readyToPrint(e), false);
  q.title = 'Approve?';
  assert.equal(readyToPrint(e), true);
  r.candidates.push('   ');
  assert.equal(readyToPrint(e), false, 'blank candidate names block printing');
});

test('short titles and names lay out exactly as layout version 1 did', async () => {
  // Ballots printed before text wrapping existed must still scan, so
  // the common case has to keep its old geometry to the millimeter.
  const e = await bigElection();
  const layout = layoutPages(e);
  assert.equal(layout.contentTop, 34);
  assert.equal(layout.header.titleY, 16);
  assert.equal(layout.header.instrY, 22.5);
  assert.equal(layout.header.ruleY, 26);
  assert.equal(layout.header.instrLines.length, 1);
  const first = layout.pages[0].blocks[0];
  assert.equal(first.headerY, 39);
  assert.equal(first.rowH, GEOM.rowH);
  assert.equal(first.rows[0].y, 34 + GEOM.raceHeaderH + GEOM.rowH / 2);
});

test('long text wraps into measured lines instead of overlapping bubbles', async () => {
  const { textWidth } = await import('../js/model/text.js');
  const e = newElection('The Consolidated Annual General Meeting of the '
    + 'Intercontinental Association of Independent Community Organizations');
  const r = addRace(e, 'Chairperson of the Standing Committee on Long Range '
    + 'Infrastructure Planning and Neighborhood Development Coordination');
  r.candidates = [
    'Dr. Bartholomew Winchester-Featherstonehaugh of the Northern District Cooperative',
    'Al',
  ];
  const q = addQuestion(e, 'Shall the association adopt the revised bylaws as '
    + 'presented by the governance committee at the spring plenary session, '
    + 'including the amended quorum requirements?');
  q.labels = ['Approve the bylaws', 'Reject the bylaws'];

  const layout = layoutPages(e);
  const h = layout.header;
  assert.ok(h.titleLines.length > 1, 'election title should wrap');
  assert.ok(layout.contentTop > 34, 'header should grow with the wrapped title');

  const race = layout.pages[0].blocks[0];
  assert.ok(race.titleLines.length > 1, 'race title should wrap');
  assert.ok(race.rowH > GEOM.rowH, 'rows grow for the longest candidate name');

  const qBlock = layout.pages.flatMap((p) => p.blocks).find((b) => b.type === 'question');
  assert.ok(qBlock.titleLines.length > 1, 'question title should wrap');
  const noOpt = qBlock.row.options[1];
  assert.ok(noOpt.labelLines.length > 1, 'long No label should wrap');

  // Every wrapped line fits the space reserved for it.
  const titleMax = layout.paper.w - 2 * GEOM.leftMargin
    - textWidth('OFFICIAL BALLOT - PAGE 88 OF 88', 3.6) - 4;
  for (const line of h.titleLines) {
    assert.ok(textWidth(line, 5.2, true) <= titleMax + 0.01, 'title line too wide: ' + line);
  }
  const raceMax = layout.cols[0] - 4 - GEOM.leftMargin;
  for (const line of race.titleLines) {
    assert.ok(textWidth(line, 4.2, true) <= raceMax + 0.01, 'race title too wide: ' + line);
  }
  const fullMax = layout.paper.w - 2 * GEOM.leftMargin;
  for (const line of qBlock.titleLines) {
    assert.ok(textWidth(line, 4.2, true) <= fullMax + 0.01, 'question title too wide: ' + line);
  }
  const nameMax = layout.cols[0] - GEOM.bubbleR - 2 - GEOM.leftMargin;
  const { wrapName } = await import('../js/model/layout.js');
  for (const name of r.candidates) {
    for (const line of wrapName(name, layout.cols)) {
      assert.ok(textWidth(line, 3.6) <= nameMax + 0.01, 'name line too wide: ' + line);
    }
  }

  // Wrapping never moves a bubble out of the content area, and the
  // layout stays deterministic.
  for (const page of layout.pages) {
    for (const b of pageBubbles(layout, page)) {
      assert.ok(b.y > layout.contentTop - 1 && b.y < layout.paper.h - GEOM.footerReserve + 1);
    }
  }
  assert.deepEqual(layout, layoutPages(e));
});

test('a logo shifts the header down and renders as an svg image', async () => {
  const e = await bigElection();
  const plain = layoutPages(e);
  // A 1x1 transparent PNG; real logos are bigger but the geometry only
  // uses the stored pixel size.
  e.logo = {
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    w: 300, h: 90,
  };
  const layout = layoutPages(e);
  const box = layout.header.logo;
  assert.ok(box, 'layout should place the logo');
  assert.ok(box.w <= 60.01 && box.h <= 18.01, 'logo scaled to fit its box');
  assert.ok(Math.abs(box.w / box.h - 300 / 90) < 0.01, 'aspect ratio preserved');
  assert.ok(layout.contentTop > plain.contentTop, 'content moves down under the logo');
  assert.deepEqual(layout, layoutPages(e));

  const eid = await electionId(e);
  const code = await ballotCode(e, 3);
  const orders = {};
  for (const r of e.races) orders[r.id] = await candidateOrder(e, 3, r);
  const svgs = renderBallotSvgs({ election: e, layout, serial: 3, code, orders, electionIdCode: eid });
  assert.ok(svgs[0].includes('<image '), 'first page should embed the logo');
  assert.ok(svgs[0].includes('data:image/png;base64,'), 'logo data url embedded');

  const { validateElection } = await import('../js/model/election.js');
  assert.equal(validateElection(e), null);
  e.logo = { data: 'http://example.com/x.png', w: 10, h: 10 };
  assert.ok(validateElection(e), 'non data-url logos are rejected');
  delete e.logo;
});

test('wrapLines breaks oversized words and respects maxLines', async () => {
  const { wrapLines, textWidth } = await import('../js/model/text.js');
  const lines = wrapLines('Supercalifragilisticexpialidocious'.repeat(3), 3.6, 40);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(textWidth(line, 3.6) <= 40);
  const capped = wrapLines('one two three four five six seven eight nine ten', 3.6, 20, { maxLines: 2 });
  assert.equal(capped.length, 2);
  assert.ok(capped[1].endsWith('...'));
  assert.deepEqual(wrapLines('', 3.6, 40), ['']);
  assert.deepEqual(wrapLines('Alice', 3.6, 40), ['Alice']);
});

test('qr payload round trips', () => {
  const s = qrPayload('ABCD2345', '003-K7Q2M', 2, 3);
  const p = parseQrPayload(s);
  assert.deepEqual(p, { electionId: 'ABCD2345', ballotCode: '003-K7Q2M', page: 2, pageCount: 3 });
  assert.equal(parseQrPayload('junk'), null);
  assert.equal(parseQrPayload('OC1|a|b|4|3'), null);
});

test('qr modules generate for typical payloads', () => {
  const mods = qrModules(qrPayload('ABCD2345', '003-K7Q2M', 1, 1));
  assert.ok(mods.length >= 21);
  assert.equal(mods.length, mods[0].length);
});

test('ballot pages render to valid-looking svg with all candidates', async () => {
  const e = await bigElection();
  const layout = layoutPages(e);
  const eid = await electionId(e);
  const code = await ballotCode(e, 7);
  const orders = {};
  for (const r of e.races) orders[r.id] = await candidateOrder(e, 7, r);

  const svgs = renderBallotSvgs({ election: e, layout, serial: 7, code, orders, electionIdCode: eid });
  assert.equal(svgs.length, layout.pageCount);
  const all = svgs.join('');
  for (const r of e.races) {
    for (const name of r.candidates) {
      assert.ok(all.includes('>' + name + '<'), 'missing candidate ' + name);
    }
  }
  assert.ok(all.includes('Adopt the new bylaws?'));
  assert.ok(all.includes(code));
  for (const svg of svgs) {
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.endsWith('</svg>'));
    assert.equal((svg.match(/<svg/g) || []).length, 1);
  }
});

test('randomized ballots show different name order for different serials', async () => {
  const e = await bigElection();
  const layout = layoutPages(e);
  const eid = await electionId(e);
  const orderings = new Set();
  for (const serial of [1, 2, 3, 4, 5]) {
    const orders = {};
    for (const r of e.races) orders[r.id] = await candidateOrder(e, serial, r);
    orderings.add(orders.r2.join(','));
    const code = await ballotCode(e, serial);
    const svgs = renderBallotSvgs({ election: e, layout, serial, code, orders, electionIdCode: eid });
    assert.equal(svgs.length, layout.pageCount);
  }
  assert.ok(orderings.size > 1);
});
