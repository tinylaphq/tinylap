// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let owner;
let stranger;
let office;

before(async () => {
  app = await startTiming();
  const ana = await app.signUp('Ana');
  const zed = await app.signUp('Zed');
  office = app.club(ana, 'Office');
  owner = await app.login(ana);
  stranger = await app.login(zed);
});
after(() => app.close());

const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  assert.equal((await res.json()).type, `${app.base}/problems/${name}`);
};

test('who is logged in, with their workspaces', async () => {
  const out = await (await app.api(null, 'GET', '/auth/me')).json();
  assert.deepEqual(out, { loggedIn: false, available: true });
  const me = await (await app.api(owner, 'GET', '/auth/me')).json();
  assert.equal(me.loggedIn, true);
  assert.ok(me.workspaces.some((w) => w.id === office.id && w.role === 'owner'));
});

test('the workspace snapshot needs a member', async () => {
  await problemOf(await app.api(null, 'GET', `/workspaces/${office.id}`), 401, 'unauthorized');
  await problemOf(await app.api(stranger, 'GET', `/workspaces/${office.id}`), 404, 'not-found');
  const res = await app.api(owner, 'GET', `/workspaces/${office.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS on credentials routes');
  const snapshot = await res.json();
  assert.deepEqual([snapshot.session, snapshot.track?.name, snapshot.direction, snapshot.standings, snapshot.unknown], [null, 'Track', 'ccw', [], []]);
});
