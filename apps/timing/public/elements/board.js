// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-board> (spec step two §3): owns the live board's stream. The server
// renders #board-live inside it and streams a new one on every change.
// - On connect it opens an EventSource on #board-live's data-events, read
//   each time it opens, so ?big carries over; on disconnect it closes it.
// - Each 'board' message is swapped in for #board-live, keeping focus and an
//   unchanged notice; tl-board itself is never replaced. The strip's fastest
//   lap line, a live region, stays and takes the new line's content, so a
//   screen reader reads a new fastest lap.
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
//   data-record-new (on the shallow strip, the burst alone), then bounces
//   the time. All of it aria-hidden, absolute and clipped to the card;
//   nothing stays. A swap during it carries it over to the new card; a new
//   record or disconnecting stops it.
// - A row's moment (fastest lap spec §4): a swap that brings a standings row
//   whose data-moment this page has not seen lights that row in its mark's
//   colour (TR, FL or PB), behind its text; never on the first render. A
//   swap during it carries it to the same driver's row at its elapsed time;
//   a newer fastest lap slides an older one out; while three rows are lit, PBs
//   are dropped. With reduced motion the row takes the colour, holds and
//   fades. No sound: the record rings as above.
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
 * pops up (on the idle record card; the strip is too shallow), a little
 * wider than the digits, its base on their baseline, its peaks inside the
 * card, and grows slowly while it fades; a burst of twelve bars shoots out
 * with it, gone within the first second; then the time bounces. Starts `elapsed` ms in, when a swap carries it over.
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
  // The strip is too shallow for a crown behind its digits: there, only the burst and the bounce.
  const big = crown && card.matches('.board-hero-record') ? crownCopy(crown, 'fx-crown') : null;
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
  const tr = time.getBoundingClientRect();
  const transformOrigin = `${digits.left + digits.width / 2 - tr.left}px ${digits.top + digits.height / 2 - tr.top}px`;
  animations.push(time.animate([
    { transform: 'scale(1)', transformOrigin },
    { transform: 'scale(1)', transformOrigin, offset: 0.34 },
    { transform: 'scale(1.2)', transformOrigin, offset: 0.46, easing: 'cubic-bezier(.3,0,.4,1)' },
    { transform: 'scale(0.95)', transformOrigin, offset: 0.56 },
    { transform: 'scale(1.06)', transformOrigin, offset: 0.64 },
    { transform: 'scale(1)', transformOrigin, offset: 0.72 },
    { transform: 'scale(1)', transformOrigin },
  ], { duration: MOMENT_MS }));
  for (const a of animations) a.currentTime = elapsed;
  return { fx, animations };
}

/**
 * A row's moment (fastest lap spec §4), one for each mark: its length, when
 * its head has crossed the row, and when its fill slides out, in ms.
 */
const ROW_KINDS = {
  fl: { ms: 1600, cross: 520, out: 1150 },
  pb: { ms: 1600, cross: 520, out: 1150 },
  tr: { ms: 2400, cross: 700, out: 1900 },
};
/** The head's and the fill's crossing share one easing; the slide out eases in. */
const CROSS_EASE = 'cubic-bezier(.45,.05,.55,.95)';
const OUT_EASE = 'cubic-bezier(.6,0,.8,.4)';
/** A newer fastest lap slides the older row out this fast; with reduced motion a row fades this fast. */
const CUT_MS = 300;
const FADE_MS = 200;
/** While this many rows are lit, further PB moments are dropped. */
const MAX_LIT = 3;
const LIT = ['is-lit', 'is-lit-fl', 'is-lit-pb', 'is-lit-tr', 'is-lit-light'];

/**
 * A row's moment while it plays: whose row, which lap (`seq`) and mark, when
 * it began, whether motion was reduced then, when a newer fastest lap cut it
 * short, and what of it is on the row now.
 * @typedef {{ driver: string, seq: string, kind: keyof typeof ROW_KINDS, start: number, reduced: boolean, cut: number | null,
 *   row: HTMLElement, fx: HTMLElement | null, animations: Animation[], timers: ReturnType<typeof setTimeout>[] }} RowMoment
 */

