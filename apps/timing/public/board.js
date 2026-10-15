// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The live board (spec §6.1, §7): the server renders #board-live and
// streams it; this swaps each one in, ticks the clock on the server's time,
// shows whether the stream is live, and offers full screen on ?big.
// Without it the page reloads every ten seconds (<noscript> refresh).
import { formatClock } from './format.js';

const STATES = { live: 'Live', reconnecting: 'Reconnecting…', off: 'Disconnected' };
let skew = 0;

function remaining(el, now) {
  const { kind, state } = el.dataset;
  const opens = Number(el.dataset.opens);
  const closes = Number(el.dataset.closes);
  if (state === 'countdown') return opens - now;
  if (kind === 'practice') return state === 'running' ? now - opens : 0;
  return state === 'running' ? Math.max(0, closes - now) : 0;
}

function adopt(root) {
  const clock = root.querySelector('time[data-clock]');
  if (clock) skew = Number(clock.dataset.now) - Date.now();
}

function tick() {
  const clock = /** @type {HTMLElement | null} */ (document.querySelector('#board-live time[data-clock]'));
  if (clock) clock.textContent = formatClock(remaining(clock, Date.now() + skew));
}

/** @param {keyof typeof STATES} state */
function setStatus(state) {
  const status = /** @type {HTMLElement | null} */ (document.querySelector('#live-status'));
  if (!status) return;
  status.hidden = false;
  status.dataset.state = state;
  status.textContent = STATES[state];
}

const live = /** @type {HTMLElement | null} */ (document.querySelector('#board-live'));
if (live && 'EventSource' in window) {
  // The stream keeps the board current; the reload is only for no-JS.
  document.querySelector('meta[http-equiv="refresh"]')?.remove();
  adopt(live);
  setInterval(tick, 200);
  const source = new EventSource(live.dataset.events);
  source.addEventListener('open', () => setStatus('live'));
  source.addEventListener('error', () => setStatus(source.readyState === EventSource.CLOSED ? 'off' : 'reconnecting'));
  source.addEventListener('board', (event) => {
    const template = document.createElement('template');
    template.innerHTML = /** @type {MessageEvent} */ (event).data; // rendered and escaped by the server
    const next = template.content.firstElementChild;
    const current = document.querySelector('#board-live');
    if (next && current) {
      current.replaceWith(next);
      adopt(next);
    }
  });
}

if (document.body.classList.contains('big') && document.documentElement.requestFullscreen) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm btn-outline';
  button.textContent = 'Full screen';
  button.addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));
  document.querySelector('.navbar-right')?.prepend(button);
}
