// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The live board (spec §6.1, §7): the server renders #board-live and
// streams it; this swaps each one in, shows whether the stream is live, and
// offers full screen on ?big. The clock is tl-countdown.
// Without it the page reloads every ten seconds (<noscript> refresh).

const STATES = { live: 'Live', reconnecting: 'Reconnecting…', off: 'Disconnected' };
// Once the stream gives up, reload: the server then answers the board, sign-in or the gone page.
// Tests set globalThis.tinylapReloadMs to wait less.
const RELOAD_MS = 10_000;
/** @param {keyof typeof STATES} state */
function setStatus(state) {
  const status = /** @type {HTMLElement | null} */ (document.querySelector('#live-status'));
  if (!status) return;
  status.hidden = false;
  status.dataset.state = state;
  status.textContent = STATES[state];
}

/** The focused element's counterpart in `next`, by href or id. @param {Element} next @param {Element | null} focused */
function counterpart(next, focused) {
  const href = focused?.getAttribute('href');
  if (href) return next.querySelector(`[href="${CSS.escape(href)}"]`);
  return focused?.id ? next.querySelector(`#${CSS.escape(focused.id)}`) : null;
}

/** Swaps `next` in for `current`, keeping focus and an unchanged notice (so it isn't announced again). */
function swap(current, next) {
  const focused = current.contains(document.activeElement) ? document.activeElement : null;
  const was = current.querySelector('.board-unknown');
  const now = next.querySelector('.board-unknown');
  if (was && now && was.textContent === now.textContent) now.replaceWith(was);
  current.replaceWith(next);
  const target = focused && (next.contains(focused) ? focused : counterpart(next, focused));
  if (target instanceof HTMLElement && document.activeElement !== target) target.focus({ preventScroll: true });
}

const live = /** @type {HTMLElement | null} */ (document.querySelector('#board-live'));
if (live && 'EventSource' in window) {
  const source = new EventSource(live.dataset.events);
  source.addEventListener('open', () => setStatus('live'));
  source.addEventListener('error', () => {
    if (source.readyState !== EventSource.CLOSED) return setStatus('reconnecting');
    setStatus('off');
    setTimeout(() => location.reload(), Number(/** @type {any} */ (globalThis).tinylapReloadMs) || RELOAD_MS);
  });
  source.addEventListener('board', (event) => {
    const template = document.createElement('template');
    template.innerHTML = /** @type {MessageEvent} */ (event).data; // rendered and escaped by the server
    const next = template.content.firstElementChild;
    const current = document.querySelector('#board-live');
    if (next && current) swap(current, next);
  });
}

if (document.body.classList.contains('big') && document.documentElement.requestFullscreen) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm btn-outline';
  const label = () => { button.textContent = document.fullscreenElement ? 'Leave full screen' : 'Full screen'; };
  label();
  button.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
  document.addEventListener('fullscreenchange', label);
  document.querySelector('.navbar-right')?.prepend(button);
}
