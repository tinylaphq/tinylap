// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-crossing-now src="/workspaces/<id>/live" hold-ms="10000">: wraps rows
// marked data-code="<transponder>", each holding a hidden .crossing-now the
// server rendered ("Crossing now", "It's on the track now.", drivers and
// transponders spec §3.3, §3.6), or being that slot itself.
// - On a `crossing` or `idle` event of the live stream for a row's
//   transponder, it shows that row's slot and adds `is-crossing` to the row
//   for hold-ms, then undoes both; another passing starts the hold over.
// - A slot the server rendered shown (it crossed in the last few seconds),
//   on connect or in a swap, is held for the time its data-left-ms says is
//   left (hold-ms without one), then hidden.
// - A row swapped in meanwhile (tl-frame) gets the same while its hold lasts.
// - An event older than hold-ms lights nothing: a reconnect replays what it
//   missed. Its age is its `at` against the server's clock, the snapshot's
//   `now` that starts every stream, so the device's clock may be off.
// - It never writes words; without EventSource nothing lights, beyond what
//   the server rendered.
// Opens the stream in connectedCallback, closes it in disconnectedCallback.

const HOLD_MS = 10_000;

class TlCrossingNow extends HTMLElement {
  /** @type {EventSource | null} */
  source = null;
  /** The transponders lit now, each with the timer that ends it. @type {Map<string, ReturnType<typeof setTimeout>>} */
  lit = new Map();
  /** The server's clock minus this device's, from the stream's snapshot. @type {number | null} */
  offset = null;
  /** Lights rows that arrive in a swap, and holds what the server lit in them. */
  observer = new MutationObserver(() => {
    for (const code of this.lit.keys()) this.show(code, true);
    this.adopt();
  });

  connectedCallback() {
    this.adopt();
    this.observer.observe(this, { childList: true, subtree: true });
    const src = this.getAttribute('src');
    if (!src || !('EventSource' in window)) return;
    this.source = new EventSource(src);
    for (const type of ['snapshot', 'crossing', 'idle']) this.source.addEventListener(type, this);
  }

  /** Each slot shown by the server and not held yet: held from now. */
  adopt() {
    for (const row of this.querySelectorAll('[data-code]')) {
      const code = row.getAttribute('data-code') ?? '';
      const slot = this.slotOf(row);
      if (slot && !slot.hidden && !this.lit.has(code)) this.hold(code, this.leftOf(slot));
    }
  }

  /** A row's slot: the row itself, or its .crossing-now. @param {Element} row */
  slotOf(row) {
    return /** @type {HTMLElement | null} */ (row.matches('.crossing-now') ? row : row.querySelector('.crossing-now'));
  }

  /** What the server says is left of a shown slot's hold, else hold-ms. @param {HTMLElement} slot */
  leftOf(slot) {
    const ms = Number(slot.getAttribute('data-left-ms'));
    return Number.isFinite(ms) && ms > 0 ? Math.min(ms, this.holdMs) : this.holdMs;
  }

  /** Lights `code` for `ms` (hold-ms) from now. @param {string} code @param {number} [ms] */
  hold(code, ms = this.holdMs) {
    clearTimeout(this.lit.get(code));
    this.lit.set(code, setTimeout(() => {
      this.lit.delete(code);
      this.show(code, false);
    }, ms));
    this.show(code, true);
  }

  disconnectedCallback() {
    this.source?.close();
    this.source = null;
    this.observer.disconnect();
    for (const [code, timer] of this.lit) {
      clearTimeout(timer);
      this.show(code, false);
    }
    this.lit.clear();
  }

  get holdMs() {
    const ms = Number(this.getAttribute('hold-ms'));
    return Number.isFinite(ms) && ms > 0 ? ms : HOLD_MS;
  }

  /** Shows or hides `code`'s slots; only rows with a slot light. @param {string} code @param {boolean} on */
  show(code, on) {
    for (const row of this.querySelectorAll(`[data-code="${CSS.escape(code)}"]`)) {
      const slot = this.slotOf(row);
      if (!slot) continue;
      if (row.classList.contains('is-crossing') !== on) row.classList.toggle('is-crossing', on);
      if (slot.hidden === on) slot.hidden = !on;
    }
  }

  /** @param {Event} event */
  handleEvent(event) {
    let data;
    try { data = JSON.parse(/** @type {MessageEvent} */ (event).data); } catch { return; }
    if (event.type === 'snapshot') {
      if (typeof data?.now === 'number') this.offset = data.now - Date.now();
      return;
    }
    const passing = event.type === 'idle' ? data?.idle : data;
    const code = passing?.transponder;
    if (typeof code !== 'string') return;
    // A replayed event from before a reconnect: it crossed too long ago to be crossing now.
    if (typeof passing.at === 'number' && Date.now() + (this.offset ?? 0) - passing.at > this.holdMs) return;
    this.hold(code);
  }
}

if (!customElements.get('tl-crossing-now')) customElements.define('tl-crossing-now', TlCrossingNow);
