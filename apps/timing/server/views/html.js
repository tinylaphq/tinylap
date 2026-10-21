// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The only way the timing app makes HTML (spec §4.1): every interpolated
// value is escaped unless it is itself made by html`` or marked safe().
// The escaping is right for text and for quoted attribute values only, so
// interpolate there and nowhere else: never into an unquoted attribute, and
// never inside <script> or <style>, where escaping does not protect.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class Html {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    Object.freeze(this);
  }
  toString() {
    return this.text;
  }
}

/** Trusted markup, rendered as is; null and undefined render as nothing. @param {unknown} text */
export const safe = (text) => new Html(text === null || text === undefined ? '' : String(text));

/** @param {unknown} value @returns {string} */
function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Html) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** @param {TemplateStringsArray} strings @param {...unknown} values */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Html(out);
}
