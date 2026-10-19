// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// <tl-relative-time>: keeps the "3 min ago" text of the <time datetime> inside
// it current on the server's time, and keeps itself hidden while that time is
// younger than its `min` attribute (ms). Its `now` attribute is the server's
// time (ms) when the page was rendered; skew = now − Date.now() is taken once,
// on connect. Without `now` it uses the device clock. One shared timer updates every element every 15 s, and once on
// connect; it pauses while the page is hidden, and stops when no element is
// connected. It writes the <time>'s text and its own `hidden` only. Without
// it the server-rendered text and `hidden` stay as rendered.
import { formatAgo } from '../format-ago.js';

const EVERY_MS = 15_000;
/** @type {Set<TlRelativeTime>} */
const live = new Set();
/** @type {ReturnType<typeof setInterval> | 0} */
let timer = 0;

function update() { for (const el of live) el.update(); }
function start() { clearInterval(timer); timer = document.hidden ? 0 : setInterval(update, EVERY_MS); }
function onVisibility() { if (!document.hidden) update(); start(); }

class TlRelativeTime extends HTMLElement {
  /** @type {number | null} */
  skew = null;

  connectedCallback() {
    if (this.skew === null) {
      // Without a server time, the device clock.
      const now = this.getAttribute('now');
      this.skew = now === null || now === '' ? 0 : Number(now) - Date.now();
    }
    if (live.size === 0) document.addEventListener('visibilitychange', onVisibility);
    live.add(this);
    this.update();
    start();
  }

  disconnectedCallback() {
    live.delete(this);
    if (live.size === 0) {
      clearInterval(timer);
      timer = 0;
      document.removeEventListener('visibilitychange', onVisibility);
    }
  }

  update() {
    const time = this.querySelector('time');
    const at = Date.parse(time?.dateTime ?? '');
    if (!time || Number.isNaN(at)) return;
    const now = Date.now() + (Number.isNaN(this.skew) ? 0 : this.skew ?? 0);
    const text = formatAgo(at, now);
    if (time.textContent !== text) time.textContent = text;
    const hidden = now - at < Number(this.getAttribute('min') ?? 0);
    if (this.hasAttribute('hidden') !== hidden) this.toggleAttribute('hidden', hidden);
  }
}

if (!customElements.get('tl-relative-time')) customElements.define('tl-relative-time', TlRelativeTime);
