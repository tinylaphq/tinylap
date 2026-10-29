// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Passings (spec §4): what a decoder reports when a car crosses the line,
// and the batches decoders and bridges post (spec §5).

/** @import { Batch, Passing } from './types.js' */

export const DECODER_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const BOOT_ID = /^[A-Za-z0-9_-]{8,32}$/;
export const TRANSPONDER = /^[0-9A-F]{1,16}$/;
export const MAX_BATCH = 500;
export const MAX_LOG_LINES = 64;
export const MAX_LOG_BYTES = 32 * 1024;
export const MAX_LOG_ENTRY_BYTES = 510;

/** Upper-cases a hex transponder code; null when it isn't one. @param {unknown} value */
export function transponderCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return TRANSPONDER.test(code) ? code : null;
}

/** One passing, whichever transport carried it. @param {Passing} p */
export const passingKey = ({ decoder, boot, transponder, t }) => `${decoder} ${boot} ${transponder} ${t}`;

/** @param {Uint8Array} bytes */
export const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A new boot id: 64 random bits, base64url. */
export const randomBoot = () => base64url(globalThis.crypto.getRandomValues(new Uint8Array(8)));

/**
 * Reads an ingest batch: `{ boot, passings: [{ transponder, t }], logs?: string[] }`.
 * @param {unknown} value
 * @returns {{ ok: true, batch: Batch } | { ok: false, error: string }}
 */
export function readBatch(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'The body must be a JSON object.' };
  const { boot, passings, logs } = /** @type {{ boot?: unknown, passings?: unknown, logs?: unknown }} */ (value);
  if (typeof boot !== 'string' || !BOOT_ID.test(boot)) return { ok: false, error: '`boot` must be 8 to 32 base64url characters.' };
  /** @type {string[]} */
  const lines = [];
  if (logs !== undefined) {
    if (!Array.isArray(logs) || logs.some((l) => typeof l !== 'string')) return { ok: false, error: '`logs` must be an array of strings.' };
    const encoder = new TextEncoder();
    const sizes = logs.map((l) => encoder.encode(l).length);
    if (sizes.reduce((a, b) => a + b, 0) > MAX_LOG_BYTES) return { ok: false, error: 'The log lines are over 32 KiB together.' };
    if (logs.length > MAX_LOG_LINES) return { ok: false, error: `A batch holds at most ${MAX_LOG_LINES} log lines.` };
    const big = sizes.findIndex((n) => n > MAX_LOG_ENTRY_BYTES);
    if (big !== -1) return { ok: false, error: `\`logs[${big}]\` is over ${MAX_LOG_ENTRY_BYTES} bytes.` };
    lines.push(...logs);
  }
  if (!Array.isArray(passings) || (passings.length === 0 && lines.length === 0)) return { ok: false, error: '`passings` must be a non-empty array, unless `logs` has lines.' };
  if (passings.length > MAX_BATCH) return { ok: false, error: `A batch holds at most ${MAX_BATCH} passings.` };
  /** @type {Batch['passings']} */
  const out = [];
  for (const [i, item] of passings.entries()) {
    const p = /** @type {{ transponder?: unknown, t?: unknown } | null} */ (item);
    const transponder = transponderCode(p?.transponder);
    const t = p?.t;
    if (transponder === null) return { ok: false, error: `passings[${i}].transponder must be a hex code.` };
    if (typeof t !== 'number' || !Number.isSafeInteger(t) || t < 0) return { ok: false, error: `passings[${i}].t must be a whole number of milliseconds, 0 or more.` };
    out.push({ transponder, t });
  }
  return { ok: true, batch: { boot, passings: out, logs: lines } };
}
