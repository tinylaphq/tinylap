// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-countdown> (spec step two §2.2): ticks the session clock of its
// <time data-clock> on the server's time, on the board and on race control.
// - Reads data-kind, data-state, data-opens and data-closes ('' is null), and
//   takes skew = data-now − Date.now() once, on its first connect. On a page
//   that came from a prefetch, data-now may be minutes old: the elements that
//   came with that page's HTML use the device clock instead (skew 0).
// - Writes the <time>'s text and the [data-clock-label]'s text, which follows
//   the phase that time alone decides (clockAt), every 200 ms. Once the clock
//   is a fixed 0:00 (finishing, done, aborted) it stops ticking.
// - With reload-on-phase (race control's 200 answer to GET only, so a reload
//   never sends a form again): once the phase at server time differs from
//   data-state, it reloads the page once, 1 s after the boundary, so the
//   server's tick has moved the session first. A hidden page waits until it
//   is visible. A sessionStorage key per page, boundary and state allows one
//   reload, so a server that is behind or stalled can't make it loop; without
//   storage it never reloads. A prefetched element neither reads nor writes
//   the key: the page it loads is a normal one, which uses the key.
// Without it the server-rendered clock stays as rendered.
import { clockAt, formatClock } from '../format.js';

const TICK_MS = 200;
const GRACE_MS = 1000;
const prefetchedPage = /** @type {any} */ (performance.getEntriesByType('navigation')[0])?.deliveryType === 'navigational-prefetch';
let upgrading = false; // true only inside define(): the elements that came with the page's HTML
/** @param {string | undefined} v */
const num = (v) => (v === '' || v === undefined ? null : Number(v));
const STOPPED = ['finishing', 'done', 'aborted'];

class TlCountdown extends HTMLElement {
  /** @type {number | null} */
  skew = null;
  prefetched = false;
  /** @type {ReturnType<typeof setInterval> | 0} */
  interval = 0;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  reloadTimer = 0;
  decided = false;

  get time() {
    return /** @type {HTMLElement | null} */ (this.querySelector('time[data-clock]'));
  }

  connectedCallback() {
    const time = this.time;
    if (!time) return;
    if (this.skew === null) {
      this.prefetched = upgrading && prefetchedPage;
      this.skew = this.prefetched ? 0 : Number(time.dataset.now) - Date.now();
    }
    this.tick();
    this.interval = setInterval(() => this.tick(), TICK_MS);
    if (this.hasAttribute('reload-on-phase')) document.addEventListener('visibilitychange', this);
  }

  disconnectedCallback() {
    clearInterval(this.interval);
    this.interval = 0;
    clearTimeout(this.reloadTimer);
    this.reloadTimer = 0;
    document.removeEventListener('visibilitychange', this);
  }

  handleEvent() {
    if (!document.hidden) this.tick();
  }

  tick() {
    const time = this.time;
    if (!time) return;
    const d = time.dataset;
    const c = clockAt({ kind: d.kind ?? '', state: d.state ?? '', opensAt: num(d.opens), closesAt: num(d.closes) }, Date.now() + (this.skew ?? 0));
    const text = formatClock(c.ms);
    if (time.textContent !== text) time.textContent = text;
    const label = this.querySelector('[data-clock-label]');
    if (label && label.textContent !== c.label) label.textContent = c.label;
    const reloads = this.hasAttribute('reload-on-phase');
    if (reloads && c.phase !== d.state) this.decide();
    // A fixed 0:00: stop, but only once the reload is decided (or there is none to decide).
    if (c.ms === 0 && STOPPED.includes(c.phase) && (!reloads || this.decided || c.phase === d.state)) {
      clearInterval(this.interval);
      this.interval = 0;
    }
  }

  /** Schedules the one reload for this boundary, 1 s after it in server time. */
  decide() {
    if (this.decided || document.hidden) return;
    this.decided = true;
    const d = /** @type {HTMLElement} */ (this.time).dataset;
    const boundary = d.state === 'countdown' ? num(d.opens) : num(d.closes);
    const wait = Math.max(0, (boundary ?? 0) + GRACE_MS - (Date.now() + (this.skew ?? 0)));
    if (this.prefetched) {
      this.reloadTimer = setTimeout(() => location.reload(), wait);
      return;
    }
    const key = `tl-countdown reload ${location.pathname} ${d.opens} ${d.state}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      return;
    }
    this.reloadTimer = setTimeout(() => location.reload(), wait);
  }
}

upgrading = true;
if (!customElements.get('tl-countdown')) customElements.define('tl-countdown', TlCountdown);
upgrading = false;
