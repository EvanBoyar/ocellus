// Election Integrity Code.
//
// A short code computed from the session's data in a canonical,
// order-independent way. Two tabulators who hold the same set of
// valid ballots and the same spoiled list get the same code, no
// matter what order they scanned in, whether they scanned a ballot
// twice, or whether they spoiled a ballot themselves or merely
// learned it was spoiled.

import { canonicalJson, groupCode } from './codec.js';
import { shortHash } from './crypt.js';

export async function integrityCode(session) {
  const spoiled = [...session.spoiled].sort((a, b) => a - b);
  const ballots = Object.entries(session.records)
    .filter(([serial]) => !spoiled.includes(Number(serial)))
    .map(([serial, rec]) => [
      Number(serial),
      normalizeVotes(rec.votes),
      normalizeQuestions(rec.questions),
    ])
    .sort((a, b) => a[0] - b[0]);

  const payload = canonicalJson({
    eic: 1,
    electionId: session.electionId,
    ballots,
    spoiled,
  });
  const code = await shortHash('ocellus-eic|' + payload, 8);
  return groupCode(code);
}

// Scores normalize so blank and 0 hash identically. Votes are sparse
// maps of canonical candidate index to score; canonicalJson sorts the
// keys, so insertion order never matters.
function normalizeVotes(votes) {
  const out = {};
  for (const raceId of Object.keys(votes).sort()) {
    const marks = votes[raceId];
    const clean = {};
    for (const idx of Object.keys(marks)) {
      const s = marks[idx];
      clean[idx] = Number.isInteger(s) && s > 0 ? Math.min(s, 5) : 0;
    }
    out[raceId] = clean;
  }
  return out;
}

function normalizeQuestions(questions) {
  const out = {};
  for (const qId of Object.keys(questions).sort()) {
    const a = questions[qId];
    out[qId] = a === 1 ? 1 : a === 0 ? 0 : null;
  }
  return out;
}
