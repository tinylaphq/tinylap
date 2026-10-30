// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Sessions tab, a session's page and the records page (records spec §5.2),
// and their forms: start, end a practice, abort a qualifying or race.
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute, toPage } from './page-access.js';
import { page, seeOther } from './respond.js';
import { spacePath } from './spaces.js';
import { notFoundPage } from './views/notice.js';
import { confirmPage } from './views/confirm.js';
import { recordsPage } from './views/records.js';
import { sessionPage } from './views/session.js';
import { sessionsPage } from './views/sessions.js';

const NO_RACE = { message: 'There is no running qualifying or race here.' };
const NO_PRACTICE = { message: 'There is no running practice here.' };
const PAGE = 20;
const LATEST_RECORDS = 5;
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
  const rows = sessions.map((session) => ({ session, ...store.sessionSummary(session.id) }));
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
      row.best = { ...best, isRecord: best.seq === record?.seq, isPb: bests.some((b) => b.seq === best.seq), isHolder: best.driverId === record?.driverId };
    }
  }
  const last = sessions[PAGE - 1];
  return { rows, older: ended.length > PAGE ? `${last.createdAt}.${last.id}` : null, newer: before !== null };
}

/** The record history of the current track and direction; `limit` -1 for all of it. */
function recordsOf(request, limit) {
  const { track, direction } = trackOf(request);
  return { track, direction, rows: track ? request.store.recordHistory(request.workspaceId, track.id, direction, { limit }) : [] };
}

/**
 * The Sessions tab. Only a 200, the answer to GET, lets the clock reload the page: a reload
 * of the answer to a POST would send the form again.
 * @param {any} request @param {number} status @param {{ error?: any, values?: any }} [extras]
 */
function renderTab(request, status, { error = null, values = null } = {}) {
  const ws = request.workspaceId;
  const cursor = CURSOR.exec(request.url.searchParams.get('before') ?? '');
  const before = cursor ? { createdAt: Number(cursor[1]), id: cursor[2] } : null;
  return page(request, status, sessionsPage(request, {
    session: request.store.runningSession(ws),
    drivers: request.store.drivers(ws),
    idle: request.engine.idleOf(ws),
    history: historyOf(request, before),
    records: recordsOf(request, LATEST_RECORDS),
    error,
    values,
    reload: status === 200,
  }));
}

/**
 * Starting while a session runs: say what runs, and send the same form again with
 * `replace` naming that session (records spec §5.2), so it ends only what it named.
 */
function askReplace(request, values, running) {
  const base = request.space.base;
  const minutes = Math.floor(Math.max(0, request.now() - (running.opensAt ?? running.createdAt)) / 60_000);
  const drivers = running.kind === 'practice' ? request.engine.driverCount(running) : (running.roster ?? []).length;
  const what = values.kind === 'race' || values.kind === 'qualifying' ? values.kind : 'practice';
  const fields = values.kind === 'practice'
    ? [['kind', 'practice']]
    : [['kind', values.kind], ...values.roster.map((id) => ['roster', id]), ['duration', values.duration], ['countdown', values.countdown]];
  return page(request, 200, confirmPage(request, {
    title: what === 'qualifying' ? 'Start qualifying?' : `Start a ${what}?`,
    text: `A ${running.kind} is running (${minutes} min, ${drivers} ${drivers === 1 ? 'driver' : 'drivers'}). Starting this ${what} ends it.`,
    action: `${base}/sessions`,
    button: 'Start',
    back: `${base}/sessions`,
    screen: 'sessions',
    fields: [...fields, ['replace', running.id]],
  }));
}

