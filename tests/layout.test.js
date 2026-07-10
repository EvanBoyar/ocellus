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
      assert.ok(b.y > GEOM.contentTop - 1 && b.y < layout.paper.h - GEOM.footerReserve + 1,
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
