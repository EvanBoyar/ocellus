import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesToB32, intToB32, b32ToInt, normalizeB32, canonicalJson, packString, unpackString, groupCode } from '../js/model/codec.js';
import { sha256, hmacSha256, shortHash, randomBytes } from '../js/model/crypt.js';
import { newElection, addRace, addQuestion, electionId, exportElection, importElection, readyToPrint } from '../js/model/election.js';
import { ballotCode, verifyBallotCode, candidateOrder, invertOrder } from '../js/model/ballotid.js';
import { tallyRace, tallyQuestion } from '../js/model/star.js';
import { newSession, mergeScan, spoilBallot, mergeSessions, isComplete, incompleteSerials } from '../js/model/records.js';
import { integrityCode } from '../js/model/eic.js';
import { exportResults, importResults } from '../js/model/share.js';

test('base32 round trips integers', () => {
  for (const n of [0, 1, 31, 32, 1023, 32767]) {
    assert.equal(b32ToInt(intToB32(n, 3)), n);
  }
});

test('normalizeB32 fixes confusable characters', () => {
  assert.equal(normalizeB32('o1l-iu'), '0111V');
  assert.equal(normalizeB32('abc 123'), 'ABC123');
});

test('canonicalJson sorts keys at every depth', () => {
  const a = canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } });
  const b = canonicalJson({ a: { c: 3, d: [2, { y: 2, z: 1 }] }, b: 1 });
  assert.equal(a, b);
});

test('pack/unpack round trips and rejects garbage', () => {
  const obj = { hello: 'world', n: [1, 2, 3] };
  const s = packString('EL', obj);
  assert.deepEqual(unpackString('EL', s), obj);
  assert.deepEqual(unpackString('EL', '  ' + s.slice(0, 10) + '\n' + s.slice(10) + '  '), obj);
  assert.equal(unpackString('EL', 'nonsense'), null);
  assert.equal(unpackString('SC', s), null);
});

test('sha256 and hmac produce stable values', async () => {
  const h = await sha256('hello');
  assert.equal(h.length, 32);
  const m1 = await hmacSha256(new Uint8Array([1, 2, 3]), 'msg');
  const m2 = await hmacSha256(new Uint8Array([1, 2, 3]), 'msg');
  assert.deepEqual(m1, m2);
  const m3 = await hmacSha256(new Uint8Array([1, 2, 4]), 'msg');
  assert.notDeepEqual(m1, m3);
  assert.equal((await shortHash('x', 8)).length, 8);
  assert.equal(randomBytes(16).length, 16);
  assert.equal(bytesToB32(h, 8).length, 8);
  assert.equal(groupCode('ABCDEFGH'), 'ABCD-EFGH');
});

function sampleElection() {
  const e = newElection('Club Election');
  const r = addRace(e, 'President');
  r.candidates = ['Alice', 'Bob', 'Carol'];
  const q = addQuestion(e, 'Adopt bylaws?');
  q.num = 2; q.den = 3;
  return e;
}

test('election export/import round trips, id depends on contents', async () => {
  const e = sampleElection();
  const s = exportElection(e);
  const back = importElection(s);
  assert.equal(back.error, undefined);
  assert.deepEqual(back.election, e);
  const id1 = await electionId(e);
  assert.equal(id1.length, 8);
  const e2 = structuredClone(e);
  e2.races[0].candidates.push('Dave');
  assert.notEqual(await electionId(e2), id1);
  assert.ok(readyToPrint(e));
  const empty = newElection('x');
  assert.ok(!readyToPrint(empty));
  assert.ok(importElection('garbage').error);
});

test('ballot codes verify and reject forgeries', async () => {
  const e = sampleElection();
  const code = await ballotCode(e, 3);
  assert.match(code, /^[0-9A-Z]{6}-[0-9A-Z]{5}$/);
  const ok = await verifyBallotCode(e, code);
  assert.equal(ok.serial, 3);
  const lower = await verifyBallotCode(e, code.toLowerCase());
  assert.equal(lower.serial, 3);
  const forged = code.slice(0, -1) + (code.endsWith('7') ? '8' : '7');
  assert.ok((await verifyBallotCode(e, forged)).error);
  const other = sampleElection();
  assert.ok((await verifyBallotCode(other, code)).error);
});

