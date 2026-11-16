// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Sessions tab, a session's page and the records page (records spec §5.2),
// and their forms: start (the board's Start panel posts here), end a practice,
// abort a qualifying or race.
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute, toPage } from './page-access.js';
import { page, seeOther } from './respond.js';
import { spacePath } from './spaces.js';
import { readStart } from './start-form.js';
import { boardPage } from './views/board.js';
import { notFoundPage } from './views/notice.js';
import { confirmPage } from './views/confirm.js';
import { recordsPage } from './views/records.js';
import { resultOf } from './views/result.js';
import { sessionPage } from './views/session.js';
import { sessionsPage } from './views/sessions.js';

const NO_RACE = { message: 'There is no running qualifying or race here.' };
const NO_PRACTICE = { message: 'There is no running practice here.' };
const PAGE = 20;
/** A gap longer than this between one session's end and the next's start begins another club night (board hub spec §7). */
const NIGHT_GAP_MS = 6 * 3_600_000;
/** A confirmation sent twice: the session running is the one its first send started, if of its kind and this new. */
const DOUBLE_SUBMIT_MS = 10_000;
/** The history's page cursor, "<createdAt>.<id>" of the last row shown. */
const CURSOR = /^([0-9]{1,15})\.([A-Za-z0-9-]{1,64})$/;

/** The workspace's track, if set, with its direction. */
function trackOf(request) {
  const ws = request.store.workspace(request.workspaceId);
  return { track: ws?.trackId ? request.store.track(request.workspaceId, ws.trackId) : null, direction: ws?.direction ?? 'ccw' };
}

/**
 * Ended sessions, newest first, a page at a time, each with its driver count and
 * best lap. Each reads only its own laps; records and bests only for the drivers shown.
 * @param {any} request @param {{ createdAt: number, id: string } | null} before
 */
function historyOf(request, before) {
  const { store, workspaceId: ws } = request;
  const ended = store.listSessions(ws, PAGE + 2, before).filter((s) => s.state === 'done' || s.state === 'aborted');
  const sessions = ended.slice(0, PAGE);
  // Each track once: a page holds few of them, and a deleted one is null.
  const tracks = new Map(sessions.map((session) => [session.trackId, null]));
  for (const id of tracks.keys()) if (id !== null) tracks.set(id, store.track(ws, id));
  const rows = sessions.map((session) => ({ session, track: tracks.get(session.trackId), ...store.sessionSummary(session.id) }));
  const groups = new Map();
  for (const row of rows) {
    if (!row.best || row.session.trackId === null) continue;
    const key = `${row.session.trackId} ${row.session.direction}`;
    if (!groups.has(key)) groups.set(key, { trackId: row.session.trackId, direction: row.session.direction, rows: [] });
    groups.get(key).rows.push(row);
  }
  for (const { trackId, direction, rows: group } of groups.values()) {
    const record = store.currentRecord(ws, trackId, direction);
    const bests = store.personalBests(ws, trackId, direction, [...new Set(group.map((r) => r.best.driverId))]);
    for (const row of group) {
      const best = row.best;
      row.best = { ...best, isRecord: best.seq === record?.seq, isPb: bests.some((b) => b.seq === best.seq) };
    }
  }
  const last = sessions[PAGE - 1];
  return { rows, nights: nightsOf(rows), older: ended.length > PAGE ? `${last.createdAt}.${last.id}` : null, newer: before === null ? null : newerOf(request, sessions[0]) };
}

/**
 * The rows, newest first, cut into club nights: a run of sessions with no gap over
 * NIGHT_GAP_MS between one's end and the next's start, on one track and direction.
 * The server knows no time zone, so a night is never a calendar day. Each night
 * starts at its first (oldest) session on the page.
 * @param {any[]} rows
 */
function nightsOf(rows) {
  const startOf = (session) => session.opensAt ?? session.createdAt;
  const nights = [];
  let night = null;
  for (const row of rows) {
    const { session } = row;
    const older = night?.rows.at(-1).session;
    const apart = older && startOf(older) - (session.endedAt ?? startOf(session)) > NIGHT_GAP_MS;
    if (!night || apart || session.trackId !== older.trackId || session.direction !== older.direction) {
      night = { track: row.track, direction: session.direction, rows: [] };
      nights.push(night);
    }
    night.rows.push(row);
    night.at = startOf(session);
  }
  return nights;
}

