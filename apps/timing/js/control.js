// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control (spec §8): start a qualifying or race for chosen drivers, or
// abort the one running. Practice needs no control; it is always on.
import { h, screenHref } from './dom.js';

const ACTIVE = new Set(['countdown', 'running', 'finishing']);
const KIND = { qualifying: 'Qualifying', race: 'Race' };

export function mountControl(root, ctx) {
  const section = h('section', { class: 'container stack-lg screen' });
  root.append(section);
  const base = `/workspaces/${encodeURIComponent(ctx.workspaceId)}`;
  const errorBox = () => h('p', { class: 'status status-error', role: 'alert', hidden: true });
  const fail = (box, error) => {
    box.textContent = error.message;
    box.hidden = false;
  };

  function startForm() {
    const drivers = [...ctx.view.drivers.values()];
    if (drivers.length === 0) return h('div', { class: 'card stack-md' }, h('h1', {}, 'Race control'), h('p', { class: 'empty' }, 'Add drivers in Setup first. '), h('a', { href: screenHref('setup') }, 'Setup'));
    const error = errorBox();
    const radio = (value, label, checked) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'kind', value, checked }), label);
    const form = /** @type {HTMLFormElement} */ (h('form', { class: 'card stack-md' },
      h('h1', {}, 'Race control'),
      h('fieldset', { class: 'stack-sm' }, h('legend', {}, 'Session'), radio('race', 'Race', true), radio('qualifying', 'Qualifying', false)),
      h('fieldset', { class: 'stack-sm' }, h('legend', {}, 'Drivers'),
        drivers.map((d) => h('label', { class: 'choice' }, h('input', { type: 'checkbox', name: 'roster', value: d.id, checked: true }), d.name))),
      h('label', { class: 'field' }, 'Minutes', h('input', { type: 'number', name: 'minutes', value: '5', min: '1', max: '60', step: '1', required: true })),
      h('label', { class: 'field' }, 'Countdown (seconds)', h('input', { type: 'number', name: 'countdown', value: '10', min: '0', max: '30', step: '1', required: true })),
      error,
      h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, 'Start')));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await ctx.api('POST', `${base}/sessions`, {
          kind: data.get('kind'), roster: data.getAll('roster'),
          durationSeconds: Number(data.get('minutes')) * 60, countdownSeconds: Number(data.get('countdown')),
        });
        location.hash = '#board';
      } catch (caught) {
        fail(error, caught);
      }
    });
    return form;
  }

  function runningPanel(session) {
    const error = errorBox();
    const abort = h('button', { type: 'button', class: 'btn btn-danger btn-lg' }, 'Abort');
    abort.addEventListener('click', async () => {
      try {
        await ctx.api('POST', `${base}/sessions/${encodeURIComponent(session.id)}/abort`);
      } catch (caught) {
        fail(error, caught);
      }
    });
    return h('div', { class: 'card stack-md' },
      h('h1', {}, KIND[session.kind]),
      h('p', { class: 'subtitle' }, session.state === 'countdown' ? 'Counting down' : session.state === 'finishing' ? 'Finishing the last lap' : 'Running'),
      h('a', { class: 'btn btn-secondary', href: screenHref('board') }, 'Show the board'),
      error, abort);
  }

  let key = '';
  const draw = () => {
    const s = ctx.view.session;
    const running = s && s.kind !== 'practice' && ACTIVE.has(s.state) ? s : null;
    const next = running ? `run:${running.id}:${running.state}` : `form:${[...ctx.view.drivers.keys()].join(',')}`;
    if (next === key) return;
    key = next;
    section.replaceChildren(running ? runningPanel(running) : startForm());
  };
  draw();
  const off = ctx.onChange(draw);
  return () => {
    off();
    section.remove();
  };
}
