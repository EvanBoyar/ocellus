// Full workflow simulation: one person designs the election and
// shares it, two officials print and scan different ballots from
// synthetic photos, share their results, and both tabulators arrive
// at identical tallies and the same Election Integrity Code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { newElection, addRace, addQuestion, electionId, exportElection, importElection } from '../js/model/election.js';
import { ballotCode, candidateOrder, invertOrder } from '../js/model/ballotid.js';
import { layoutPages } from '../js/model/layout.js';
import { detectPage, toCanonicalVotes } from '../js/scan/detect.js';
import { newSession, mergeScan, spoilBallot, mergeSessions } from '../js/model/records.js';
import { integrityCode } from '../js/model/eic.js';
import { exportResults, importResults } from '../js/model/share.js';
import { tallyRace, tallyQuestion } from '../js/model/star.js';
import { makeImage, addNoise, rasterPage } from './helpers/raster.js';

const require = createRequire(import.meta.url);
const jsQR = require('../js/vendor/jsQR.js');

const QUAD = [
  { x: 55, y: 48 }, { x: 852, y: 62 }, { x: 838, y: 1105 }, { x: 42, y: 1118 },
];

// Scans one ballot from a synthetic photo into a session, the same
// way the scan screen does it.
async function scanBallot(session, election, eid, layout, serial, wantedScores, answer) {
  const race = election.races[0];
  const order = await candidateOrder(election, serial, race);
  const inv = invertOrder(order);
  const marks = {};
  for (const [canonical, score] of Object.entries(wantedScores)) {
    if (score > 0) marks[race.id + '|' + inv[Number(canonical)]] = score;
  }
  const image = makeImage(900, 1160, 228);
  rasterPage({
    election, layout, page: layout.pages[0], electionIdCode: eid,
    ballotCodeStr: await ballotCode(election, serial),
    marks, answers: answer === null ? {} : { q1: answer }, image, quad: QUAD,
  });
  addNoise(image, 5, serial * 7 + 1);

  const res = await detectPage(image, { election, electionIdCode: eid, layout, jsQR });
  assert.equal(res.error, undefined, 'scan of ballot ' + serial + ' failed: ' + res.error);
  assert.equal(res.serial, serial);
  const votes = await toCanonicalVotes(election, serial, res.votesByRow, candidateOrder);
  return mergeScan(session, {
    serial, page: res.page, votes, questions: res.questions,
  });
}

test('two officials split the scanning and agree on everything', async (t) => {
  // The designer builds the election and shares it as a string.
  const designed = newElection('Garden Club Spring Election');
  const race = addRace(designed, 'President');
  race.candidates = ['Ash', 'Birch', 'Cedar'];
  race.randomize = true;
  const q = addQuestion(designed, 'Raise annual dues to $20?');
  q.num = 2; q.den = 3;

  const shared = exportElection(designed);
  const officialA = importElection(shared);
  const officialB = importElection(shared);
  assert.equal(officialA.error, undefined);
  assert.deepEqual(officialA.election, officialB.election);

  const election = officialA.election;
  const eid = await electionId(election);
  assert.equal(eid, await electionId(officialB.election));
  const layout = layoutPages(election);

  // The votes cast on paper. Ballot 4 gets spoiled (say the voter
  // made a mess of it and asked for a fresh one).
  const paper = [
    { serial: 1, scores: { 0: 5, 1: 2, 2: 0 }, answer: 1 },
    { serial: 2, scores: { 0: 4, 1: 5, 2: 1 }, answer: 1 },
    { serial: 3, scores: { 0: 0, 1: 3, 2: 5 }, answer: 0 },
    { serial: 5, scores: { 0: 5, 1: 0, 2: 3 }, answer: 1 },
    { serial: 6, scores: { 0: 2, 1: 1, 2: 4 }, answer: null },
  ];

  // Official A scans ballots 1-3 and spoils 4; B scans 5 and 6.
  const sessionA = newSession(eid, layout.pageCount);
  for (const b of paper.slice(0, 3)) {
    const res = await scanBallot(sessionA, election, eid, layout, b.serial, b.scores, b.answer);
    assert.equal(res.status, 'added');
  }
  spoilBallot(sessionA, 4);
  // A accidentally scans ballot 2 twice; nothing changes.
  const dup = await scanBallot(sessionA, election, eid, layout, 2, paper[1].scores, paper[1].answer);
  assert.equal(dup.status, 'duplicate');

  const sessionB = newSession(eid, layout.pageCount);
  for (const b of paper.slice(3)) {
    const res = await scanBallot(sessionB, election, eid, layout, b.serial, b.scores, b.answer);
    assert.equal(res.status, 'added');
  }

  // They exchange result strings. A merges B's work and vice versa.
  const fromB = importResults(exportResults(sessionB));
  assert.equal(fromB.error, undefined);
  const mergeIntoA = mergeSessions(sessionA, fromB.session);
  assert.equal(mergeIntoA.conflicts.length, 0);
  assert.equal(mergeIntoA.added, 2);

  const fromA = importResults(exportResults(sessionA));
  const mergeIntoB = mergeSessions(sessionB, fromA.session);
  assert.equal(mergeIntoB.conflicts.length, 0);

  // Same integrity code on both sides, spoil learned second-hand.
  const codeA = await integrityCode(sessionA);
  const codeB = await integrityCode(sessionB);
  assert.equal(codeA, codeB);
  assert.ok(sessionB.spoiled.includes(4));

  // Both tabulate the same results.
  for (const session of [sessionA, sessionB]) {
    const counted = Object.keys(session.records).map(Number)
      .filter((s) => !session.spoiled.includes(s))
      .sort((a, b) => a - b);
    assert.deepEqual(counted, [1, 2, 3, 5, 6]);

    const ballots = counted.map((s) => {
      const marks = session.records[String(s)].votes[race.id] || {};
      return race.candidates.map((_, c) => marks[c] ?? 0);
    });
    const r = tallyRace(race, ballots);
    // Totals: Ash 16, Birch 11, Cedar 13. Finalists Ash and Cedar.
    // Head to head: Ash preferred on 1,2,5; Cedar on 3,6. Ash wins 3-2.
    assert.deepEqual(r.totals, [16, 11, 13]);
    assert.deepEqual([...r.finalists].sort(), [0, 2]);
    assert.equal(r.winner, 0);

    const answers = counted.map((s) => {
      const a = session.records[String(s)].questions[q.id];
      return a === undefined ? null : a;
    });
    const qr = tallyQuestion(q, answers);
    // 3 yes, 1 no, 1 blank: 3/4 of voted >= 2/3, passes.
    assert.equal(qr.yes, 3);
    assert.equal(qr.no, 1);
    assert.equal(qr.blank, 1);
    assert.equal(qr.passed, true);
  }

  await t.test('a third tabulator scanning in reverse order still matches', async () => {
    const sessionC = newSession(eid, layout.pageCount);
    spoilBallot(sessionC, 4);
    for (const b of [...paper].reverse()) {
      await scanBallot(sessionC, election, eid, layout, b.serial, b.scores, b.answer);
    }
    assert.equal(await integrityCode(sessionC), codeA);
  });
});
