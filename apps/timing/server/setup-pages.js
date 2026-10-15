// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup's pages and forms (spec §3, §6.4). Every form posts to a resource
// URL and answers 303 to the setup section it changed; a failure renders the
// page again with the error and what was typed.
import { can } from '@tinylap/auth';
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute } from './page-access.js';
import { page, seeOther } from './respond.js';
import { spacePath } from './spaces.js';
import { confirmPage } from './views/confirm.js';
import { setupPage } from './views/setup.js';

/**
 * The setup page from the store, with any errors and kept values.
 * @param {any} request @param {number} status
 * @param {{ headers?: Record<string, any>, failed?: { error: any, fieldId?: string | null }, errors?: Record<string, any>, values?: Record<string, any>, paired?: { id: string, name: string, token: string } | null }} [extras]
 */
export function renderSetup(request, status, { headers = {}, ...extras } = {}) {
  const ws = request.workspaceId;
  const workspace = request.store.workspace(ws);
  return page(request, status, setupPage(request, {
    drivers: request.store.drivers(ws),
    transponders: request.store.transponders(ws),
    decoders: request.store.decoders(ws),
    track: workspace.trackId ? request.store.track(ws, workspace.trackId) : null,
    direction: workspace.direction,
    watchToken: workspace.watchToken,
    mayDelete: can(request.session.claims, ws, 'timing.delete'),
    ...extras,
  }), { headers });
}

/**
 * Runs an operation from a form: 303 to `section` on success, the setup page
 * with the error otherwise (422, or the operation's own status).
 */
export function afterForm(request, result, { key, values, section, fieldId = null }) {
  if (!result.error) return seeOther(`${request.space.base}/setup#${section}`);
  const headers = result.error.retryAfter ? { 'Retry-After': String(result.error.retryAfter) } : undefined;
  return renderSetup(request, result.error.status, { errors: { [key]: result.error }, values: { [key]: values }, failed: { error: result.error, fieldId }, headers });
}

/** A form handler: read the body, then `run(request, form, match)`. */
const withForm = (run) => async (request, match) => {
  const { form, error } = await readForm(request);
  return error ?? run(request, form, match);
};

const addDriver = withForm((request, form) => {
  const values = { name: form.get('name') ?? '' };
  return afterForm(request, ops.addDriver(request, { name: values.name }), { key: 'add-driver', values, section: 'drivers', fieldId: 'add-driver-name' });
});

const renameDriver = withForm((request, form, match) => {
  const values = { name: form.get('name') ?? '' };
  return afterForm(request, ops.renameDriver(request, { id: match[2], name: values.name }), { key: `rename:${match[2]}`, values, section: 'drivers', fieldId: `rename-${match[2]}` });
});

function askDeleteDriver(request, match) {
  const driver = request.store.driver(request.workspaceId, match[2]);
  if (!driver) return renderSetup(request, 404, { failed: { error: { message: 'There is no such driver here.' } } });
  const base = request.space.base;
  return page(request, 200, confirmPage(request, {
    title: `Delete ${driver.name}?`,
    text: 'Their laps stay on the board as "former driver", and their transponders become unassigned.',
    action: `${base}/drivers/${driver.id}/delete`,
    button: 'Delete',
    back: `${base}/setup#drivers`,
  }));
}

const deleteDriver = withForm((request, _form, match) => afterForm(request, ops.deleteDriver(request, { id: match[2] }), { key: 'delete', values: {}, section: 'drivers' }));

const assignTransponder = withForm((request, form, match) => {
  const driver = form.get('driver') ?? '';
  const code = match[2].toUpperCase();
  return afterForm(request, ops.assignTransponder(request, { code, driverId: driver === '' ? null : driver }), { key: `transponder:${code}`, values: { driver }, section: 'transponders', fieldId: `transponder-${code}` });
});

const write = { write: true };

/** @type {any[]} Task 6 adds the track, decoder and watchers-link routes here. */
export const setupPageRoutes = [
  { pattern: spacePath('setup'), credentials: true, methods: { GET: pageRoute('timing.run', (request) => renderSetup(request, 200)) } },
  { pattern: spacePath('drivers'), credentials: true, methods: { POST: pageRoute('timing.setup', addDriver, write) } },
  { pattern: spacePath('drivers/([^/]+)'), credentials: true, methods: { POST: pageRoute('timing.setup', renameDriver, write) } },
  { pattern: spacePath('drivers/([^/]+)/delete'), credentials: true, methods: { GET: pageRoute('timing.delete', askDeleteDriver), POST: pageRoute('timing.delete', deleteDriver, write) } },
  { pattern: spacePath('transponders/([0-9A-Fa-f]{1,16})'), credentials: true, methods: { POST: pageRoute('timing.setup', assignTransponder, write) } },
];
