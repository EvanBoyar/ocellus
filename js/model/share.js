// Export/import of one official's scan results as a copy/pasteable
// text string, so several officials can split up scanning and send
// their work to a tabulator over any text channel.

import { packString, unpackString } from './codec.js';

export function exportResults(session) {
  return packString('SC', {
    electionId: session.electionId,
    pageCount: session.pageCount,
    records: session.records,
    spoiled: session.spoiled,
  });
}

export function importResults(str) {
  const obj = unpackString('SC', str);
  if (!obj) return { error: 'Not a valid results string.' };
  if (typeof obj.electionId !== 'string' || typeof obj.records !== 'object'
      || !Array.isArray(obj.spoiled)) {
    return { error: 'Malformed results data.' };
  }
  return { session: obj };
}
