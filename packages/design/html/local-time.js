// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// A time of day or a date for <tl-local-time>. The server knows no time zone,
// so the text it writes is UTC; the element rewrites it in the viewer's zone.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * @param {number} ms
 * @param {'time' | 'date' | 'datetime'} format `14:32`, `12 Oct`, or `12 Oct, 14:32`
 */
export function localTime(ms, format) {
  const d = new Date(ms);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const text = format === 'time' ? time : format === 'date' ? date : `${date}, ${time}`;
  return `<tl-local-time format="${format}"><time datetime="${d.toISOString()}">${text}</time></tl-local-time>`;
}
