// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// A fixed window per client, in memory only: a restart forgets everyone,
// and an address is dropped once its window is over, so nothing about a
// client is kept longer than one window.
import { isIPv6 } from 'node:net';

/**
 * The key a client is limited by. An IPv6 host owns a whole /64, so
 * addresses are bucketed by it; IPv4, IPv4-mapped IPv6 and anything
 * unparseable stay as they are.
 * @param {string} address
 */
export function clientBucket(address) {
  const bare = address.split('%')[0];
  if (!isIPv6(bare)) return address;
  const groups = expandIPv6(bare);
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

/** @param {string} address A valid IPv6 address. @returns {number[]} eight 16-bit groups */
function expandIPv6(address) {
  let text = address;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail[1].split('.').map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const front = head ? head.split(':') : [];
  const back = rest === undefined ? [] : rest ? rest.split(':') : [];
  const fill = rest === undefined ? [] : Array(8 - front.length - back.length).fill('0');
  return [...front, ...fill, ...back].map((g) => parseInt(g, 16));
}

/**
 * @param {{ limit: number, windowMs?: number, now?: () => number, sweepMs?: number }} options
 * Expired windows are dropped on every take(), and by an unref'd sweep so a
 * quiet server forgets addresses too. stop() ends the sweep.
 */
export function rateLimiter({ limit, windowMs = 3_600_000, now = Date.now, sweepMs = 600_000 }) {
  /** @type {Map<string, { start: number, count: number }>} */
  const windows = new Map();
  const prune = () => {
    const t = now();
    for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
  };
  const sweep = setInterval(prune, sweepMs);
  sweep.unref();
  return {
    /** @param {string} client @returns {number} 0 when allowed, else seconds until it is again. */
    take(client) {
      prune();
      const t = now();
      let w = windows.get(client);
      if (!w) {
        w = { start: t, count: 0 };
        windows.set(client, w);
      }
      if (w.count >= limit) return Math.max(1, Math.ceil((w.start + windowMs - t) / 1000));
      w.count += 1;
      return 0;
    },
    /** How many clients are remembered. */
    get size() {
      return windows.size;
    },
    stop() {
      clearInterval(sweep);
    },
  };
}
