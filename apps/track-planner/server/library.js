// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The private library (identity spec §4–§6): named tracks per workspace,
// each with its history of private snapshots. Every route reads the session
// cookie, so they are `credentials` routes (no CORS, Vary: Cookie), and
// every write must come from the planner's own pages. Access is the token's
// `workspaces` claim through can(): 404 for a workspace or track that is not
// yours, 403 when your role may not do it.
import { randomBytes } from 'node:crypto';
import { canonicalJson, snapshotKey, layoutFromData, parseLayout } from '@tinylap/track-format';
import { AuthError, can } from '@tinylap/auth';
import { displayName, withSession } from './auth.js';
import { MAX_BODY, MAX_LAYOUT, publish, readBody } from './layouts.js';
import { mediaType } from './negotiate.js';
import { json, problem } from './responses.js';
import { VERSIONS_KEPT } from './store.js';

export const TRACK_QUOTA = 200;
const MAX_NAME = 100;
const FORMER = 'former member';
const NO_STORE = { 'Cache-Control': 'no-store' };

const notFound = (request) => problem(request, 'not-found', 'There is no such track, or it is not in your personal space or one of your clubs.');
const noWorkspace = (request) => problem(request, 'not-found', 'There is no such club, or you are not in it.');

/** @param {import('./store.js').Saver} saver */
const saverOf = ({ id, name }) => ({ id, name: name ?? FORMER });
/** @param {import('./store.js').Track} t */
const trackOut = (t) => ({ ...t, updatedBy: saverOf(t.updatedBy) });
/** @param {import('./store.js').Version} v */
const versionOut = (v) => ({ ...v, savedBy: saverOf(v.savedBy) });

/** The workspaces in the token the user may read, with their names. */
const readable = (claims) => (claims.workspaces ?? []).filter((w) => can(claims, w.id, 'track.read'));

/**
 * Wraps a library handler: a session is required (401), and a write must
 * be same-origin (403).
 * @param {(request: any, match: any) => any} handler @param {{ write?: boolean }} [options]
 */
function route(handler, { write = false } = {}) {
  return withSession(async (request, match) => {
    if (!request.session) {
      request.req.resume();
      return problem(request, 'unauthorized', 'Sign in to use the library.');
    }
    if (write && !request.auth.bff.requireSameOrigin(request.req)) {
      request.req.resume();
      return problem(request, 'forbidden', "Change the library from the planner's own pages.");
    }
    return handler(request, match);
  });
}

/** The JSON body as an object, or a problem response. */
async function bodyOf(request) {
  const { req } = request;
  if (mediaType(req.headers['content-type']) !== 'application/json') {
    req.resume();
    return { error: problem(request, 'unsupported-media-type', 'Send the request as application/json.') };
  }
  const tooLarge = () => ({ error: problem(request, 'too-large', 'A request body may be at most 512 KiB.') });
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) {
    req.resume();
    return tooLarge();
  }
  const text = await readBody(req, MAX_BODY);
  if (text === null) return tooLarge();
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return { body };
  } catch {
    // answered below
  }
  return { error: problem(request, 'invalid-request', 'The body must be a JSON object.') };
}

/** A track name: trimmed, 1 to 100 characters. @returns {string | null} */
function nameOf(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= MAX_NAME ? name : null;
}
const badName = (request) => problem(request, 'invalid-request', `A track needs a name of 1 to ${MAX_NAME} characters.`);

/** The snapshot to save: its key and canonical JSON, or a problem. Open layouts are fine. */
async function snapshotOf(request, value) {
  if (!value || typeof value !== 'object') return { error: problem(request, 'invalid-layout', 'The request needs a layout object.') };
  let layout;
  try {
    layout = layoutFromData(value);
  } catch (error) {
    return { error: problem(request, 'invalid-layout', /** @type {Error} */ (error).message) };
  }
  const canonical = canonicalJson(layout);
  if (Buffer.byteLength(canonical) > MAX_LAYOUT) {
    return { error: problem(request, 'quota-exceeded', 'A snapshot may be at most 64 KiB (canonical JSON).') };
  }
  return { key: await snapshotKey(layout), json: canonical };
}