test('old short ballot codes still verify', async () => {
  const { intToB32: toB32 } = await import('../js/model/codec.js');
  const { hmacSha256: hmac } = await import('../js/model/crypt.js');
  const { base64ToBytes: b64 } = await import('../js/model/codec.js');
  const { bytesToB32: toB32b } = await import('../js/model/codec.js');
  const e = sampleElection();
  // Reconstruct what v0.0.8 printed: a 3-character serial.
  const serial = 7;
  const mac = await hmac(b64(e.key), 'ballot|' + serial);
  const oldCode = toB32(serial, 3) + '-' + toB32b(mac, 5);
  const ok = await verifyBallotCode(e, oldCode);
  assert.equal(ok.serial, 7);
});

test('batch allocation avoids known ranges and spreads out', async () => {
  const { allocateBatch, SERIAL_SPACE } = await import('../js/model/ballotid.js');
  // Fresh allocations land inside the space and clear of each other.
  const batches = [];
  for (let i = 0; i < 50; i++) {
    const start = allocateBatch(batches, 100);
    assert.ok(start >= 1 && start + 100 < SERIAL_SPACE);
    for (const b of batches) {
      assert.ok(start + 100 <= b.start || b.start + b.count <= start,
        'batch overlap: ' + start + ' vs ' + b.start);
    }
    batches.push({ start, count: 100 });
  }
  // Independent devices choosing randomly should not cluster at the
  // start of the space the way sequential allocation did.
  const starts = batches.map((b) => b.start);
  assert.ok(Math.max(...starts) > SERIAL_SPACE / 4,
    'allocations suspiciously clustered low: ' + Math.max(...starts));
  // A legacy sequential range is respected.
  const legacy = [{ start: 1, count: 500 }];
  for (let i = 0; i < 20; i++) {
    const start = allocateBatch(legacy, 50);
    assert.ok(start >= 501 || start + 50 <= 1, 'collided with legacy range');
  }
});

test('candidate order is deterministic, valid, and varies by serial', async () => {
  const e = sampleElection();
  const race = e.races[0];
  const o1 = await candidateOrder(e, 1, race);
  const o1again = await candidateOrder(e, 1, race);
  assert.deepEqual(o1, o1again);
  assert.deepEqual([...o1].sort(), [0, 1, 2]);
  const inv = invertOrder(o1);
  o1.forEach((canonical, row) => assert.equal(inv[canonical], row));
  race.randomize = false;
  assert.deepEqual(await candidateOrder(e, 1, race), [0, 1, 2]);
  race.randomize = true;
  const orders = new Set();
  for (let s = 1; s <= 20; s++) {
    orders.add((await candidateOrder(e, s, race)).join(','));
  }
  assert.ok(orders.size > 1, 'shuffle should vary across serials');
});

test('STAR tally: clear winner', () => {
  const race = { candidates: ['A', 'B', 'C'] };
  const ballots = [
    [5, 2, 0],
    [4, 3, 1],
    [0, 5, 2],
    [5, 1, 1],
    [3, 4, 0],
  ];
  const r = tallyRace(race, ballots);
  assert.deepEqual(r.totals, [17, 15, 4]);
  assert.deepEqual(r.finalists.slice().sort(), [0, 1]);
  assert.equal(r.runoff.forA + r.runoff.forB + r.runoff.noPref, 5);
  assert.equal(r.winner, 0); // A preferred on 3 ballots, B on 2
});

test('STAR tally: runoff can overturn score leader', () => {
  const race = { candidates: ['A', 'B'] };
  // A has the higher total but B is preferred head-to-head.
  const ballots = [
    [5, 0],
    [3, 4],
    [3, 4],
    [3, 4],
  ];
  const r = tallyRace(race, ballots);
  assert.equal(r.totals[0] > r.totals[1], true);
  assert.equal(r.winner, 1);
});

test('STAR tally: blank and out-of-range scores are safe', () => {
  const race = { candidates: ['A', 'B'] };
  const r = tallyRace(race, [[null, 9], [undefined, 3]]);
  assert.deepEqual(r.totals, [0, 8]);
  assert.equal(r.winner, 1);
});

test('STAR tally: exact tie is reported', () => {
  const race = { candidates: ['A', 'B'] };
  const r = tallyRace(race, [[3, 3], [2, 2]]);
  assert.equal(r.tie, true);
  assert.equal(r.winner, null);
});

test('STAR tally: three-way entry tie broken head-to-head', () => {
  const race = { candidates: ['A', 'B', 'C'] };
  // All totals equal (6 each) but pairwise A beats B, A beats C, and
  // B beats C, so A and B advance and A wins the runoff.
  const ballots = [
    [3, 2, 1],
    [3, 2, 1],
    [0, 2, 4],
  ];
  const r = tallyRace(race, ballots);
  assert.deepEqual(r.totals, [6, 6, 6]);
  assert.ok(r.finalists.includes(0));
  assert.ok(r.finalists.includes(1));
  assert.equal(r.winner, 0);
});

