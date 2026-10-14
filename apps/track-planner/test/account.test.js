// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAccount, loginHref } from '../js/account.js';

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('log-in off on this server: nothing to show', async () => {
  assert.deepEqual(await loadAccount({ fetch: reply(200, { loggedIn: false, available: false }) }), { state: 'off' });
});

test('logged out, logged in, and accounts down', async () => {
  assert.deepEqual(await loadAccount({ fetch: reply(200, { loggedIn: false, available: true }) }), { state: 'out' });
  const me = { loggedIn: true, available: true, user: { id: 'u', name: 'Michèle' }, workspaces: [], accountUrl: 'https://accounts.test/account' };
  assert.deepEqual(await loadAccount({ fetch: reply(200, me) }), { state: 'in', name: 'Michèle', accountUrl: 'https://accounts.test/account' });
  assert.equal((await loadAccount({ fetch: reply(200, { ...me, user: { id: 'u', name: null } }) })).name, 'Account', 'no name: a plain label');
  assert.deepEqual(await loadAccount({ fetch: reply(503, { title: 'x' }) }), { state: 'down' });
});

test('the planner server unreachable or answering oddly: nothing to show', async () => {
  assert.deepEqual(await loadAccount({ fetch: async () => { throw new TypeError('offline'); } }), { state: 'off' });
  assert.deepEqual(await loadAccount({ fetch: reply(404, {}) }), { state: 'off' });
});

test('/auth/me is asked for without caching, with the cookie', async () => {
  let seen;
  await loadAccount({ fetch: async (url, init) => { seen = { url, init }; return reply(200, { loggedIn: false, available: true })(); } });
  assert.equal(seen.url, '/auth/me');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(seen.init.credentials, 'same-origin');
});

test('logging in comes back to the current path and query', () => {
  assert.equal(loginHref({ pathname: '/', search: '?layout=abc' }), '/auth/login?returnTo=%2F%3Flayout%3Dabc');
  assert.equal(loginHref({ pathname: '/', search: '' }), '/auth/login?returnTo=%2F');
});
