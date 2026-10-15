// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Builds DOM without ever parsing HTML: names and codes come from users.

/**
 * @param {string} tag @param {Record<string, any>} [attrs]
 * @param {...(Node | string | null | undefined | false | (Node | string | null | undefined | false)[])} children
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

/**
 * A link to a screen of this page. A bare "#id" would resolve against the
 * page's <base href="/v/<sha>/"> in production and lead to a 404, so the
 * link carries the page's own path and query. @param {string} id
 */
export const screenHref = (id) => `${location.pathname}${location.search}#${id}`;