test('STAR tally: tie for second seat resolved by five-star counts', () => {
  const race = { candidates: ['A', 'B', 'C'] };
  // A leads. B and C tie on totals and head-to-head, but B holds a
  // five-star rating and C does not.
  const ballots = [
    [5, 5, 2],
    [5, 0, 3],
  ];
  const r = tallyRace(race, ballots);
  assert.deepEqual(r.totals, [10, 5, 5]);
  assert.deepEqual(r.finalists.slice().sort(), [0, 1]);
  assert.equal(r.winner, 0);
});

test('STAR tally: tie for second seat that cannot change the outcome', () => {
  const race = { candidates: ['A', 'B', 'C'] };
  // Single ballot: B and C tie at 0 for the second seat, but A beats
  // both head-to-head, so A simply wins.
  const r = tallyRace(race, [[5, 0, 0]]);
  assert.equal(r.tie, false);
  assert.equal(r.winner, 0);
  assert.ok(r.notes.length > 0);
});

test('question tally honors threshold with integer math', () => {
  const q = { num: 2, den: 3 };
  assert.equal(tallyQuestion(q, [1, 1, 0]).passed, true);   // 2/3 exactly
  assert.equal(tallyQuestion(q, [1, 1, 0, 0]).passed, false);
  assert.equal(tallyQuestion(q, [1, 1, 0, null]).passed, true); // blank excluded
  assert.equal(tallyQuestion(q, [null, null]).passed, false);   // nobody voted
  const half = { num: 1, den: 2 };
  assert.equal(tallyQuestion(half, [1, 0]).passed, true); // >=50%
});

function sparse(scores) {
  const out = {};
  scores.forEach((s, i) => { out[i] = s; });
  return out;
}

function scanOf(serial, page, scores, answer) {
  return {
    serial,
    page,
    votes: { r1: sparse(scores) },
    questions: answer === undefined ? {} : { q1: answer },
  };
}

test('records: dedup, conflict, spoil', () => {
  const s = newSession('ELEC1234', 1);
  assert.equal(mergeScan(s, scanOf(1, 1, [5, 0, 3], 1)).status, 'added');
  assert.equal(mergeScan(s, scanOf(1, 1, [5, 0, 3], 1)).status, 'duplicate');
  assert.equal(mergeScan(s, scanOf(1, 1, [4, 0, 3], 1)).status, 'conflict');
  spoilBallot(s, 2);
  assert.equal(mergeScan(s, scanOf(2, 1, [1, 1, 1], 0)).status, 'spoiled');
  assert.equal(Object.keys(s.records).length, 1);
  assert.ok(isComplete(s, 1));
});

test('records: multi-page ballots merge and track completeness', () => {
  const s = newSession('ELEC1234', 2);
  mergeScan(s, { serial: 5, page: 1, votes: { r1: sparse([2, 3, 4]) }, questions: {} });
  assert.ok(!isComplete(s, 5));
  assert.deepEqual(incompleteSerials(s), [5]);
  mergeScan(s, { serial: 5, page: 2, votes: {}, questions: { q1: 0 } });
  assert.ok(isComplete(s, 5));
  assert.deepEqual(s.records['5'].votes.r1, sparse([2, 3, 4]));
  assert.equal(s.records['5'].questions.q1, 0);
});

test('records: race split across pages merges without conflict', () => {
  const s = newSession('ELEC1234', 2);
  // Page 1 carries candidates 0 and 1, page 2 carries candidate 2.
  mergeScan(s, { serial: 8, page: 1, votes: { r1: { 0: 5, 1: 0 } }, questions: {} });
  const res = mergeScan(s, { serial: 8, page: 2, votes: { r1: { 2: 3 } }, questions: {} });
  assert.equal(res.status, 'added');
  assert.deepEqual(s.records['8'].votes.r1, { 0: 5, 1: 0, 2: 3 });
  // Rescanning page 1 with a different mark on a shared row conflicts.
  const bad = mergeScan(s, { serial: 8, page: 1, votes: { r1: { 0: 4, 1: 0 } }, questions: {} });
  assert.equal(bad.status, 'conflict');
});

