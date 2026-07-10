import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { newElection, addRace, addQuestion, electionId } from '../js/model/election.js';
import { ballotCode, candidateOrder, invertOrder } from '../js/model/ballotid.js';
import { layoutPages } from '../js/model/layout.js';
import { computeHomography, applyH, invertH, localScale } from '../js/scan/homography.js';
import { detectPage, toCanonicalVotes } from '../js/scan/detect.js';
import { makeImage, addNoise, rasterPage, fillExtraBubble } from './helpers/raster.js';

const require = createRequire(import.meta.url);
const jsQR = require('../js/vendor/jsQR.js');

test('homography maps corners exactly and inverts', () => {
  const src = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 },
  ];
  const dst = [
    { x: 20, y: 30 }, { x: 420, y: 44 }, { x: 400, y: 820 }, { x: 34, y: 800 },
  ];
  const H = computeHomography(src, dst);
  for (let i = 0; i < 4; i++) {
    const p = applyH(H, src[i].x, src[i].y);
    assert.ok(Math.abs(p.x - dst[i].x) < 1e-6);
    assert.ok(Math.abs(p.y - dst[i].y) < 1e-6);
  }
  const Hinv = invertH(H);
  const mid = applyH(H, 50, 100);
  const back = applyH(Hinv, mid.x, mid.y);
  assert.ok(Math.abs(back.x - 50) < 1e-6);
  assert.ok(Math.abs(back.y - 100) < 1e-6);
  assert.ok(localScale(H, 50, 100) > 0);
});

async function smallElection() {
  const e = newElection('Test Club Vote');
  const r = addRace(e, 'President');
  r.candidates = ['Alice', 'Bob', 'Carol'];
  r.randomize = true;
  const q = addQuestion(e, 'Adopt bylaws?');
  q.num = 1; q.den = 2;
  return e;
}

// Fills chosen per-candidate scores on a synthetic photo and checks
// the detector reads them back, including the shuffle mapping.
async function roundTrip(quad, opts = {}) {
  const election = await smallElection();
  const layout = layoutPages(election);
  assert.equal(layout.pageCount, 1);
  const eid = await electionId(election);
  const serial = 5;
  const code = await ballotCode(election, serial);

  // Intended scores by canonical candidate: Alice 5, Bob 0, Carol 2.
  const wanted = { 0: 5, 1: 0, 2: 2 };
  const race = election.races[0];
  const order = await candidateOrder(election, serial, race);
  const inv = invertOrder(order);
  const marks = {};
  for (const [canonical, score] of Object.entries(wanted)) {
    marks[race.id + '|' + inv[Number(canonical)]] = score;
  }

  const image = makeImage(opts.w || 900, opts.h || 1160, 225);
  rasterPage({
    election, layout, page: layout.pages[0], electionIdCode: eid,
    ballotCodeStr: code, marks, answers: { q1: 1 }, image, quad,
    fillShade: opts.fillShade ?? 40,
  });
  if (opts.noise) addNoise(image, opts.noise);

  const res = await detectPage(image, { election, electionIdCode: eid, layout, jsQR });
  assert.equal(res.error, undefined, 'detect failed: ' + res.error);
  assert.equal(res.serial, serial);
  assert.equal(res.page, 1);

  const votes = await toCanonicalVotes(election, serial, res.votesByRow, candidateOrder);
  assert.deepEqual(votes[race.id], wanted);
  assert.equal(res.questions.q1, 1);
  return res;
}

test('detects marks on a straight-on photo', async () => {
  await roundTrip([
    { x: 40, y: 40 }, { x: 860, y: 40 }, { x: 860, y: 1120 }, { x: 40, y: 1120 },
  ]);
});

test('detects marks with perspective skew and noise', async () => {
  await roundTrip([
    { x: 70, y: 55 }, { x: 840, y: 85 }, { x: 810, y: 1080 }, { x: 45, y: 1110 },
  ], { noise: 6 });
});

test('detects marks on an upside-down photo', async () => {
  await roundTrip([
    { x: 860, y: 1120 }, { x: 40, y: 1120 }, { x: 40, y: 40 }, { x: 860, y: 40 },
  ]);
});

test('detects lighter pencil marks', async () => {
  await roundTrip([
    { x: 40, y: 40 }, { x: 860, y: 40 }, { x: 860, y: 1120 }, { x: 40, y: 1120 },
  ], { fillShade: 110 });
});

test('rejects a ballot from a different election', async () => {
  const election = await smallElection();
  const other = await smallElection(); // different random key
  const layout = layoutPages(election);
  const eid = await electionId(election);
  const otherEid = await electionId(other);
  const code = await ballotCode(election, 1);

  const image = makeImage(900, 1160, 225);
  rasterPage({
    election, layout, page: layout.pages[0], electionIdCode: eid,
    ballotCodeStr: code, image,
    quad: [{ x: 40, y: 40 }, { x: 860, y: 40 }, { x: 860, y: 1120 }, { x: 40, y: 1120 }],
  });
  const res = await detectPage(image, {
    election: other, electionIdCode: otherEid, layout: layoutPages(other), jsQR,
  });
  assert.ok(res.error, 'should reject foreign ballot');
});

test('rejects a forged ballot code even with matching election id', async () => {
  const election = await smallElection();
  const layout = layoutPages(election);
  const eid = await electionId(election);
  const good = await ballotCode(election, 1);
  const forged = good.slice(0, 4) + (good[4] === 'A' ? 'B' : 'A') + good.slice(5);

  const image = makeImage(900, 1160, 225);
  rasterPage({
    election, layout, page: layout.pages[0], electionIdCode: eid,
    ballotCodeStr: forged, image,
    quad: [{ x: 40, y: 40 }, { x: 860, y: 40 }, { x: 860, y: 1120 }, { x: 40, y: 1120 }],
  });
  const res = await detectPage(image, { election, electionIdCode: eid, layout, jsQR });
  assert.ok(res.error, 'forged code must fail');
  assert.match(res.error, /verification/i);
});

test('reports no QR when pointed at blank paper', async () => {
  const election = await smallElection();
  const layout = layoutPages(election);
  const eid = await electionId(election);
  const image = makeImage(400, 400, 225);
  const res = await detectPage(image, { election, electionIdCode: eid, layout, jsQR });
  assert.ok(res.error);
  assert.ok(res.transient, 'blank frame should be a transient error');
});

test('flags a row with two filled bubbles', async () => {
  const election = await smallElection();
  election.races[0].randomize = false;
  const layout = layoutPages(election);
  const eid = await electionId(election);
  const code = await ballotCode(election, 2);

  const image = makeImage(900, 1160, 225);
  // Fill score 4 for row 0 normally, then add a stray mark on score 1
  // of the same row.
  const H = rasterPage({
    election, layout, page: layout.pages[0], electionIdCode: eid,
    ballotCodeStr: code, marks: { 'r1|0': 4 }, image,
    quad: [{ x: 40, y: 40 }, { x: 860, y: 40 }, { x: 860, y: 1120 }, { x: 40, y: 1120 }],
  });
  fillExtraBubble(image, H, layout, layout.pages[0], { raceId: 'r1', printedRow: 0, score: 1 }, 95);
  const res = await detectPage(image, { election, electionIdCode: eid, layout, jsQR });
  assert.equal(res.error, undefined);
  assert.ok(res.flags.some((f) => f.kind === 'multiple'));
  assert.equal(res.votesByRow.r1[0], 4);
});
