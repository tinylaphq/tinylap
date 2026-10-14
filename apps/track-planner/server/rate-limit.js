// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A fixed window per client, in memory only: a restart forgets everyone,
// and an address is dropped once its window is over, so nothing about a
// client is kept longer than one window.

/** @param {{ limit: number, windowMs?: number, now?: () => number }} options */
export function rateLimiter({ limit, windowMs = 3_600_000, now = Date.now }) {
  /** @type {Map<string, { start: number, count: number }>} */
  const windows = new Map();
  let pruned = 0;
  return {
    /** @param {string} client @returns {number} 0 when allowed, else seconds until it is again. */
    take(client) {
      const t = now();
      if (t - pruned >= 60_000) {
        for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
        pruned = t;
      }
      let w = windows.get(client);
      if (!w || t - w.start >= windowMs) {
        w = { start: t, count: 0 };
        windows.set(client, w);
      }
      if (w.count >= limit) return Math.max(1, Math.ceil((w.start + windowMs - t) / 1000));
      w.count += 1;
      return 0;
    },
  };
}
