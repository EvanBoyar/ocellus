// Ballot identity and per-ballot candidate shuffling.
//
// Every printed ballot carries a code like 003-K7Q2M. The first part
// is the serial number, the second is a MAC computed from the
// election's secret key. A scanner holding the same election string
// can verify the MAC, so only ballots printed by an official are
// accepted, and each ballot can be spoiled or deduplicated by serial.

import { intToB32, bytesToB32, b32ToInt, base64ToBytes, normalizeB32 } from './codec.js';
import { hmacSha256 } from './crypt.js';

const SERIAL_CHARS = 3; // up to 32767 ballots
const MAC_CHARS = 5;    // 25 bits of forgery resistance

export async function ballotCode(election, serial) {
  const mac = await hmacSha256(base64ToBytes(election.key), 'ballot|' + serial);
  return intToB32(serial, SERIAL_CHARS) + '-' + bytesToB32(mac, MAC_CHARS);
}

// Returns { serial } when the code is authentic, otherwise { error }.
export async function verifyBallotCode(election, code) {
  const cleaned = normalizeB32(code);
  if (cleaned.length !== SERIAL_CHARS + MAC_CHARS) {
    return { error: 'Ballot code has the wrong length.' };
  }
  const serial = b32ToInt(cleaned.slice(0, SERIAL_CHARS));
  if (serial === null || serial < 1) return { error: 'Bad ballot serial.' };
  const expected = await ballotCode(election, serial);
  if (normalizeB32(expected) !== cleaned) {
    return { error: 'Ballot code failed verification. Not a ballot from this election.' };
  }
  return { serial };
}

// Deterministic per-ballot candidate order. Officials never store the
// permutation anywhere; anyone with the election key recomputes it
// from the serial, so scanning knows which row is which candidate.
export async function candidateOrder(election, serial, race) {
  const n = race.candidates.length;
  const order = Array.from({ length: n }, (_, i) => i);
  if (!race.randomize || n < 2) return order;

  const key = base64ToBytes(election.key);
  let pool = [];
  let counter = 0;
  const next16 = async () => {
    if (pool.length < 2) {
      const block = await hmacSha256(key, 'shuffle|' + serial + '|' + race.id + '|' + counter);
      counter += 1;
      pool = pool.concat(Array.from(block));
    }
    const hi = pool.shift();
    const lo = pool.shift();
    return hi * 256 + lo;
  };

  for (let i = n - 1; i >= 1; i--) {
    const j = (await next16()) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// candidateOrder returns printed-row -> canonical index. This gives
// the reverse: canonical index -> printed row.
export function invertOrder(order) {
  const inv = new Array(order.length);
  order.forEach((canonical, row) => { inv[canonical] = row; });
  return inv;
}
