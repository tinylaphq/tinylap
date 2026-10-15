// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Reading request bodies, and naming the client for rate limits.
import { clientBucket } from '@tinylap/auth';
import { mediaType } from './negotiate.js';
import { problem } from './responses.js';

export const MAX_BODY = 64 * 1024;

/** Reads at most `max` bytes; past that it drains the rest and returns null. */
export async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= max) chunks.push(chunk);
  }
  return size > max ? null : Buffer.concat(chunks).toString('utf8');
}

/** The JSON object body, or a problem response. */
export async function readJson(request, max = MAX_BODY) {
  const { req } = request;
  if (mediaType(req.headers['content-type']) !== 'application/json') {
    req.resume();
    return { error: problem(request, 'unsupported-media-type', 'Send the request as application/json.') };
  }
  const tooLarge = () => ({ error: problem(request, 'too-large', 'A request body may be at most 64 KiB.') });
  if (Number(req.headers['content-length'] ?? 0) > max) {
    req.resume();
    return tooLarge();
  }
  const text = await readBody(req, max);
  if (text === null) return tooLarge();
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return { body };
  } catch {
    // answered below
  }
  return { error: problem(request, 'invalid-request', 'The body must be a JSON object.') };
}

/** Only a configured header names the client: an unconfigured one is just a forgery. */
export function clientOf(request) {
  const value = request.clientIpHeader && request.req.headers[request.clientIpHeader];
  return clientBucket(typeof value === 'string' && value ? value : request.req.socket.remoteAddress ?? 'unknown');
}

/** A 429 with Retry-After. @param {any} request @param {number} wait seconds */
export const rateLimited = (request, wait) => problem(request, 'rate-limited', `Try again in ${wait} seconds.`, { 'Retry-After': String(wait) });
