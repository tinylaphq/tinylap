// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup forms, continued (spec §6.4): unpairing, which comes back to the
// Bridge, and the watchers link.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let owner;
let member;
let office;
let base;
let ana;
let ben;

before(async () => {
  app = await startTiming();
  ana = await app.signUp('Ana');
  ben = await app.signUp('Ben');
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  owner = await app.login(ana);
  member = await app.login(ben);
  base = `/clubs/${office.id}`;
});
after(() => app.close());

const get = (who, path, cookie = '') => app.api(who, 'GET', path, undefined, { accept: 'text/html', ...(cookie ? { cookie: `${who.jar.header()}; ${cookie}` } : {}) });

test('decoders live on the Bridge: a page load of decoders goes there, and Setup pairs none', async () => {
  const res = await get(member, `${base}/decoders`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/bridge`);
  assert.equal((await app.form(member, `${base}/decoders`, { name: 'Start line' })).status, 405);
  assert.deepEqual(app.store.decoders(office.id), []);
});

const addDecoder = async (name) => (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name })).json();

test('unpairing asks first and needs an admin', async () => {
  const decoder = await addDecoder('Start line');
  assert.equal((await get(member, `${base}/decoders/${decoder.id}/unpair`)).status, 403);
  const ask = await (await get(owner, `${base}/decoders/${decoder.id}/unpair`)).text();
  assert.match(ask, /<h1 class="cut-words" title="Unpair Start line\?">Unpair Start line\?<\/h1>/);
  assert.match(ask, new RegExp(`<a class="btn btn-outline" href="${base}/bridge">Cancel</a>`), 'the way back is the Bridge, where decoders live');
  const done = await app.form(owner, `${base}/decoders/${decoder.id}/unpair`, {});
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), `${base}/bridge`);
  assert.deepEqual(app.store.decoders(office.id), []);
  const again = await app.form(owner, `${base}/decoders/${decoder.id}/unpair`, {});
  assert.equal(again.status, 404);
  assert.equal((await get(owner, `${base}/decoders/${decoder.id}/unpair`)).status, 404);
});

test('the watchers link: make one, then replace it after confirming', async () => {
  assert.equal((await get(member, `${base}/watch-link/new`)).headers.get('location'), `${base}/setup#watchers`, 'nothing to replace yet');
  const made = await app.form(member, `${base}/watch-link`, {});
  assert.equal(made.status, 303);
  const first = app.store.workspace(office.id).watchToken;
  assert.match(first, /^[A-Za-z0-9_-]{22}$/);
  assert.match(await (await get(member, `${base}/setup`)).text(), new RegExp(`value="${app.base}/watch/${first}"[^>]*readonly`));
  const ask = await (await get(member, `${base}/watch-link/new`)).text();
  assert.match(ask, /The old link stops working/);
  await app.form(member, `${base}/watch-link`, {});
  assert.notEqual(app.store.workspace(office.id).watchToken, first);
});

test('forms from another site change nothing, as for the other setup forms', async () => {
  const foreign = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };
  const decoder = await addDecoder('Gate');
  const before = app.store.decoders(office.id).length;
  const token = app.store.workspace(office.id).watchToken;
  for (const path of [`${base}/decoders/${decoder.id}/unpair`, `${base}/watch-link`]) {
    const res = await app.form(owner, path, { name: 'Mallory' }, foreign);
    assert.equal(res.status, 403, path);
    assert.match(await res.text(), /<h1>Not allowed<\/h1>/, path);
  }
  assert.equal(app.store.decoders(office.id).length, before);
  assert.equal(app.store.workspace(office.id).watchToken, token);
});

test('a member cannot unpair a decoder', async () => {
  const [decoder] = app.store.decoders(office.id);
  const res = await app.form(member, `${base}/decoders/${decoder.id}/unpair`, {});
  assert.equal(res.status, 403);
  assert.ok(app.store.decoders(office.id).some((d) => d.id === decoder.id));
});
