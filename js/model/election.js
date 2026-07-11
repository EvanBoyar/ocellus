// Election definition model.
//
// An election is a plain JSON object so it can be exported/imported as
// a text string. Shape:
// {
//   v: 1,
//   title: 'Spring Board Election',
//   key: '<base64, 16 random bytes>',   secret shared by officials
//   paper: 'letter' | 'a4',
//   logo: { data: 'data:image/...', w, h },   optional, printed at
//     the top of every page; w and h are the stored pixel size, kept
//     so layout can compute the printed size without decoding
//   races: [{ id: 'r1', title: 'President',
//             candidates: ['Alice', 'Bob'], randomize: true }],
//   questions: [{ id: 'q1', title: 'Adopt the new bylaws?',
//                 labels: ['Yes', 'No'], num: 1, den: 2 }],
// }
// A question passes when yes * den >= num * (yes + no), i.e. the yes
// share is at least num/den. Integer math, no float surprises.

import { canonicalJson, packString, unpackString, bytesToBase64 } from './codec.js';
import { randomBytes, shortHash } from './crypt.js';

export const MAX_SCORE = 5;

// Like races and questions, elections start untitled; the design
// screen focuses the empty field and printing is gated until it has
// a real name.
export function newElection(title) {
  return {
    v: 1,
    title: title || '',
    key: bytesToBase64(randomBytes(16)),
    paper: 'letter',
    races: [],
    questions: [],
  };
}

export function freshId(prefix, existing) {
  const used = new Set(existing.map((x) => x.id));
  let n = 1;
  while (used.has(prefix + n)) n += 1;
  return prefix + n;
}

// New races and questions start untitled; the design screen focuses
// the empty field so the official just types. readyToPrint() blocks
// printing until everything has a real name.
export function addRace(election, title) {
  const race = {
    id: freshId('r', election.races),
    title: title || '',
    candidates: [],
    randomize: true,
  };
  election.races.push(race);
  return race;
}

export function addQuestion(election, title) {
  const q = {
    id: freshId('q', election.questions),
    title: title || '',
    labels: ['Yes', 'No'],
    num: 1,
    den: 2,
  };
  election.questions.push(q);
  return q;
}

// The election ID is a short hash of the whole definition, key
// included. Two officials see the same ID only if they hold the exact
// same election, races, candidate order, and secret key.
export async function electionId(election) {
  return shortHash('ocellus-election|' + canonicalJson(election), 8);
}

export function exportElection(election) {
  return packString('EL', election);
}

export function importElection(str) {
  const obj = unpackString('EL', str);
  if (!obj) return { error: 'Not a valid election string.' };
  const err = validateElection(obj);
  if (err) return { error: err };
  return { election: obj };
}

export function validateElection(e) {
  if (!e || typeof e !== 'object') return 'Malformed data.';
  if (e.v !== 1) return 'Unsupported election version.';
  if (typeof e.title !== 'string') return 'Missing title.';
  if (typeof e.key !== 'string' || e.key.length < 16) return 'Missing key.';
  if (!Array.isArray(e.races) || !Array.isArray(e.questions)) return 'Malformed data.';
  if (e.logo != null) {
    if (typeof e.logo !== 'object'
        || typeof e.logo.data !== 'string'
        || !e.logo.data.startsWith('data:image/')
        || !(e.logo.w > 0) || !(e.logo.h > 0)) {
      return 'Malformed logo.';
    }
  }
  for (const r of e.races) {
    if (typeof r.id !== 'string' || typeof r.title !== 'string') return 'Malformed race.';
    if (!Array.isArray(r.candidates)) return 'Malformed race.';
  }
  for (const q of e.questions) {
    if (typeof q.id !== 'string' || typeof q.title !== 'string') return 'Malformed question.';
    if (!Number.isInteger(q.num) || !Number.isInteger(q.den) || q.den <= 0) {
      return 'Malformed question threshold.';
    }
    if (q.labels != null && (!Array.isArray(q.labels) || q.labels.length !== 2
        || q.labels.some((l) => typeof l !== 'string' || l.trim().length === 0))) {
      return 'Malformed question labels.';
    }
  }
  if (e.races.length === 0 && e.questions.length === 0) {
    return 'Election has no races or questions.';
  }
  return null;
}

// True when the election is complete enough to print ballots: every
// race and question titled, every race populated with named
// candidates.
export function readyToPrint(e) {
  if (validateElection(e)) return false;
  if (e.title.trim().length === 0) return false;
  return e.races.every((r) => r.title.trim().length > 0
      && r.candidates.length >= 1
      && r.candidates.every((c) => c.trim().length > 0))
    && e.questions.every((q) => q.title.trim().length > 0);
}
