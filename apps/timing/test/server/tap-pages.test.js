// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let office;
let base;
let ana;

before(async () => {
  app = await startTiming({ clock });
  const user = await app.signUp('Ana');
  office = app.club(user, 'Office');
  member = await app.login(user);
  base = `/clubs/${office.id}`;
  await app.form(member, `${base}/drivers`, { name: 'Ana' });
  [ana] = app.store.drivers(office.id);
});
after(() => app.close());

const get = (path) => app.api(member, 'GET', path, undefined, { accept: 'text/html' });

test('a tile per driver, each its own form', async () => {
  const body = await (await get(`${base}/tap`)).text();
  assert.match(body, new RegExp(`<form method="post" action="${base}/tap" class="tap-form">\\s*<input type="hidden" name="driver" value="${ana.id}">\\s*<button type="submit" class="tap-tile"[^>]*>Ana</button>`));
  assert.match(body, /<script type="module" src="\/public\/tap.js"><\/script>/);
});

test('a tap is a post and a redirect that says what it did', async () => {
  let res = await app.form(member, `${base}/tap`, { driver: ana.id });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/tap?driver=${ana.id}&result=started`);
  assert.match(await (await get(res.headers.get('location'))).text(), /role="status"[^>]*>Ana: started</);
  clock.now += 8412;
  res = await app.form(member, `${base}/tap`, { driver: ana.id });
  assert.equal(res.headers.get('location'), `${base}/tap?driver=${ana.id}&result=lap&ms=8412`);
  assert.match(await (await get(res.headers.get('location'))).text(), />Ana: 8\.412</);
  res = await app.form(member, `${base}/tap`, { driver: ana.id });
  assert.equal(res.headers.get('location'), `${base}/tap?driver=${ana.id}&result=again`, 'the same millisecond');
});

test('asked for JSON, the same post answers in place', async () => {
  clock.now += 9000;
  const res = await app.form(member, `${base}/tap`, { driver: ana.id }, { accept: 'application/json' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { stored: true, lapMs: 9000, text: 'Ana: 9.000' });
});

test('a failed tap comes back as the page with an alert, status 422', async () => {
  const bad = await app.form(member, `${base}/tap`, { driver: 'nobody' });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /<p class="status status-error" role="alert">/);
});

test('without drivers: a link to Setup and no tiles', async () => {
  const solo = await app.signUp('Solo');
  const login = await app.login(solo);
  const body = await (await app.api(login, 'GET', '/personal/tap', undefined, { accept: 'text/html' })).text();
  assert.match(body, /href="\/personal\/setup#drivers"/);
  assert.doesNotMatch(body, /tap-tile/);
});
