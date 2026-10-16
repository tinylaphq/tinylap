// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

/** Text made safe for HTML content and quoted attribute values; null and undefined are empty. @param {unknown} text */
export const escapeHtml = (text) =>
  String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[/** @type {'&'} */ (c)]);

/**
 * A URL for href, src or action: http(s), or a path from here (/, ./, ?);
 * anything else, such as javascript:, becomes "#". Escaped.
 * @param {unknown} url
 */
export function safeHref(url) {
  const text = String(url ?? '').trim();
  // The URL parser drops tabs and newlines and reads \ as /, so "/\host"
  // would be another site: neither may appear at all.
  if ([...text].some((c) => c < ' ' || c === '\u007f' || c === '\\')) return '#';
  return escapeHtml(/^(https?:\/\/|\/(?!\/)|\.\/|\?)/i.test(text) ? text : '#');
}