/**
 * Draws `m` on its row as it stands at time `t`, whether it starts now or a
 * swap carries it over: one aria-hidden .row-fx in the row's first cell, the
 * head and fill animated to their elapsed time, the row's classes (lit; a
 * record row's text white while the purple is under it), and a timer for
 * each change still to come. `end` runs when it is over.
 * @param {RowMoment} m @param {number} t @param {() => void} end
 */
function drawRow(m, t, end) {
  const k = ROW_KINDS[m.kind];
  const elapsed = t - m.start;
  const fx = document.createElement('div');
  fx.className = 'row-fx';
  fx.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('span');
  fill.className = 'row-fx-fill';
  fx.append(fill);
  /** @type {Animation[]} */
  const main = [];
  const timing = { duration: k.ms, fill: /** @type {const} */ ('forwards') };
  if (m.reduced) {
    // No head and no sweep: the colour at once, held, then faded.
    main.push(fill.animate([{ opacity: 1 }, { opacity: 1, offset: (k.ms - FADE_MS) / k.ms }, { opacity: 0 }], timing));
  } else {
    const head = document.createElement('span');
    head.className = 'row-fx-head';
    fx.append(head);
    const cross = k.cross / k.ms;
    // The head is 40% of the row: from just off its left edge to just off its right edge, in the head's own widths.
    main.push(head.animate([
      { transform: 'translateX(-100%)', easing: CROSS_EASE },
      { transform: 'translateX(250%)', offset: cross },
      { transform: 'translateX(250%)' },
    ], timing));
    // The fill follows the head's back edge (the head starts in the fill's colour, so there is no seam), holds, then slides out.
    main.push(fill.animate([
      { clipPath: 'inset(0 135% 0 0)', easing: CROSS_EASE },
      { clipPath: 'inset(0 -5% 0 0)', offset: cross },
      { clipPath: 'inset(0 0 0 0)', offset: k.out / k.ms, easing: OUT_EASE },
      { clipPath: 'inset(0 0 0 100%)' },
    ], timing));
  }
  for (const a of main) a.currentTime = elapsed;
  // Cut short by a newer fastest lap: the whole moment slides out with a plain edge (or fades), wherever it was.
  let over = k.ms;
  let lightOff = m.reduced ? k.ms - FADE_MS : k.out + 120;
  if (m.cut !== null) {
    const cutAt = m.cut - m.start;
    const leave = m.reduced
      ? fx.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' })
      : fx.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: CUT_MS, easing: OUT_EASE, fill: 'forwards' });
    leave.currentTime = t - m.cut;
    main.push(leave);
    over = Math.min(over, cutAt + (m.reduced ? FADE_MS : CUT_MS));
    lightOff = Math.min(lightOff, cutAt + (m.reduced ? 0 : 120));
  }
  m.row.classList.add('is-lit', `is-lit-${m.kind}`);
  m.row.firstElementChild?.append(fx);
  m.fx = fx;
  m.animations = main;
  /** @type {(at: number, run: () => void) => void} */
  const at = (when, run) => {
    if (when <= elapsed) run();
    else m.timers.push(setTimeout(run, when - elapsed));
  };
  if (m.kind === 'tr') {
    const lightOn = m.reduced ? 0 : k.cross * 0.7;
    if (lightOn < lightOff && elapsed < lightOff) {
      at(lightOn, () => m.row.classList.add('is-lit-light'));
      at(lightOff, () => m.row.classList.remove('is-lit-light'));
    }
  }
  at(over, end);
}

