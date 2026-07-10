// Election designer: races, candidates, questions, and sharing.

import { el, clear, copyText } from './dom.js';
import { navTabs } from '../app.js';
import { addRace, addQuestion, exportElection, electionId, readyToPrint } from '../model/election.js';
import { groupCode } from '../model/codec.js';

const THRESHOLDS = [
  { label: 'Simple majority (at least 50%)', num: 1, den: 2 },
  { label: 'Two thirds (at least 2/3)', num: 2, den: 3 },
  { label: 'Three quarters (at least 75%)', num: 3, den: 4 },
];

export async function renderDesign(root, ctx) {
  const e = ctx.election;
  let saveTimer = null;

  const idBadge = el('span', { class: 'pill gray' }, 'ID ' + groupCode(ctx.eid));

  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      ctx.saveEntry();
      const eid = await electionId(e);
      if (eid !== ctx.eid) {
        ctx.eid = eid;
        ctx.entry.eid = eid;
        ctx.saveEntry();
        idBadge.textContent = 'ID ' + groupCode(eid);
      }
    }, 250);
  };

  const hasScans = Object.keys(ctx.session.records).length > 0 || ctx.session.spoiled.length > 0;
  const printed = ctx.entry.nextSerial > 1;

  root.append(navTabs(ctx, 'design'));
  root.append(el('h1', {}, 'Design'));
  root.append(el('p', { class: 'sub' },
    'Set up the races and questions for this election. ', idBadge));

  if (printed || hasScans) {
    root.append(el('div', { class: 'notice warn' },
      'Ballots have already been ' + (hasScans ? 'scanned' : 'printed')
      + '. Any design change creates a new election ID, and existing printed ballots will no longer verify.'));
  }

  const titleInput = el('input', {
    type: 'text', value: e.title,
    placeholder: 'Election title (e.g. Spring Board Election)',
    oninput: (ev) => { e.title = ev.target.value; persist(); },
  });
  root.append(el('label', { class: 'field' },
    el('span', {}, 'Election title (printed on every ballot)'),
    titleInput,
  ));
  // A brand new election lands here with no title; put the cursor
  // where the first keystroke belongs.
  if (e.title.trim() === '') {
    setTimeout(() => titleInput.focus(), 0);
  }

  root.append(el('label', { class: 'field' },
    el('span', {}, 'Paper size'),
    (() => {
      const sel = el('select', {},
        el('option', { value: 'letter' }, 'US Letter'),
        el('option', { value: 'a4' }, 'A4'),
      );
      sel.value = e.paper || 'letter';
      sel.addEventListener('change', () => { e.paper = sel.value; persist(); });
      return sel;
    })(),
  ));

  const racesBox = el('div');
  const questionsBox = el('div');

  const drawRaces = () => {
    clear(racesBox);
    e.races.forEach((race, ri) => {
      const candBox = el('div');
      const drawCands = () => {
        clear(candBox);
        race.candidates.forEach((name, ci) => {
          candBox.append(el('div', { class: 'list-item' },
            el('input', {
              type: 'text', value: name, class: 'grow',
              oninput: (ev) => { race.candidates[ci] = ev.target.value; persist(); },
            }),
            el('button', {
              class: 'btn-quiet btn-small',
              onclick: () => { race.candidates.splice(ci, 1); persist(); drawCands(); },
            }, 'Remove'),
          ));
        });
      };
      drawCands();

      const addInput = el('input', { type: 'text', placeholder: 'Add candidate', class: 'grow' });
      const addCand = () => {
        const name = addInput.value.trim();
        if (!name) return;
        race.candidates.push(name);
        addInput.value = '';
        persist();
        drawCands();
      };
      addInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addCand(); });

      racesBox.append(el('div', { class: 'card' },
        el('div', { class: 'row space' },
          el('input', {
            type: 'text', value: race.title, class: 'grow race-title',
            placeholder: 'Race title (e.g. President)',
            style: 'font-weight: 600;',
            oninput: (ev) => { race.title = ev.target.value; persist(); },
          }),
          el('button', {
            class: 'btn-quiet btn-small',
            onclick: () => {
              if (race.candidates.length === 0 || confirm('Remove the race "' + race.title + '"?')) {
                e.races.splice(ri, 1);
                persist();
                drawRaces();
              }
            },
          }, 'Remove race'),
        ),
        candBox,
        el('div', { class: 'row', style: 'margin-top: 8px;' }, addInput,
          el('button', { class: 'btn-small', onclick: addCand }, 'Add')),
        el('label', { class: 'check' },
          (() => {
            const cb = el('input', { type: 'checkbox' });
            cb.checked = !!race.randomize;
            cb.addEventListener('change', () => { race.randomize = cb.checked; persist(); });
            return cb;
          })(),
          'Randomize candidate order on each ballot',
        ),
      ));
    });
  };

  const drawQuestions = () => {
    clear(questionsBox);
    e.questions.forEach((q, qi) => {
      const sel = el('select', {},
        ...THRESHOLDS.map((t, i) => el('option', { value: String(i) }, t.label)),
      );
      const current = THRESHOLDS.findIndex((t) => t.num === q.num && t.den === q.den);
      sel.value = String(current >= 0 ? current : 0);
      sel.addEventListener('change', () => {
        const t = THRESHOLDS[Number(sel.value)];
        q.num = t.num;
        q.den = t.den;
        persist();
      });
      questionsBox.append(el('div', { class: 'card' },
        el('div', { class: 'row space' },
          el('input', {
            type: 'text', value: q.title, class: 'grow question-title',
            placeholder: 'Question (e.g. Adopt the new bylaws?)',
            style: 'font-weight: 600;',
            oninput: (ev) => { q.title = ev.target.value; persist(); },
          }),
          el('button', {
            class: 'btn-quiet btn-small',
            onclick: () => { e.questions.splice(qi, 1); persist(); drawQuestions(); },
          }, 'Remove'),
        ),
        el('label', { class: 'field' }, el('span', {}, 'Passes with'), sel),
        el('p', { class: 'meta' }, 'Voters mark Yes or No. Blank answers do not count toward the total.'),
      ));
    });
  };

  drawRaces();
  drawQuestions();

  root.append(
    el('h2', {}, 'Races (STAR voting)'),
    el('p', { class: 'sub' }, 'Voters score every candidate from 0 to 5. The two highest-scored candidates go to an automatic runoff.'),
    racesBox,
    el('button', {
      class: 'btn-quiet',
      onclick: () => {
        addRace(e);
        persist();
        drawRaces();
        const inputs = racesBox.querySelectorAll('input.race-title');
        if (inputs.length > 0) inputs[inputs.length - 1].focus();
      },
    }, 'Add race'),
    el('h2', {}, 'Yes/No questions'),
    questionsBox,
    el('button', {
      class: 'btn-quiet',
      onclick: () => {
        addQuestion(e);
        persist();
        drawQuestions();
        const inputs = questionsBox.querySelectorAll('input.question-title');
        if (inputs.length > 0) inputs[inputs.length - 1].focus();
      },
    }, 'Add question'),
  );

  // Sharing.
  const shareArea = el('textarea', { readonly: '', rows: 4 });
  const copyBtn = el('button', { class: 'btn-small' }, 'Copy');
  copyBtn.addEventListener('click', async () => {
    shareArea.value = exportElection(e);
    await copyText(shareArea.value, copyBtn);
  });
  const revealBtn = el('button', {
    class: 'btn-quiet btn-small',
    onclick: () => { shareArea.value = exportElection(e); },
  }, 'Show string');

  root.append(el('div', { class: 'card', style: 'margin-top: 18px;' },
    el('h3', {}, 'Share this election'),
    el('p', { class: 'meta' },
      'Send this string to the other officials (for example in a Signal chat). '
      + 'It contains the full ballot design and the secret key, so only share it with people running the election.'),
    shareArea,
    el('div', { class: 'row', style: 'margin-top: 8px;' }, copyBtn, revealBtn),
  ));

  if (readyToPrint(e)) {
    root.append(el('a', { class: 'btn btn-big', href: '#/e/' + ctx.entry.id + '/ballots', style: 'margin-top: 10px;' },
      'Next: print ballots'));
  }
}
