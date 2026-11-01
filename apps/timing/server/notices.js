// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Accounts' membership notices (spec §4.2). A notice carries no authority: it
// only marks the users' tokens stale and has their open streams check now, so
// refreshed claims alone decide whether a stream ends.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readJson } from './body.js';
import { problem } from './responses.js';

const MAX_USERS = 1000;

/** SHA-256 of a bearer token, the form compared. @param {string} token */
export const noticeDigest = (token) => createHash('sha256').update(token).digest();

/** The notice token's digest compared in constant time: neither content nor length leaks. @param {any} request */
function allowed(request) {
  const match = /^Bearer ([^\s]+)$/.exec(request.req.headers.authorization ?? '');
  return Boolean(match) && timingSafeEqual(noticeDigest(match[1]), request.noticeDigest);
}

async function notice(request) {
  if (!request.noticeDigest) {
    request.req.resume();
    return problem(request, 'not-found', 'There is no such page.');
  }
  if (!allowed(request)) {
    request.req.resume();
    return problem(request, 'unauthorized', 'Send the notice token as a Bearer token.', { 'WWW-Authenticate': 'Bearer realm="notices"' });
  }
  const { body, error } = await readJson(request);
  if (error) return error;
  const { users } = body;
  if (!Array.isArray(users) || users.length < 1 || users.length > MAX_USERS || users.some((u) => typeof u !== 'string' || !u)) {
    return problem(request, 'invalid-request', `users must list 1 to ${MAX_USERS} user ids.`);
  }
  for (const user of users) request.auth.bff.stale(user);
  // MCP tokens issued before now are refused, so their clients refresh (timing MCP spec §4.2).
  request.store?.stale.mark(users, request.now());
  request.streams.recheck(users);
  return { status: 204, headers: { 'Cache-Control': 'no-store' } };
}

// Not `credentials`: it reads no cookie.
export const noticeRoutes = [{ pattern: /^\/notices\/membership$/, methods: { POST: notice } }];
