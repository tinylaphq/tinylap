// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';
import { tokenHash } from '../../server/setup.js';
import { CLOSED, OPEN, closed, startPlannerStub } from './planner-stub.js';

let app;
let planner;
let member;
let admin;
let stranger;
let office;
let path;

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ plannerUrl: planner.url, limits: { pair: 3 } });
  const [ana, ben, cy, zed] = await Promise.all(['Ana', 'Ben', 'Cy', 'Zed'].map((n) => app.signUp(n)));
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  app.join(ana, office.id, cy, 'admin');
  // Serial on purpose, see `login` in helpers.js.
  member = await app.login(ben); admin = await app.login(cy); stranger = await app.login(zed);
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
  // The limit is 3 per hour here; the test above used one.
  assert.equal((await app.api(member, 'POST', path('decoders'), {})).status, 201);
  assert.equal((await app.api(member, 'POST', path('decoders'), {})).status, 201);
  const res = await app.api(member, 'POST', path('decoders'), {});
  await problemOf(res, 429, 'rate-limited');
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

test('the current track comes from a planner link', async () => {
  const res = await app.api(member, 'PUT', path('track'), { link: `${planner.url}/layouts/${CLOSED}`, name: 'Office loop', direction: 'cw' });
  assert.deepEqual(await res.json(), { id: closed.track.id, name: 'Office loop', direction: 'cw', snapshotKey: CLOSED });
  const snapshot = await (await app.api(member, 'GET', `/workspaces/${office.id}`)).json();
  assert.deepEqual([snapshot.track, snapshot.direction], [{ id: closed.track.id, name: 'Office loop' }, 'cw']);
  await problemOf(await app.api(member, 'PUT', path('track'), { link: `${planner.url}/layouts/${OPEN}`, direction: 'cw' }), 422, 'not-a-circuit');
  await problemOf(await app.api(member, 'PUT', path('track'), { link: `${planner.url}/layouts/${CLOSED}`, direction: 'up' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'PUT', path('track'), { link: 'https://elsewhere.example/layouts/x', direction: 'cw' }), 422, 'invalid-request');
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
