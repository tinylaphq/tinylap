// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// <tl-local-time format="time|date|datetime">: rewrites the text of the
// <time datetime> inside it in the viewer's time zone, once, on connect:
// "14:32", "12 Oct" or "12 Oct, 14:32". The server renders the same time in
// UTC, which stays as it is without this element. Nothing runs afterwards.
const OPTIONS = {
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  date: { day: 'numeric', month: 'short' },
  datetime: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
};

class TlLocalTime extends HTMLElement {
  connectedCallback() {
    const time = this.querySelector('time');
    const at = Date.parse(time?.dateTime ?? '');
    const format = /** @type {keyof typeof OPTIONS} */ (this.getAttribute('format'));
    if (!time || Number.isNaN(at) || !OPTIONS[format]) return;
    // en-GB writes "12 Oct" and "12 Oct, 14:32", whatever the viewer's language.
    const text = new Intl.DateTimeFormat('en-GB', /** @type {Intl.DateTimeFormatOptions} */ (OPTIONS[format])).format(at);
    if (time.textContent !== text) time.textContent = text;
  }
}

if (!customElements.get('tl-local-time')) customElements.define('tl-local-time', TlLocalTime);
