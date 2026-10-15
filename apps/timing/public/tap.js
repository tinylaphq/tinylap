// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Taps without a page load (spec §6.3): the tap forms are submitted with
// fetch and the result is shown in place. Without this script each form
// submits normally. A failed request is never retried and never falls back
// to a normal submit: the server may have stored the tap already, so the
// driver is told to check the board.
const NO_ANSWER = 'No answer from the server. Check the board before tapping again.';
const LABEL = { started: 'Started', lap: 'Lap', again: 'Again', error: 'Failed' };
const bar = /** @type {HTMLElement | null} */ (document.querySelector('.tap-bar'));
const status = document.querySelector('#tap-result');
const alertBox = document.querySelector('#tap-alert');
const timers = new WeakMap();
let latest = 0;

/** The bar's content: a state label and the text. */
function content(state, text) {
  const label = document.createElement('span');
  label.className = 'tap-state';
  label.textContent = LABEL[state];
  const words = document.createElement('span');
  words.className = 'tap-text';
  words.textContent = text;
  return [label, ' ', words];
}

function show(state, text, colour) {
  if (!bar || !status || !alertBox) return;
  bar.dataset.state = state;
  if (colour) bar.style.setProperty('--driver', colour);
  alertBox.replaceChildren();
  if (state === 'error') {
    const box = document.createElement('p');
    box.className = 'status status-error';
    box.setAttribute('role', 'alert');
    box.append(...content(state, text));
    alertBox.append(box);
    status.replaceChildren();
    return;
  }
  // Cleared first, so that identical text is announced again.
  status.replaceChildren();
  requestAnimationFrame(() => status.replaceChildren(...content(state, text)));
}

for (const form of /** @type {NodeListOf<HTMLFormElement>} */ (document.querySelectorAll('form.tap-form'))) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const mine = ++latest;
    const tile = /** @type {HTMLElement | null} */ (form.querySelector('.tap-tile'));
    if (tile) {
      clearTimeout(timers.get(tile));
      tile.classList.add('is-tapped');
      timers.set(tile, setTimeout(() => tile.classList.remove('is-tapped'), 150));
    }
    const colour = tile ? tile.style.getPropertyValue('--driver') : '';
    let state = 'error';
    let text = NO_ANSWER;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new URLSearchParams(/** @type {Record<string, string>} */ (Object.fromEntries(new FormData(form)))),
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.text === 'string') {
        state = data.stored ? (data.lapMs === null ? 'started' : 'lap') : 'again';
        text = data.text;
      } else if (typeof data?.error === 'string') {
        text = data.error;
      }
    } catch {
      // Keep the fallback text.
    }
    if (mine === latest) show(state, text, state === 'error' ? '' : colour);
  });
}