async function start(request) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const values = { kind: form.get('kind') ?? '', roster: form.getAll('roster'), duration: form.get('duration') ?? '', countdown: form.get('countdown') ?? '' };
  const practice = values.kind === 'practice';
  // A blank box is "use the default" on a form; the operation only takes a missing value.
  // The box takes whole minutes, as its min and max say: plain digits only, not "1e1" or "0x10".
  const minutes = practice || values.duration === '' ? undefined : /^[0-9]+$/.test(values.duration) ? Number(values.duration) : NaN;
  if (minutes !== undefined && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 60)) {
    const { error } = ops.fail('invalid-request', 'A session lasts 1 to 60 minutes.', 'duration');
    return renderTab(request, error.status, { error, values });
  }
  // A confirmation replaces only the session it named. From here to the start nothing awaits,
  // so what runs cannot change in between.
  const named = form.get('replace');
  const running = named ? request.store.runningSession(request.workspaceId) : null;
  if (running && running.id !== named) {
    if (running.kind === values.kind && request.now() - running.createdAt < DOUBLE_SUBMIT_MS) return seeOther(`${request.space.base}/board`);
    return askReplace(request, values, running);
  }
  const result = ops.startSession(request, {
    kind: values.kind,
    roster: practice ? undefined : values.roster,
    durationSeconds: minutes === undefined ? undefined : minutes * 60,
    countdownSeconds: practice || values.countdown === '' ? undefined : values.countdown,
    replace: running !== null,
  });
  if (!result.error) return seeOther(`${request.space.base}/board`);
  if ('running' in result.error) return askReplace(request, values, result.error.running);
  return renderTab(request, result.error.status, { error: result.error, values });
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
    text: 'The session ends now. Laps already driven stay on the board.',
    action: `${base}/sessions/${session.id}/abort`,
    button: 'Abort',
    back: `${base}/sessions`,
    screen: 'sessions',
  }));
}

async function abort(request, match) {
  const { error } = await readForm(request);
  if (error) return error;
  const result = ops.abortSession(request, { id: match[2] });
  return result.error ? renderTab(request, result.error.status, { error: result.error }) : seeOther(`${request.space.base}/sessions`);
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
    back: `${base}/sessions`,
    screen: 'sessions',
  }));
}

async function end(request, match) {
  const { error } = await readForm(request);
  if (error) return error;
  const result = ops.endSession(request, { id: match[2] });
  return result.error ? renderTab(request, result.error.status, { error: result.error }) : seeOther(`${request.space.base}/sessions`);
}

/** A session's page: its final table with marks and crown, and every lap. */
function showSession(request, match) {
  const { store, workspaceId: ws } = request;
  const detail = request.engine.sessionDetail(ws, match[2]);
  if (!detail) return page(request, 404, notFoundPage(request));
  const { session, standings, crossings } = detail;
  const track = session.trackId ? store.track(ws, session.trackId) : null;
  const record = track ? store.currentRecord(ws, track.id, session.direction) : null;
  const bests = track ? store.personalBests(ws, track.id, session.direction, standings.map((r) => r.driverId)) : [];
  return page(request, 200, sessionPage(request, { session, standings, crossings, drivers: store.drivers(ws), track, record, bests }));
}

const showRecords = (request) => page(request, 200, recordsPage(request, { ...recordsOf(request, -1), drivers: request.store.drivers(request.workspaceId) }));

const write = { write: true };

export const sessionsPageRoutes = [
  { pattern: spacePath('race'), credentials: true, methods: { GET: toPage('sessions') } },
  { pattern: spacePath('sessions'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => renderTab(request, 200)), POST: pageRoute('timing.run', start, write) } },
  { pattern: spacePath('sessions/([^/]+)'), credentials: true, methods: { GET: pageRoute('timing.run', showSession) } },
  { pattern: spacePath('sessions/([^/]+)/abort'), credentials: true, methods: { GET: pageRoute('timing.run', askAbort), POST: pageRoute('timing.run', abort, write) } },
  { pattern: spacePath('sessions/([^/]+)/end'), credentials: true, methods: { GET: pageRoute('timing.run', askEnd), POST: pageRoute('timing.run', end, write) } },
  { pattern: spacePath('records'), credentials: true, methods: { GET: pageRoute('timing.run', showRecords) } },
];
