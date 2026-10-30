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
// - The bell: the icon switch its `sound` attribute names is revealed, and
//   localStorage['tinylap-sound'] remembers whether sound is wanted. Browsers
//   start audio only after a gesture, so the AudioContext is made on the
//   switch's click, or on the first click or key after a reload that
//   remembered sound on. The switch shows pressed only while the context
//   runs; wanted but not running, it shows its waiting state
//   (data-state="wanted") and swaps its title for the server's
//   data-title-wanted ("Tap to turn sound on"). A swap that brings a
//   data-record-new this page has not seen rings it; the first render never does.
// - The notification: the same swap shows "New track record" with the
//   header's text, while the tl-notify-setting its `notify` attribute names
//   (in the account menu) is on; its tag makes several open boards show one.
//   A browser that refuses to construct one (Android Chrome) shows nothing.
//   Without that setting (the big board, the watch link) it never notifies.
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

/** Swaps `next` in for `current`, keeping focus and an unchanged live line (so it isn't announced again). */
function swap(current, next) {
  const focused = current.contains(document.activeElement) ? document.activeElement : null;
  for (const selector of ['.board-unknown', '.board-on-track', '.board-quiet']) {
    const was = current.querySelector(selector);
    const now = next.querySelector(selector);
    if (was && now && was.textContent === now.textContent) now.replaceWith(was);
  }
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
  /** Whether sound is wanted, as remembered or last chosen. */
  wanted = false;
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

  /** Reveals the switch, asking for a tap if sound is remembered on. */
  initSound() {
    this.sound = document.getElementById(this.getAttribute('sound') ?? '');
    if (!this.sound || !('AudioContext' in window)) return;
    try { this.wanted = localStorage.getItem(SOUND_KEY) === 'on'; } catch { /* storage blocked: sound starts off */ }
    this.showSound();
    this.sound.hidden = false;
    this.sound.addEventListener('click', this);
    for (const type of GESTURES) addEventListener(type, this);
  }

  /** Stops waiting for a gesture. */
  lock() {
    for (const type of GESTURES) removeEventListener(type, this);
  }

  /** Sound can ring: wanted, and the context runs. */
  get soundOn() {
    return this.wanted && this.audio?.state === 'running';
  }

  /** Pressed only while sound can ring; wanted but not running, the switch asks for a tap. */
  showSound() {
    const on = this.soundOn;
    this.sound?.setAttribute('aria-pressed', String(on));
    if (this.wanted && !on) this.sound?.setAttribute('data-state', 'wanted');
    else this.sound?.removeAttribute('data-state');
    const title = this.sound?.getAttribute(this.wanted && !on ? 'data-title-wanted' : 'data-title');
    if (title) this.sound?.setAttribute('title', title);
  }

  /** On a gesture, while sound is wanted: makes the context and resumes it; once it runs, the gestures are no longer needed. */
  wake() {
    if (!this.wanted) return;
    const audio = this.audio ??= new AudioContext();
    audio.resume().then(() => {
      if (audio !== this.audio) return;
      if (audio.state === 'running') this.lock();
      this.showSound();
    }, () => {});
  }

  /** Notifications can show: the setting the `notify` attribute names is on. */
  get notifyOn() {
    const setting = /** @type {HTMLElement & { on?: boolean } | null} */ (document.getElementById(this.getAttribute('notify') ?? ''));
    return setting?.on === true;
  }

  /** Shows the record on the board as a notification: its time and holder, then what it beat. @param {string} seq */
  notifyRecord(seq) {
    const clean = (/** @type {string | null | undefined} */ value) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const text = (/** @type {string} */ selector) => clean(this.querySelector(selector)?.textContent);
    const now = text('.board-track-new .board-track-time');
    const holder = text('.board-track-new .driver');
    // The board sets the beaten record's time, holder and date apart by a gap; plain text takes dots.
    const parts = [...(this.querySelector('.board-track-beat')?.children ?? [])].map((part) => clean(part.textContent)).filter(Boolean);
    const beat = parts.length ? `Beat ${parts.join(' · ')}` : '';
    let note;
    try {
      note = new Notification('New track record', { body: `${now} · ${holder}${beat ? `\n${beat}` : ''}`, tag: `tinylap-record-${seq}` });
    } catch { return; } // only a service worker may notify here
    note.addEventListener('click', () => {
      window.focus();
      note.close();
    });
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
          // Pressed turns it off; off or waiting for a tap turns it on.
          this.wanted = !this.soundOn;
          this.showSound();
          try { localStorage.setItem(SOUND_KEY, this.wanted ? 'on' : 'off'); } catch { /* storage blocked: the choice lasts this page */ }
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
        const fresh = seq !== null && seq !== this.seen;
        this.seen = seq ?? this.seen; // first, so a failing bell or notification can't repeat
        if (fresh && this.audio && this.soundOn) ring(this.audio);
        if (fresh && this.notifyOn) this.notifyRecord(seq);
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
