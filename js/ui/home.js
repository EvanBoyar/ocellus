// Home: list of elections, create new, import shared election string.

import { el, clear } from './dom.js';
import { listElections, saveEntry, deleteEntry } from '../storage.js';
import { newElection, importElection, electionId } from '../model/election.js';
import { groupCode } from '../model/codec.js';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function renderHome(root) {
  const entries = listElections();

  root.append(
    el('h1', {}, 'Elections'),
    el('p', { class: 'sub' }, 'Design ballots, print them, scan them back in, and tally STAR results.'),
  );

  if (entries.length === 0) {
    root.append(el('div', { class: 'card' },
      el('h3', {}, 'No elections yet'),
      el('p', { class: 'meta' },
        'Create a new election to design your ballot, or paste an election string someone sent you.'),
    ));
  }

  for (const entry of entries) {
    const races = entry.election.races.length;
    const questions = entry.election.questions.length;
    const bits = [];
    if (races) bits.push(races + (races === 1 ? ' race' : ' races'));
    if (questions) bits.push(questions + (questions === 1 ? ' question' : ' questions'));
    root.append(el('div', { class: 'card' },
      el('div', { class: 'row space' },
        el('div', { class: 'grow' },
          el('h3', {}, entry.election.title),
          el('div', { class: 'meta' },
            (bits.join(', ') || 'empty') + ' - ID ' + groupCode(entry.eid || ''),
          ),
        ),
        el('a', { class: 'btn btn-small', href: '#/e/' + entry.id + '/design' }, 'Open'),
        el('button', {
          class: 'btn-quiet btn-small',
          onclick: () => {
            if (confirm('Delete "' + entry.election.title + '" and its scan data? This cannot be undone.')) {
              deleteEntry(entry.id);
              clear(root);
              renderHome(root);
            }
          },
        }, 'Delete'),
      ),
    ));
  }

  root.append(el('button', {
    class: 'btn-big',
    style: 'margin-top: 12px;',
    onclick: async () => {
      const election = newElection('Untitled Election');
      const entry = { id: uid(), election, nextSerial: 1, createdAt: new Date().toISOString() };
      entry.eid = await electionId(election);
      saveEntry(entry);
      location.hash = '#/e/' + entry.id + '/design';
    },
  }, 'New Election'));

  const pasteBox = el('textarea', { placeholder: 'Paste an election string (OCEL1. ...)' });
  const msg = el('div');
  root.append(el('div', { class: 'card', style: 'margin-top: 14px;' },
    el('h3', {}, 'Import an election'),
    el('p', { class: 'meta' }, 'Another official can send you their election as a text string. Paste it here to get the exact same ballot design and keys.'),
    pasteBox,
    msg,
    el('div', { class: 'row', style: 'margin-top: 8px;' },
      el('button', {
        onclick: async () => {
          const res = importElection(pasteBox.value);
          clear(msg);
          if (res.error) {
            msg.append(el('div', { class: 'notice error' }, res.error));
            return;
          }
          const eid = await electionId(res.election);
          const existing = listElections().find((e) => e.eid === eid);
          if (existing) {
            msg.append(el('div', { class: 'notice info' }, 'You already have this exact election.'));
            return;
          }
          const entry = {
            id: uid(), election: res.election, nextSerial: 1,
            createdAt: new Date().toISOString(), eid,
          };
          saveEntry(entry);
          location.hash = '#/e/' + entry.id + '/design';
        },
      }, 'Import'),
    ),
  ));
}
