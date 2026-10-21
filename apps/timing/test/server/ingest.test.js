// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let stranger;
let office;
let gate;
let spare;
let ana;

before(async () => {
  app = await startTiming({ clock, limits: { ingest: 5 } });
  const [owner, zed] = await Promise.all(['Ana', 'Zed'].map((n) => app.signUp(n)));
  office = app.club(owner, 'Office');
  app.club(zed, 'Elsewhere');
  member = await app.login(owner);
  stranger = await app.login(zed);
  const pair = async (name) => (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name })).json();
  gate = await pair('Gate');
  spare = await pair('Spare');
  ana = await (await app.api(member, 'POST', `/workspaces/${office.id}/drivers`, { name: 'Ana' })).json();
});
after(() => app.close());

const batch = { boot: 'b00tb00t', passings: [{ transponder: '0a', t: 1000 }, { transponder: '0A', t: 9000 }] };
const asDecoder = (decoder, token, body = batch, headers = {}) => fetch(`${app.base}/decoders/${decoder}/passings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
  body: JSON.stringify(body),
});
const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal((await res.json()).type, `${app.base}/problems/${name}`);
};

test('a decoder posts with its token; the same batch through the bridge is a duplicate', async () => {
  const net = await asDecoder(gate.id, gate.token);
  assert.equal(net.status, 200);
  assert.deepEqual(await net.json(), { stored: 2, duplicates: 0, through: 9000 });
  const serial = await app.api(member, 'POST', `/decoders/${gate.id}/passings`, batch);
  assert.deepEqual(await serial.json(), { stored: 0, duplicates: 2, through: 9000 });
  const snapshot = await (await app.api(member, 'GET', `/workspaces/${office.id}`)).json();
  assert.deepEqual(snapshot.crossings.map((c) => [c.transponder, c.lapMs, c.via]), [['0A', 8000, 'net'], ['0A', null, 'net']]);
  assert.deepEqual(snapshot.unknown, ['0A']);
});

test('wrong, foreign, malformed and revoked tokens are refused', async () => {
  await problemOf(await asDecoder(gate.id, 'x'.repeat(43)), 401, 'unauthorized');
  await problemOf(await asDecoder(gate.id, spare.token), 401, 'unauthorized');
  await problemOf(await asDecoder(gate.id, gate.token, batch, { authorization: 'Basic abc' }), 401, 'unauthorized');
  const temp = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, {})).json();
  assert.equal((await app.api(member, 'DELETE', `/workspaces/${office.id}/decoders/${temp.id}`)).status, 204);
  await problemOf(await asDecoder(temp.id, temp.token), 401, 'unauthorized');
});

test('the bridge path needs a member of the decoder\'s workspace, from the app', async () => {
  // Signed out or not allowed may change with the next sign-in, so the bridge keeps the passings: 401 and 403.
  await problemOf(await app.api(null, 'POST', `/decoders/${gate.id}/passings`, batch), 401, 'unauthorized');
  await problemOf(await app.api(null, 'POST', '/decoders/nope/passings', batch), 401, 'unauthorized');
  await problemOf(await app.api(stranger, 'POST', `/decoders/${gate.id}/passings`, batch), 403, 'forbidden');
  await problemOf(await app.api(member, 'POST', `/decoders/${gate.id}/passings`, batch, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), 403, 'forbidden');
  await problemOf(await app.api(member, 'POST', '/decoders/nope/passings', batch, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), 403, 'forbidden');
  // A decoder that doesn't exist (never paired, or removed) never will: 404, and the bridge drops them.
  await problemOf(await app.api(member, 'POST', '/decoders/nope/passings', batch), 404, 'not-found');
  const temp = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, {})).json();
  assert.equal((await app.api(member, 'DELETE', `/workspaces/${office.id}/decoders/${temp.id}`)).status, 204);
  await problemOf(await app.api(member, 'POST', `/decoders/${temp.id}/passings`, batch), 404, 'not-found');
});

test('bad batches are refused whole', async () => {
  await problemOf(await asDecoder(spare.id, spare.token, { boot: 'x', passings: [{ transponder: '0A', t: 1 }] }), 422, 'invalid-request');
  await problemOf(await asDecoder(spare.id, spare.token, { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1 }, { transponder: 'q', t: 2 }] }), 422, 'invalid-request');
  assert.equal(app.store.through(spare.id, 'b00tb00t'), null, 'nothing of a bad batch is stored');
  const text = await fetch(`${app.base}/decoders/${spare.id}/passings`, { method: 'POST', headers: { authorization: `Bearer ${spare.token}`, 'content-type': 'text/plain' }, body: 'hi' });
  await problemOf(text, 415, 'unsupported-media-type');
});

test('ingest is rate limited per decoder', async () => {
  // The limit is 5 per minute here; the spare decoder has used 3.
  assert.equal((await asDecoder(spare.id, spare.token)).status, 200);
  assert.equal((await asDecoder(spare.id, spare.token)).status, 200);
  const res = await asDecoder(spare.id, spare.token);
  await problemOf(res, 429, 'rate-limited');
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

test('tap entry times a driver by hand', async () => {
  const tap = () => app.api(member, 'POST', `/workspaces/${office.id}/tap`, { driverId: ana.id });
  assert.deepEqual(await (await tap()).json(), { stored: true, lapMs: null });
  clock.now += 8000;
  assert.deepEqual(await (await tap()).json(), { stored: true, lapMs: 8000 });
  assert.deepEqual(await (await tap()).json(), { stored: false, lapMs: null }, 'the same millisecond');
  await problemOf(await app.api(member, 'POST', `/workspaces/${office.id}/tap`, { driverId: 'nobody' }), 422, 'invalid-request');
  await problemOf(await app.api(stranger, 'POST', `/workspaces/${office.id}/tap`, { driverId: ana.id }), 404, 'not-found');
});
