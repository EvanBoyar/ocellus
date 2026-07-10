// Results: tallies, winners, the Election Integrity Code, and
// sharing scan data between officials.

import { el, clear, copyText } from './dom.js';
import { navTabs } from '../app.js';
import { tallyRace, tallyQuestion } from '../model/star.js';
import { integrityCode } from '../model/eic.js';
import { exportResults, importResults } from '../model/share.js';
import { mergeSessions, incompleteSerials } from '../model/records.js';

export async function renderResults(root, ctx) {
  root.append(navTabs(ctx, 'results'));
  root.append(el('h1', {}, 'Results'));

  const session = ctx.session;
  const serials = Object.keys(session.records).map(Number).sort((a, b) => a - b);
  const counted = serials.filter((s) => !session.spoiled.includes(s));

  if (ctx.sessionStale) {
    root.append(el('div', { class: 'notice error' },
      'Scan data belongs to an older version of this election design. Go to the Scan tab to resolve this.'));
    return;
  }

  root.append(el('div', { class: 'row' },
    el('span', { class: 'pill' }, counted.length + ' ballots counted'),
    el('span', { class: 'pill gray' }, session.spoiled.length + ' spoiled'),
  ));

  const missing = incompleteSerials(session);
  if (missing.length > 0) {
    root.append(el('div', { class: 'notice warn' },
      'Ballots with missing pages: ' + missing.join(', ')
      + '. Their scanned races still count; scan the missing pages to complete them.'));
  }

  if (counted.length === 0) {
    root.append(el('div', { class: 'card' },
      el('h3', {}, 'Nothing scanned yet'),
      el('p', { class: 'meta' }, 'Scan some ballots or import results from another official below.'),
    ));
  }

  // Race tallies.
  const summaryLines = [ctx.election.title, ''];
  for (const race of ctx.election.races) {
    const ballots = counted.map((s) => {
      const marks = session.records[String(s)].votes[race.id] || {};
      return race.candidates.map((_, c) => marks[c] ?? 0);
    });
    const r = tallyRace(race, ballots);
    root.append(raceCard(race, r));
    summaryLines.push(race.title + ': ' + raceSummary(race, r));
  }

  for (const q of ctx.election.questions) {
    const answers = counted.map((s) => {
      const a = session.records[String(s)].questions[q.id];
      return a === undefined ? null : a;
    });
    const r = tallyQuestion(q, answers);
    const pct = r.yes + r.no > 0 ? Math.round((r.yes / (r.yes + r.no)) * 1000) / 10 : 0;
    root.append(el('div', { class: 'card' },
      el('div', { class: 'row space' },
        el('h3', {}, q.title),
        el('span', { class: 'pill ' + (r.passed ? 'ok' : 'coral') }, r.passed ? 'PASSES' : 'FAILS'),
      ),
      el('p', { class: 'meta' },
        (q.labels ? q.labels[0] : 'Yes') + ' ' + r.yes + ', '
        + (q.labels ? q.labels[1] : 'No') + ' ' + r.no
        + (r.blank ? ', blank ' + r.blank : '')
        + ' (' + pct + '% yes, needs ' + q.num + '/' + q.den + ')'),
    ));
    summaryLines.push(q.title + ': ' + (r.passed ? 'PASSES' : 'FAILS')
      + ' (' + r.yes + ' yes, ' + r.no + ' no)');
  }

  // Election Integrity Code.
  const eicBox = el('div', { class: 'code-box' }, '...');
  integrityCode(session).then((code) => { eicBox.textContent = code; });
  root.append(el('div', { class: 'card' },
    el('h3', {}, 'Election Integrity Code'),
    eicBox,
    el('p', { class: 'meta' },
      'Every official who has the same complete set of ballots and spoils sees this exact code, '
      + 'no matter what order they scanned in. If your codes differ, someone is missing data. '
      + 'Compare it out loud or over chat before announcing results.'),
  ));

  // Plain-language summary.
  const summaryText = summaryLines.join('\n');
  const sumBtn = el('button', { class: 'btn-small' }, 'Copy summary');
  sumBtn.addEventListener('click', () => copyText(summaryText, sumBtn));
  root.append(el('div', { class: 'card' },
    el('h3', {}, 'Summary'),
    el('pre', { style: 'white-space: pre-wrap; font-size: 0.9rem; margin: 6px 0;' }, summaryText),
    sumBtn,
  ));

  // Share and merge scan data.
  const exportArea = el('textarea', { readonly: '', rows: 3 });
  const exportBtn = el('button', { class: 'btn-small' }, 'Copy my scan data');
  exportBtn.addEventListener('click', async () => {
    exportArea.value = exportResults(session);
    await copyText(exportArea.value, exportBtn);
  });

  const importArea = el('textarea', { rows: 3, placeholder: 'Paste another official\'s scan data (OCSC1. ...)' });
  const importMsg = el('div');
  const importBtn = el('button', { class: 'btn-small btn-coral' }, 'Merge into my data');
  importBtn.addEventListener('click', () => {
    clear(importMsg);
    const res = importResults(importArea.value);
    if (res.error) {
      importMsg.append(el('div', { class: 'notice error' }, res.error));
      return;
    }
    const summary = mergeSessions(session, res.session);
    if (summary.error) {
      importMsg.append(el('div', { class: 'notice error' }, summary.error));
      return;
    }
    ctx.saveSession();
    const parts = [summary.added + ' ballots added', summary.duplicates + ' already known'];
    if (summary.spoiledAdded) parts.push(summary.spoiledAdded + ' newly spoiled');
    importMsg.append(el('div', { class: 'notice ok' }, 'Merged: ' + parts.join(', ') + '.'));
    if (summary.conflicts.length > 0) {
      importMsg.append(el('div', { class: 'notice error' },
        'Conflicting marks on ballots ' + summary.conflicts.map((c) => c.serial).join(', ')
        + '. Those ballots kept your version; rescan them together to resolve.'));
    }
    setTimeout(() => { location.reload(); }, 1800);
  });

  root.append(el('div', { class: 'card' },
    el('h3', {}, 'Share your work'),
    el('p', { class: 'meta' },
      'Several officials can each scan part of the ballots. Send your scan data to the tabulator '
      + 'as a text string, and merge strings you receive into your own count.'),
    exportArea,
    el('div', { class: 'row', style: 'margin: 8px 0 14px;' }, exportBtn),
    importArea,
    el('div', { class: 'row', style: 'margin-top: 8px;' }, importBtn),
    importMsg,
  ));
}

