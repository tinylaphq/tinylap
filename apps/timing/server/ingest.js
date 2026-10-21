// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Passings in (spec §5). A decoder posts with its own token over Wi-Fi; the
// bridge tab posts the same passings with a member's session, from the
// cable. The engine keeps one copy. Tap entry is a passing by hand.
import { can } from '@tinylap/auth';
import { readBatch } from '@tinylap/timing';
import { NO_STORE, workspaceRoute } from './access.js';
import { withSession } from './auth.js';
import { rateLimited, readJson } from './body.js';
import * as ops from './operations.js';
import { json, opProblem, problem } from './responses.js';
import { tokenHash } from './setup.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

const postPassings = withSession(async (request, match) => {
  const decoderId = match[1];
  const refuse = (name, detail) => {
    request.req.resume();
    return problem(request, name, detail);
  };
  if (!request.store) return refuse('unavailable', 'Passings cannot be stored right now.');
  const header = request.req.headers.authorization;
  let decoder;
  let via;
  if (header !== undefined) {
    const token = BEARER.exec(header)?.[1];
    const found = token ? request.store.decoderByTokenHash(tokenHash(token)) : null;
    if (!found || found.id !== decoderId) return refuse('unauthorized', "Send this decoder's token as a Bearer token.");
    decoder = found;
    via = 'net';
  } else {
    // The bridge keeps passings refused with a 401 or 403 (a new sign-in may send them) and drops
    // them on a 404: a decoder that doesn't exist never takes them.
    if (!request.session) return refuse('unauthorized', 'You are not signed in. Sign in to forward passings.');
    if (!request.auth.bff.requireSameOrigin(request.req)) return refuse('forbidden', "Forward passings from the app's own pages.");
    decoder = request.store.decoder(decoderId);
    if (!decoder) return refuse('not-found', 'There is no such decoder: it was removed, or never paired.');
    if (!can(request.session.claims, decoder.workspaceId, 'timing.run')) {
      return refuse('forbidden', 'This decoder is not paired in one of your clubs or your personal space.');
    }
    via = 'serial';
  }
  const wait = request.limiters.ingest.take(decoderId);
  if (wait) {
    request.req.resume();
    return rateLimited(request, wait);
  }
  const { body, error } = await readJson(request);
  if (error) return error;
  const result = readBatch(body);
  if (!('batch' in result)) return problem(request, 'invalid-request', result.error);
  return json(200, request.engine.ingest({ workspaceId: decoder.workspaceId, decoder: decoderId, via, batch: result.batch }), NO_STORE);
});

async function postTap(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = ops.tap(request, { driverId: body.driverId });
  return r.error ? opProblem(request, r.error) : json(200, r.value, NO_STORE);
}

export const ingestRoutes = [
  { pattern: /^\/decoders\/([^/]+)\/passings$/, credentials: true, methods: { POST: postPassings } },
  { pattern: /^\/workspaces\/([^/]+)\/tap$/, credentials: true, methods: { POST: workspaceRoute('timing.run', postTap, { write: true }) } },
];
