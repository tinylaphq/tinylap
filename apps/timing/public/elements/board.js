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
// - The record moment (drivers and transponders spec §4): the same swap, unless
//   motion is reduced, jumps a copy of the crown from the old holder's row to
//   the new holder's (whose own crown waits, hidden, until it lands), and
//   plays a crown and a burst behind the new time on the card that carries
//   data-record-new, then bounces the time. All of it aria-hidden, absolute
//   and clipped to the card; nothing stays. A swap during it carries it over
//   to the new card; a new record or disconnecting stops it.
// Without EventSource there is no stream; without JavaScript the page
// reloads every ten seconds (<noscript> refresh).

import { ring } from '../bell.js';

const STATES = { live: 'Live', reconnecting: 'Reconnecting…', off: 'Disconnected' };
// Once the stream gives up, reload: the server then answers the board, sign-in or the gone page.
const RELOAD_MS = 10_000;
const SOUND_KEY = 'tinylap-sound';
// What Safari and iOS accept as a gesture that unlocks audio.
const GESTURES = ['click', 'touchend', 'keydown'];
/** The record moment's length, and the crown's jump. */
const MOMENT_MS = 2400;
const JUMP_MS = 1100;
/** The burst's colours, in turn: palace's. */
const BURST = ['var(--p-warning)', 'var(--p-accent-1)', 'var(--p-accent-3)'];
const still = matchMedia('(prefers-reduced-motion: reduce)');

/** The time on the card that carries data-record-new: the idle record card's, else the strip's. @param {ParentNode} root */
const recordTime = (root) => /** @type {HTMLElement | null} */ (root.querySelector('.board-hero[data-record-new] .board-hero-time')
  ?? root.querySelector('.board-track[data-record-new] .board-track-new .board-track-time'));

/** A copy of the server's crown for the moment, for the eye only. @param {Element} crown @param {string} className */
function crownCopy(crown, className) {
  const copy = /** @type {SVGElement} */ (crown.cloneNode(true));
  copy.querySelector('title')?.remove();
  copy.removeAttribute('role');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('class', className);
  return copy;
}

/**
 * The record card's part (the mockup's heroFall): behind the time a crown
 * pops up, a little wider than the digits, its base on their baseline, its
 * peaks inside the card, and grows slowly while it fades; a burst of twelve
 * bars shoots out with it, gone within the first second; then the time
 * bounces. Starts `elapsed` ms in, when a swap carries it over.
 * @param {HTMLElement} time @param {Element | null} crown @param {number} elapsed
 */
