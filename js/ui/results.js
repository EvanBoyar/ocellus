// Results: tallies, winners, the Election Integrity Code, and
// sharing scan data between officials.

import { el, clear, copyText, saveTextFile, openTextFile } from './dom.js';
import { navTabs } from '../app.js';
import { tallySeats, tallyQuestion } from '../model/star.js';
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
    const r = tallySeats(race, ballots);
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

  // Share and merge scan data. Big counts overflow what a Signal or
  // SMS message can carry, so the file path sits beside copy/paste.
  const MESSAGE_SAFE_LENGTH = 2000;
  const tooLong = exportResults(session).length > MESSAGE_SAFE_LENGTH;
  const exportArea = el('textarea', { readonly: '', rows: 3 });
  const exportBtn = el('button', { class: 'btn-small' }, 'Copy my scan data');
  exportBtn.addEventListener('click', async () => {
    exportArea.value = exportResults(session);
    await copyText(exportArea.value, exportBtn);
  });
  const saveBtn = el('button', {
    class: tooLong ? 'btn-small' : 'btn-quiet btn-small',
    onclick: () => saveTextFile(
      'ocellus-scans-' + ctx.eid.toLowerCase() + '.txt', exportResults(session)),
  }, 'Save as file');

  const importArea = el('textarea', { rows: 3, placeholder: 'Paste another official\'s scan data (OCSC1. ...)' });
  const importMsg = el('div');
  const mergeText = (text) => {
    clear(importMsg);
    const res = importResults(text);
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
  };
  const importBtn = el('button', { class: 'btn-small btn-coral' }, 'Merge into my data');
  importBtn.addEventListener('click', () => mergeText(importArea.value));
  const openBtn = el('button', {
    class: 'btn-quiet btn-small',
    onclick: async () => {
      const text = await openTextFile();
      if (text === null) return;
      importArea.value = text.trim();
      mergeText(text);
    },
  }, 'Open file');

  root.append(el('div', { class: 'card' },
    el('h3', {}, 'Share your work'),
    el('p', { class: 'meta' },
      'Several officials can each scan part of the ballots. Send your scan data to the tabulator '
      + 'as a text string or a file, and merge what you receive into your own count.'),
    tooLong ? el('div', { class: 'notice warn' },
      'Your scan data is too long for a Signal or SMS message, which would '
      + 'cut it off. Send it as a file instead.') : null,
    exportArea,
    el('div', { class: 'row', style: 'margin: 8px 0 14px;' },
      ...(tooLong ? [saveBtn, exportBtn] : [exportBtn, saveBtn])),
    importArea,
    el('div', { class: 'row', style: 'margin-top: 8px;' }, importBtn, openBtn),
    importMsg,
  ));
}

// One STAR round as a table. `members` maps the round's index i to a
// canonical candidate index; `r` is a tallyRace result in round space.
// winnerLabel marks the round winner's row (WINNER, SEAT 2, ...).
function starTable(race, members, r, winnerLabel) {
  const rows = members.map((canon, i) => {
    const isFinalist = r.finalists.includes(i);
    const isWinner = r.winner === i;
    return el('tr', { class: isWinner ? 'winner' : '' },
      el('td', {}, race.candidates[canon]
        + (isWinner ? ' - ' + winnerLabel : isFinalist ? ' - finalist' : '')),
      el('td', { class: 'num' }, String(r.totals[i])),
      el('td', { class: 'num' },
        r.runoff && isFinalist
          ? String(r.finalists[0] === i ? r.runoff.forA : r.runoff.forB)
          : ''),
    );
  });
  return el('table', { class: 'results' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Candidate'),
      el('th', { class: 'num' }, 'Score total'),
      el('th', { class: 'num' }, 'Runoff votes'),
    )),
    el('tbody', {}, rows),
  );
}

function roundNotes(r) {
  const bits = [];
  if (!r.tie && r.notes.length > 0) bits.push(el('p', { class: 'meta' }, r.notes.join(' ')));
  if (r.runoff) {
    const n = r.runoff.noPref;
    bits.push(el('p', { class: 'meta' },
      n + (n === 1 ? ' ballot' : ' ballots') + ' had no preference between the finalists.'));
  }
  return bits;
}

function winnersLine(race, res) {
  if (res.winners.length === 0) return null;
  const names = res.winners.map((w) => race.candidates[w]);
  return el('p', { class: 'meta' },
    (res.winners.length === res.seats ? 'Winners: ' : 'Seats decided so far: ')
    + names.join(', '));
}

