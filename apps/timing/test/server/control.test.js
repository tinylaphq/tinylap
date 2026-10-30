// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let member;
let office;
let ana;
let ben;
const path = (rest) => `/workspaces/${office.id}/${rest}`;

before(async () => {
  app = await startTiming();
  const owner = await app.signUp('Ana');
  office = app.club(owner, 'Office');
  member = await app.login(owner);
  ana = await (await app.api(member, 'POST', path('drivers'), { name: 'Ana' })).json();
  ben = await (await app.api(member, 'POST', path('drivers'), { name: 'Ben' })).json();
});
after(() => app.close());

const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal((await res.json()).type, `${app.base}/problems/${name}`);
};

test('bad session requests say what is wrong', async () => {
  const bad = (body) => app.api(member, 'POST', path('sessions'), body);
  await problemOf(await bad({ kind: 'lap' }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'practice', replace: 'yes' }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [] }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [ana.id, ana.id] }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: ['nobody'] }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [ana.id], durationSeconds: 5 }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [ana.id], countdownSeconds: 31 }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [ana.id], durationSeconds: null }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [ana.id], countdownSeconds: null }), 422, 'invalid-request');
});

test('start, list, read and abort a race; one at a time', async () => {
  const res = await app.api(member, 'POST', path('sessions'), { kind: 'race', roster: [ana.id, ben.id], durationSeconds: 120, countdownSeconds: 5 });
  assert.equal(res.status, 201);
  const race = await res.json();
  assert.deepEqual([race.kind, race.state, race.roster, race.durationMs, race.closesAt - race.opensAt], ['race', 'countdown', [ana.id, ben.id], 120_000, 120_000]);
  assert.equal('workspaceId' in race, false);
  await problemOf(await app.api(member, 'POST', path('sessions'), { kind: 'qualifying', roster: [ana.id] }), 409, 'conflict');
  const { sessions } = await (await app.api(member, 'GET', path('sessions?limit=5'))).json();
  assert.equal(sessions[0].id, race.id);
  const detail = await (await app.api(member, 'GET', path(`sessions/${race.id}`))).json();
  assert.deepEqual(detail.standings.map((s) => s.driverId).sort(), [ana.id, ben.id].sort());
  assert.equal((await (await app.api(member, 'POST', path(`sessions/${race.id}/abort`))).json()).state, 'aborted');
  await problemOf(await app.api(member, 'POST', path(`sessions/${race.id}/abort`)), 404, 'not-found');
  await problemOf(await app.api(member, 'GET', path('sessions/nope')), 404, 'not-found');
});

test('qualifying ignores the countdown', async () => {
  const q = await (await app.api(member, 'POST', path('sessions'), { kind: 'qualifying', roster: [ana.id], countdownSeconds: 10 })).json();
  assert.deepEqual([q.state, q.durationMs], ['running', 300_000]);
  await app.api(member, 'POST', path(`sessions/${q.id}/abort`));
});

test('a practice starts with no other field, is replaced on request, and is ended by hand', async () => {
  const start = (body) => app.api(member, 'POST', path('sessions'), body);
  const res = await start({ kind: 'practice', roster: ['ignored'], durationSeconds: 1 });
  assert.equal(res.status, 201);
  const practice = await res.json();
  assert.equal(practice.kind, 'practice');
  const refused = await start({ kind: 'practice' });
  await problemOf(refused.clone(), 409, 'conflict');
  const body = await refused.json();
  assert.equal(body.detail, 'A practice is already running here.');
  assert.equal(body.running.id, practice.id);
  const replaced = await start({ kind: 'qualifying', roster: [ana.id], replace: true });
  assert.equal(replaced.status, 201);
  const q = await replaced.json();
  const old = await (await app.api(member, 'GET', path(`sessions/${practice.id}`))).json();
  assert.equal(old.session.state, 'done');
  await problemOf(await app.api(member, 'POST', path(`sessions/${q.id}/end`)), 404, 'not-found');
  await app.api(member, 'POST', path(`sessions/${q.id}/abort`));
  const again = await (await start({ kind: 'practice' })).json();
  const ended = await app.api(member, 'POST', path(`sessions/${again.id}/end`));
  assert.equal(ended.status, 200);
  assert.equal((await ended.json()).state, 'done');
  await problemOf(await app.api(member, 'POST', path(`sessions/${again.id}/end`)), 404, 'not-found');
  await problemOf(await app.api(member, 'POST', path(`sessions/${again.id}/abort`)), 404, 'not-found');
});

test('two starts at once: one wins, one conflicts', async () => {
  const start = () => app.api(member, 'POST', path('sessions'), { kind: 'practice' });
  const results = await Promise.all([start(), start()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const won = await (results.find((r) => r.status === 201)).json();
  await app.api(member, 'POST', path(`sessions/${won.id}/end`));
});
