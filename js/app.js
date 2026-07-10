// App entry: hash router and shared election context.

import { APP_VERSION } from './version.js';
import { el, clear } from './ui/dom.js';
import { getEntry, saveEntry, getSession, saveSession } from './storage.js';
import { electionId } from './model/election.js';
import { layoutPages } from './model/layout.js';
import { newSession } from './model/records.js';
import { renderHome } from './ui/home.js';
import { renderDesign } from './ui/design.js';
import { renderBallots } from './ui/ballots.js';
import { renderScan } from './ui/scan.js';
import { renderResults } from './ui/results.js';

document.getElementById('version').textContent = 'v' + APP_VERSION;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

const screenEl = document.getElementById('screen');
let teardown = null;

// Loads everything a per-election screen needs and keeps it saved.
async function loadCtx(id) {
  const entry = getEntry(id);
  if (!entry) return null;
  const eid = await electionId(entry.election);
  if (entry.eid !== eid) {
    entry.eid = eid;
    saveEntry(entry);
  }
  const layout = layoutPages(entry.election);
  let session = getSession(id);
  if (!session || session.electionId !== eid) {
    // Keep a stale session around rather than silently discarding it;
    // screens decide what to tell the user.
    if (!session) session = newSession(eid, layout.pageCount);
  }
  session.pageCount = layout.pageCount;
  return {
    entry,
    election: entry.election,
    eid,
    layout,
    session,
    saveEntry() { saveEntry(this.entry); },
    saveSession() { saveSession(this.entry.id, this.session); },
    sessionStale: session.electionId !== eid,
  };
}

export function navTabs(ctx, active) {
  const tabs = [
    ['design', 'Design'],
    ['ballots', 'Ballots'],
    ['scan', 'Scan'],
    ['results', 'Results'],
  ];
  return el('nav', { class: 'tabs' },
    el('a', { href: '#/' }, 'Elections'),
    ...tabs.map(([slug, label]) => el('a', {
      class: active === slug ? 'active' : '',
      href: '#/e/' + ctx.entry.id + '/' + slug,
    }, label)),
  );
}

async function route() {
  if (teardown) {
    try { teardown(); } catch { /* screen already gone */ }
    teardown = null;
  }
  clear(screenEl);
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\//, '').split('/').filter(Boolean);

  if (parts.length === 0) {
    renderHome(screenEl);
    return;
  }
  if (parts[0] === 'e' && parts[1]) {
    const ctx = await loadCtx(parts[1]);
    if (!ctx) {
      location.hash = '#/';
      return;
    }
    const page = parts[2] || 'design';
    const renderers = {
      design: renderDesign,
      ballots: renderBallots,
      scan: renderScan,
      results: renderResults,
    };
    const render = renderers[page] || renderDesign;
    teardown = await render(screenEl, ctx) || null;
    return;
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', route);
route();