function lightCard(time, crown, elapsed) {
  const card = /** @type {HTMLElement} */ (time.closest('.board-hero-record, .board-track'));
  const box = card.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(time);
  const digits = range.getBoundingClientRect();
  const base = digits.top + digits.height * 0.84;
  const ch = Math.max(0, Math.min(digits.width * 1.15 * 18 / 26, base - box.top - Math.min(12, (base - box.top) * 0.15)));
  const w = ch * 26 / 18;
  const fx = document.createElement('div');
  fx.className = 'hero-fx';
  fx.setAttribute('aria-hidden', 'true');
  const at = document.createElement('div');
  at.className = 'fx-at';
  Object.assign(at.style, { left: `${digits.left + digits.width / 2 - box.left}px`, top: `${base - ch / 2 - box.top}px` });
  const rays = BURST.flatMap(() => [0, 1, 2, 3]).map((_, i) => {
    const ray = document.createElement('span');
    ray.className = 'fx-ray';
    Object.assign(ray.style, { width: `${w * 0.08}px`, height: `${w * 0.3}px`, background: BURST[i % 3] });
    return ray;
  });
  at.append(...rays);
  const big = crown ? crownCopy(crown, 'fx-crown') : null;
  if (big) {
    Object.assign(big.style, { width: `${w}px`, height: `${ch}px` });
    at.append(big);
  }
  fx.append(at);
  card.prepend(fx);
  const timing = { duration: MOMENT_MS, fill: /** @type {const} */ ('forwards') };
  const animations = [];
  if (big) {
    animations.push(big.animate([
      { transform: 'scale(0.2) rotate(-24deg)', opacity: 0 },
      { transform: 'scale(1.08) rotate(3deg)', opacity: 1, offset: 0.14, easing: 'cubic-bezier(.2,.9,.3,1.2)' },
      { transform: 'scale(1) rotate(0)', opacity: 1, offset: 0.22, easing: 'linear' },
      { transform: 'scale(1.08) rotate(0)', opacity: 1, offset: 0.66, easing: 'cubic-bezier(.5,0,.8,.3)' },
      { transform: 'scale(1.3) rotate(0)', opacity: 0 },
    ], timing));
  }
  rays.forEach((ray, i) => {
    const turn = `rotate(${i * 30}deg)`, gap = ch * 0.5;
    animations.push(ray.animate([
      { transform: `${turn} translateY(${-gap}px) scaleY(0)`, opacity: 1 },
      { transform: `${turn} translateY(${-gap}px) scaleY(0)`, opacity: 1, offset: 0.06 },
      { transform: `${turn} translateY(${-gap * 1.3}px) scaleY(1)`, opacity: 1, offset: 0.18, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: `${turn} translateY(${-gap * 2}px) scaleY(0)`, opacity: 1, offset: 0.34 },
      { transform: `${turn} translateY(${-gap * 2}px) scaleY(0)`, opacity: 0 },
    ], timing));
  });
  // The finale: the time bounces in front, about its digits' middle, wherever the card aligns them.
  // Light digits (the strip's) take the card's --fx-halo while the crown is behind them, so they still read.
  const tr = time.getBoundingClientRect();
  const transformOrigin = `${digits.left + digits.width / 2 - tr.left}px ${digits.top + digits.height / 2 - tr.top}px`;
  const halo = getComputedStyle(time).getPropertyValue('--fx-halo').trim();
  const shade = (/** @type {boolean} */ on) => halo ? { textShadow: on ? halo : '0 0 0 transparent' } : {};
  animations.push(time.animate([
    { transform: 'scale(1)', transformOrigin, ...shade(false) },
    { transform: 'scale(1)', transformOrigin, offset: 0.14, ...shade(true) },
    { transform: 'scale(1)', transformOrigin, offset: 0.34, ...shade(true) },
    { transform: 'scale(1.2)', transformOrigin, offset: 0.46, easing: 'cubic-bezier(.3,0,.4,1)', ...shade(true) },
    { transform: 'scale(0.95)', transformOrigin, offset: 0.56, ...shade(true) },
    { transform: 'scale(1.06)', transformOrigin, offset: 0.64, ...shade(true) },
    { transform: 'scale(1)', transformOrigin, offset: 0.72, ...shade(true) },
    { transform: 'scale(1)', transformOrigin, ...shade(false) },
  ], { duration: MOMENT_MS }));
  for (const a of animations) a.currentTime = elapsed;
  return { fx, animations };
}

/** The focused element's counterpart in `next`, by href or id. @param {Element} next @param {Element | null} focused */
function counterpart(next, focused) {
  const href = focused?.getAttribute('href');
  if (href) return next.querySelector(`[href="${CSS.escape(href)}"]`);
  return focused?.id ? next.querySelector(`#${CSS.escape(focused.id)}`) : null;
}

