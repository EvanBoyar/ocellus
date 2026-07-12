// How-to screen, reached from the "?" in the header.

import { el } from './dom.js';

function card(title, ...body) {
  return el('div', { class: 'card' },
    el('h3', {}, title),
    ...body.map((t) => (typeof t === 'string' ? el('p', { class: 'meta' }, t) : t)),
  );
}

export function renderHelp(root, goBack) {
  root.append(
    el('div', { style: 'margin-top: 6px;' },
      el('button', { class: 'btn-quiet btn-small', onclick: goBack }, 'Back'),
    ),
    el('h1', {}, 'How to run an election'),
    el('p', { class: 'sub' },
      'Ocellus prints paper STAR voting ballots, scans them with the camera, and tallies the results. '
      + 'Everything stays on your device; nothing is uploaded anywhere.'),

    card('1. Design the ballot',
      'Create an election, add races and candidates, and add any yes/no questions. '
      + 'In a STAR race, voters score every candidate from 0 (oppose) to 5 (strongest support); '
      + 'the two highest scorers go to an automatic runoff decided by which of them more voters preferred. '
      + 'Candidate order can be shuffled on every ballot so nobody benefits from being listed first.'),

    card('2. Bring in the other officials',
      'On the Design tab, copy the election string and send it to your other officials over any private '
      + 'channel, like a Signal group. Importing it gives them the exact same election, ballot design, and keys. '
      + 'Long strings (for example when the ballot has a graphic) get cut off by messaging apps; send those '
      + 'with Save as file instead, and import with Open file. '
      + 'The election contains the secret key that makes ballots verifiable, so only share it with people '
      + 'running the election.'),

    card('3. Print ballots',
      'Print from the Ballots tab, or save as PDF and print elsewhere. Each ballot carries a unique code, '
      + 'so it can only be counted once and only for this election. '
      + 'Ballot numbers come from a random range on every print run, which lets several officials print '
      + 'independently: the chance of a clash is about one in a million. If you want that chance to be '
      + 'exactly zero, have one person do all the printing.'),

    card('4. Vote',
      'Voters fill bubbles completely with dark ink. A skipped row counts as 0. '
      + 'If someone ruins a ballot, spoil it (Scan tab, spoil mode) and hand them a fresh one. '
      + 'A spoiled ballot can never be counted, even if someone finds the paper later.'),

    card('5. Scan',
      'Point the camera at each ballot page. The app verifies the ballot, reads the marks, and shows you '
      + 'what it read. Anything doubtful is highlighted: faint marks, double marks, and rows that look blank '
      + 'all need your confirmation before the ballot is accepted. Scanning the same ballot twice is '
      + 'harmless, and a ballot can also be typed in by hand using its printed code.'),

    card('6. Combine everyone\'s work',
      'Officials can split the stack and each scan a share. On the Results tab, copy your scan data string '
      + 'and send it to whoever is tabulating; they merge it with one tap. Large scan counts are too long '
      + 'for a message, so send those as a file. Spoils carry across merges automatically.'),

    card('7. Check the Election Integrity Code',
      'The Results tab shows the tallies, the outcome of each race and question, and the Election Integrity '
      + 'Code. Every official whose data is complete sees the same code, no matter what order they scanned '
      + 'in or who spoiled what. Read your codes out loud to each other before announcing results: '
      + 'if they match, your counts match.'),

    el('p', { class: 'meta', style: 'margin-top: 14px;' },
      'Ocellus works offline once installed. Add it to your home screen from the browser menu.'),
  );
}
