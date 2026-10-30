// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';
import { tokenHash } from '../../server/setup.js';
import { CLOSED, OPEN, OTHER, startPlannerStub } from './planner-stub.js';

let app;
let planner;
let member;
let admin;
let stranger;
let office;
let path;

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ plannerUrl: planner.url, limits: { pair: 4 } });
  const [ana, ben, cy, zed] = await Promise.all(['Ana', 'Ben', 'Cy', 'Zed'].map((n) => app.signUp(n)));
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  app.join(ana, office.id, cy, 'admin');
  [member, admin, stranger] = await Promise.all([ben, cy, zed].map((u) => app.login(u)));
  path = (rest) => `/workspaces/${office.id}/${rest}`;
});
after(async () => {
  await app.close();
  await planner.close();
});

const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal((await res.json()).type, `${app.base}/problems/${name}`);
};

test('members add, rename and list drivers', async () => {
  const res = await app.api(member, 'POST', path('drivers'), { name: '  Ana  ' });
  assert.equal(res.status, 201);
  const ana = await res.json();
  assert.deepEqual([ana.name, ana.colour], ['Ana', '#ff2d9b']);
  const second = await (await app.api(member, 'POST', path('drivers'), { name: 'Ben', colour: '#ABCDEF' })).json();
  assert.equal(second.colour, '#abcdef');
  const renamed = await (await app.api(member, 'PATCH', path(`drivers/${ana.id}`), { name: 'Ana P.' })).json();
  assert.deepEqual([renamed.name, renamed.colour], ['Ana P.', '#ff2d9b']);
  const { drivers } = await (await app.api(member, 'GET', path('drivers'))).json();
  assert.deepEqual(drivers.map((d) => d.name), ['Ana P.', 'Ben']);
});

