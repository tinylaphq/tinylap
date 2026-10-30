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
// - The bell: the switch its `sound` attribute names is revealed, pressed or
//   not as localStorage['tinylap-sound'] remembers. Browsers start audio only
//   after a gesture, so the AudioContext is made on the switch's click, or on
//   the first click or key after a reload that remembered sound on. A swap
//   that brings a data-record-new this page has not seen rings it; the first
//   render never does.
// Without EventSource there is no stream; without JavaScript the page
// reloads every ten seconds (<noscript> refresh).

import { ring } from '../bell.js';

const STATES = { live: 'Live', reconnecting: 'Reconnecting…', off: 'Disconnected' };
// Once the stream gives up, reload: the server then answers the board, sign-in or the gone page.
const RELOAD_MS = 10_000;
const SOUND_KEY = 'tinylap-sound';
// What Safari and iOS accept as a gesture that unlocks audio.
const GESTURES = ['click', 'touchend', 'keydown'];

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
  /** @type {HTMLElement | null} */
  sound = null;
  /** @type {AudioContext | null} */
  audio = null;
  /** The newest data-record-new this page has shown. @type {string | null} */
  seen = null;

  connectedCallback() {
    this.seen = this.recordSeq();
    this.initSound();
    if (!('EventSource' in window)) return;
    addEventListener('pagehide', this);
    addEventListener('pageshow', this);
    this.open();
  }

  disconnectedCallback() {
    this.sound?.removeEventListener('click', this);
    this.lock();
    this.audio?.close().catch(() => {});
    this.audio = null;
    this.close();
    removeEventListener('pagehide', this);
    removeEventListener('pageshow', this);
  }

  /** The record state's seq on the board now, if any. */
  recordSeq() {
    return this.querySelector('[data-record-new]')?.getAttribute('data-record-new') ?? null;
  }

  /** Reveals the switch, pressed as remembered. */
  initSound() {
    this.sound = document.getElementById(this.getAttribute('sound') ?? '');
    if (!this.sound || !('AudioContext' in window)) return;
    let on = false;
    try { on = localStorage.getItem(SOUND_KEY) === 'on'; } catch { /* storage blocked: sound starts off */ }
    this.sound.setAttribute('aria-pressed', String(on));
    this.sound.hidden = false;
    this.sound.addEventListener('click', this);
    for (const type of GESTURES) addEventListener(type, this);
  }

  /** Stops waiting for a gesture. */
  lock() {
    for (const type of GESTURES) removeEventListener(type, this);
  }

  get soundOn() {
    return this.sound?.getAttribute('aria-pressed') === 'true';
  }

  /** On a gesture, while sound is on: makes the context and resumes it; once it runs, the gestures are no longer needed. */
  wake() {
    if (!this.soundOn) return;
    const audio = this.audio ??= new AudioContext();
    audio.resume().then(() => { if (audio.state === 'running') this.lock(); }, () => {});
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
      case 'click': // the switch's own click toggles; any click is a gesture
        if (event.currentTarget === this.sound) {
          const on = !this.soundOn;
          this.sound?.setAttribute('aria-pressed', String(on));
          try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* storage blocked: the choice lasts this page */ }
        }
        this.wake();
        break;
      case 'touchend':
        this.wake();
        break;
      case 'keydown': // only an activating key unlocks audio on Safari
        if (/** @type {KeyboardEvent} */ (event).key === 'Enter' || /** @type {KeyboardEvent} */ (event).key === ' ') this.wake();
        break;
      case 'open':
        this.setStatus('live');
        break;
      case 'error':
        if (this.source?.readyState !== EventSource.CLOSED) {
          this.setStatus('reconnecting');
          break;
        }
        this.setStatus('off');
        this.timer = setTimeout(() => location.reload(), RELOAD_MS);
        break;
      case 'board': {
        const template = document.createElement('template');
        template.innerHTML = /** @type {MessageEvent} */ (event).data; // rendered and escaped by the server
        const next = template.content.firstElementChild;
        const current = this.querySelector('#board-live');
        if (next && current) swap(current, next);
        const seq = this.recordSeq();
        if (seq && seq !== this.seen && this.audio && this.soundOn) ring(this.audio);
        this.seen = seq ?? this.seen;
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
