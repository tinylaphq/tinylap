// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The planner's side of the snapshot API. Paths are absolute, so they reach
// the server's /layouts whatever <base href> the page has.
import { parseLayout, KEY_PATTERN } from '@tinylap/track-format';

/** @import { Layout } from '@tinylap/track-format' */

/** A fetch that throws `Error(problem.title)`, carrying the HTTP status. */
export async function request(fetch, url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Could not reach the planner. Check your connection and try again.');
  }
  if (res.ok) return res;
  const problem = await res.json().catch(() => null);
  throw Object.assign(new Error(problem?.title ?? `The planner answered ${res.status}. Try again in a minute.`), { status: res.status });
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
  if (!KEY_PATTERN.test(key)) throw new Error('This link does not point to a shared track.');
  const res = await request(fetch, `/layouts/${key}.json`);
  return parseLayout(await res.text());
}

/**
 * Asks before anything is published ("Publishing makes this layout public
 * at a permanent link. It cannot be undone."): `dialog` (#share-dialog) closes with
 * "publish" or anything else. Resolves true only for "publish".
 * @param {HTMLDialogElement} dialog @returns {Promise<boolean>}
 */
export function confirmPublish(dialog) {
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'publish'), { once: true });
    dialog.showModal();
  });
}
