// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The form "Whose transponder is 41?" at <space>/transponders/<number>
// (drivers and transponders spec §3.3, §3.4): reached from anywhere with
// ?returnTo=, one POST, then 303 back there; someone else's asks first.
import { transponderCode } from '@tinylap/timing';
import { readForm } from './form.js';
import * as ops from './operations.js';
import { pageRoute } from './page-access.js';
import { page, seeOther } from './respond.js';
import { retryHeaders } from './responses.js';
import { safeReturnTo } from './return-to.js';
import { assignFromSetup } from './setup-pages.js';
import { spacePath } from './spaces.js';
import { notFoundPage } from './views/notice.js';
import { moveQuestionPage, transponderFormPage } from './views/transponder.js';

const CROSSING_NOW_MS = 10_000;
const bare = (code) => code.replace(/^0+(?=.)/u, '');

/**
 * The transponder a number in a URL means: any case, and with or without leading zeros,
 * the known one it matches; else the number as given. Null when it is no number.
 * @param {any} request @param {string} raw
 */
function transponderOf(request, raw) {
  const code = transponderCode(raw);
  if (!code) return null;
  const all = request.store.transponders(request.workspaceId);
  return all.find((t) => t.code === code) ?? all.find((t) => bare(t.code) === bare(code)) ?? { code, driverId: null, lastSeenAt: null };
}

const fallbackOf = (request) => `${request.space.base}/setup#transponders`;

/** The form, with any error and what was typed. @param {any} request @param {number} status */
function renderForm(request, status, transponder, { returnTo, values = {}, errors = null, headers = {} }) {
  const ws = request.workspaceId;
  const { lastSeenAt } = transponder;
  return page(request, status, transponderFormPage(request, {
    base: request.space.base,
    code: transponder.code,
    crossingNow: lastSeenAt !== null && request.now() - lastSeenAt <= CROSSING_NOW_MS,
    drivers: request.store.drivers(ws),
    transponders: request.store.transponders(ws),
    values,
    errors,
    returnTo,
  }), { headers });
}

function showForm(request, match) {
  const transponder = transponderOf(request, match[2]);
  if (!transponder) return page(request, 404, notFoundPage(request));
  return renderForm(request, 200, transponder, { returnTo: safeReturnTo(request.url.searchParams.get('returnTo') ?? undefined, fallbackOf(request)) });
}

async function assign(request, match) {
  const { form, error } = await readForm(request);
  if (error) return error;
  // Setup's own row sends no name: it keeps its select until Setup links here.
  if (!form.has('name')) return assignFromSetup(request, form, match);
  const transponder = transponderOf(request, match[2]);
  if (!transponder) return page(request, 404, notFoundPage(request));
  const ws = request.workspaceId;
  const driverId = form.get('driver') ?? '';
  const name = form.get('name') ?? '';
  const returnTo = safeReturnTo(form.get('returnTo') ?? undefined, fallbackOf(request));
  const owner = transponder.driverId ? request.store.driver(ws, transponder.driverId) : null;
  const chosen = driverId ? request.store.driver(ws, driverId) : null;
  const to = driverId ? chosen?.name : name.trim();
  // Someone else's asks first, once the choice itself is sound; the operation refuses the rest.
  const sound = driverId ? chosen && name.trim() === '' : to !== '';
  if (owner && sound && chosen?.id !== owner.id && form.get('confirm') !== '1') {
    return page(request, 200, moveQuestionPage(request, { base: request.space.base, code: transponder.code, owner, to, driver: driverId, name, returnTo }));
  }
  const result = ops.assignTransponderTo(request, { code: transponder.code, driverId: driverId || null, label: undefined, newDriverName: name });
  if (!result.error) return seeOther(returnTo);
  // A driver deleted meanwhile is a mistake in the form, like any other: 422.
  const failure = result.error.field ? { ...result.error, status: 422 } : result.error;
  return renderForm(request, failure.status, transponder, { returnTo, values: { name }, errors: failure, headers: retryHeaders(failure) });
}

/** Where Remove goes back to: the page of the driver who has it, else Setup's transponders. */
const ownerPageOf = (request, transponder) => (transponder.driverId ? `${request.space.base}/drivers/${transponder.driverId}` : fallbackOf(request));

/** GET on Remove's target (§3.5): on to the page the button is on. */
function toOwnerPage(request, match) {
  const transponder = transponderOf(request, match[2]);
  return transponder ? seeOther(ownerPageOf(request, transponder)) : page(request, 404, notFoundPage(request));
}

/** Remove (§3.5): back to "Not assigned yet", its label gone; 303 back to the driver's page. */
async function remove(request, match) {
  const { error } = await readForm(request);
  if (error) return error;
  const transponder = transponderOf(request, match[2]);
  if (!transponder) return page(request, 404, notFoundPage(request));
  const back = ownerPageOf(request, transponder);
  const result = ops.removeTransponder(request, { code: transponder.code });
  if (result.error) return page(request, result.error.status, notFoundPage(request));
  return seeOther(back);
}

export const transponderPageRoutes = [
  { pattern: spacePath('transponders/([0-9A-Fa-f]{1,16})/remove'), credentials: true, methods: { GET: pageRoute('timing.setup', toOwnerPage), POST: pageRoute('timing.setup', remove, { write: true }) } },
  { pattern: spacePath('transponders/([0-9A-Fa-f]{1,16})'), credentials: true, methods: { GET: pageRoute('timing.setup', showForm), POST: pageRoute('timing.setup', assign, { write: true }) } },
];
