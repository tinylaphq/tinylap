// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control's page and forms (spec §3, §6.2).
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute } from './page-access.js';
import { page, seeOther } from './respond.js';
import { spacePath } from './spaces.js';
import { confirmPage } from './views/confirm.js';
import { racePage } from './views/race.js';

const NO_SESSION = { message: 'There is no running qualifying or race here.' };

/** @param {any} request @param {number} status @param {{ error?: any, values?: any, headers?: Record<string, any> }} [extras] */
function renderRace(request, status, { error = null, values = null, headers } = {}) {
  const ws = request.workspaceId;
  const session = request.store.activeSession(ws);
  return page(request, status, racePage(request, { session, drivers: request.store.drivers(ws), error, values }), { headers });
}

async function start(request) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const values = { kind: form.get('kind') ?? '', roster: form.getAll('roster'), duration: form.get('duration') ?? '', countdown: form.get('countdown') ?? '' };
  // A blank box is "use the default" on a form; the operation only takes a missing value.
  const minutes = values.duration === '' ? undefined : Number(values.duration);
  const result = ops.startSession(request, {
    kind: values.kind,
    roster: values.roster,
    durationSeconds: minutes === undefined ? undefined : Math.round(minutes * 60),
    countdownSeconds: values.countdown === '' ? undefined : values.countdown,
  });
  if (!result.error) return seeOther(`${request.space.base}/board`);
  const headers = result.error.retryAfter ? { 'Retry-After': String(result.error.retryAfter) } : undefined;
  return renderRace(request, result.error.status, { error: result.error, values, headers });
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
  { pattern: spacePath('sessions'), credentials: true, methods: { POST: pageRoute('timing.run', start, write) } },
  { pattern: spacePath('sessions/([^/]+)/abort'), credentials: true, methods: { GET: pageRoute('timing.run', askAbort), POST: pageRoute('timing.run', abort, write) } },
];