test('EIC is order independent and spoil-source independent', async () => {
  // Tabulator A scans 1 then 2, spoils 3 after scanning it.
  const a = newSession('ELEC1234', 1);
  mergeScan(a, scanOf(1, 1, [5, 0, 3], 1));
  mergeScan(a, scanOf(2, 1, [0, 2, 4], 0));
  mergeScan(a, scanOf(3, 1, [1, 1, 1], null));
  spoilBallot(a, 3);

  // Tabulator B scans 2 then 1 (1 twice), learns 3 is spoiled and
  // never scans it.
  const b = newSession('ELEC1234', 1);
  spoilBallot(b, 3);
  mergeScan(b, scanOf(2, 1, [0, 2, 4], 0));
  mergeScan(b, scanOf(1, 1, [5, 0, 3], 1));
  mergeScan(b, scanOf(1, 1, [5, 0, 3], 1));

  const codeA = await integrityCode(a);
  const codeB = await integrityCode(b);
  assert.equal(codeA, codeB);
  assert.match(codeA, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // Different data means a different code.
  const c = newSession('ELEC1234', 1);
  mergeScan(c, scanOf(1, 1, [5, 0, 3], 1));
  assert.notEqual(await integrityCode(c), codeA);
});

test('EIC treats blank and zero scores identically', async () => {
  const a = newSession('E', 1);
  mergeScan(a, { serial: 1, page: 1, votes: { r1: { 0: 0, 1: 3 } }, questions: {} });
  const b = newSession('E', 1);
  mergeScan(b, { serial: 1, page: 1, votes: { r1: { 0: null, 1: 3 } }, questions: {} });
  assert.equal(await integrityCode(a), await integrityCode(b));
});

test('share: results round trip and merge across officials', () => {
  const a = newSession('ELEC1234', 1);
  mergeScan(a, scanOf(1, 1, [5, 0, 3], 1));
  spoilBallot(a, 9);
  const str = exportResults(a);
  const back = importResults(str);
  assert.equal(back.error, undefined);

  const b = newSession('ELEC1234', 1);
  mergeScan(b, scanOf(2, 1, [0, 2, 4], 0));
  const summary = mergeSessions(b, back.session);
  assert.equal(summary.added, 1);
  assert.equal(summary.spoiledAdded, 1);
  assert.equal(Object.keys(b.records).length, 2);
  assert.deepEqual(b.spoiled, [9]);

  const wrong = newSession('OTHER', 1);
  assert.ok(mergeSessions(wrong, back.session).error);
  assert.ok(importResults('junk').error);
});

test('spoils win over scans in every merge order', async () => {
  // Official A scanned ballot 2 before anyone knew it was bad;
  // official B spoiled it without ever scanning it.
  const makeA = () => {
    const a = newSession('ELEC1234', 1);
    mergeScan(a, scanOf(1, 1, [5, 0, 3], 1));
    mergeScan(a, scanOf(2, 1, [0, 2, 4], 0));
    return a;
  };
  const makeB = () => {
    const b = newSession('ELEC1234', 1);
    spoilBallot(b, 2);
    mergeScan(b, scanOf(3, 1, [1, 1, 1], null));
    return b;
  };

  // Order 1: A merges B's data, then B merges A's.
  const a1 = makeA();
  const b1 = makeB();
  mergeSessions(a1, JSON.parse(exportImport(b1)));
  mergeSessions(b1, JSON.parse(exportImport(a1)));

  // Order 2: B merges A's data first, then A merges B's.
  const a2 = makeA();
  const b2 = makeB();
  mergeSessions(b2, JSON.parse(exportImport(a2)));
  mergeSessions(a2, JSON.parse(exportImport(b2)));

  for (const s of [a1, b1, a2, b2]) {
    assert.ok(s.spoiled.includes(2), 'ballot 2 must be spoiled everywhere');
    assert.equal(s.records['2'], undefined, 'ballot 2 votes must be gone');
    assert.ok(s.records['1'] && s.records['3'], 'valid ballots survive');
  }
  const codes = await Promise.all([a1, b1, a2, b2].map(integrityCode));
  assert.equal(new Set(codes).size, 1, 'all four sessions must agree: ' + codes.join(' '));

  function exportImport(session) {
    const back = importResults(exportResults(session));
    assert.equal(back.error, undefined);
    return JSON.stringify(back.session);
  }
});

test('merging sessions is idempotent for the EIC', async () => {
  const a = newSession('ELEC1234', 1);
  mergeScan(a, scanOf(1, 1, [5, 0, 3], 1));
  mergeScan(a, scanOf(2, 1, [0, 2, 4], 0));
  const b = newSession('ELEC1234', 1);
  mergeScan(b, scanOf(2, 1, [0, 2, 4], 0));
  mergeSessions(b, JSON.parse(JSON.stringify(a)));
  mergeSessions(b, JSON.parse(JSON.stringify(a)));
  assert.equal(await integrityCode(a), await integrityCode(b));
});
