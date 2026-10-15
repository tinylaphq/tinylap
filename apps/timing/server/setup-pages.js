// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup's pages and forms (spec §3, §6.4). Every form posts to a resource
// URL and answers 303 to the setup section it changed; a failure renders the
// page again with the error and what was typed.
import { can, open, seal } from '@tinylap/auth';
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute, toPage } from './page-access.js';
import { page, seeOther } from './respond.js';
import { retryHeaders } from './responses.js';
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
  const headers = retryHeaders(result.error);
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

export const PAIRED_COOKIE = '__Host-tl-paired';
const PAIRED_TTL_SECONDS = 300;
const PAIRED = new RegExp(`(?:^|;\\s*)${PAIRED_COOKIE}=([^;]+)`);
const clearPaired = `${PAIRED_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
const NO_SUCH_DECODER = { failed: { error: { message: 'There is no such decoder here.' } } };

/** GET setup: the page, and once after pairing, the new decoder's token. */
function showSetup(request) {
  const id = request.url.searchParams.get('paired');
  const raw = PAIRED.exec(String(request.req.headers.cookie ?? ''))?.[1];
  if (!id || !raw || !request.keys) return renderSetup(request, 200);
  let paired = null;
  try {
    const value = JSON.parse(open(request.keys, decodeURIComponent(raw), 'paired'));
    const decoder = request.store.decoder(value.id);
    const fresh = Number.isFinite(value.exp) && value.exp > request.now() && value.sub === request.userId;
    if (fresh && value.id === id && decoder?.workspaceId === request.workspaceId) paired = { id: value.id, name: decoder.name, token: value.token };
  } catch {
    // A tampered or stale cookie shows nothing.
  }
  return renderSetup(request, 200, { paired, headers: { 'Set-Cookie': [clearPaired] } });
}

const setTrack = withForm(async (request, form) => {
  const values = { link: form.get('link') ?? '', name: form.get('name') ?? '', direction: form.get('direction') ?? '' };
  // A blank name is "use the default" on a form; the operation only takes a missing one.
  const result = await ops.setTrack(request, { ...values, name: values.name || undefined });
  return afterForm(request, result, { key: 'track', values, section: 'track', fieldId: result.error?.field ? `track-${result.error.field}` : null });
});

const pairDecoder = withForm((request, form) => {
  const values = { name: form.get('name') ?? '' };
  const result = ops.pairDecoder(request, { name: values.name || undefined });
  if (result.error) return afterForm(request, result, { key: 'pair', values, section: 'decoders', fieldId: 'pair-name' });
  const { id, token } = result.value;
  const sealed = encodeURIComponent(seal(request.keys, JSON.stringify({ id, token, sub: request.userId, exp: request.now() + PAIRED_TTL_SECONDS * 1000 }), 'paired'));
  return seeOther(`${request.space.base}/setup?paired=${id}#decoders`, {
    'Set-Cookie': [`${PAIRED_COOKIE}=${sealed}; Path=/; Max-Age=${PAIRED_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`],
  });
});

function askUnpair(request, match) {
  const decoder = request.store.decoder(match[2]);
  if (!decoder || decoder.workspaceId !== request.workspaceId) return renderSetup(request, 404, NO_SUCH_DECODER);
  const base = request.space.base;
  return page(request, 200, confirmPage(request, {
    title: `Unpair ${decoder.name}?`,
    text: 'Its token stops working at once. Its passings stay.',
    action: `${base}/decoders/${decoder.id}/unpair`,
    button: 'Unpair',
    back: `${base}/setup#decoders`,
  }));
}

const unpair = withForm((request, _form, match) => afterForm(request, ops.unpairDecoder(request, { id: match[2] }), { key: 'pair', values: {}, section: 'decoders' }));

const makeWatchLink = withForm((request) => afterForm(request, ops.rotateWatchLink(request), { key: 'watchers', values: {}, section: 'watchers' }));

function askNewWatchLink(request) {
  const base = request.space.base;
  if (!request.store.workspace(request.workspaceId).watchToken) return seeOther(`${base}/setup#watchers`);
  return page(request, 200, confirmPage(request, {
    title: 'Make a new watchers link?',
    text: 'The old link stops working, and anyone watching with it is cut off.',
    action: `${base}/watch-link`,
    button: 'Make a new link',
    back: `${base}/setup#watchers`,
  }));
}

const write = { write: true };

export const setupPageRoutes = [
  { pattern: spacePath('setup'), credentials: true, methods: { GET: pageRoute('timing.run', showSetup) } },
  { pattern: spacePath('drivers'), credentials: true, methods: { GET: toPage('setup#drivers'), POST: pageRoute('timing.setup', addDriver, write) } },
  { pattern: spacePath('drivers/([^/]+)'), credentials: true, methods: { GET: toPage('setup#drivers'), POST: pageRoute('timing.setup', renameDriver, write) } },
  { pattern: spacePath('drivers/([^/]+)/delete'), credentials: true, methods: { GET: pageRoute('timing.delete', askDeleteDriver), POST: pageRoute('timing.delete', deleteDriver, write) } },
  { pattern: spacePath('transponders/([0-9A-Fa-f]{1,16})'), credentials: true, methods: { GET: toPage('setup#transponders'), POST: pageRoute('timing.setup', assignTransponder, write) } },
  { pattern: spacePath('track'), credentials: true, methods: { GET: toPage('setup#track'), POST: pageRoute('timing.setup', setTrack, write) } },
  { pattern: spacePath('decoders'), credentials: true, methods: { GET: toPage('setup#decoders'), POST: pageRoute('timing.setup', pairDecoder, write) } },
  { pattern: spacePath('decoders/([^/]+)/unpair'), credentials: true, methods: { GET: pageRoute('timing.delete', askUnpair), POST: pageRoute('timing.delete', unpair, write) } },
  { pattern: spacePath('watch-link'), credentials: true, methods: { GET: toPage('setup#watchers'), POST: pageRoute('timing.setup', makeWatchLink, write) } },
  { pattern: spacePath('watch-link/new'), credentials: true, methods: { GET: pageRoute('timing.setup', askNewWatchLink) } },
];
