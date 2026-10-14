// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The planner's side of the snapshot API. Paths are absolute, so they reach
// the server's /layouts whatever <base href> the page has.
import { parseLayout, KEY_PATTERN } from '@tinylap/track-format';

/** @import { Layout } from '@tinylap/track-format' */

async function request(fetch, url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Could not reach the planner server. Check your connection and try again.');
  }
  if (res.ok) return res;
  const problem = await res.json().catch(() => null);
  throw new Error(problem?.title ?? `The planner server answered ${res.status}.`);
}

/**
 * Stores the layout as a snapshot. Settle its track first (prepareExport),
 * as the server refuses a closed loop without one.
 * @param {Layout} layout @returns {Promise<string>} the link to share
 */
export async function shareLayout(layout, { fetch = globalThis.fetch } = {}) {
  const res = await request(fetch, '/layouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
  return (await res.json()).url;
}

/** @param {string} key @returns {Promise<Layout>} */
export async function fetchShared(key, { fetch = globalThis.fetch } = {}) {
  if (!KEY_PATTERN.test(key)) throw new Error('This link does not point to a layout.');
  const res = await request(fetch, `/layouts/${key}.json`);
  return parseLayout(await res.text());
}
