// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A workspace's setup (spec §8 Setup): drivers, transponders, decoders and
// pairing, the current track and the watchers link. Every route reads the
// session cookie; deleting needs `timing.delete` (owners and admins).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DIRECTIONS } from '@tinylap/track-format';
import { transponderCode } from '@tinylap/timing';
import { NO_STORE, workspaceRoute } from './access.js';
import { rateLimited, readJson } from './body.js';
import { TrackError, fetchTrack } from './planner.js';
import { json, problem } from './responses.js';

/** Driver colours, handed out in order (palace's accents first). */
export const COLOURS = ['#ff2d9b', '#2d9bff', '#ffb82d', '#2dff9b', '#b82dff', '#ff5a2d', '#2dfff0', '#f0ff2d'];
const MAX_NAME = 60;
const MAX_DRIVERS = 200;
const COLOUR = /^#[0-9a-f]{6}$/i;

/** SHA-256, hex: what is stored of a decoder token. @param {string} token */
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

const nameOf = (value) => {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
};
const colourOf = (value) => (typeof value === 'string' && COLOUR.test(value) ? value.toLowerCase() : null);
const invalid = (request, detail) => problem(request, 'invalid-request', detail);
const notFound = (request, what) => problem(request, 'not-found', `There is no such ${what} in this workspace.`);

const publishDrivers = (request) => request.hub.publish(request.workspaceId, 'drivers', request.store.drivers(request.workspaceId));

const listDrivers = (request) => json(200, { drivers: request.store.drivers(request.workspaceId) }, NO_STORE);

async function addDriver(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const name = nameOf(body.name);
  if (!name) return invalid(request, 'A driver needs a name of 1 to 60 characters.');
  const existing = request.store.drivers(request.workspaceId);
  if (existing.length >= MAX_DRIVERS) return invalid(request, `A workspace holds at most ${MAX_DRIVERS} drivers.`);
  const colour = body.colour === undefined ? COLOURS[existing.length % COLOURS.length] : colourOf(body.colour);
  if (!colour) return invalid(request, '`colour` must be #rrggbb.');
  const driver = { id: randomUUID(), name, colour };
  request.store.addDriver(request.workspaceId, driver);
  publishDrivers(request);
  return json(201, driver, NO_STORE);
}

async function updateDriver(request, match) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const current = request.store.driver(request.workspaceId, match[2]);
  if (!current) return notFound(request, 'driver');
  const name = body.name === undefined ? current.name : nameOf(body.name);
  if (!name) return invalid(request, 'A driver needs a name of 1 to 60 characters.');
  const colour = body.colour === undefined ? current.colour : colourOf(body.colour);
  if (!colour) return invalid(request, '`colour` must be #rrggbb.');
  request.store.updateDriver(request.workspaceId, current.id, { name, colour });
  publishDrivers(request);
  return json(200, { id: current.id, name, colour }, NO_STORE);
}

function deleteDriver(request, match) {
  if (!request.store.deleteDriver(request.workspaceId, match[2])) return notFound(request, 'driver');
  publishDrivers(request);
  request.engine.publishUnknown(request.workspaceId);
  return { status: 204, headers: NO_STORE };
}

const listTransponders = (request) => json(200, { transponders: request.store.transponders(request.workspaceId) }, NO_STORE);

async function putTransponder(request, match) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const code = transponderCode(match[2]);
  if (!code) return invalid(request, 'A transponder code is 1 to 16 hex digits.');
  const { driverId } = body;
  if (driverId !== null && (typeof driverId !== 'string' || !request.store.driver(request.workspaceId, driverId))) {
    return invalid(request, '`driverId` must be a driver of this workspace, or null.');
  }
  request.engine.assign(request.workspaceId, code, driverId);
  return json(200, { code, driverId }, NO_STORE);
}

const listDecoders = (request) => json(200, { decoders: request.store.decoders(request.workspaceId) }, NO_STORE);

