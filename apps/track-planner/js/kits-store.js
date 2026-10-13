// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The owned inventory, persisted across reloads.
//
// It stays out of the exported layout file on purpose: the inventory is the
// owner's shelf, not a property of any particular track. But it is the
// generator's input, so losing it on reload is wrong.

import { KITS } from './inventory.js';

export const KITS_STORAGE_KEY = 'circuit30.kits';
export const DEFAULT_KITS = { '87033': 1 };

// A stored value is untrusted: it can be absent, corrupt, hand-edited, or
// left behind by an older build. Anything that is not a clean map of known
// kit ids to non-negative integers falls back to the default rather than
// half-applying.
//
// An unknown id is dropped but the rest of the payload is kept: it is most
// likely a kit added by a newer build, and silently ignoring it while
// trusting the rest is the forgiving, forward-compatible read. A malformed
// count, by contrast, discards the whole payload: it means the value was
// corrupted or hand-edited, and partially trusting a corrupted payload is
// worse than starting clean. The asymmetry is deliberate.
export function parseKits(raw) {
  if (typeof raw !== 'string') return { ...DEFAULT_KITS };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_KITS };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { ...DEFAULT_KITS };

  const out = {};
  for (const [id, count] of Object.entries(data)) {
    if (!Object.hasOwn(KITS, id)) continue;                      // unknown kit: drop it
    if (!Number.isSafeInteger(count) || count < 0) return { ...DEFAULT_KITS };
    out[id] = count;
  }
  return Object.keys(out).length > 0 ? out : { ...DEFAULT_KITS };
}

export function loadKits(storage) {
  try {
    return parseKits(storage.getItem(KITS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_KITS };                                // storage can be denied
  }
}

export function saveKits(storage, kits) {
  try {
    storage.setItem(KITS_STORAGE_KEY, JSON.stringify(kits));
  } catch {
    /* Storage denied or full. The inventory still works for this session. */
  }
}
