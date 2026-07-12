// Election designer: races, candidates, questions, and sharing.

import { el, clear, copyText, saveTextFile } from './dom.js';
import { navTabs } from '../app.js';
import { addRace, addQuestion, exportElection, electionId, readyToPrint } from '../model/election.js';
import { groupCode } from '../model/codec.js';

const THRESHOLDS = [
  { label: 'Simple majority (at least 50%)', num: 1, den: 2 },
  { label: 'Two thirds (at least 2/3)', num: 2, den: 3 },
  { label: 'Three quarters (at least 75%)', num: 3, den: 4 },
];

// Reads an image file and downscales it for the ballot header. The
// printed box tops out at 45x16mm, so 600x180 pixels is about 300 dpi
// on paper. PNG keeps line art and transparency crisp; JPEG usually
// wins for photos; whichever encodes smaller is stored.
async function loadLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('not a readable image'));
      im.src = url;
    });
    const scale = Math.min(1, 600 / img.naturalWidth, 180 / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const cx = canvas.getContext('2d');
    cx.drawImage(img, 0, 0, w, h);
    // JPEG turns transparent pixels black, so it is only a candidate
    // for fully opaque images.
    const alpha = cx.getImageData(0, 0, w, h).data;
    let opaque = true;
    for (let i = 3; i < alpha.length; i += 4) {
      if (alpha[i] < 255) { opaque = false; break; }
    }
    const png = canvas.toDataURL('image/png');
    const jpeg = opaque ? canvas.toDataURL('image/jpeg', 0.85) : null;
    return { data: jpeg && jpeg.length < png.length ? jpeg : png, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
  const printed = (ctx.entry.batches || []).length > 0 || ctx.entry.nextSerial > 1;

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

  // Optional graphic printed at the top of every ballot page. Stored
  // downscaled so the share string stays a reasonable size.
  const logoBox = el('div', { class: 'field' },
    el('span', {}, 'Ballot graphic (optional, printed beside the title on every page)'));
  const drawLogo = () => {
    while (logoBox.childNodes.length > 1) logoBox.lastChild.remove();
    if (e.logo) {
      logoBox.append(
        el('div', { class: 'row' },
          el('img', {
            src: e.logo.data, alt: 'Ballot graphic',
            style: 'max-height: 48px; max-width: 160px; border: 1px solid #ccc; background: #fff; padding: 2px;',
          }),
          el('button', {
            class: 'btn-quiet btn-small',
            onclick: () => { delete e.logo; persist(); drawLogo(); },
          }, 'Remove'),
        ),
      );
      return;
    }
    const fileInput = el('input', {
      type: 'file', accept: 'image/*',
      onchange: async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        try {
          e.logo = await loadLogo(file);
          persist();
          drawLogo();
        } catch (err) {
          alert('Could not read that image: ' + err.message);
        }
      },
    });
    logoBox.append(fileInput,
      el('p', { class: 'meta' },
        'A logo or seal. It keeps its proportions and is scaled to fit a '
        + '45 by 16 mm space beside the title: a squarish seal uses the full '
        + '16 mm height, while a wide banner is capped at 45 mm across and '
        + 'comes out shorter. Transparent backgrounds stay transparent, and '
        + 'the graphic is part of the election design, so officials you share '
        + 'it with print the same ballots. Note that the image makes the '
        + 'share string much longer: thousands of characters instead of a '
        + 'few hundred.'));
  };
  drawLogo();
  root.append(logoBox);

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

      // Seats to fill; blank means one. The method choice only exists
      // for multi-seat races, so the picker hides at one seat.
      const methodSel = el('select', {},
        el('option', { value: 'bloc' }, 'Bloc STAR: the group\'s overall favorites win'),
        el('option', { value: 'pr' }, 'Proportional (STAR-PR): seats split among voting blocs'),
      );
      methodSel.value = race.method === 'pr' ? 'pr' : 'bloc';
      methodSel.addEventListener('change', () => { race.method = methodSel.value; persist(); });
      const methodField = el('label', { class: 'field' },
        el('span', {}, 'How seats are awarded'), methodSel);
      const showMethod = () => {
        methodField.style.display = (race.seats || 1) > 1 ? '' : 'none';
      };
      showMethod();
      const seatsInput = el('input', {
        type: 'number', min: '1', max: '20',
        placeholder: '1',
        value: (race.seats || 1) > 1 ? String(race.seats) : '',
        oninput: (ev) => {
          const v = Math.floor(Number(ev.target.value));
          race.seats = Number.isFinite(v) && v >= 1 ? Math.min(v, 20) : 1;
          persist();
          showMethod();
        },
      });

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
        el('label', { class: 'field' },
          el('span', {}, 'Seats to fill (1 if blank; e.g. 3 to elect three board members)'),
          seatsInput),
        methodField,
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
      // Answer labels print next to the bubbles in place of Yes and
      // No. Blank means the default, so the fields start empty unless
      // a custom label was set.
      const labelInput = (idx, def) => el('input', {
        type: 'text',
        value: q.labels && q.labels[idx] !== def ? q.labels[idx] : '',
        placeholder: def,
        oninput: (ev) => {
          if (!Array.isArray(q.labels)) q.labels = ['Yes', 'No'];
          q.labels[idx] = ev.target.value.trim() || def;
          persist();
        },
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
        el('div', { class: 'row' },
          el('label', { class: 'field grow' },
            el('span', {}, 'Label for a yes vote'), labelInput(0, 'Yes')),
          el('label', { class: 'field grow' },
            el('span', {}, 'Label for a no vote'), labelInput(1, 'No')),
        ),
        el('p', { class: 'meta' },
          'Voters mark one of the two answers. Blank answers do not count toward the total. '
          + 'Short labels fit best; long ones wrap next to the bubble.'),
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

  // Sharing. Strings past a couple thousand characters get cut off by
  // Signal and SMS, so long elections (usually ones with a graphic)
  // steer toward the file instead.
  const MESSAGE_SAFE_LENGTH = 2000;
  const tooLong = exportElection(e).length > MESSAGE_SAFE_LENGTH;
  const slug = (e.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled');
  const shareArea = el('textarea', { readonly: '', rows: 4 });
  const copyBtn = el('button', { class: 'btn-small' }, 'Copy');
  copyBtn.addEventListener('click', async () => {
    shareArea.value = exportElection(e);
    await copyText(shareArea.value, copyBtn);
  });
  const saveBtn = el('button', {
    class: tooLong ? 'btn-small' : 'btn-quiet btn-small',
    onclick: () => saveTextFile('ocellus-election-' + slug + '.txt', exportElection(e)),
  }, 'Save as file');
  const revealBtn = el('button', {
    class: 'btn-quiet btn-small',
    onclick: () => { shareArea.value = exportElection(e); },
  }, 'Show string');

  root.append(el('div', { class: 'card', style: 'margin-top: 18px;' },
    el('h3', {}, 'Share this election'),
    el('p', { class: 'meta' },
      'Send this to the other officials, as a pasted string or as a file '
      + '(for example in a Signal chat). It contains the full ballot design '
      + 'and the secret key, so only share it with people running the election.'),
    tooLong ? el('div', { class: 'notice warn' },
      'This election\'s string is too long for a Signal or SMS message, '
      + 'which would cut it off. Send it as a file instead.') : null,
    shareArea,
    el('div', { class: 'row', style: 'margin-top: 8px;' },
      ...(tooLong ? [saveBtn, copyBtn, revealBtn] : [copyBtn, saveBtn, revealBtn])),
  ));

  if (readyToPrint(e)) {
    root.append(el('a', { class: 'btn btn-big', href: '#/e/' + ctx.entry.id + '/ballots', style: 'margin-top: 10px;' },
      'Next: print ballots'));
  }
}