async function addDecoder(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const wait = request.limiters.pair.take(request.userId);
  if (wait) return rateLimited(request, wait);
  const name = body.name === undefined ? 'Decoder' : nameOf(body.name);
  if (!name) return invalid(request, 'A decoder name is 1 to 60 characters.');
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  request.store.addDecoder(request.workspaceId, { id, name, tokenHash: tokenHash(token), createdAt: request.now() });
  return json(201, { id, name, token }, NO_STORE);
}

function deleteDecoder(request, match) {
  if (!request.store.deleteDecoder(request.workspaceId, match[2])) return notFound(request, 'decoder');
  return { status: 204, headers: NO_STORE };
}

const TRACK_PROBLEMS = { invalid: 'invalid-request', 'not-a-circuit': 'not-a-circuit', unavailable: 'planner-unavailable' };

async function putTrack(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  if (!DIRECTIONS.includes(body.direction)) return invalid(request, '`direction` must be "cw" or "ccw".');
  const name = body.name === undefined ? 'Track' : nameOf(body.name);
  if (!name) return invalid(request, 'A track name is 1 to 60 characters.');
  if (typeof body.link !== 'string') return invalid(request, '`link` must be a planner share link.');
  let track;
  try {
    track = await fetchTrack(request.plannerUrl, body.link, { fetch: request.fetch });
  } catch (caught) {
    if (!(caught instanceof TrackError)) throw caught;
    return problem(request, TRACK_PROBLEMS[caught.code], caught.message);
  }
  const ws = request.workspaceId;
  request.store.setTrack(ws, { ...track, name }, body.direction);
  request.engine.restartPractice(ws);
  request.hub.publish(ws, 'track', { track: { id: track.id, name }, direction: body.direction, bests: request.store.personalBests(ws, track.id, body.direction) });
  return json(200, { id: track.id, name, direction: body.direction, snapshotKey: track.snapshotKey }, NO_STORE);
}

const getWatchToken = (request) => json(200, { token: request.store.workspace(request.workspaceId).watchToken }, NO_STORE);

function rotateWatchToken(request) {
  const old = request.store.workspace(request.workspaceId).watchToken;
  const token = randomBytes(16).toString('base64url');
  request.store.setWatchToken(request.workspaceId, token);
  if (old) request.hub.closeTagged(request.workspaceId, old);
  return json(200, { token }, NO_STORE);
}

const path = (rest) => new RegExp(`^/workspaces/([^/]+)/${rest}$`);
const write = { write: true };

export const setupRoutes = [
  { pattern: path('drivers'), credentials: true, methods: { GET: workspaceRoute('timing.run', listDrivers), POST: workspaceRoute('timing.setup', addDriver, write) } },
  { pattern: path('drivers/([^/]+)'), credentials: true, methods: { PATCH: workspaceRoute('timing.setup', updateDriver, write), DELETE: workspaceRoute('timing.delete', deleteDriver, write) } },
  { pattern: path('transponders'), credentials: true, methods: { GET: workspaceRoute('timing.run', listTransponders) } },
  { pattern: path('transponders/([^/]+)'), credentials: true, methods: { PUT: workspaceRoute('timing.setup', putTransponder, write) } },
  { pattern: path('decoders'), credentials: true, methods: { GET: workspaceRoute('timing.run', listDecoders), POST: workspaceRoute('timing.setup', addDecoder, write) } },
  { pattern: path('decoders/([^/]+)'), credentials: true, methods: { DELETE: workspaceRoute('timing.delete', deleteDecoder, write) } },
  { pattern: path('track'), credentials: true, methods: { PUT: workspaceRoute('timing.setup', putTrack, write) } },
  { pattern: path('watch-token'), credentials: true, methods: { GET: workspaceRoute('timing.run', getWatchToken), POST: workspaceRoute('timing.setup', rotateWatchToken, write) } },
];
