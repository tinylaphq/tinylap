// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-board> (spec step two §3): owns the live board's stream. The server
// renders #board-live inside it and streams a new one on every change.
// - On connect it opens an EventSource on #board-live's data-events, read
//   each time it opens, so ?big carries over; on disconnect it closes it.
// - Each 'board' message is swapped in for #board-live, keeping focus and an
//   unchanged notice; tl-board itself is never replaced.
// - Shows the stream's state in the element its `status` attribute names:
//   Live, Reconnecting… (the browser retries) or Disconnected. Once the
//   stream gives up, it reloads the page after RELOAD_MS.
// - pagehide closes the stream, so a hidden or cached board holds no
//   connection; pageshow from the back/forward cache reopens it, showing
//   "Reconnecting…" until it opens.
// Without EventSource there is no stream; without JavaScript the page
// reloads every ten seconds (<noscript> refresh).

const STATES = { live: 'Live', reconnecting: 'Reconnecting…', off: 'Disconnected' };
// Once the stream gives up, reload: the server then answers the board, sign-in or the gone page.
// Tests set globalThis.tinylapReloadMs to wait less.
const RELOAD_MS = 10_000;

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

class TlBoard extends HTMLElement {
  /** @type {EventSource | null} */
  source = null;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  timer = 0;

  connectedCallback() {
    if (!('EventSource' in window)) return;
    addEventListener('pagehide', this);
    addEventListener('pageshow', this);
    this.open();
  }

  disconnectedCallback() {
    this.close();
    removeEventListener('pagehide', this);
    removeEventListener('pageshow', this);
  }

  open() {
    const url = /** @type {HTMLElement | null} */ (this.querySelector('#board-live'))?.dataset.events;
    if (!url) return;
    this.source = new EventSource(url);
    for (const type of ['open', 'error', 'board']) this.source.addEventListener(type, this);
  }

  close() {
    this.source?.close();
    this.source = null;
    clearTimeout(this.timer);
    this.timer = 0;
  }

  /** @param {keyof typeof STATES} state */
  setStatus(state) {
    const status = document.getElementById(this.getAttribute('status') ?? '');
    if (!status) return;
    status.hidden = false;
    status.dataset.state = state;
    status.textContent = STATES[state];
  }

  /** @param {Event} event */
  handleEvent(event) {
    switch (event.type) {
      case 'open':
        this.setStatus('live');
        break;
      case 'error':
        if (this.source?.readyState !== EventSource.CLOSED) {
          this.setStatus('reconnecting');
          break;
        }
        this.setStatus('off');
        this.timer = setTimeout(() => location.reload(), Number(/** @type {any} */ (globalThis).tinylapReloadMs) || RELOAD_MS);
        break;
      case 'board': {
        const template = document.createElement('template');
        template.innerHTML = /** @type {MessageEvent} */ (event).data; // rendered and escaped by the server
        const next = template.content.firstElementChild;
        const current = this.querySelector('#board-live');
        if (next && current) swap(current, next);
        break;
      }
      case 'pagehide':
        this.close();
        break;
      case 'pageshow':
        if (/** @type {PageTransitionEvent} */ (event).persisted && this.isConnected && !this.source) {
          this.setStatus('reconnecting');
          this.open();
        }
        break;
    }
  }
}

if (!customElements.get('tl-board')) customElements.define('tl-board', TlBoard);