/**
 * The cursor of the page just newer than one starting at `first`: the session
 * after the PAGE ended ones that come next, or '' when those reach the newest.
 * @param {any} request @param {{ createdAt: number, id: string } | undefined} first
 */
function newerOf(request, first) {
  if (!first) return '';
  const next = request.store.listSessionsAfter(request.workspaceId, PAGE + 2, first).filter((s) => s.state === 'done' || s.state === 'aborted');
  return next.length > PAGE ? `${next[PAGE].createdAt}.${next[PAGE].id}` : '';
}

/** The record history of the current track and direction, all of it. */
function recordsOf(request) {
  const { track, direction } = trackOf(request);
  return { track, direction, rows: track ? request.store.recordHistory(request.workspaceId, track.id, direction, { limit: -1 }) : [] };
}

/**
 * The Sessions tab: the history, and a line while a session runs (board hub spec §7).
 * @param {any} request @param {number} status @param {{ error?: any, errors?: any[] }} [extras]
 */
function renderTab(request, status, { error = null, errors = error ? [error] : [] } = {}) {
  const ws = request.workspaceId;
  const cursor = CURSOR.exec(request.url.searchParams.get('before') ?? '');
  const before = cursor ? { createdAt: Number(cursor[1]), id: cursor[2] } : null;
  return page(request, status, sessionsPage(request, {
    running: request.store.runningSession(ws),
    drivers: request.store.drivers(ws),
    history: historyOf(request, before),
    errors,
  }));
}

/**
 * "A practice has been running for 12 min, with 3 drivers.", or "…for under a minute, with no drivers yet.";
 * a race in its countdown "is counting down to its start, with 3 drivers."
 */
export function runningFor(kind, minutes, drivers, countingDown = false) {
  const length = minutes < 1 ? 'under a minute' : `${minutes} min`;
  const who = drivers === 0 ? 'no drivers yet' : `${drivers} ${drivers === 1 ? 'driver' : 'drivers'}`;
  return countingDown ? `A ${kind} is counting down to its start, with ${who}.` : `A ${kind} has been running for ${length}, with ${who}.`;
}

/**
 * Starting while a session runs: say what runs, and send the same form again with
 * `replace` naming that session (records spec §5.2), so it ends only what it named.
 * @param {any} request @param {{ kind: string, fields: string[][] }} sent readStart's kind and fields
 */
function askReplace(request, { kind, fields }, running) {
  const base = request.space.base;
  const minutes = Math.floor(Math.max(0, request.now() - (running.opensAt ?? running.createdAt)) / 60_000);
  const drivers = running.roster ? running.roster.length : request.engine.driverCount(running);
  const what = kind === 'race' || kind === 'qualifying' ? kind : 'practice';
  return page(request, 200, confirmPage(request, {
    title: what === 'qualifying' ? 'Start qualifying?' : `Start a ${what}?`,
    // The engine moves a race out of its countdown on its next tick, up to a second late; the clock says it has started.
    text: `${runningFor(running.kind, minutes, drivers, running.state === 'countdown' && request.now() < running.opensAt)} Starting this ${what} ends it.`,
    action: `${base}/sessions`,
    button: 'Start',
    back: `${base}/board`,
    screen: 'board',
    fields: [...fields, ['replace', running.id]],
  }));
}

/** A start that failed: the board again, its Start panel with the errors and what was sent (board hub spec §5). */
const startFailed = (request, status, errors, values) => page(request, status, boardPage(request, request.engine.snapshot(request.workspaceId, { moments: true }), { start: { errors, values } }));

/**
 * The board's Start form (board hub spec §5): only the sent kind's own fields
 * are read (readStart), then 303 to the board; a failure is the board again.
 */
