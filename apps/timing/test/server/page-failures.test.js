// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A page that can't be served says so as a page; the JSON API keeps Problem Details.
import test, { after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AuthError } from '@tinylap/auth';
import { startServer, startTiming } from './helpers.js';

const HTML = { accept: 'text/html' };

/** An issuer that is down, or a session lookup that blows up. */
const stubAuth = (error) => ({
  issuer: 'http://127.0.0.1:9',
  accountUrl: 'http://127.0.0.1:9/account',
  bff: { session: async () => { throw error; }, sessionId: () => null },
});

test('an issuer outage is a 503 page on a board page and JSON on the API', async () => {
  const server = await startServer({ auth: stubAuth(new AuthError('unavailable', 'down')) });
  try {
    for (const path of ['/', '/personal/board', '/personal/setup']) {
      const res = await fetch(server.base + path, { headers: HTML, redirect: 'manual' });
      assert.equal(res.status, 503, path);
      assert.match(res.headers.get('content-type'), /^text\/html/, path);
      assert.match(res.headers.get('content-security-policy'), /script-src 'self'/, path);
      assert.match(await res.text(), /<h1>Not available<\/h1>/, path);
    }
    const api = await fetch(`${server.base}/workspaces/w1/drivers`, { headers: HTML });
    assert.equal(api.status, 503);
    assert.match(api.headers.get('content-type'), /^application\/problem\+json/);
  } finally {
    await server.close();
  }
});

test('an unexpected throw is a 500 page on a page route, logged once, and Problem Details on the API', async () => {
  const log = mock.method(console, 'error', () => {});
  const server = await startServer({ auth: stubAuth(new Error('boom')) });
  try {
    const res = await fetch(`${server.base}/personal/board`, { headers: HTML });
    assert.equal(res.status, 500);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(await res.text(), /<h1>Something went wrong<\/h1>/);
    assert.equal(log.mock.callCount(), 1);
    const api = await fetch(`${server.base}/workspaces/w1/drivers`);
    assert.match(api.headers.get('content-type'), /^application\/problem\+json/);
  } finally {
    log.mock.restore();
    await server.close();
  }
});

let app;
before(async () => { app = await startTiming(); });
after(() => app.close());

test('a handler that throws after sign-in is a 500 page too', async () => {
  const ana = await app.signUp('Ana');
  const who = await app.login(ana);
  const log = mock.method(console, 'error', () => {});
  const snapshot = app.engine.snapshot;
  app.engine.snapshot = () => { throw new Error('boom'); };
  try {
    const res = await app.api(who, 'GET', '/personal/board', undefined, HTML);
    assert.equal(res.status, 500);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.match(await res.text(), /Something went wrong/);
    assert.equal(log.mock.callCount(), 1);
  } finally {
    app.engine.snapshot = snapshot;
    log.mock.restore();
  }
});