/** Swaps `next` in for `current`, keeping focus and an unchanged live line (so it isn't announced again). */
function swap(current, next) {
  const focused = current.contains(document.activeElement) ? document.activeElement : null;
  for (const selector of ['.board-unknown', '.board-offline', '.board-on-track', '.board-quiet', '.board-decoders']) {
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
  /**
   * The record moment while it plays: when it began, the card's part, the
   * crown's jump and the crown that waits for it.
   * @type {{ seq: string, start: number, card: { fx: HTMLElement, animations: Animation[] } | null, flyer: Element | null, jump: Animation | null, crown: SVGElement | null, timer: ReturnType<typeof setTimeout> } | null}
   */
  moment = null;

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
    this.stopMoment();
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
    const holder = text('.board-track-new .driver-name');
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

  /**
   * Plays the record moment for `seq`, the crown jumping from `from` (the old
   * holder's crown, measured before the swap) to the board's crown now.
   * @param {string} seq @param {DOMRect | null} from
   */
  playMoment(seq, from) {
    this.stopMoment();
    if (still.matches) return;
    const crown = /** @type {SVGElement | null} */ (this.querySelector('#board-live .crown'));
    const time = recordTime(this);
    /** @type {NonNullable<TlBoard['moment']>} */
    const moment = { seq, start: performance.now(), card: null, flyer: null, jump: null, crown: null, timer: setTimeout(() => this.stopMoment(), MOMENT_MS + 50) };
    this.moment = moment;
    if (time) moment.card = lightCard(time, crown, 0);
    if (!crown || !from || !from.width) return;
    // The mockup's play: up, over in an arc, and down onto the new holder's name with a squash.
    const to = crown.getBoundingClientRect();
    const flyer = crownCopy(crown, 'crown crown-flyer');
    Object.assign(flyer.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
    this.append(flyer);
    crown.style.visibility = 'hidden';
    const dx = to.left - from.left, dy = to.top - from.top;
    const lift = Math.min(dy, 0) - from.height * 1.6;
    moment.flyer = flyer;
    moment.crown = crown;
    moment.jump = flyer.animate([
      { transform: 'translate(0, 0) scale(1) rotate(0)' },
      { transform: `translate(0, ${-from.height * 0.5}px) scale(1.5) rotate(-12deg)`, offset: 0.18 },
      { transform: `translate(${dx / 2}px, ${lift}px) scale(1.7) rotate(8deg)`, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.15, 0.85) rotate(0)`, offset: 0.88 },
      { transform: `translate(${dx}px, ${dy}px) scale(1) rotate(0)` },
    ], { duration: JUMP_MS, easing: 'cubic-bezier(.3,.7,.4,1)' });
    moment.jump.finished.then(() => this.land(moment), () => {});
  }

  /** The jump is over: the crown shows where it landed. @param {NonNullable<TlBoard['moment']>} moment */
  land(moment) {
    moment.crown?.style.removeProperty('visibility');
    moment.flyer?.remove();
    moment.crown = moment.flyer = moment.jump = null;
  }

  /** A swap during the moment: the card's part starts again on the new card where it was, and the new crown waits for the jump. */
  carryMoment() {
    const moment = this.moment;
    if (!moment) return;
    if (this.recordSeq() !== moment.seq) {
      this.stopMoment();
      return;
    }
    if (moment.card) {
      for (const a of moment.card.animations) a.cancel();
      moment.card.fx.remove();
    }
    const time = recordTime(this);
    const crown = /** @type {SVGElement | null} */ (this.querySelector('#board-live .crown'));
    moment.card = time ? lightCard(time, crown, performance.now() - moment.start) : null;
    if (moment.jump) {
      moment.crown = crown;
      crown?.style.setProperty('visibility', 'hidden');
    }
  }

  /** Ends the moment at once: nothing of it stays. */
  stopMoment() {
    const moment = this.moment;
    if (!moment) return;
    this.moment = null;
    clearTimeout(moment.timer);
    moment.jump?.cancel();
    this.land(moment);
    if (moment.card) {
      for (const a of moment.card.animations) a.cancel();
      moment.card.fx.remove();
    }
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
        // Where the old holder's crown was, for the jump, before the swap takes it away.
        const from = current?.querySelector('.crown')?.getBoundingClientRect() ?? null;
        if (next && current) swap(current, next);
        const seq = this.recordSeq();
        const fresh = seq !== null && seq !== this.seen;
        this.seen = seq ?? this.seen; // first, so a failing bell or notification can't repeat
        if (fresh && this.audio && this.soundOn) ring(this.audio);
        if (fresh && this.notifyOn) this.notifyRecord(seq);
        if (fresh) this.playMoment(seq, from);
        else this.carryMoment();
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