/** Counts a save against the user's 60 an hour; a problem when they are spent. */
function spendSave(request) {
  const wait = request.saves.take(`user:${request.session.userId}`);
  if (!wait) return null;
  return problem(request, 'quota-exceeded', `You can save at most 60 times an hour. Try again in ${wait} seconds.`, { 'Retry-After': String(wait) });
}

const fullWorkspace = (request) => problem(request, 'quota-exceeded', `A club or personal space can hold at most ${TRACK_QUOTA} tracks.`);

/** The track, or a 404 (not yours) or 403 (your role may not `action`). */
function trackFor(request, id, action) {
  const track = request.store.getTrack(id);
  const { claims } = request.session;
  if (!track || !can(claims, track.workspaceId, 'track.read')) return { error: notFound(request) };
  if (!can(claims, track.workspaceId, action)) {
    return { error: problem(request, 'forbidden', 'Your role in this club cannot do that: only the owner and admins delete tracks and versions.') };
  }
  return { track };
}

/**
 * Who saves: the user id and the display name at save time. A name that
 * can't be looked up fails the save (503, nothing written): a stored null
 * means "former member", which only the deletions feed may write.
 */
async function saver(request) {
  const userName = await displayName(request);
  if (userName === null) throw new AuthError('unavailable', 'Your name could not be looked up at accounts right now; nothing was saved. Try again in a minute.');
  return { userId: request.session.userId, userName };
}

const newId = () => randomBytes(16).toString('base64url');

async function getLibrary(request) {
  const workspaces = readable(request.session.claims).map(({ id, name, role }) => ({
    id, name: name ?? null, role, tracks: request.store.listTracks(id).map(trackOut),
  }));
  return json(200, { workspaces }, NO_STORE);
}

async function createTrack(request) {
  const { body, error } = await bodyOf(request);
  if (error) return error;
  const { workspaceId } = body;
  if (typeof workspaceId !== 'string' || !can(request.session.claims, workspaceId, 'track.save')) return noWorkspace(request);
  const name = nameOf(body.name);
  if (!name) return badName(request);
  const snap = await snapshotOf(request, body.layout);
  if (snap.error) return snap.error;
  if (request.store.countTracks(workspaceId) >= TRACK_QUOTA) return fullWorkspace(request);
  const spent = spendSave(request);
  if (spent) return spent;
  const { track } = request.store.createTrack({ id: newId(), workspaceId, name, ...snap, ...(await saver(request)) });
  return json(201, { track: trackOut(track) }, NO_STORE);
}

async function saveVersion(request, [, id]) {
  const { track, error: denied } = trackFor(request, id, 'track.save');
  if (denied) {
    request.req.resume();
    return denied;
  }
  const { body, error } = await bodyOf(request);
  if (error) return error;
  const snap = await snapshotOf(request, body.layout);
  if (snap.error) return snap.error;
  const spent = spendSave(request);
  if (spent) return spent;
  const saved = request.store.addVersion(track.id, { ...snap, ...(await saver(request)) });
  return json(201, { track: trackOut(saved.track), version: versionOut(saved.version) }, NO_STORE);
}

async function renameTrack(request, [, id]) {
  const { track, error: denied } = trackFor(request, id, 'track.save');
  if (denied) {
    request.req.resume();
    return denied;
  }
  const { body, error } = await bodyOf(request);
  if (error) return error;
  const name = nameOf(body.name);
  if (!name) return badName(request);
  const { userId, userName } = await saver(request);
  return json(200, { track: trackOut(request.store.renameTrack(track.id, name, userId, userName)) }, NO_STORE);
}