function raceCard(race, res) {
  if (res.method === 'star') {
    const round = res.rounds[0];
    return el('div', { class: 'card' },
      el('h3', {}, race.title),
      starTable(race, round.members, round.result, 'WINNER'),
      res.tie ? el('div', { class: 'notice warn' },
        'This race is tied. ' + res.notes.join(' ')) : null,
      ...roundNotes(round.result),
    );
  }
  if (res.method === 'bloc') return blocCard(race, res);
  return prCard(race, res);
}

// Bloc STAR: one ordinary STAR round per seat, winners removed as
// they are seated.
function blocCard(race, res) {
  const kids = [
    el('div', { class: 'row space' },
      el('h3', {}, race.title),
      el('span', { class: 'pill' }, res.seats + ' seats, Bloc STAR'),
    ),
    winnersLine(race, res),
  ];
  res.rounds.forEach((round, i) => {
    const r = round.result;
    const seatName = r.winner !== null ? race.candidates[round.members[r.winner]] : 'tied';
    kids.push(el('h4', {}, 'Seat ' + (i + 1) + ': ' + seatName));
    kids.push(starTable(race, round.members, r, 'SEAT ' + (i + 1)));
    kids.push(...roundNotes(r));
  });
  if (res.tie) {
    kids.push(el('div', { class: 'notice warn' },
      'This race is tied. ' + res.notes.join(' ')));
  }
  return el('div', { class: 'card' }, ...kids.filter(Boolean));
}

// STAR-PR: weighted score totals per seat round, with a quota of
// ballot weight spent for every seat filled.
function prCard(race, res) {
  const per = Math.round((res.quota.ballots / res.quota.seats) * 100) / 100;
  const kids = [
    el('div', { class: 'row space' },
      el('h3', {}, race.title),
      el('span', { class: 'pill' }, res.seats + ' seats, proportional'),
    ),
    winnersLine(race, res),
    el('p', { class: 'meta' },
      'Each seat spends a quota of ' + per + ' ballots of weight ('
      + res.quota.ballots + ' ballots for ' + res.quota.seats + ' seats) from the '
      + 'ballots that supported that winner most strongly, so remaining seats '
      + 'reflect the rest of the voters.'),
  ];
  res.rounds.forEach((round, i) => {
    const seatName = round.winner !== null ? race.candidates[round.winner] : 'tied';
    kids.push(el('h4', {}, 'Seat ' + (i + 1) + ': ' + seatName));
    kids.push(el('table', { class: 'results' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Candidate'),
        el('th', { class: 'num' }, 'Weighted score'),
      )),
      el('tbody', {}, round.members.map((c, j) => el('tr',
        { class: c === round.winner ? 'winner' : '' },
        el('td', {}, race.candidates[c] + (c === round.winner ? ' - SEAT ' + (i + 1) : '')),
        el('td', { class: 'num' }, String(round.totals[j])),
      ))),
    ));
  });
  if (res.tie) {
    kids.push(el('div', { class: 'notice warn' },
      'This race is tied. ' + res.notes.join(' ')));
  } else if (res.notes.length > 0) {
    kids.push(el('p', { class: 'meta' }, res.notes.join(' ')));
  }
  return el('div', { class: 'card' }, ...kids.filter(Boolean));
}

function raceSummary(race, res) {
  if (res.ballotCount === 0) return 'no ballots';
  if (res.seats === 1) {
    const r = res.rounds[0].result;
    if (r.tie || r.winner === null) return 'TIE - needs resolution';
    const name = race.candidates[r.winner];
    if (!r.runoff) return name + ' wins';
    const other = r.finalists.find((f) => f !== r.winner);
    const winVotes = r.finalists[0] === r.winner ? r.runoff.forA : r.runoff.forB;
    const loseVotes = r.finalists[0] === r.winner ? r.runoff.forB : r.runoff.forA;
    return name + ' wins ' + winVotes + ' to ' + loseVotes
      + (other !== undefined ? ' over ' + race.candidates[other] : '');
  }
  const names = res.winners.map((w) => race.candidates[w]);
  if (res.tie) {
    return (names.length > 0 ? 'seats so far: ' + names.join(', ') + '; ' : '')
      + 'TIE - needs resolution';
  }
  return 'winners: ' + names.join(', ');
}