async function start(request) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const sent = readStart(request, form);
  // Every field's error at once, in the form's order, so one round trip shows all that needs fixing.
  if (sent.errors.length) return startFailed(request, sent.errors[0].status, sent.errors, sent.values);
  // A start leads to the board.
  const done = `${request.space.base}/board`;
  // A confirmation replaces only the session it named. From here to the start nothing awaits,
  // so what runs cannot change in between.
  // Sent twice (a double click, two members): the session running is the one the first send started.
  const twice = (running) => running.kind === sent.kind && request.now() - running.createdAt < DOUBLE_SUBMIT_MS;
  const named = form.get('replace');
  const running = named ? request.store.runningSession(request.workspaceId) : null;
  if (running && running.id !== named) return twice(running) ? seeOther(done) : askReplace(request, sent, running);
  const result = ops.startSession(request, { roster: undefined, durationSeconds: undefined, countdownSeconds: undefined, ...sent.args, replace: running !== null });
  if (!result.error) return seeOther(done);
  if ('running' in result.error) return twice(result.error.running) ? seeOther(done) : askReplace(request, sent, result.error.running);
  return startFailed(request, result.error.status, [result.error], sent.values);
}


/** The running session `match[2]`, if it is of a kind `ok` accepts. */
function runningAs(request, match, ok) {
  const session = request.store.runningSession(request.workspaceId);
  return session && session.id === match[2] && ok(session.kind) ? session : null;
}

function askAbort(request, match) {
  const session = runningAs(request, match, (kind) => kind !== 'practice');
  if (!session) return renderTab(request, 404, { error: NO_RACE });
  const base = request.space.base;
  return page(request, 200, confirmPage(request, {
    title: `Abort the ${session.kind === 'race' ? 'race' : 'qualifying'}?`,
    text: `The ${session.kind === 'race' ? 'race' : 'qualifying'} ends now. Its laps stay in the history.`,
    action: `${base}/sessions/${session.id}/abort`,
    button: 'Abort',
    back: `${base}/board`,
    screen: 'board',
  }));
}

async function abort(request, match) {
  const { error } = await readForm(request);
  if (error) return error;
  const result = ops.abortSession(request, { id: match[2] });
  // Back to the board, where the night is run (board hub spec §4.2).
  return result.error ? renderTab(request, result.error.status, { error: result.error }) : seeOther(`${request.space.base}/board`);
}

function askEnd(request, match) {
  const session = runningAs(request, match, (kind) => kind === 'practice');
  if (!session) return renderTab(request, 404, { error: NO_PRACTICE });
  const base = request.space.base;
  return page(request, 200, confirmPage(request, {
    title: 'End the practice?',
    text: 'The practice ends at its last lap. Its laps stay in the history.',
    action: `${base}/sessions/${session.id}/end`,
    button: 'End',
    back: `${base}/board`,
    screen: 'board',
  }));
}

async function end(request, match) {
  const { error } = await readForm(request);
  if (error) return error;
  const result = ops.endSession(request, { id: match[2] });
  return result.error ? renderTab(request, result.error.status, { error: result.error }) : seeOther(`${request.space.base}/board`);
}

/** A session's page: its final table with marks and crown, and every lap. */
function showSession(request, match) {
  const { store, workspaceId: ws } = request;
  const detail = request.engine.sessionDetail(ws, match[2]);
  if (!detail) return page(request, 404, notFoundPage(request));
  const input = request.engine.resultInput(ws, detail);
  const { session, crossings, track } = input;
  const result = resultOf(input);
  return page(request, 200, sessionPage(request, { session, crossings, drivers: store.drivers(ws), track, result }));
}

function showRecords(request) {
  const { store, workspaceId: ws } = request;
  const records = recordsOf(request);
  // The Layout column only where the track has had a layout.
  const layoutOf = records.track?.layout ? (at) => store.layoutAt(ws, records.track.id, at) : null;
  return page(request, 200, recordsPage(request, { ...records, drivers: store.drivers(ws), layoutOf }));
}

const write = { write: true };

export const sessionsPageRoutes = [
  { pattern: spacePath('race'), credentials: true, methods: { GET: toPage('sessions') } },
  { pattern: spacePath('sessions'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => renderTab(request, 200)), POST: pageRoute('timing.run', start, write) } },
  { pattern: spacePath('sessions/([^/]+)'), credentials: true, methods: { GET: pageRoute('timing.run', showSession) } },
  { pattern: spacePath('sessions/([^/]+)/abort'), credentials: true, methods: { GET: pageRoute('timing.run', askAbort), POST: pageRoute('timing.run', abort, write) } },
  { pattern: spacePath('sessions/([^/]+)/end'), credentials: true, methods: { GET: pageRoute('timing.run', askEnd), POST: pageRoute('timing.run', end, write) } },
  { pattern: spacePath('records'), credentials: true, methods: { GET: pageRoute('timing.run', showRecords) } },
];
