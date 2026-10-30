// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup's pages and forms (spec §3, §6.4). Every form posts to a resource
// URL and answers 303 to the setup section it changed; a failure renders the
// page again with the error and what was typed.
import { can, open, seal } from '@tinylap/auth';
import { displayName } from './auth.js';
import * as ops from './operations.js';
import { readForm } from './form.js';
import { pageRoute, toPage } from './page-access.js';
import { page, seeOther } from './respond.js';
import { retryHeaders } from './responses.js';
import { spacePath } from './spaces.js';
import { changeLayoutPage, confirmPage } from './views/confirm.js';
import { notFoundPage } from './views/notice.js';
import { setupPage } from './views/setup.js';
import { trackPage } from './views/track.js';

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
    track: request.store.track(ws, workspace.trackId),
    tracks: request.store.tracks(ws, { archived: false }),
    archived: request.store.tracks(ws, { archived: true }),
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

// The track list (named tracks spec §3.3–3.5). A name in use is a mistake in
// the form, so it answers 422 like any other bad input, not the API's 409.
const asForm = (result) => (result.error?.problem === 'conflict' && result.error.field ? { error: { ...result.error, status: 422 } } : result);
const trackForm = (request, result, key, values, fieldIds = {}) => afterForm(request, asForm(result), { key, values, section: 'track', fieldId: fieldIds[result.error?.field] ?? null });
const by = async (request) => ({ userId: request.userId, name: await displayName(request) });

const addTrack = withForm(async (request, form) => {
  const values = { name: form.get('name') ?? '', link: form.get('link') ?? '' };
  // An empty link is no layout; the name is always the member's.
  const result = await ops.addTrack(request, { name: values.name, link: values.link.trim() === '' ? undefined : values.link, by: await by(request) });
  return trackForm(request, result, 'add-track', values, { name: 'add-track-name', link: 'add-track-link' });
});

const renameTrack = withForm((request, form, match) => {
  const values = { name: form.get('name') ?? '' };
  return trackForm(request, ops.renameTrack(request, { id: match[2], name: values.name }), `track-rename:${match[2]}`, values, { name: `track-name-${match[2]}` });
});

// A different layout answers with the confirmation (§3.4), its link carried in both of its forms.
// Its "add as a new track" form posts here too (`as=new`), so a failure comes back to the confirmation.
const attachLayout = withForm(async (request, form, match) => {
  const values = { link: form.get('link') ?? '' };
  const confirmation = (status, extras = {}) => {
    const track = request.store.track(request.workspaceId, match[2]);
    if (!track) return renderSetup(request, 404, { failed: { error: { message: 'There is no such track here.' } } });
    return page(request, status, changeLayoutPage(request, { track, link: values.link, back: `${request.space.base}/setup#track`, ...extras }));
  };
  if (form.get('as') === 'new') {
    const name = form.get('name') ?? '';
    const added = asForm(await ops.addTrack(request, { name, link: values.link, by: await by(request) }));
    if (!added.error) return seeOther(`${request.space.base}/setup#track`);
    return confirmation(added.error.status, { error: added.error, name });
  }
  const result = await ops.attachLayout(request, { id: match[2], link: values.link, confirm: form.get('confirm') === '1', by: await by(request) });
  if (result.error?.problem === 'conflict' && result.error.current) return confirmation(200);
  return trackForm(request, result, `track-layout:${match[2]}`, values, { link: `track-link-${match[2]}` });
});

// Make current, from the switch form or a track's own button.
const setTrack = withForm((request, form) => {
  const values = { id: form.get('id') ?? '', direction: form.get('direction') ?? '' };
  return trackForm(request, ops.setCurrentTrack(request, values), 'track', values, { direction: 'current-direction' });
});

const archiveTrack = withForm((request, _form, match) => trackForm(request, ops.archiveTrack(request, { id: match[2] }), `track-archive:${match[2]}`, {}));

const restoreTrack = withForm((request, _form, match) => trackForm(request, ops.restoreTrack(request, { id: match[2] }), `track-restore:${match[2]}`, {}));

function askDeleteTrack(request, match) {
  const track = request.store.track(request.workspaceId, match[2]);
  if (!track) return renderSetup(request, 404, { failed: { error: { message: 'There is no such track here.' } } });
  if (track.archivedAt === null) return renderSetup(request, 409, { failed: { error: { message: `Archive ${track.name} before deleting it.` } } });
  const base = request.space.base;
  const n = request.store.sessionCount(request.workspaceId, track.id);
  const sessions = n === 0 ? 'It has no sessions.' : n === 1 ? 'Its 1 session stays in the history, without a track.' : `Its ${n} sessions stay in the history, without a track.`;
  return page(request, 200, confirmPage(request, {
    title: `Delete ${track.name}?`,
    text: `Its records and layouts are removed. ${sessions}`,
    action: `${base}/tracks/${track.id}/delete`,
    button: 'Delete',
    back: `${base}/setup#track`,
  }));
}

const deleteTrack = withForm((request, _form, match) => trackForm(request, ops.deleteTrack(request, { id: match[2] }), `track-delete:${match[2]}`, {}));

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

/** A track's page: its layouts and its records in both directions. */
function showTrack(request, match) {
  const { store, workspaceId: ws } = request;
  const track = store.track(ws, match[2]);
  if (!track) return page(request, 404, notFoundPage(request));
  const workspace = store.workspace(ws);
  const records = Object.fromEntries(['ccw', 'cw'].map((d) => [d, store.recordHistory(ws, track.id, d)]));
  return page(request, 200, trackPage(request, {
    track,
    layouts: store.layouts(ws, track.id),
    current: workspace.trackId === track.id,
    direction: workspace.direction,
    records,
    drivers: store.drivers(ws),
    layoutOf: (at) => store.layoutAt(ws, track.id, at),
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
  { pattern: spacePath('tracks'), credentials: true, methods: { GET: toPage('setup#track'), POST: pageRoute('timing.setup', addTrack, write) } },
  { pattern: spacePath('tracks/([^/]+)'), credentials: true, methods: { GET: pageRoute('timing.run', showTrack), POST: pageRoute('timing.setup', renameTrack, write) } },
  { pattern: spacePath('tracks/([^/]+)/layout'), credentials: true, methods: { GET: toPage('setup#track'), POST: pageRoute('timing.setup', attachLayout, write) } },
  { pattern: spacePath('tracks/([^/]+)/archive'), credentials: true, methods: { GET: toPage('setup#track'), POST: pageRoute('timing.setup', archiveTrack, write) } },
  { pattern: spacePath('tracks/([^/]+)/restore'), credentials: true, methods: { GET: toPage('setup#track'), POST: pageRoute('timing.setup', restoreTrack, write) } },
  { pattern: spacePath('tracks/([^/]+)/delete'), credentials: true, methods: { GET: pageRoute('timing.delete', askDeleteTrack), POST: pageRoute('timing.delete', deleteTrack, write) } },
  { pattern: spacePath('decoders'), credentials: true, methods: { GET: toPage('setup#decoders'), POST: pageRoute('timing.setup', pairDecoder, write) } },
  { pattern: spacePath('decoders/([^/]+)/unpair'), credentials: true, methods: { GET: pageRoute('timing.delete', askUnpair), POST: pageRoute('timing.delete', unpair, write) } },
  { pattern: spacePath('watch-link'), credentials: true, methods: { GET: toPage('setup#watchers'), POST: pageRoute('timing.setup', makeWatchLink, write) } },
  { pattern: spacePath('watch-link/new'), credentials: true, methods: { GET: pageRoute('timing.setup', askNewWatchLink) } },
];
