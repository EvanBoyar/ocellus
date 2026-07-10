// Scanning: camera capture, mark review, manual entry, and spoiling.

import { el, clear } from './dom.js';
import { navTabs } from '../app.js';
import { startCamera, stopCamera, frameLoop } from '../scan/camera.js';
import { detectPage, toCanonicalVotes } from '../scan/detect.js';
import { candidateOrder, verifyBallotCode } from '../model/ballotid.js';
import { mergeScan, overwriteScan, spoilBallot, unspoilBallot, isComplete } from '../model/records.js';
import { readyToPrint } from '../model/election.js';

export async function renderScan(root, ctx) {
  root.append(navTabs(ctx, 'scan'));
  root.append(el('h1', {}, 'Scan ballots'));

  if (!readyToPrint(ctx.election)) {
    root.append(el('div', { class: 'notice warn' }, 'Finish the ballot design before scanning.'));
    return;
  }
  if (ctx.sessionStale) {
    root.append(el('div', { class: 'notice error' },
      'Existing scan data belongs to an older version of this election design. '
      + 'Scanning now would mix incompatible data.',
      el('div', { style: 'margin-top:8px;' },
        el('button', {
          class: 'btn-danger btn-small',
          onclick: () => {
            ctx.session = { electionId: ctx.eid, pageCount: ctx.layout.pageCount, records: {}, spoiled: [] };
            ctx.saveSession();
            location.reload();
          },
        }, 'Discard old scan data'),
      ),
    ));
    return;
  }

  const counts = el('div', { class: 'row', style: 'margin-bottom:8px;' });
  const refreshCounts = () => {
    clear(counts);
    const total = Object.keys(ctx.session.records).length;
    const complete = Object.keys(ctx.session.records)
      .filter((s) => isComplete(ctx.session, Number(s))).length;
    counts.append(el('span', { class: 'pill' }, complete + ' scanned'));
    if (ctx.session.pageCount > 1 && total !== complete) {
      counts.append(el('span', { class: 'pill coral' }, (total - complete) + ' missing pages'));
    }
    counts.append(el('span', { class: 'pill gray' }, ctx.session.spoiled.length + ' spoiled'));
  };
  refreshCounts();
  root.append(counts);

  let spoilMode = false;

  // Camera stage.
  const video = el('video', { playsinline: '', muted: '' });
  const statusBar = el('div', { class: 'scan-status' }, 'Starting camera...');
  const stage = el('div', { class: 'scan-stage' }, video, statusBar);
  const panel = el('div');
  root.append(stage, panel);

  const spoilBtn = el('button', { class: 'btn-quiet' }, 'Spoil mode: off');
  spoilBtn.addEventListener('click', () => {
    spoilMode = !spoilMode;
    spoilBtn.textContent = 'Spoil mode: ' + (spoilMode ? 'ON' : 'off');
    spoilBtn.className = spoilMode ? 'btn-danger' : 'btn-quiet';
    statusBar.textContent = spoilMode
      ? 'SPOIL MODE: the next ballot scanned will be spoiled.'
      : 'Point the camera at a ballot page.';
  });

  const manualBtn = el('button', { class: 'btn-quiet' }, 'Enter by hand');
  root.append(el('div', { class: 'row', style: 'margin-top:10px;' }, spoilBtn, manualBtn));

  let stopLoop = null;
  let busy = false;
  let lastError = '';

  const handleFrame = async (frame) => {
    if (busy) return;
    const res = await detectPage(frame, {
      election: ctx.election, electionIdCode: ctx.eid, layout: ctx.layout, jsQR: window.jsQR,
    });
    if (res.error) {
      if (!res.transient && res.error !== lastError) {
        statusBar.textContent = res.error;
        lastError = res.error;
      }
      return;
    }
    lastError = '';
    busy = true;
    if (spoilMode) {
      showSpoilConfirm(res);
    } else {
      showReview(res, [res.page]);
    }
  };

  const startLoop = async () => {
    try {
      await startCamera(video);
      statusBar.textContent = 'Point the camera at a ballot page.';
      stopLoop = frameLoop(video, handleFrame);
    } catch (err) {
      statusBar.textContent = 'Camera unavailable: ' + err.message + '. You can still enter ballots by hand.';
    }
  };

  const resume = () => {
    clear(panel);
    busy = false;
    refreshCounts();
    statusBar.textContent = spoilMode
      ? 'SPOIL MODE: the next ballot scanned will be spoiled.'
      : 'Point the camera at a ballot page.';
  };

  function showSpoilConfirm(res) {
    clear(panel);
    if (ctx.session.spoiled.includes(res.serial)) {
      panel.append(el('div', { class: 'notice info' }, 'Ballot ' + res.ballotCode + ' is already spoiled.'));
      panel.append(el('button', { onclick: resume }, 'Keep scanning'));
      return;
    }
    panel.append(el('div', { class: 'card' },
      el('h3', {}, 'Spoil ballot ' + res.ballotCode + '?'),
      el('p', { class: 'meta' }, 'A spoiled ballot is removed from the count and can never be scanned into this election again.'),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn-danger',
          onclick: () => {
            spoilBallot(ctx.session, res.serial);
            ctx.saveSession();
            resume();
          },
        }, 'Spoil it'),
        el('button', { class: 'btn-quiet', onclick: resume }, 'Cancel'),
      ),
    ));
  }

  // Review panel after a successful scan: show what was read, let the
  // official correct anything flagged, then accept. `pageNumbers`
  // lists which layout pages are covered (one page for a camera scan,
  // all pages for manual entry).
  async function showReview(res, pageNumbers) {
    clear(panel);
    const blocks = pageNumbers.flatMap((n) => ctx.layout.pages[n - 1].blocks);
    const flagsFor = (raceId, row) => res.flags.filter((f) => f.raceId === raceId && f.printedRow === row);

    const editable = { votesByRow: structuredClone(res.votesByRow), questions: { ...res.questions } };
    const card = el('div', { class: 'card' });
    const pageLabel = ctx.layout.pageCount > 1
      ? (pageNumbers.length === 1 ? ' - page ' + pageNumbers[0] + ' of ' + ctx.layout.pageCount : ' - all pages')
      : '';
    card.append(el('h3', {}, 'Ballot ' + res.ballotCode + pageLabel));

    if (res.flags.length > 0) {
      card.append(el('div', { class: 'notice warn' },
        'Some marks need a second look. Check the highlighted rows below.'));
    }

    for (const block of blocks) {
      if (block.type === 'race') {
        const race = ctx.election.races.find((r) => r.id === block.raceId);
        const order = await candidateOrder(ctx.election, res.serial, race);
        card.append(el('h2', {}, race.title + (block.continued ? ' (continued)' : '')));
        for (const row of block.rows) {
          const name = race.candidates[order[row.printedRow]];
          const rowFlags = flagsFor(block.raceId, row.printedRow);
          const picker = el('div', { class: 'score-picker' });
          const current = () => editable.votesByRow[block.raceId]?.[row.printedRow] ?? 0;
          const redraw = () => {
            clear(picker);
            for (let s = 0; s <= 5; s++) {
              picker.append(el('button', {
                class: (current() === s ? 'sel' : '') + (rowFlags.length ? ' flagged' : ''),
                onclick: () => {
                  editable.votesByRow[block.raceId] = editable.votesByRow[block.raceId] || {};
                  editable.votesByRow[block.raceId][row.printedRow] = s;
                  redraw();
                },
              }, String(s)));
            }
          };
          redraw();
          card.append(el('div', { class: 'review-row' },
            el('div', { class: 'review-name' }, name,
              rowFlags.length ? el('span', { class: 'pill coral', style: 'margin-left:8px;' }, rowFlags[0].message) : null),
            picker,
          ));
        }
      } else {
        const q = ctx.election.questions.find((x) => x.id === block.qId);
        const qFlags = res.flags.filter((f) => f.qId === block.qId);
        card.append(el('h2', {}, q.title));
        const picker = el('div', { class: 'score-picker' });
        const labels = [[1, q.labels ? q.labels[0] : 'Yes'], [0, q.labels ? q.labels[1] : 'No'], [null, 'Blank']];
        const redraw = () => {
          clear(picker);
          for (const [value, label] of labels) {
            picker.append(el('button', {
              class: (editable.questions[block.qId] === value ? 'sel' : '') + (qFlags.length ? ' flagged' : ''),
              style: 'width:auto; padding:0 14px; border-radius:19px;',
              onclick: () => { editable.questions[block.qId] = value; redraw(); },
            }, label));
          }
        };
        redraw();
        card.append(el('div', { class: 'review-row' },
          qFlags.length ? el('div', { class: 'review-name' },
            el('span', { class: 'pill coral' }, qFlags[0].message)) : null,
          picker,
        ));
      }
    }

    const outcome = el('div');
    card.append(
      outcome,
      el('div', { class: 'row', style: 'margin-top: 12px;' },
        el('button', {
          class: 'btn-coral',
          onclick: async () => {
            const scans = await buildScans(res.serial, pageNumbers, editable);
            const results = scans.map((scan) => mergeScan(ctx.session, scan));
            clear(outcome);
            if (results.some((r) => r.status === 'conflict')) {
              outcome.append(el('div', { class: 'notice error' },
                'This ballot was already scanned with different marks. Keep the earlier scan, or replace it with this one.'),
              el('div', { class: 'row' },
                el('button', { class: 'btn-quiet btn-small', onclick: resume }, 'Keep earlier scan'),
                el('button', {
                  class: 'btn-danger btn-small',
                  onclick: () => {
                    for (const scan of scans) overwriteScan(ctx.session, scan);
                    ctx.saveSession();
                    resume();
                  },
                }, 'Replace with this scan'),
              ));
              return;
            }
            ctx.saveSession();
            if (results.some((r) => r.status === 'spoiled')) {
              outcome.append(el('div', { class: 'notice error' }, 'This ballot is spoiled and cannot be counted.'));
              setTimeout(resume, 1400);
            } else if (results.every((r) => r.status === 'duplicate')) {
              outcome.append(el('div', { class: 'notice info' }, 'Already scanned. Nothing new recorded.'));
              setTimeout(resume, 900);
            } else {
              outcome.append(el('div', { class: 'notice ok' }, 'Recorded.'));
              setTimeout(resume, 600);
            }
          },
        }, 'Accept'),
        el('button', { class: 'btn-quiet', onclick: resume }, 'Rescan'),
      ),
    );
    panel.append(card);
    panel.scrollIntoView({ behavior: 'smooth' });
  }

  // Splits the edited marks back into one scan record per page, with
  // printed rows mapped to canonical candidate order.
  async function buildScans(serial, pageNumbers, editable) {
    const scans = [];
    for (const n of pageNumbers) {
      const page = ctx.layout.pages[n - 1];
      const votesByRow = {};
      const questions = {};
      for (const block of page.blocks) {
        if (block.type === 'race') {
          for (const row of block.rows) {
            const score = editable.votesByRow[block.raceId]?.[row.printedRow] ?? 0;
            votesByRow[block.raceId] = votesByRow[block.raceId] || {};
            votesByRow[block.raceId][row.printedRow] = score;
          }
        } else {
          questions[block.qId] = editable.questions[block.qId] ?? null;
        }
      }
      const votes = await toCanonicalVotes(ctx.election, serial, votesByRow, candidateOrder);
      scans.push({ serial, page: n, votes, questions });
    }
    return scans;
  }

  // Manual entry: type the ballot code, then pick scores by hand.
  manualBtn.addEventListener('click', () => {
    clear(panel);
    busy = true;
    const codeInput = el('input', { type: 'text', placeholder: 'Ballot code, like 003-K7Q2M' });
    const msg = el('div');
    panel.append(el('div', { class: 'card' },
      el('h3', {}, 'Enter a ballot by hand'),
      el('p', { class: 'meta' }, 'Type the code printed at the bottom of the ballot.'),
      codeInput, msg,
      el('div', { class: 'row', style: 'margin-top:8px;' },
        el('button', {
          onclick: async () => {
            const verdict = await verifyBallotCode(ctx.election, codeInput.value);
            clear(msg);
            if (verdict.error) {
              msg.append(el('div', { class: 'notice error' }, verdict.error));
              return;
            }
            if (spoilMode) {
              showSpoilConfirm({ serial: verdict.serial, ballotCode: codeInput.value.trim().toUpperCase() });
              return;
            }
            // Start from an all-blank ballot covering every page and
            // let the official fill it in with the review controls.
            const allPages = ctx.layout.pages.map((pg) => pg.number);
            await showReview({
              serial: verdict.serial,
              ballotCode: codeInput.value.trim().toUpperCase(),
              votesByRow: {},
              questions: {},
              flags: [],
            }, allPages);
          },
        }, 'Continue'),
        el('button', { class: 'btn-quiet', onclick: resume }, 'Cancel'),
      ),
    ));
  });

  await startLoop();

  return () => {
    if (stopLoop) stopLoop();
    stopCamera(video);
  };
}
