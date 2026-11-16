// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// <tl-local-time format="time|date|datetime|datetime-year|datetime-short|day">: rewrites the text
// of the <time datetime> inside it in the viewer's time zone, once, on connect:
// "14:32", "12 Oct", "12 Oct, 14:32" or "12 Oct 2026, 14:32". datetime-short is the time alone
// on the viewer's today, without the year in their year, and in full before. day is "Monday 12 October"
// in the viewer's year and "Monday, 12 October 2025" outside it. The server renders
// the same time in UTC, which stays as it is without this element. Nothing runs afterwards.
const OPTIONS = {
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  date: { day: 'numeric', month: 'short' },
  datetime: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  'datetime-year': { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  day: { weekday: 'long', day: 'numeric', month: 'long' },
  'day-year': { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
};

/** A day in the viewer's year leaves its year out. @param {number} at */
const dayFormat = (at) => (new Date(at).getFullYear() === new Date().getFullYear() ? 'day' : 'day-year');

/** The viewer's today and year, in their zone: what datetime-short can leave out. @param {number} at */
function shortFormat(at) {
  const d = new Date(at);
  const now = new Date();
  if (d.getFullYear() !== now.getFullYear()) return 'datetime-year';
  return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() ? 'time' : 'datetime';
}

class TlLocalTime extends HTMLElement {
  connectedCallback() {
    const time = this.querySelector('time');
    const at = Date.parse(time?.dateTime ?? '');
    const asked = this.getAttribute('format');
    const format = /** @type {keyof typeof OPTIONS} */ (asked === 'datetime-short' ? shortFormat(at) : asked === 'day' ? dayFormat(at) : asked);
    if (!time || Number.isNaN(at) || !OPTIONS[format]) return;
    // en-GB writes "12 Oct", "12 Oct, 14:32", "12 Oct 2026, 14:32" and "Monday 12 October", whatever the viewer's language.
    const text = new Intl.DateTimeFormat('en-GB', /** @type {Intl.DateTimeFormatOptions} */ (OPTIONS[format])).format(at);
    if (time.textContent !== text) time.textContent = text;
  }
}

if (!customElements.get('tl-local-time')) customElements.define('tl-local-time', TlLocalTime);
