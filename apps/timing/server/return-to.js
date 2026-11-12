// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Where a form goes back to after its 303 (drivers and transponders spec §3.3):
// a path on this site only, so a link can never send someone elsewhere.

const MAX = 1024;
// One slash, then no second slash or backslash: "//host" and "/\host" are other sites to a browser.
// eslint-disable-next-line no-control-regex
const PATH = /^\/(?![/\\])[^\\\s\u0000-\u001f\u007f]*$/u;

/**
 * `value` when it is a path on this site, percent-encoded as a Location header needs; else `fallback`.
 * @param {string | undefined | null} value @param {string} fallback
 */
export function safeReturnTo(value, fallback) {
  if (typeof value !== 'string' || value.length > MAX || !PATH.test(value)) return fallback;
  const origin = 'http://same.invalid';
  const url = new URL(value, origin);
  return url.origin === origin ? url.pathname + url.search + url.hash : fallback;
}
