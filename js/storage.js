// localStorage persistence. Each election is stored with its id,
// definition, and print bookkeeping; scan sessions are stored
// separately per election.

const INDEX_KEY = 'ocellus.elections';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function listElections() {
  return readJson(INDEX_KEY, []);
}

export function getEntry(id) {
  return listElections().find((e) => e.id === id) || null;
}

// entry: { id, election, nextSerial, createdAt }
export function saveEntry(entry) {
  const all = listElections().filter((e) => e.id !== entry.id);
  all.unshift(entry);
  writeJson(INDEX_KEY, all);
}

export function deleteEntry(id) {
  writeJson(INDEX_KEY, listElections().filter((e) => e.id !== id));
  localStorage.removeItem('ocellus.session.' + id);
}

export function getSession(electionId) {
  return readJson('ocellus.session.' + electionId, null);
}

export function saveSession(electionId, session) {
  writeJson('ocellus.session.' + electionId, session);
}