test('bad driver input, strangers and cross-origin writes are refused', async () => {
  await problemOf(await app.api(member, 'POST', path('drivers'), { name: '' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'POST', path('drivers'), { name: 'x'.repeat(61) }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'POST', path('drivers'), { name: 'C', colour: 'red' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'PATCH', path('drivers/nope'), { name: 'X' }), 404, 'not-found');
  await problemOf(await app.api(stranger, 'POST', path('drivers'), { name: 'Z' }), 404, 'not-found');
  await problemOf(await app.api(member, 'POST', path('drivers'), { name: 'Z' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), 403, 'forbidden');
});

test('assigning a transponder; deleting its driver unassigns it', async () => {
  const cy = await (await app.api(member, 'POST', path('drivers'), { name: 'Cy' })).json();
  const put = await app.api(member, 'PUT', path('transponders/4a1f'), { driverId: cy.id });
  assert.deepEqual(await put.json(), { code: '4A1F', driverId: cy.id });
  await problemOf(await app.api(member, 'PUT', path('transponders/zz'), { driverId: cy.id }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'PUT', path('transponders/4a1f'), { driverId: 'nobody' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'DELETE', path(`drivers/${cy.id}`)), 403, 'forbidden');
  assert.equal((await app.api(admin, 'DELETE', path(`drivers/${cy.id}`))).status, 204);
  const { transponders } = await (await app.api(member, 'GET', path('transponders'))).json();
  assert.deepEqual(transponders.map((t) => [t.code, t.driverId]), [['4A1F', null]]);
  await problemOf(await app.api(admin, 'DELETE', path(`drivers/${cy.id}`)), 404, 'not-found');
});

test('pairing a decoder answers its token once', async () => {
  await problemOf(await app.api(member, 'POST', path('decoders'), { name: '' }), 422, 'invalid-request');
  const res = await app.api(member, 'POST', path('decoders'), { name: 'Start line' });
  assert.equal(res.status, 201);
  const decoder = await res.json();
  assert.match(decoder.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(app.store.decoderByTokenHash(decoder.token), null, 'only a hash is stored');
  assert.deepEqual(app.store.decoderByTokenHash(tokenHash(decoder.token)), { id: decoder.id, workspaceId: office.id });
  const { decoders } = await (await app.api(member, 'GET', path('decoders'))).json();
  assert.deepEqual(decoders.map((d) => [d.id, d.name, 'token' in d]), [[decoder.id, 'Start line', false]]);
  await problemOf(await app.api(member, 'DELETE', path(`decoders/${decoder.id}`)), 403, 'forbidden');
  assert.equal((await app.api(admin, 'DELETE', path(`decoders/${decoder.id}`))).status, 204);
  assert.equal(app.store.decoderByTokenHash(tokenHash(decoder.token)), null);
});

test('pairing is rate limited per member', async () => {
  // The limit is 4 per hour here; the test above used two (one refused for its name).
  assert.equal((await app.api(member, 'POST', path('decoders'), {})).status, 201);
  assert.equal((await app.api(member, 'POST', path('decoders'), {})).status, 201);
  const res = await app.api(member, 'POST', path('decoders'), {});
  await problemOf(res, 429, 'rate-limited');
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

test('members add, list, rename, archive and restore tracks', async () => {
  const res = await app.api(member, 'POST', path('tracks'), { name: ' Home ', link: `${planner.url}/layouts/${CLOSED}` });
  assert.equal(res.status, 201);
  const home = await res.json();
  assert.deepEqual([home.name, home.archived, home.current, home.layout.snapshotKey], ['Home', false, false, CLOSED]);
  const bare = await (await app.api(member, 'POST', path('tracks'), { name: 'Bare' })).json();
  assert.equal(bare.layout, null);
  await problemOf(await app.api(member, 'POST', path('tracks'), { name: 'home' }), 409, 'conflict');
  await problemOf(await app.api(member, 'POST', path('tracks'), { name: '' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'POST', path('tracks'), { name: 'Open', link: `${planner.url}/layouts/${OPEN}` }), 422, 'not-a-circuit');
  const renamed = await (await app.api(member, 'PATCH', path(`tracks/${bare.id}`), { name: 'Garage' })).json();
  assert.equal(renamed.name, 'Garage');
  const archived = await (await app.api(member, 'PATCH', path(`tracks/${bare.id}`), { archived: true })).json();
  assert.equal(archived.archived, true);
  const names = async (query) => (await (await app.api(member, 'GET', path(`tracks${query}`))).json()).tracks.map((t) => t.name);
  assert.ok(!(await names('')).includes('Garage'));
  assert.ok((await names('?archived=1')).includes('Garage'));
  assert.equal((await (await app.api(member, 'PATCH', path(`tracks/${bare.id}`), { archived: false })).json()).archived, false);
  await problemOf(await app.api(member, 'PATCH', path('tracks/nope'), { name: 'X' }), 404, 'not-found');
  await problemOf(await app.api(member, 'PATCH', path(`tracks/${bare.id}`), {}), 422, 'invalid-request');
  await problemOf(await app.api(member, 'PATCH', path(`tracks/${bare.id}`), { archived: 'yes' }), 422, 'invalid-request');
});

test('a layout is attached once, and a different planner track needs a confirmation', async () => {
  const track = await (await app.api(member, 'POST', path('tracks'), { name: 'Attach' })).json();
  const url = path(`tracks/${track.id}/layouts`);
  const first = await app.api(member, 'POST', url, { link: `${planner.url}/layouts/${CLOSED}` });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).layout.snapshotKey, CLOSED);
  assert.equal((await app.api(member, 'POST', url, { link: `${planner.url}/layouts/${CLOSED}` })).status, 200);
  const refused = await app.api(member, 'POST', url, { link: `${planner.url}/layouts/${OTHER}` });
  await problemOf(refused.clone(), 409, 'conflict');
  assert.equal((await refused.json()).current.snapshotKey, CLOSED);
  const confirmed = await app.api(member, 'POST', url, { link: `${planner.url}/layouts/${OTHER}`, confirm: true });
  assert.equal(confirmed.status, 201);
  assert.equal((await confirmed.json()).layout.snapshotKey, OTHER);
  await problemOf(await app.api(member, 'POST', url, { link: `${planner.url}/layouts/${OPEN}` }), 422, 'not-a-circuit');
  await problemOf(await app.api(member, 'POST', path('tracks/nope/layouts'), { link: `${planner.url}/layouts/${CLOSED}` }), 404, 'not-found');
});

test('a track is deleted only when archived, and the current track is set by id', async () => {
  const track = await (await app.api(member, 'POST', path('tracks'), { name: 'Doomed' })).json();
  await problemOf(await app.api(admin, 'DELETE', path(`tracks/${track.id}`)), 409, 'conflict');
  await app.api(member, 'PATCH', path(`tracks/${track.id}`), { archived: true });
  await problemOf(await app.api(member, 'DELETE', path(`tracks/${track.id}`)), 403, 'forbidden');
  assert.equal((await app.api(admin, 'DELETE', path(`tracks/${track.id}`))).status, 204);
  await problemOf(await app.api(admin, 'DELETE', path(`tracks/${track.id}`)), 404, 'not-found');

  const home = (await (await app.api(member, 'GET', path('tracks'))).json()).tracks.find((t) => t.name === 'Home');
  const res = await app.api(member, 'PUT', path('track'), { trackId: home.id, direction: 'cw' });
  assert.equal(res.status, 200);
  const set = await res.json();
  assert.deepEqual([set.track.id, set.track.current, set.direction], [home.id, true, 'cw']);
  const snapshot = await (await app.api(member, 'GET', `/workspaces/${office.id}`)).json();
  assert.deepEqual([snapshot.track, snapshot.direction], [{ id: home.id, name: 'Home' }, 'cw']);
  await problemOf(await app.api(admin, 'DELETE', path(`tracks/${home.id}`)), 409, 'conflict');
  await problemOf(await app.api(member, 'PUT', path('track'), { trackId: home.id, direction: 'up' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'PUT', path('track'), { trackId: 'nope', direction: 'cw' }), 404, 'not-found');
});

test('strangers and cross-origin writes are refused on tracks', async () => {
  const evil = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };
  await problemOf(await app.api(stranger, 'GET', path('tracks')), 404, 'not-found');
  await problemOf(await app.api(stranger, 'POST', path('tracks'), { name: 'Z' }), 404, 'not-found');
  await problemOf(await app.api(stranger, 'PUT', path('track'), { trackId: 'x', direction: 'cw' }), 404, 'not-found');
  await problemOf(await app.api(member, 'POST', path('tracks'), { name: 'Z' }, evil), 403, 'forbidden');
  await problemOf(await app.api(admin, 'DELETE', path('tracks/x'), undefined, evil), 403, 'forbidden');
});

test('a new watchers token replaces the old one', async () => {
  assert.deepEqual(await (await app.api(member, 'GET', path('watch-token'))).json(), { token: null });
  const first = (await (await app.api(member, 'POST', path('watch-token'))).json()).token;
  const second = (await (await app.api(member, 'POST', path('watch-token'))).json()).token;
  assert.match(first, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(first, second);
  assert.equal(app.store.workspaceByWatchToken(first), null);
  assert.equal(app.store.workspaceByWatchToken(second), office.id);
});

test('names with control characters are refused for drivers, tracks and decoders', async () => {
  for (const name of ['A\rB', 'A\nB', 'A\u0000B', 'A\u007fB']) {
    await problemOf(await app.api(member, 'POST', path('drivers'), { name }), 422, 'invalid-request');
    await problemOf(await app.api(member, 'POST', path('tracks'), { name }), 422, 'invalid-request');
  }
  const ok = await (await app.api(member, 'POST', path('drivers'), { name: 'Ctl' })).json();
  await problemOf(await app.api(member, 'PATCH', path(`drivers/${ok.id}`), { name: 'Ctl\r\nevent: x' }), 422, 'invalid-request');
  await problemOf(await app.api(admin, 'POST', path('decoders'), { name: 'Gate\r' }), 422, 'invalid-request');
  assert.ok(app.store.drivers(office.id).every((d) => ![...d.name].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)));
});
