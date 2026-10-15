// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control (spec §6, §8): start a qualifying or race, list and read
// sessions, abort. Practice is never started by hand.
import { NO_STORE, workspaceRoute } from './access.js';
import { readJson } from './body.js';
import { publicSession } from './engine.js';
import { json, problem } from './responses.js';

const KINDS = new Set(['qualifying', 'race']);
const MAX_ROSTER = 20;
const invalid = (request, detail) => problem(request, 'invalid-request', detail);
const notFound = (request) => problem(request, 'not-found', 'There is no such session in this workspace.');

/** An integer in [min, max], `fallback` when absent, or null. */
const intIn = (value, min, max, fallback) => {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
};

async function startSession(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  if (!KINDS.has(body.kind)) return invalid(request, '`kind` must be "qualifying" or "race".');
  const { roster } = body;
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > MAX_ROSTER) return invalid(request, `\`roster\` must list 1 to ${MAX_ROSTER} drivers.`);
  if (new Set(roster).size !== roster.length) return invalid(request, 'A driver can be on the roster only once.');
  if (!roster.every((id) => typeof id === 'string' && request.store.driver(request.workspaceId, id))) return invalid(request, 'Every roster entry must be a driver of this workspace.');
  const duration = intIn(body.durationSeconds, 10, 3600, 300);
  if (duration === null) return invalid(request, '`durationSeconds` must be a whole number from 10 to 3600.');
  const countdown = intIn(body.countdownSeconds, 0, 30, 10);
  if (countdown === null) return invalid(request, '`countdownSeconds` must be a whole number from 0 to 30.');
  const result = request.engine.start(request.workspaceId, {
    kind: body.kind, roster, durationMs: duration * 1000, countdownMs: body.kind === 'race' ? countdown * 1000 : 0,
  });
  if (result.error) return problem(request, 'conflict', 'A qualifying or race is already running here.');
  return json(201, publicSession(result.session), NO_STORE);
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
  const ended = request.engine.abort(request.workspaceId, match[2]);
  return ended ? json(200, publicSession(ended), NO_STORE) : problem(request, 'not-found', 'There is no running qualifying or race with this id.');
}

const path = (rest) => new RegExp(`^/workspaces/([^/]+)/${rest}$`);

export const controlRoutes = [
  { pattern: path('sessions'), credentials: true, methods: { GET: workspaceRoute('timing.run', listSessions), POST: workspaceRoute('timing.run', startSession, { write: true }) } },
  { pattern: path('sessions/([^/]+)'), credentials: true, methods: { GET: workspaceRoute('timing.run', getSession) } },
  { pattern: path('sessions/([^/]+)/abort'), credentials: true, methods: { POST: workspaceRoute('timing.run', abortSession, { write: true }) } },
];
