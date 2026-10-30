// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every change to a space's timing (spec §5), shared by the JSON API and
// the pages so each rule and message exists once. Each returns { value } or
// { error: { problem, status, message, field?, retryAfter? } }.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DIRECTIONS } from '@tinylap/track-format';
import { transponderCode } from '@tinylap/timing';
import { publicSession } from './engine.js';
import { TrackError, fetchTrack } from './planner.js';
import { PROBLEMS } from './problems.js';

/** Driver colours, handed out in order (palace's accents first). */
export const COLOURS = ['#ff2d9b', '#2d9bff', '#ffb82d', '#2dff9b', '#b82dff', '#ff5a2d', '#2dfff0', '#f0ff2d'];
export const MAX_NAME = 60;
const MAX_DRIVERS = 200;
const MAX_ROSTER = 20;
const COLOUR = /^#[0-9a-f]{6}$/i;
const KINDS = new Set(['practice', 'qualifying', 'race']);

/** SHA-256, hex: what is stored of a decoder token. @param {string} token */
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

/**
 * The status comes from the problem table, so the two cannot disagree; a name not in it throws.
 * @param {string} problem @param {string} message @param {string} [field] @param {number} [retryAfter] seconds, for a 429
 */
export const fail = (problem, message, field, retryAfter) => {
  if (!Object.hasOwn(PROBLEMS, problem)) throw new Error(`unknown problem ${problem}`);
  return { error: { problem, status: PROBLEMS[problem].status, message, ...(field ? { field } : {}), ...(retryAfter ? { retryAfter } : {}) } };
};
/** @param {string} message @param {number} retryAfter seconds */
const limited = (message, retryAfter) => fail('rate-limited', message, undefined, retryAfter);
const invalid = (message, field) => fail('invalid-request', message, field);
const missing = (what) => fail('not-found', `There is no such ${what} here.`);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A name: trimmed, 1 to 60 characters, no control characters (line breaks included), or null. @param {unknown} value */
const nameOf = (value) => {
  if (typeof value !== 'string' || CONTROL.test(value)) return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
};
const colourOf = (value) => (typeof value === 'string' && COLOUR.test(value) ? value.toLowerCase() : null);
const DIGITS = /^[0-9]+$/;
/** An integer in [min, max], `fallback` when absent, or null. A string counts only as plain digits: not "1e1", "0x10" or " 5". */
const intIn = (value, min, max, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && !DIGITS.test(value)) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const publishDrivers = (request) => request.hub.publish(request.workspaceId, 'drivers', request.store.drivers(request.workspaceId));

/** @param {any} request @param {{ name: any, colour?: any }} input */
export function addDriver(request, { name: raw, colour: rawColour }) {
  const name = nameOf(raw);
  if (!name) return invalid('Give the driver a name of 1 to 60 characters.', 'name');
  const existing = request.store.drivers(request.workspaceId);
  if (existing.length >= MAX_DRIVERS) return invalid(`You can have at most ${MAX_DRIVERS} drivers here.`, 'name');
  const colour = rawColour === undefined ? COLOURS[existing.length % COLOURS.length] : colourOf(rawColour);
  if (!colour) return invalid('A colour is #rrggbb.', 'colour');
  const driver = { id: randomUUID(), name, colour };
  request.store.addDriver(request.workspaceId, driver);
  publishDrivers(request);
  return { value: driver };
}

/** @param {any} request @param {{ id: string, name?: any, colour?: any }} input */
export function renameDriver(request, { id, name: rawName, colour: rawColour }) {
  const current = request.store.driver(request.workspaceId, id);
  if (!current) return missing('driver');
  const name = rawName === undefined ? current.name : nameOf(rawName);
  if (!name) return invalid('Give the driver a name of 1 to 60 characters.', 'name');
  const colour = rawColour === undefined ? current.colour : colourOf(rawColour);
  if (!colour) return invalid('A colour is #rrggbb.', 'colour');
  request.store.updateDriver(request.workspaceId, current.id, { name, colour });
  publishDrivers(request);
  return { value: { id: current.id, name, colour } };
}

export function deleteDriver(request, { id }) {
  if (!request.store.deleteDriver(request.workspaceId, id)) return missing('driver');
  publishDrivers(request);
  request.engine.publishUnknown(request.workspaceId);
  return { value: true };
}

export function assignTransponder(request, { code: rawCode, driverId }) {
  const code = transponderCode(rawCode);
  if (!code) return invalid('A transponder code is 1 to 16 hex digits.', 'code');
  if (driverId !== null && (typeof driverId !== 'string' || !request.store.driver(request.workspaceId, driverId))) {
    return invalid('Pick one of the drivers here, or none.', 'driver');
  }
  request.engine.assign(request.workspaceId, code, driverId);
  return { value: { code, driverId } };
}

/** @type {Record<string, string>} */
export const TRACK_PROBLEMS = { invalid: 'invalid-request', 'not-a-circuit': 'not-a-circuit', unavailable: 'planner-unavailable' };

