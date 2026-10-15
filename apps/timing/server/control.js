// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control (spec §6, §8): start a qualifying or race, list and read
// sessions, abort. Practice is never started by hand.
import { NO_STORE, workspaceRoute } from './access.js';
import { readJson } from './body.js';
import { publicSession } from './engine.js';
import * as ops from './operations.js';
import { json, opProblem, problem } from './responses.js';

const invalid = (request, detail) => problem(request, 'invalid-request', detail);
const notFound = (request) => problem(request, 'not-found', 'There is no such session here.');

async function startSession(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  for (const key of ['durationSeconds', 'countdownSeconds']) {
    if (typeof body[key] === 'string') return invalid(request, `\`${key}\` must be a whole number.`);
  }
  const r = ops.startSession(request, { kind: body.kind, roster: body.roster, durationSeconds: body.durationSeconds, countdownSeconds: body.countdownSeconds });
  return r.error ? opProblem(request, r.error) : json(201, r.value, NO_STORE);
}

function listSessions(request) {
  const text = request.url.searchParams.get('limit');
  const limit = text === null ? 20 : Number(text);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return invalid(request, '`limit` must be from 1 to 50.');
  return json(200, { sessions: request.store.listSessions(request.workspaceId, limit).map(publicSession) }, NO_STORE);
}

function getSession(request, match) {
  const detail = request.engine.sessionDetail(request.workspaceId, match[2]);
  return detail ? json(200, detail, NO_STORE) : notFound(request);
}

function abortSession(request, match) {
  request.req.resume();
  const r = ops.abortSession(request, { id: match[2] });
  return r.error ? opProblem(request, r.error) : json(200, r.value, NO_STORE);
}

const path = (rest) => new RegExp(`^/workspaces/([^/]+)/${rest}$`);

export const controlRoutes = [
  { pattern: path('sessions'), credentials: true, methods: { GET: workspaceRoute('timing.run', listSessions), POST: workspaceRoute('timing.run', startSession, { write: true }) } },
  { pattern: path('sessions/([^/]+)'), credentials: true, methods: { GET: workspaceRoute('timing.run', getSession) } },
  { pattern: path('sessions/([^/]+)/abort'), credentials: true, methods: { POST: workspaceRoute('timing.run', abortSession, { write: true }) } },
];
