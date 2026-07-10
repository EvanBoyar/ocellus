// Scan session: everything one official has scanned or learned.
//
// Session shape (plain JSON, storable and shareable):
// {
//   electionId: 'ABCD2345',
//   pageCount: 2,
//   records: {
//     '3': {                       keyed by ballot serial
//       pages: [1],                page numbers seen so far
//       votes: { r1: { 0: 3, 1: 0, 2: 5 } },
//       questions: { q1: 1 },      1 yes, 0 no, null blank
//     },
//   },
//   spoiled: [7, 12],
// }
//
// Votes are sparse maps of canonical candidate index to score. Only
// candidates whose row appeared on a scanned page get an entry, so a
// race split across two pages merges cleanly: a blank row is an
// explicit 0, a row on a page not yet scanned is simply absent.

export function newSession(electionId, pageCount) {
  return { electionId, pageCount, records: {}, spoiled: [] };
}

// Merge one scanned page into the session. `scan` is
// { serial, page, votes: {raceId: {canonicalIdx: score}},
//   questions: {qId: answer} }.
// Returns { status } where status is one of:
//   'added'      new information stored
//   'duplicate'  identical page already scanned, nothing changed
//   'conflict'   same page seen before with different marks
//   'spoiled'    ballot is spoiled, scan ignored
export function mergeScan(session, scan) {
  const serial = String(scan.serial);
  if (session.spoiled.includes(scan.serial)) {
    return { status: 'spoiled' };
  }
  const existing = session.records[serial];
  if (!existing) {
    session.records[serial] = {
      pages: [scan.page],
      votes: structuredClone(scan.votes),
      questions: structuredClone(scan.questions),
    };
    return { status: 'added' };
  }

  const conflicts = [];
  for (const [raceId, marks] of Object.entries(scan.votes)) {
    const mine = existing.votes[raceId];
    if (!mine) continue;
    for (const [idx, score] of Object.entries(marks)) {
      if (idx in mine && norm(mine[idx]) !== norm(score)) {
        conflicts.push(raceId + '#' + idx);
      }
    }
  }
  for (const [qId, answer] of Object.entries(scan.questions)) {
    if (qId in existing.questions && existing.questions[qId] !== answer) {
      conflicts.push(qId);
    }
  }
  if (conflicts.length > 0) {
    return { status: 'conflict', conflicts };
  }

  const isNewPage = !existing.pages.includes(scan.page);
  if (isNewPage) existing.pages.push(scan.page);
  existing.pages.sort((a, b) => a - b);
  for (const [raceId, marks] of Object.entries(scan.votes)) {
    existing.votes[raceId] = Object.assign(existing.votes[raceId] || {}, structuredClone(marks));
  }
  Object.assign(existing.questions, structuredClone(scan.questions));
  return { status: isNewPage ? 'added' : 'duplicate' };
}

// Replace a ballot's marks outright (used when the official resolves a
// conflict by trusting the latest scan, or edits marks by hand).
export function overwriteScan(session, scan) {
  const serial = String(scan.serial);
  const existing = session.records[serial];
  if (!existing) return mergeScan(session, scan);
  if (!existing.pages.includes(scan.page)) existing.pages.push(scan.page);
  existing.pages.sort((a, b) => a - b);
  for (const [raceId, marks] of Object.entries(scan.votes)) {
    existing.votes[raceId] = Object.assign(existing.votes[raceId] || {}, structuredClone(marks));
  }
  Object.assign(existing.questions, structuredClone(scan.questions));
  return { status: 'added' };
}

export function spoilBallot(session, serial) {
  if (!session.spoiled.includes(serial)) {
    session.spoiled.push(serial);
    session.spoiled.sort((a, b) => a - b);
  }
  delete session.records[String(serial)];
}

export function unspoilBallot(session, serial) {
  session.spoiled = session.spoiled.filter((s) => s !== serial);
}

// Merge another official's session into this one. Returns a summary
// with any conflicts found. Spoils always win over scans.
export function mergeSessions(target, incoming) {
  const summary = { added: 0, duplicates: 0, conflicts: [], spoiledAdded: 0 };
  if (target.electionId !== incoming.electionId) {
    return { error: 'These results are from a different election.' };
  }
  for (const s of incoming.spoiled) {
    if (!target.spoiled.includes(s)) {
      spoilBallot(target, s);
      summary.spoiledAdded += 1;
    }
  }
  for (const [serial, rec] of Object.entries(incoming.records)) {
    if (target.spoiled.includes(Number(serial))) continue;
    const res = mergeScan(target, {
      serial: Number(serial),
      page: rec.pages[0],
      votes: rec.votes,
      questions: rec.questions,
    });
    if (res.status === 'added') summary.added += 1;
    else if (res.status === 'duplicate' || res.status === 'spoiled') summary.duplicates += 1;
    else if (res.status === 'conflict') summary.conflicts.push({ serial, details: res.conflicts });
    // Record any extra pages the incoming record had seen.
    const mine = target.records[serial];
    if (mine) {
      for (const p of rec.pages) if (!mine.pages.includes(p)) mine.pages.push(p);
      mine.pages.sort((a, b) => a - b);
    }
  }
  return summary;
}

// A record is complete when every page has been scanned.
export function isComplete(session, serial) {
  const rec = session.records[String(serial)];
  return !!rec && rec.pages.length >= session.pageCount;
}

export function incompleteSerials(session) {
  return Object.keys(session.records)
    .filter((s) => !isComplete(session, Number(s)))
    .map(Number)
    .sort((a, b) => a - b);
}

function norm(score) {
  return Number.isInteger(score) && score > 0 ? Math.min(score, 5) : 0;
}
