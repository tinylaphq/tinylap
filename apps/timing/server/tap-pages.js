// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tap entry's page and form (spec §6.3). The form answers 303 with what the
// tap did in the query; asked for JSON (tl-tap), the same post answers in
// place, so taps don't wait for a page load.
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute } from './page-access.js';
import { page, seeOther } from './respond.js';
import { json, retryHeaders } from './responses.js';
import { spacePath } from './spaces.js';
import { tapPage, tapResultText } from './views/tap.js';

const RESULTS = new Set(['started', 'lap', 'again']);
const wantsJson = (req) => /application\/json/.test(String(req.headers.accept ?? ''));

function showTap(request) {
  const drivers = request.store.drivers(request.workspaceId);
  const q = request.url.searchParams;
  const driver = drivers.find((d) => d.id === q.get('driver'));
  const kind = q.get('result');
  // A lap needs its time, as digits; the other results carry none. Anything else is no result.
  const ms = /^\d{1,9}$/.test(q.get('ms') ?? '') ? Number(q.get('ms')) : null;
  const result = driver && RESULTS.has(kind) && (kind !== 'lap' || ms !== null) ? { result: kind, ms: kind === 'lap' ? ms : null, driver } : null;
  return page(request, 200, tapPage(request, { drivers, result, running: !!request.store.runningSession(request.workspaceId) }));
}

/** @param {{ stored: boolean, lapMs: number | null }} value */
const outcomeOf = (value) => (!value.stored ? 'again' : value.lapMs === null ? 'started' : 'lap');

async function postTap(request) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const driverId = form.get('driver') ?? '';
  const result = ops.tap(request, { driverId });
  const drivers = request.store.drivers(request.workspaceId);
  if (result.error) {
    const headers = retryHeaders(result.error);
    if (wantsJson(request.req)) return { ...json(result.error.status, { error: result.error.message }, { 'Cache-Control': 'no-store', ...headers }), credentials: true };
    return page(request, result.error.status, tapPage(request, { drivers, error: result.error, running: !!request.store.runningSession(request.workspaceId) }), { headers });
  }
  const outcome = outcomeOf(result.value);
  const driver = drivers.find((d) => d.id === driverId);
  if (wantsJson(request.req)) {
    return { ...json(200, { ...result.value, text: tapResultText({ result: outcome, ms: result.value.lapMs }, driver) }, { 'Cache-Control': 'no-store' }), credentials: true };
  }
  const query = new URLSearchParams({ driver: driverId, result: outcome, ...(outcome === 'lap' ? { ms: String(result.value.lapMs) } : {}) });
  return seeOther(`${request.space.base}/tap?${query}`);
}

export const tapPageRoutes = [
  { pattern: spacePath('tap'), credentials: true, methods: { GET: pageRoute('timing.run', showTap), POST: pageRoute('timing.run', postTap, { write: true }) } },
];