function raceCard(race, r) {
  const rows = race.candidates.map((name, c) => {
    const isFinalist = r.finalists.includes(c);
    const isWinner = r.winner === c;
    return el('tr', { class: isWinner ? 'winner' : '' },
      el('td', {}, name + (isWinner ? ' - WINNER' : isFinalist ? ' - finalist' : '')),
      el('td', { class: 'num' }, String(r.totals[c])),
      el('td', { class: 'num' },
        r.runoff && isFinalist
          ? String(r.finalists[0] === c ? r.runoff.forA : r.runoff.forB)
          : ''),
    );
  });
  return el('div', { class: 'card' },
    el('h3', {}, race.title),
    el('table', { class: 'results' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Candidate'),
        el('th', { class: 'num' }, 'Score total'),
        el('th', { class: 'num' }, 'Runoff votes'),
      )),
      el('tbody', {}, rows),
    ),
    r.tie ? el('div', { class: 'notice warn' }, 'This race is tied. ' + r.notes.join(' ')) : null,
    !r.tie && r.notes.length > 0 ? el('p', { class: 'meta' }, r.notes.join(' ')) : null,
    r.runoff ? el('p', { class: 'meta' },
      r.runoff.noPref + ' ballots had no preference between the finalists.') : null,
  );
}

function raceSummary(race, r) {
  if (r.ballotCount === 0) return 'no ballots';
  if (r.tie || r.winner === null) return 'TIE - needs resolution';
  const name = race.candidates[r.winner];
  if (!r.runoff) return name + ' wins';
  const other = r.finalists.find((f) => f !== r.winner);
  const winVotes = r.finalists[0] === r.winner ? r.runoff.forA : r.runoff.forB;
  const loseVotes = r.finalists[0] === r.winner ? r.runoff.forB : r.runoff.forA;
  return name + ' wins ' + winVotes + ' to ' + loseVotes
    + (other !== undefined ? ' over ' + race.candidates[other] : '');
}
