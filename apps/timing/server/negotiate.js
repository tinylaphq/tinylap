// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Content negotiation (RFC 9110 §12.5.1). Only one question is ever asked:
// does this client prefer HTML to JSON? Ties go to JSON, so */* and a missing
// header (fetch, curl, scripts) get data, and a browser navigation, which
// names text/html explicitly, gets the page.

/** @param {string} accept @returns {{ range: string, q: number }[]} */
function ranges(accept) {
  return accept.split(',').map((part) => {
    const [range, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    const q = params.find((p) => p.startsWith('q='));
    const quality = q === undefined ? 1 : Number(q.slice(2));
    return { range, q: Number.isFinite(quality) ? quality : 0 };
  }).filter((r) => r.range);
}

/** The quality of the most specific range matching `type`. */
function quality(list, type) {
  const major = type.split('/')[0];
  let best = 0;
  let rank = -1;
  for (const { range, q } of list) {
    const r = range === type ? 2 : range === `${major}/*` ? 1 : range === '*/*' ? 0 : -1;
    if (r > rank) { rank = r; best = q; }
  }
  return best;
}

/** @param {string | undefined} accept @returns {boolean} */
export function prefersHtml(accept) {
  if (!accept) return false;
  const list = ranges(accept);
  return quality(list, 'text/html') > quality(list, 'application/json');
}

/** @param {string | undefined} contentType @returns {string} */
export const mediaType = (contentType) => (contentType ?? '').split(';')[0].trim().toLowerCase();

/** @param {{ headers: Record<string, string | string[] | undefined> }} req @param {string} etag */
export function matchesEtag(req, etag) {
  const header = req.headers['if-none-match'];
  if (typeof header !== 'string') return false;
  return header.split(',').map((s) => s.trim()).some((t) => t === '*' || t === etag || t === `W/${etag}`);
}
