// Ballot identity and per-ballot candidate shuffling.
//
// Every printed ballot carries a code like 0K7Q2M-M9XFA. The first
// part is the serial number, the second is a MAC computed from the
// election's secret key. A scanner holding the same election string
// can verify the MAC, so only ballots printed by an official are
// accepted, and each ballot can be spoiled or deduplicated by serial.
//
// Serials are drawn from random blocks in a billion-wide space (see
// allocateBatch), so several officials can print ballots for the same
// election independently without ever issuing the same number twice.

import { intToB32, bytesToB32, b32ToInt, base64ToBytes, normalizeB32 } from './codec.js';
import { hmacSha256, randomBytes } from './crypt.js';

const SERIAL_CHARS = 6; // 32^6, about a billion possible serials
const MAC_CHARS = 5;    // 25 bits of forgery resistance
export const SERIAL_SPACE = 32 ** SERIAL_CHARS;

export async function ballotCode(election, serial) {
  const mac = await hmacSha256(base64ToBytes(election.key), 'ballot|' + serial);
  return intToB32(serial, SERIAL_CHARS) + '-' + bytesToB32(mac, MAC_CHARS);
}

// Returns { serial } when the code is authentic, otherwise { error }.
// The serial part may be shorter than SERIAL_CHARS so ballots printed
// by older versions still verify; the MAC is keyed on the integer
// serial, not its printed padding.
export async function verifyBallotCode(election, code) {
  const cleaned = normalizeB32(code);
  if (cleaned.length < 1 + MAC_CHARS || cleaned.length > SERIAL_CHARS + MAC_CHARS) {
    return { error: 'Ballot code has the wrong length.' };
  }
  const serial = b32ToInt(cleaned.slice(0, -MAC_CHARS));
  if (serial === null || serial < 1) return { error: 'Bad ballot serial.' };
  const mac = await hmacSha256(base64ToBytes(election.key), 'ballot|' + serial);
  if (bytesToB32(mac, MAC_CHARS) !== cleaned.slice(-MAC_CHARS)) {
    return { error: 'Ballot code failed verification. Not a ballot from this election.' };
  }
  return { serial };
}

// Picks the starting serial for a new print batch: a random block in
// the serial space that avoids this device's own earlier batches.
// Randomness is what keeps independent officials from issuing the
// same ballot numbers; at 2^30 serials, even thousands of printed
// ballots across many devices leave collision odds around one in a
// million.
export function allocateBatch(existingBatches, count) {
  const overlaps = (start) => existingBatches.some((b) =>
    start < b.start + b.count && b.start < start + count);
  for (let attempt = 0; attempt < 200; attempt++) {
    const bytes = randomBytes(4);
    const raw = (((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0;
    const start = 1 + (raw % (SERIAL_SPACE - count - 1));
    if (!overlaps(start)) return start;
  }
  throw new Error('No room left for a new ballot batch.');
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
