// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-crossing-now src="/workspaces/<id>/live" hold-ms="10000">: wraps rows
// marked data-code="<transponder>", each holding a hidden .crossing-now the
// server rendered ("Crossing now", drivers and transponders spec §3.6).
// - On a `crossing` or `idle` event of the live stream for a row's
//   transponder, it shows that row's .crossing-now and adds `is-crossing` to
//   the row for hold-ms, then undoes both; another passing starts the hold over.
// - A row swapped in meanwhile (tl-frame) gets the same while its hold lasts.
// - It never writes words; without EventSource nothing lights.
// Opens the stream in connectedCallback, closes it in disconnectedCallback.

const HOLD_MS = 10_000;

class TlCrossingNow extends HTMLElement {
  /** @type {EventSource | null} */
  source = null;
  /** The transponders lit now, each with the timer that ends it. @type {Map<string, ReturnType<typeof setTimeout>>} */
  lit = new Map();
  /** Lights rows that arrive in a swap. */
  observer = new MutationObserver(() => { for (const code of this.lit.keys()) this.show(code, true); });

  connectedCallback() {
    const src = this.getAttribute('src');
    if (!src || !('EventSource' in window)) return;
    this.source = new EventSource(src);
    for (const type of ['crossing', 'idle']) this.source.addEventListener(type, this);
    this.observer.observe(this, { childList: true, subtree: true });
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

  /** @param {string} code @param {boolean} on */
  show(code, on) {
    for (const row of this.querySelectorAll(`[data-code="${CSS.escape(code)}"]`)) {
      if (row.classList.contains('is-crossing') !== on) row.classList.toggle('is-crossing', on);
      const slot = /** @type {HTMLElement | null} */ (row.querySelector('.crossing-now'));
      if (slot && slot.hidden === on) slot.hidden = !on;
    }
  }

  /** @param {Event} event */
  handleEvent(event) {
    let data;
    try { data = JSON.parse(/** @type {MessageEvent} */ (event).data); } catch { return; }
    const code = event.type === 'idle' ? data?.idle?.transponder : data?.transponder;
    if (typeof code !== 'string') return;
    clearTimeout(this.lit.get(code));
    this.lit.set(code, setTimeout(() => {
      this.lit.delete(code);
      this.show(code, false);
    }, this.holdMs));
    this.show(code, true);
  }
}

if (!customElements.get('tl-crossing-now')) customElements.define('tl-crossing-now', TlCrossingNow);
