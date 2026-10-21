// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control's page and forms (spec §3, §6.2).
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute, toPage } from './page-access.js';
import { page, seeOther } from './respond.js';
import { spacePath } from './spaces.js';
import { confirmPage } from './views/confirm.js';
import { racePage } from './views/race.js';

const NO_SESSION = { message: 'There is no running qualifying or race here.' };

/**
 * Race control. Only a 200, the answer to GET /race, lets the clock reload the page: a reload
 * of the answer to a POST would send the form again.
 * @param {any} request @param {number} status @param {{ error?: any, values?: any }} [extras]
 */
function renderRace(request, status, { error = null, values = null } = {}) {
  const ws = request.workspaceId;
  const session = request.store.activeSession(ws);
  return page(request, status, racePage(request, { session, drivers: request.store.drivers(ws), error, values, reload: status === 200 }));
}

async function start(request) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const values = { kind: form.get('kind') ?? '', roster: form.getAll('roster'), duration: form.get('duration') ?? '', countdown: form.get('countdown') ?? '' };
  // A blank box is "use the default" on a form; the operation only takes a missing value.
  // The box takes whole minutes, as its min and max say: plain digits only, not "1e1" or "0x10".
  const minutes = values.duration === '' ? undefined : /^[0-9]+$/.test(values.duration) ? Number(values.duration) : NaN;
  if (minutes !== undefined && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 60)) {
    const { error } = ops.fail('invalid-request', 'A session lasts 1 to 60 minutes.', 'duration');
    return renderRace(request, error.status, { error, values });
  }
  const result = ops.startSession(request, {
    kind: values.kind,
    roster: values.roster,
    durationSeconds: minutes === undefined ? undefined : minutes * 60,
    countdownSeconds: values.countdown === '' ? undefined : values.countdown,
  });
  if (!result.error) return seeOther(`${request.space.base}/board`);
  return renderRace(request, result.error.status, { error: result.error, values });
}

function askAbort(request, match) {
  const session = request.store.activeSession(request.workspaceId);
  if (!session || session.id !== match[2]) return renderRace(request, 404, { error: NO_SESSION });
  const base = request.space.base;
  return page(request, 200, confirmPage(request, {
    title: `Abort the ${session.kind === 'race' ? 'race' : 'qualifying'}?`,
    text: 'The session ends now. Laps already driven stay on the board.',
    action: `${base}/sessions/${session.id}/abort`,
    button: 'Abort',
    back: `${base}/race`,
    screen: 'race',
  }));
}

async function abort(request, match) {
  const { error } = await readForm(request);
  if (error) return error;
  const result = ops.abortSession(request, { id: match[2] });
  return result.error ? renderRace(request, result.error.status, { error: result.error }) : seeOther(`${request.space.base}/race`);
}

const write = { write: true };

export const racePageRoutes = [
  { pattern: spacePath('race'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => renderRace(request, 200)) } },
  { pattern: spacePath('sessions'), credentials: true, methods: { GET: toPage('race'), POST: pageRoute('timing.run', start, write) } },
  { pattern: spacePath('sessions/([^/]+)/abort'), credentials: true, methods: { GET: pageRoute('timing.run', askAbort), POST: pageRoute('timing.run', abort, write) } },
];
