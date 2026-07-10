// Ballot generation and the print / save-as-PDF flow.

import { el, clear } from './dom.js';
import { navTabs } from '../app.js';
import { readyToPrint } from '../model/election.js';
import { ballotCode, candidateOrder } from '../model/ballotid.js';
import { renderBallotSvgs } from '../model/render.js';

export async function renderBallots(root, ctx) {
  root.append(navTabs(ctx, 'ballots'));
  root.append(el('h1', {}, 'Ballots'));

  if (!readyToPrint(ctx.election)) {
    root.append(el('div', { class: 'notice warn' },
      'The design is not ready to print yet. Every race needs at least one candidate.'));
    return;
  }

  const pages = ctx.layout.pageCount;
  root.append(el('p', { class: 'sub' },
    'Each ballot is ' + pages + (pages === 1 ? ' page' : ' pages')
    + ' with a unique code, so it can only be scanned once and only for this election.'));

  const countInput = el('input', { type: 'number', min: '1', max: '500', value: '10' });
  const status = el('div');
  const preview = el('div', { class: 'ballot-preview' });

  const drawPreview = async () => {
    clear(preview);
    const serial = ctx.entry.nextSerial;
    const svgs = await buildBallot(ctx, serial);
    const holder = el('div', { html: svgs[0] });
    preview.append(holder.firstChild);
  };
  drawPreview();

  const printBtn = el('button', { class: 'btn-big' }, 'Print ballots');
  printBtn.addEventListener('click', async () => {
    const count = Math.max(1, Math.min(500, Number(countInput.value) || 0));
    printBtn.disabled = true;
    printBtn.textContent = 'Preparing ' + count + ' ballots...';
    try {
      const printRoot = document.getElementById('print-root');
      clear(printRoot);
      const first = ctx.entry.nextSerial;
      for (let s = first; s < first + count; s++) {
        for (const svg of await buildBallot(ctx, s)) {
          const holder = el('div', { class: 'print-page', html: svg });
          printRoot.append(holder);
        }
      }
      ctx.entry.nextSerial = first + count;
      ctx.saveEntry();
      clear(status);
      status.append(el('div', { class: 'notice info' },
        'Prepared ballots ' + first + ' through ' + (first + count - 1)
        + '. Use your browser print dialog to print, or choose "Save as PDF".'));
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
        el('span', {}, 'How many ballots to print'),
        countInput,
      ),
      el('p', { class: 'meta' },
        'Next ballot number: ' + ctx.entry.nextSerial
        + '. Print a few extra; unused ballots are harmless, and spoiled ones can be replaced.'),
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
