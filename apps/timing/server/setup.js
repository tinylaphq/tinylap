// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A workspace's setup (spec §8 Setup): drivers, transponders, decoders and
// pairing, the current track and the watchers link. Every route reads the
// session cookie; deleting needs `timing.delete` (owners and admins).
import { NO_STORE, workspaceRoute } from './access.js';
import { displayName } from './auth.js';
import { readJson } from './body.js';
import * as ops from './operations.js';
import { json, opProblem } from './responses.js';

export { COLOURS, tokenHash } from './operations.js';

const listDrivers = (request) => json(200, { drivers: request.store.drivers(request.workspaceId) }, NO_STORE);

async function addDriver(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = ops.addDriver(request, { name: body.name, colour: body.colour });
  return r.error ? opProblem(request, r.error) : json(201, r.value, NO_STORE);
}

async function updateDriver(request, match) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = ops.renameDriver(request, { id: match[2], name: body.name, colour: body.colour });
  return r.error ? opProblem(request, r.error) : json(200, r.value, NO_STORE);
}

function deleteDriver(request, match) {
  const r = ops.deleteDriver(request, { id: match[2] });
  return r.error ? opProblem(request, r.error) : { status: 204, headers: NO_STORE };
}

const listTransponders = (request) => json(200, { transponders: request.store.transponders(request.workspaceId) }, NO_STORE);

async function putTransponder(request, match) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = ops.assignTransponder(request, { code: match[2], driverId: body.driverId === undefined ? '' : body.driverId });
  return r.error ? opProblem(request, r.error) : json(200, r.value, NO_STORE);
}

const listDecoders = (request) => json(200, { decoders: request.store.decoders(request.workspaceId) }, NO_STORE);

async function addDecoder(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = ops.pairDecoder(request, { name: body.name });
  return r.error ? opProblem(request, r.error) : json(201, r.value, NO_STORE);
}

function deleteDecoder(request, match) {
  const r = ops.unpairDecoder(request, { id: match[2] });
  return r.error ? opProblem(request, r.error) : { status: 204, headers: NO_STORE };
}

const listTracks = (request) => json(200, { tracks: ops.listTracks(request, { archived: request.url.searchParams.get('archived') === '1' }).value }, NO_STORE);

const byOf = async (request) => ({ userId: request.userId, name: await displayName(request) });

async function addTrack(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = await ops.addTrack(request, { name: body.name, link: body.link, by: await byOf(request) });
  return r.error ? opProblem(request, r.error) : json(201, r.value, NO_STORE);
}

async function updateTrack(request, match) {
  const { body, error } = await readJson(request);
  if (error) return error;
  if (body.name === undefined && body.archived === undefined) return opProblem(request, { problem: 'invalid-request', message: 'Send a name, archived, or both.' });
  if (body.archived !== undefined && typeof body.archived !== 'boolean') return opProblem(request, { problem: 'invalid-request', message: 'archived is true or false.' });
  const id = match[2];
  /** @type {any} */
  let r = { value: null };
  if (body.name !== undefined) r = ops.renameTrack(request, { id, name: body.name });
  if (!r.error && body.archived !== undefined) r = (body.archived ? ops.archiveTrack : ops.restoreTrack)(request, { id });
  return r.error ? opProblem(request, r.error) : json(200, r.value, NO_STORE);
}

async function attachLayout(request, match) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = await ops.attachLayout(request, { id: match[2], link: body.link, confirm: body.confirm, by: await byOf(request) });
  return r.error ? opProblem(request, r.error) : json(r.value.result === 'added' ? 201 : 200, r.value.track, NO_STORE);
}

function deleteTrack(request, match) {
  const r = ops.deleteTrack(request, { id: match[2] });
  return r.error ? opProblem(request, r.error) : { status: 204, headers: NO_STORE };
}

async function putTrack(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = ops.setCurrentTrack(request, { id: body.trackId, direction: body.direction });
  return r.error ? opProblem(request, r.error) : json(200, r.value, NO_STORE);
}

const getWatchToken = (request) => json(200, { token: request.store.workspace(request.workspaceId).watchToken }, NO_STORE);

function rotateWatchToken(request) {
  return json(200, ops.rotateWatchLink(request).value, NO_STORE);
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
  { pattern: path('tracks'), credentials: true, methods: { GET: workspaceRoute('timing.run', listTracks), POST: workspaceRoute('timing.setup', addTrack, write) } },
  { pattern: path('tracks/([^/]+)'), credentials: true, methods: { PATCH: workspaceRoute('timing.setup', updateTrack, write), DELETE: workspaceRoute('timing.delete', deleteTrack, write) } },
  { pattern: path('tracks/([^/]+)/layouts'), credentials: true, methods: { POST: workspaceRoute('timing.setup', attachLayout, write) } },
  { pattern: path('track'), credentials: true, methods: { PUT: workspaceRoute('timing.setup', putTrack, write) } },
  { pattern: path('watch-token'), credentials: true, methods: { GET: workspaceRoute('timing.run', getWatchToken), POST: workspaceRoute('timing.setup', rotateWatchToken, write) } },
];
