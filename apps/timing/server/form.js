// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// HTML form bodies (spec §5): application/x-www-form-urlencoded, at most
// 64 KiB, read as URLSearchParams so repeated fields (roster) keep all values.
import { readBody } from './body.js';
import { mediaType } from './negotiate.js';
import { problem } from './responses.js';

/** @param {any} request @param {number} [max] */
export async function readForm(request, max = 64 * 1024) {
  const { req } = request;
  if (mediaType(req.headers['content-type']) !== 'application/x-www-form-urlencoded') {
    req.resume();
    return { error: problem(request, 'unsupported-media-type', 'Send the form as application/x-www-form-urlencoded.') };
  }
  const tooLarge = () => ({ error: problem(request, 'too-large', 'A form may be at most 64 KiB.') });
  if (Number(req.headers['content-length'] ?? 0) > max) {
    req.resume();
    return tooLarge();
  }
  const text = await readBody(req, max);
  if (text === null) return tooLarge();
  return { form: new URLSearchParams(text) };
}
