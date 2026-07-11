// Ballot generation and the print / save-as-PDF flow.

import { el, clear } from './dom.js';
import { navTabs } from '../app.js';
import { readyToPrint } from '../model/election.js';
import { ballotCode, candidateOrder, allocateBatch } from '../model/ballotid.js';
import { renderBallotSvgs } from '../model/render.js';

// Print history lives on the entry as batches of {start, count}.
// Devices that printed with older sequential versions get their old
// range 1..nextSerial-1 registered so new batches avoid it.
function batchesOf(entry) {
  if (!entry.batches) {
    entry.batches = [];
    if (entry.nextSerial > 1) {
      entry.batches.push({ start: 1, count: entry.nextSerial - 1 });
    }
  }
  return entry.batches;
}

export async function renderBallots(root, ctx) {
  root.append(navTabs(ctx, 'ballots'));
  root.append(el('h1', {}, 'Ballots'));

  if (!readyToPrint(ctx.election)) {
    root.append(el('div', { class: 'notice warn' },
      'The design is not ready to print yet. The election, every race, and every question '
      + 'need titles, and every race needs at least one named candidate.'));
    return;
  }

  const pages = ctx.layout.pageCount;
  root.append(el('p', { class: 'sub' },
    'Each ballot is ' + pages + (pages === 1 ? ' page' : ' pages')
    + ' with a unique code, so it can only be scanned once and only for this election.'));

  const DEFAULT_COUNT = 10;
  const countInput = el('input', {
    type: 'number', min: '1', max: '500',
    placeholder: String(DEFAULT_COUNT),
  });
  const status = el('div');
  const preview = el('div');

  const drawPreview = async () => {
    clear(preview);
    // Preview with a throwaway serial; real serials are drawn per
    // print run.
    const serial = allocateBatch(batchesOf(ctx.entry), 1);
    const svgs = await buildBallot(ctx, serial);
    svgs.forEach((svg, i) => {
      if (svgs.length > 1) {
        preview.append(el('p', { class: 'meta' },
          'Page ' + (i + 1) + ' of ' + svgs.length));
      }
      preview.append(el('div', { class: 'ballot-preview', html: svg }));
    });
  };
  drawPreview();

  const printBtn = el('button', { class: 'btn-big' }, 'Print ballots');
  printBtn.addEventListener('click', async () => {
    const raw = countInput.value.trim();
    const count = raw === ''
      ? DEFAULT_COUNT
      : Math.max(1, Math.min(500, Number(raw) || 1));
    printBtn.disabled = true;
    printBtn.textContent = 'Preparing ' + count + ' ballots...';
    try {
      const printRoot = document.getElementById('print-root');
      clear(printRoot);
      const batches = batchesOf(ctx.entry);
      const first = allocateBatch(batches, count);
      for (let s = first; s < first + count; s++) {
        for (const svg of await buildBallot(ctx, s)) {
          const holder = el('div', { class: 'print-page', html: svg });
          printRoot.append(holder);
        }
      }
      batches.push({ start: first, count });
      ctx.saveEntry();
      clear(status);
      status.append(el('div', { class: 'notice info' },
        'Prepared ' + count + ' ballots. Use your browser print dialog to print, or choose "Save as PDF".'));
      window.print();
    } finally {
      printBtn.disabled = false;
      printBtn.textContent = 'Print ballots';
      drawPreview();
    }
  });

  root.append(
    el('div', { class: 'card' },
      el('label', { class: 'field' },
        el('span', {}, 'How many ballots to print (' + DEFAULT_COUNT + ' if left blank)'),
        countInput,
      ),
      el('p', { class: 'meta' },
        'Ballot numbers are drawn from a random range on every print run, so several officials '
        + 'can each print ballots for this election without clashing. Print a few extra; '
        + 'unused ballots are harmless, and spoiled ones can be replaced.'),
      printBtn,
      status,
    ),
    el('h2', {}, 'Preview'),
    preview,
  );
}

async function buildBallot(ctx, serial) {
  const code = await ballotCode(ctx.election, serial);
  const orders = {};
  for (const race of ctx.election.races) {
    orders[race.id] = await candidateOrder(ctx.election, serial, race);
  }
  return renderBallotSvgs({
    election: ctx.election,
    layout: ctx.layout,
    serial,
    code,
    orders,
    electionIdCode: ctx.eid,
  });
}
