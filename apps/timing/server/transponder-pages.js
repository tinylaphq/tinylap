// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The form "Whose transponder is 41?" at <space>/transponders/<number>
// (drivers and transponders spec §3.3, §3.4): reached from anywhere with
// ?returnTo=, one POST, then 303 back there; someone else's asks first.
import { transponderCode } from '@tinylap/timing';
import { readForm } from './form.js';
import * as ops from './operations.js';
import { pageRoute, toPage } from './page-access.js';
import { page, seeOther } from './respond.js';
import { retryHeaders } from './responses.js';
import { safeReturnTo } from './return-to.js';
import { renderSetup } from './setup-pages.js';
import { spacePath } from './spaces.js';
import { eventStream } from './stream.js';
import { collectPage } from './views/collect.js';
import { notFoundPage } from './views/notice.js';
import { crossingSlot, moveQuestionPage, transponderFormPage } from './views/transponder.js';

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
  return all.find((t) => t.code === code) ?? all.find((t) => bare(t.code) === bare(code)) ?? { code, driverId: null, lastSeenAt: null, crossedAt: null };
}

const fallbackOf = (request) => `${request.space.base}/setup#transponders`;

/** The form, with any error and what was typed. @param {any} request @param {number} status */
function renderForm(request, status, transponder, { returnTo, values = {}, errors = null, headers = {} }) {
  const ws = request.workspaceId;
  return page(request, status, transponderFormPage(request, {
    base: request.space.base,
    code: transponder.code,
    crossingNow: crossingSlot(request, transponder.crossedAt),
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

/**
 * A refused add from Setup's add list (§3.1) comes back as Setup with that row open, the error on
 * its field and the input kept: 422 for a mistake in the form. `row` is the list row's number, or
 * '' for the row that takes a number.
 * @param {any} request @param {URLSearchParams} form @param {any} error @param {string} row
 */
function setupFailure(request, form, error, row) {
  const driverId = form.get('driver') ?? '';
  const key = `add:${driverId}`;
  const failure = error.field ? { ...error, status: 422 } : error;
  const prefix = `add-${driverId}-${row || 'number'}`;
  const fieldId = { label: `${prefix}-label`, code: `add-${driverId}-number` }[failure.field] ?? null;
  const values = { row, label: form.get('label') ?? '', number: form.get('code') ?? '' };
  return renderSetup(request, failure.status, { errors: { [key]: failure }, values: { [key]: values }, failed: { error: failure, fieldId }, headers: retryHeaders(failure) });
}

/**
 * Collect (§3.6) with what the URL says was just assigned, and any refused form of a row.
 * @param {any} request @param {number} status @param {{ failed?: any, asking?: any, headers?: Record<string, string> }} [extras]
 */
function renderCollect(request, status, { failed = null, asking = null, headers = {} } = {}) {
  const ws = request.workspaceId;
  const drivers = request.store.drivers(ws);
  const transponders = request.store.transponders(ws);
  const params = request.url.searchParams;
  const assigned = status === 200 && !asking ? transponders.find((t) => t.code === params.get('assigned')) : null;
  const owner = assigned?.driverId ? drivers.find((d) => d.id === assigned.driverId) : null;
  const done = owner ? { code: assigned.code, name: owner.name, added: params.get('added') === '1' } : null;
  return page(request, status, collectPage(request, { drivers, transponders, done, failed, asking }), { headers });
}

const showCollect = (request) => renderCollect(request, 200);

/**
 * A refused form of a collect row comes back as collect with that form's error and input, 422.
 * Which form: the new-driver one sends a name, the driver one a driver.
 */
function collectFailure(request, form, code, error) {
  const which = form.has('name') ? 'name' : 'driver';
  const failure = error.field ? { ...error, status: 422, field: which } : error;
  const failed = { code, form: which, error: failure, values: { driver: form.get('driver') ?? '', name: form.get('name') ?? '' } };
  return renderCollect(request, failure.status, { failed, headers: retryHeaders(failure) });
}

/** The assignment to `raw`, from the form or Setup's add list; `row` as for setupFailure. */
function assignTo(request, form, raw, row) {
  const transponder = transponderOf(request, raw);
  if (!transponder) return page(request, 404, notFoundPage(request));
  const ws = request.workspaceId;
  const fromSetup = form.get('from') === 'setup';
  const fromCollect = form.get('from') === 'collect';
  const driverId = form.get('driver') ?? '';
  const name = form.get('name') ?? '';
  const label = form.get('label') ?? undefined;
  const returnTo = safeReturnTo(form.get('returnTo') ?? undefined, fallbackOf(request));
  // A bad label is refused before anything is asked.
  const labelled = ops.labelOf(label);
  if (labelled.error && fromSetup) return setupFailure(request, form, labelled.error, row);
  const owner = transponder.driverId ? request.store.driver(ws, transponder.driverId) : null;
  const chosen = driverId ? request.store.driver(ws, driverId) : null;
  const to = driverId ? chosen?.name : name.trim();
  // Collect's driver form sends no name: nothing chosen is that form's mistake, not a missing new name.
  if (fromCollect && !form.has('name') && !driverId) return collectFailure(request, form, transponder.code, { problem: 'invalid-request', status: 422, field: 'driver', message: 'Choose a driver.' });
  // Someone else's asks first, once the choice itself is sound; the operation refuses the rest.
  const sound = driverId ? chosen && name.trim() === '' : to !== '';
  if (owner && sound && chosen?.id !== owner.id && form.get('confirm') !== '1') {
    // In Setup's list the question is the row itself (§3.4): Setup with that row open, so a frame can swap it in.
    if (fromSetup) return renderSetup(request, 200, { values: { [`add:${driverId}`]: { row: transponder.code, label: label ?? '', number: '' } } });
    // On collect the question is the row itself, too: collect with that row asking, for a frame to swap in.
    if (fromCollect) return renderCollect(request, 200, { asking: { code: transponder.code, owner, to, driver: driverId, name, returnTo } });
    return page(request, 200, moveQuestionPage(request, { base: request.space.base, code: transponder.code, owner, to, driver: driverId, name, returnTo }));
  }
  const result = ops.assignTransponderTo(request, { code: transponder.code, driverId: driverId || null, label, newDriverName: name });
  if (!result.error) return seeOther(returnTo);
  if (fromSetup) return setupFailure(request, form, result.error, row);
  if (fromCollect) return collectFailure(request, form, transponder.code, result.error);
  // A driver deleted meanwhile is a mistake in the form, like any other: 422.
  const failure = result.error.field ? { ...result.error, status: 422 } : result.error;
  return renderForm(request, failure.status, transponder, { returnTo, values: { name }, errors: failure, headers: retryHeaders(failure) });
}

async function assign(request, match) {
  const { form, error } = await readForm(request);
  if (error) return error;
  return assignTo(request, form, match[2], match[2]);
}

/** Setup's "Not in the list? Enter its number" (§3.1): the number comes in the form, not the URL. */
async function assignNumber(request) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const raw = form.get('code') ?? '';
  if (!transponderCode(raw)) return setupFailure(request, form, { problem: 'invalid-request', status: 422, field: 'code', message: 'Type the number on the transponder.' }, '');
  return assignTo(request, form, raw, '');
}

/** Where Remove goes back to: the page of the driver who has it, else Setup's transponders. */
const ownerPageOf = (request, transponder) => (transponder.driverId ? `${request.space.base}/drivers/${transponder.driverId}` : fallbackOf(request));

/** GET on Remove's target (§3.5): on to the page the button is on. */
function toOwnerPage(request, match) {
  const transponder = transponderOf(request, match[2]);
  return transponder ? seeOther(ownerPageOf(request, transponder)) : page(request, 404, notFoundPage(request));
}

/** Remove (§3.1, §3.5): back to "Not assigned yet", its label gone; 303 to returnTo, else the driver's page. */
async function remove(request, match) {
  const { form, error } = await readForm(request);
  if (error) return error;
  const transponder = transponderOf(request, match[2]);
  if (!transponder) return page(request, 404, notFoundPage(request));
  const back = safeReturnTo(form.get('returnTo') ?? undefined, ownerPageOf(request, transponder));
  const result = ops.removeTransponder(request, { code: transponder.code });
  if (result.error) return page(request, result.error.status, notFoundPage(request));
  return seeOther(back);
}

export const transponderPageRoutes = [
  // The live stream at the space's own address, for tl-crossing-now on its pages: members only.
  { pattern: spacePath('live'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => eventStream(request, request.workspaceId, { watcher: false })) } },
  { pattern: spacePath('transponders/new'), credentials: true, methods: { GET: pageRoute('timing.setup', showCollect) } },
  { pattern: spacePath('transponders'), credentials: true, methods: { GET: toPage('setup#drivers'), POST: pageRoute('timing.setup', assignNumber, { write: true }) } },
  { pattern: spacePath('transponders/([0-9A-Fa-f]{1,16})/remove'), credentials: true, methods: { GET: pageRoute('timing.setup', toOwnerPage), POST: pageRoute('timing.setup', remove, { write: true }) } },
  { pattern: spacePath('transponders/([0-9A-Fa-f]{1,16})'), credentials: true, methods: { GET: pageRoute('timing.setup', showForm), POST: pageRoute('timing.setup', assign, { write: true }) } },
];