export async function setTrack(request, { link, name: rawName, direction }) {
  if (!DIRECTIONS.includes(direction)) return invalid('Pick the direction you race.', 'direction');
  const name = rawName === undefined ? 'Track' : nameOf(rawName);
  if (!name) return invalid('A track name is 1 to 60 characters.', 'name');
  if (typeof link !== 'string' || link.trim() === '') return invalid('Paste a share link from the planner.', 'link');
  let track;
  try {
    track = await fetchTrack(request.plannerUrl, link.trim(), { fetch: request.fetch });
  } catch (caught) {
    if (!(caught instanceof TrackError)) throw caught;
    return fail(TRACK_PROBLEMS[caught.code], caught.message, 'link');
  }
  const ws = request.workspaceId;
  // Until tracks are managed on their own, as before: the track keyed by the planner's id, else the active one of this
  // name, gets the name and the layout, or one is added under the planner's id; it becomes current.
  const store = request.store;
  const found = store.track(ws, track.id) ?? store.tracks(ws, { archived: false }).find((t) => t.name.toLowerCase() === name.toLowerCase());
  const id = found?.id ?? track.id;
  if (!found) store.addTrack(ws, { id, name });
  else if (found.name !== name) store.renameTrack(ws, id, name);
  if (found?.archivedAt) store.setArchived(ws, id, null);
  store.attachLayout(ws, id, { plannerId: track.id, shape: track.shape, snapshotKey: track.snapshotKey, layout: track.layout },
    { userId: request.userId ?? null, name: request.displayName ?? null, at: request.now() });
  store.setCurrentTrack(ws, id, direction);
  request.engine.endPractice(ws);
  request.hub.publish(ws, 'track', { track: { id, name }, direction, bests: request.engine.bestsOf(ws) });
  return { value: { id, name, direction, snapshotKey: track.snapshotKey } };
}

export function pairDecoder(request, { name: rawName }) {
  const wait = request.limiters.pair.take(request.userId);
  if (wait) return limited(`You paired a lot of decoders just now. Try again in ${wait} seconds.`, wait);
  const name = rawName === undefined ? 'Decoder' : nameOf(rawName);
  if (!name) return invalid('A decoder name is 1 to 60 characters.', 'name');
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  request.store.addDecoder(request.workspaceId, { id, name, tokenHash: tokenHash(token), createdAt: request.now() });
  return { value: { id, name, token } };
}

export function unpairDecoder(request, { id }) {
  if (!request.store.deleteDecoder(request.workspaceId, id)) return missing('decoder');
  return { value: true };
}

export function rotateWatchLink(request) {
  const old = request.store.workspace(request.workspaceId).watchToken;
  const token = randomBytes(16).toString('base64url');
  request.store.setWatchToken(request.workspaceId, token);
  if (old) request.hub.closeTagged(request.workspaceId, old);
  return { value: { token } };
}

export function startSession(request, { kind, roster, durationSeconds, countdownSeconds, replace = undefined }) {
  if (!KINDS.has(kind)) return invalid('Pick a practice, a qualifying or a race.', 'kind');
  if (replace !== undefined && typeof replace !== 'boolean') return invalid('`replace` must be true or false.', 'replace');
  let spec = { kind, replace: replace === true };
  if (kind !== 'practice') {
    if (!Array.isArray(roster) || roster.length < 1 || roster.length > MAX_ROSTER) return invalid(`Pick 1 to ${MAX_ROSTER} drivers.`, 'roster');
    if (new Set(roster).size !== roster.length) return invalid('A driver can be on the roster only once.', 'roster');
    if (!roster.every((id) => typeof id === 'string' && request.store.driver(request.workspaceId, id))) return invalid('Pick only drivers you have set up.', 'roster');
    const duration = intIn(durationSeconds, 10, 3600, 300);
    if (duration === null) return invalid('A session lasts 10 seconds to an hour.', 'duration');
    const countdown = intIn(countdownSeconds, 0, 30, 10);
    if (countdown === null) return invalid('The countdown is 0 to 30 seconds.', 'countdown');
    spec = { ...spec, roster, durationMs: duration * 1000, countdownMs: kind === 'race' ? countdown * 1000 : 0 };
  }
  const result = request.engine.start(request.workspaceId, spec);
  if (result.error) {
    const { error } = fail('conflict', `A ${result.running.kind} is already running here.`);
    return { error: { ...error, running: publicSession(result.running) } };
  }
  return { value: publicSession(result.session) };
}

export function abortSession(request, { id }) {
  const ended = request.engine.abort(request.workspaceId, id);
  return ended ? { value: publicSession(ended) } : missing('running qualifying or race');
}

export function endSession(request, { id }) {
  const ended = request.engine.end(request.workspaceId, id);
  return ended ? { value: publicSession(ended) } : missing('running practice');
}

export function tap(request, { driverId }) {
  if (typeof driverId !== 'string' || !request.store.driver(request.workspaceId, driverId)) return invalid('Pick one of the drivers here.', 'driver');
  const wait = request.limiters.tap.take(request.userId);
  if (wait) return limited(`That's a lot of taps. Try again in ${wait} seconds.`, wait);
  const row = request.engine.tap(request.workspaceId, driverId);
  if (row?.error) return fail('no-session', 'No session is running. Start a practice first.');
  return { value: { stored: row !== null, lapMs: row?.lapMs ?? null } };
}
