// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pair again (bridge decoder home spec, Approaches): a decoder gets a new token
// and keeps its id; the old one works until the decoder uses the new one.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';
import { tokenHash } from '../../server/setup.js';

let app;
let member;
let stranger;
let office;
let path;

before(async () => {
  app = await startTiming({ limits: { pair: 50 } });
  const [ana, zed] = await Promise.all(['Ana', 'Zed'].map((n) => app.signUp(n)));
  office = app.club(ana, 'Office');
  app.club(zed, 'Elsewhere');
  [member, stranger] = await Promise.all([ana, zed].map((u) => app.login(u)));
  path = (rest) => `/workspaces/${office.id}/${rest}`;
});
after(() => app.close());

const batch = { boot: 'b00tb00t', passings: [{ transponder: '0a', t: 1000 }] };
const posts = async (decoder, token) => (await fetch(`${app.base}/decoders/${decoder}/passings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(batch),
})).status;
const pair = async (name) => (await app.api(member, 'POST', path('decoders'), { name })).json();
const newToken = (who, id) => app.api(who, 'POST', path(`decoders/${id}/token`), {});

test('a new token for a decoder keeps its id and name, and both tokens work until the new one is used', async () => {
  const old = await pair('Gate');
  const res = await newToken(member, old.id);
  assert.equal(res.status, 201);
  const next = await res.json();
  assert.equal(next.id, old.id);
  assert.match(next.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(next.token, old.token);
  assert.equal(app.store.decoder(old.id).name, 'Gate');
  assert.equal(await posts(old.id, old.token), 200);
  assert.equal(await posts(old.id, next.token), 200);
  assert.equal(await posts(old.id, old.token), 401, 'the new token used, the old one stops');
  assert.equal(await posts(old.id, next.token), 200);
});

test("a decoder's new token taken: only it works", async () => {
  const old = await pair('Start');
  const next = await (await newToken(member, old.id)).json();
  assert.equal((await app.api(member, 'POST', path(`decoders/${old.id}/token/taken`), { token: next.token })).status, 204);
  assert.equal(await posts(old.id, old.token), 401);
  assert.equal(await posts(old.id, next.token), 200);
});

test('a later Pair again replaces the pending token', async () => {
  const old = await pair('Pit');
  const first = await (await newToken(member, old.id)).json();
  const second = await (await newToken(member, old.id)).json();
  assert.equal(await posts(old.id, first.token), 401);
  assert.equal(await posts(old.id, old.token), 200);
  assert.equal(await posts(old.id, second.token), 200);
});

test("token/taken with another token is 422; another space's decoder is 404; so is a stranger's request", async () => {
  const old = await pair('Back');
  await newToken(member, old.id);
  assert.equal((await app.api(member, 'POST', path(`decoders/${old.id}/token/taken`), { token: old.token })).status, 422);
  assert.equal((await newToken(member, 'nope')).status, 404);
  assert.equal((await app.api(stranger, 'POST', path(`decoders/${old.id}/token`), {})).status, 404);
});

test("deleting a decoder removes its pending token", async () => {
  const old = await pair('Gone');
  const next = await (await newToken(member, old.id)).json();
  assert.ok(app.store.decoderByTokenHash(tokenHash(next.token)));
  assert.ok(app.store.deleteDecoder(office.id, old.id));
  assert.equal(app.store.decoderByTokenHash(tokenHash(next.token)), null);
});