/** Takes `m` off its row: nothing of it stays. @param {RowMoment} m */
function undrawRow(m) {
  for (const timer of m.timers) clearTimeout(timer);
  m.timers = [];
  for (const a of m.animations) a.cancel();
  m.animations = [];
  m.fx?.remove();
  m.fx = null;
  m.row.classList.remove(...LIT);
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
  // The strip's fastest lap is a live region (fastest lap spec §4): it stays, and takes the new line, so a change is read out.
  const was = current.querySelector('.board-fastest-line');
  const now = next.querySelector('.board-fastest-line');
  if (was && now) {
    if (was.textContent !== now.textContent) {
      for (const { name } of [...was.attributes]) if (!now.hasAttribute(name)) was.removeAttribute(name);
      for (const { name, value } of now.attributes) was.setAttribute(name, value);
      was.replaceChildren(...now.childNodes);
    }
    now.replaceWith(was);
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
  /** The row moments' seqs this page has shown or skipped. @type {Set<string>} */
  seenRows = new Set();
  /** The row moments playing, by driver. @type {Map<string, RowMoment>} */
  rows = new Map();

  connectedCallback() {
    this.seen = this.recordSeq();
    for (const r of this.rowMoments()) this.seenRows.add(r.seq);
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
    this.stopRows();
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
    // The board sets the beaten record's time and holder apart by a gap; plain text takes dots.
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

  /** The standings rows that offer a moment (fastest lap spec §4.1): `data-moment="<seq> fl|pb|tr"`. */
  rowMoments() {
    return [...this.querySelectorAll('#board-live .standings-table tbody tr[data-moment][data-driver]')].flatMap((row) => {
      const [seq, kind] = (row.getAttribute('data-moment') ?? '').split(' ');
      const driver = row.getAttribute('data-driver') ?? '';
      return seq && (kind === 'fl' || kind === 'pb' || kind === 'tr') ? [{ row: /** @type {HTMLElement} */ (row), driver, seq, kind: /** @type {keyof typeof ROW_KINDS} */ (kind) }] : [];
    });
  }

  /**
   * After a swap: playing row moments move to their driver's row in the new
   * render, at their elapsed time (a driver who left the table, or whose row
   * brings a new moment, ends theirs); a new fastest lap or record cuts an
   * older one short; then each moment this page has not seen plays, records
   * and fastest laps first, and a PB only while fewer than MAX_LIT rows are lit.
   */
  playRows() {
    const t = performance.now();
    const fresh = this.rowMoments().filter((r) => !this.seenRows.has(r.seq));
    for (const r of fresh) this.seenRows.add(r.seq);
    const renewed = new Set(fresh.map((r) => r.driver));
    for (const m of [...this.rows.values()]) {
      undrawRow(m);
      const row = this.querySelector(`#board-live .standings-table tbody tr[data-driver="${CSS.escape(m.driver)}"]`);
      if (!(row instanceof HTMLElement) || renewed.has(m.driver)) {
        this.rows.delete(m.driver);
        continue;
      }
      m.row = row;
      this.drawRow(m, t);
    }
    if (fresh.some((r) => r.kind !== 'pb')) {
      for (const m of this.rows.values()) {
        if (m.kind === 'pb' || m.cut !== null) continue;
        undrawRow(m);
        m.cut = t;
        this.drawRow(m, t);
      }
    }
    const reduced = still.matches;
    for (const r of [...fresh.filter((f) => f.kind !== 'pb'), ...fresh.filter((f) => f.kind === 'pb')]) {
      if (r.kind === 'pb' && [...this.rows.values()].filter((m) => m.cut === null).length >= MAX_LIT) continue;
      /** @type {RowMoment} */
      const m = { driver: r.driver, seq: r.seq, kind: r.kind, start: t, reduced, cut: null, row: r.row, fx: null, animations: [], timers: [] };
      this.rows.set(r.driver, m);
      this.drawRow(m, t);
    }
  }

  /** Draws a row moment, which leaves the board when it is over. @param {RowMoment} m @param {number} t */
  drawRow(m, t) {
    drawRow(m, t, () => {
      undrawRow(m);
      if (this.rows.get(m.driver) === m) this.rows.delete(m.driver);
    });
  }

  /** Ends every row moment at once: nothing of them stays. */
  stopRows() {
    for (const m of this.rows.values()) undrawRow(m);
    this.rows.clear();
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
        if (next && current) {
          swap(current, next);
          this.playRows();
        }
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
