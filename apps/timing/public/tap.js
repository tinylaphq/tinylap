// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Taps without a page load (spec §6.3): the tap forms are submitted with
// fetch and the result is shown in place. Without this script each form
// submits normally. A failed request is never retried and never falls back
// to a normal submit: the server may have stored the tap already, so the
// driver is told to check the board.
const SIGNED_OUT = ['Sign in again', ' to keep tapping.'];
const NO_ANSWER = 'No answer from the server. Check the board before tapping again.';
const LABEL = { started: 'Started', lap: 'Lap', again: 'Again', error: 'Failed' };
const bar = /** @type {HTMLElement | null} */ (document.querySelector('.tap-bar'));
const status = document.querySelector('#tap-result');
const alertBox = document.querySelector('#tap-alert');
const timers = new WeakMap();
let latest = 0;

/** The bar's content: a state label and the text; `signedOut` links its first words back to this page, to sign in. */
function content(state, text, signedOut = false) {
  const label = document.createElement('span');
  label.className = 'tap-state';
  label.textContent = LABEL[state];
  const words = document.createElement('span');
  words.className = 'tap-text';
  if (signedOut) {
    const link = document.createElement('a');
    link.href = location.pathname + location.search;
    link.textContent = SIGNED_OUT[0];
    words.append(link, SIGNED_OUT[1]);
  } else {
    words.textContent = text;
  }
  return [label, ' ', words];
}

function show(state, text, colour, signedOut = false) {
  if (!bar || !status || !alertBox) return;
  bar.dataset.state = state;
  if (colour) bar.style.setProperty('--driver', colour);
  alertBox.replaceChildren();
  if (state === 'error') {
    const box = document.createElement('p');
    box.className = 'status status-error';
    box.setAttribute('role', 'alert');
    box.append(...content(state, text, signedOut));
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
    let signedOut = false;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new URLSearchParams(/** @type {Record<string, string>} */ (Object.fromEntries(new FormData(form)))),
        credentials: 'same-origin',
        // An expired session answers with a redirect to sign-in, which fetch must not follow across origins.
        redirect: 'manual',
      });
      signedOut = res.type === 'opaqueredirect';
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
    if (mine === latest) show(state, text, state === 'error' ? '' : colour, signedOut);
  });
}