async function copyTrack(request, [, id]) {
  const { track, error: denied } = trackFor(request, id, 'track.copy');
  if (denied) {
    request.req.resume();
    return denied;
  }
  const { body, error } = await bodyOf(request);
  if (error) return error;
  const { workspaceId } = body;
  if (typeof workspaceId !== 'string' || !can(request.session.claims, workspaceId, 'track.save')) return noWorkspace(request);
  if (request.store.countTracks(workspaceId) >= TRACK_QUOTA) return fullWorkspace(request);
  const spent = spendSave(request);
  if (spent) return spent;
  // Only the current version goes along, as a private row of the target.
  const stored = /** @type {string} */ (request.store.getPrivate(track.currentKey, track.workspaceId));
  const copy = request.store.createTrack({
    id: newId(), workspaceId, name: track.name, key: track.currentKey, json: stored, ...(await saver(request)),
  });
  return json(201, { track: trackOut(copy.track) }, NO_STORE);
}

async function deleteTrack(request, [, id]) {
  const { track, error } = trackFor(request, id, 'track.delete');
  if (error) return error;
  request.store.deleteTrack(track.id);
  return { status: 204, headers: NO_STORE };
}

async function listVersions(request, [, id]) {
  const { track, error } = trackFor(request, id, 'track.read');
  if (error) return error;
  return json(200, { versions: request.store.listVersions(track.id).map(versionOut), kept: VERSIONS_KEPT }, NO_STORE);
}

async function deleteVersion(request, [, id, key]) {
  const { track, error } = trackFor(request, id, 'track.delete');
  if (error) return error;
  if (!request.store.deleteVersion(track.id, key)) return problem(request, 'not-found', 'This track has no such version.');
  return { status: 204, headers: NO_STORE };
}

// Publishes the current version through the public path, with its rules.
// The private row stays: a share never has to be undone.
async function shareTrack(request, [, id]) {
  const { track, error } = trackFor(request, id, 'track.share');
  if (error) return error;
  const stored = /** @type {string} */ (request.store.getPrivate(track.currentKey, track.workspaceId));
  return publish(request, parseLayout(stored));
}

async function exportLibrary(request) {
  const workspaces = readable(request.session.claims).map(({ id, name, role }) => ({
    id,
    name: name ?? null,
    role,
    tracks: request.store.listTracks(id).map((t) => ({
      ...trackOut(t),
      versions: request.store.listVersions(t.id).map((v) => ({
        ...versionOut(v),
        layout: JSON.parse(/** @type {string} */ (request.store.getPrivate(v.key, id))),
      })),
    })),
  }));
  return json(200, { exportedAt: new Date().toISOString(), workspaces }, {
    ...NO_STORE,
    'Content-Disposition': 'attachment; filename="tinylap-library.json"',
  });
}

const write = { write: true };

export const libraryRoutes = [
  { pattern: /^\/library$/, credentials: true, methods: { GET: route(getLibrary) } },
  { pattern: /^\/library\/export$/, credentials: true, methods: { GET: route(exportLibrary) } },
  { pattern: /^\/library\/tracks$/, credentials: true, methods: { POST: route(createTrack, write) } },
  { pattern: /^\/library\/tracks\/([^/]+)$/, credentials: true, methods: { PATCH: route(renameTrack, write), DELETE: route(deleteTrack, write) } },
  { pattern: /^\/library\/tracks\/([^/]+)\/versions$/, credentials: true, methods: { GET: route(listVersions), POST: route(saveVersion, write) } },
  { pattern: /^\/library\/tracks\/([^/]+)\/versions\/([^/]+)$/, credentials: true, methods: { DELETE: route(deleteVersion, write) } },
  { pattern: /^\/library\/tracks\/([^/]+)\/copy$/, credentials: true, methods: { POST: route(copyTrack, write) } },
  { pattern: /^\/library\/tracks\/([^/]+)\/share$/, credentials: true, methods: { POST: route(shareTrack, write) } },
  { pattern: /^\/library(?:\/.*)?$/, credentials: true, unknown: true, methods: {} },
];
