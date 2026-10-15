// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, startTiming } from './helpers.js';
import { events, next } from './sse.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let stranger;
let office;
let ana;
const path = (rest) => `/workspaces/${office.id}${rest}`;

before(async () => {
  app = await startTiming({ clock });
  const [owner, zed] = await Promise.all(['Ana', 'Zed'].map((n) => app.signUp(n)));
  office = app.club(owner, 'Office');
  member = await app.login(owner);
  stranger = await app.login(zed);
  ana = await (await app.api(member, 'POST', path('/drivers'), { name: 'Ana' })).json();
});
after(() => app.close());

const tap = async () => {
  clock.now += 8000;
  await app.api(member, 'POST', path('/tap'), { driverId: ana.id });
};

test('a member stream starts with a snapshot and carries crossings', async () => {
  const res = await app.api(member, 'GET', path('/live'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  const it = events(res);
  const first = await next(it);
  assert.equal(first.type, 'snapshot');
  assert.deepEqual(first.data.drivers.map((d) => d.name), ['Ana']);
  await tap();
  const crossing = await next(it, 'crossing');
  assert.equal(crossing.data.driverId, ana.id);
  await it.return();
});

test('a reconnect with Last-Event-ID gets only what it missed', async () => {
  const res = await app.api(member, 'GET', path('/live'));
  const it = events(res);
  const snapshot = await next(it);
  await it.return();
  await tap();
  const again = await app.api(member, 'GET', path('/live'), undefined, { 'last-event-id': String(snapshot.id) });
  const replay = events(again);
  const first = await next(replay);
  assert.notEqual(first.type, 'snapshot');
  assert.ok(first.id > snapshot.id);
  await replay.return();
});

test('live streams need a member', async () => {
  assert.equal((await app.api(null, 'GET', path('/live'))).status, 401);
  assert.equal((await app.api(stranger, 'GET', path('/live'))).status, 404);
});

test('watchers: a snapshot and a stream without setup, ended by rotating the link', async () => {
  const { token } = await (await app.api(member, 'POST', path('/watch-token'))).json();
  const snapshot = await (await fetch(`${app.base}/watch/${token}`)).json();
  assert.equal('unknown' in snapshot, false);
  const res = await fetch(`${app.base}/watch/${token}/live`);
  assert.equal(res.status, 200);
  const it = events(res);
  assert.equal((await next(it)).type, 'snapshot');
  await tap();
  const crossing = await next(it, 'crossing');
  assert.equal('transponder' in crossing.data, false);
  await app.api(member, 'POST', path('/watch-token'));
  assert.equal(await next(it, 'ended'), null, 'the old stream ends');
  assert.equal((await fetch(`${app.base}/watch/${token}`)).status, 404);
  assert.equal((await fetch(`${app.base}/watch/${token}/live`)).status, 404);
});

test('unknown API paths answer a problem', async () => {
  const res = await fetch(`${app.base}/workspaces/${office.id}/nothing`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
});

test('the request log never holds a watchers token', async () => {
  const lines = [];
  const server = await startServer({ log: (line) => lines.push(line) });
  const token = 'w'.repeat(32);
  try {
    await (await fetch(`${server.base}/watch/${token}`)).arrayBuffer();
    await (await fetch(`${server.base}/watch/${token}/live`)).arrayBuffer();
  } finally {
    await server.close();
  }
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^GET \/watch\/… \d{3} \d+ms$/);
  assert.match(lines[1], /^GET \/watch\/…\/live \d{3} \d+ms$/);
  assert.ok(lines.every((line) => !line.includes(token)));
});
