// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// A time of day or a date for <tl-local-time>. The server knows no time zone,
// so the text it writes is UTC; the element rewrites it in the viewer's zone.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * @param {number} ms
 * @param {'time' | 'date' | 'datetime' | 'datetime-year' | 'datetime-short' | 'day'} format `14:32`, `12 Oct`, `12 Oct, 14:32`, or `12 Oct 2026, 14:32`;
 *   `datetime-short` is written as `datetime-year`, and the element drops what the viewer's today and year make plain;
 *   `day` is `Monday, 12 October 2026`, and the element drops the year in the viewer's year (`Monday 12 October`)
 */
export function localTime(ms, format) {
  const d = new Date(ms);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (format === 'day') {
    const day = `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${LONG_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return `<tl-local-time format="day"><time datetime="${d.toISOString()}">${day}</time></tl-local-time>`;
  }
  const text = format === 'time' ? time : format === 'date' ? date
    : format === 'datetime-year' || format === 'datetime-short' ? `${date} ${d.getUTCFullYear()}, ${time}` : `${date}, ${time}`;
  return `<tl-local-time format="${format}"><time datetime="${d.toISOString()}">${text}</time></tl-local-time>`;
}
