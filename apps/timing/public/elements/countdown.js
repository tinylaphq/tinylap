// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-countdown> (spec step two §2.2): ticks the session clock of its
// <time data-clock> on the server's time, on the board.
// - Reads data-kind, data-state, data-opens and data-closes ('' is null), and
//   takes skew = data-now − Date.now() once, on its first connect. On a page
//   that came from a prefetch, data-now may be minutes old: the elements that
//   came with that page's HTML use the device clock instead (skew 0).
// - Writes the <time>'s text and the [data-clock-label]'s text, which follows
//   the phase that time alone decides (clockAt), every 200 ms. Once the clock
//   is a fixed 0:00 (finishing, done, aborted) it stops ticking.
// Without it the server-rendered clock stays as rendered.
import { clockAt, formatClock } from '../format.js';

const TICK_MS = 200;
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
  }

  disconnectedCallback() {
    clearInterval(this.interval);
    this.interval = 0;
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
    // A fixed 0:00: stop.
    if (c.ms === 0 && STOPPED.includes(c.phase)) {
      clearInterval(this.interval);
      this.interval = 0;
    }
  }
}

upgrading = true;
if (!customElements.get('tl-countdown')) customElements.define('tl-countdown', TlCountdown);
upgrading = false;
