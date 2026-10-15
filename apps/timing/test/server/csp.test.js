// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every page the server renders, whatever its status, carries the page CSP (spec §4.2, §9).
import test, { after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AuthError } from '@tinylap/auth';
import { startServer, startTiming } from './helpers.js';

let app;
let owner;
let member;
let office;
let driver;

before(async () => {
  app = await startTiming();
  const ana = await app.signUp('Ana');
  const ben = await app.signUp('Ben');
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  owner = await app.login(ana);
  member = await app.login(ben);
  await app.form(member, `/clubs/${office.id}/drivers`, { name: 'Dan' });
  [driver] = app.store.drivers(office.id);
});
after(() => app.close());

const POLICY = [/default-src 'self'/, /script-src 'self'/, /connect-src 'self'/, /object-src 'none'/, /base-uri 'none'/, /form-action 'self'/, /frame-ancestors 'none'/];
const expectCsp = (res, what) => {
  assert.match(res.headers.get('content-type'), /^text\/html/, what);
  const csp = res.headers.get('content-security-policy');
  for (const part of POLICY) assert.match(csp, part, what);
};

test('the 404, 403, 422, confirm and bridge pages carry the CSP', async () => {
  const base = `/clubs/${office.id}`;
  const html = { accept: 'text/html' };
  const cases = [
    [404, 'not found', () => app.api(member, 'GET', `${base}/nothing-here`, undefined, html)],
    [404, 'not a member', () => app.api(member, 'GET', '/clubs/someone-elses/board', undefined, html)],
    [403, 'forbidden', () => app.api(member, 'GET', `${base}/drivers/${driver.id}/delete`, undefined, html)],
    [403, 'another site', () => app.form(member, `${base}/drivers`, { name: 'Eve' }, { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' })],
    [422, 'bad form', () => app.form(member, `${base}/drivers`, { name: '' })],
    [200, 'confirm', () => app.api(owner, 'GET', `${base}/drivers/${driver.id}/delete`, undefined, html)],
    [200, 'bridge', () => app.api(member, 'GET', `${base}/bridge`, undefined, html)],
  ];
  for (const [status, what, call] of cases) {
    const res = await call();
    assert.equal(res.status, status, what);
    expectCsp(res, what);
  }
});

test('the watchers-link-gone page carries the CSP', async () => {
  const res = await fetch(`${app.base}/watch/${'a'.repeat(22)}`, { headers: { accept: 'text/html' } });
  assert.equal(res.status, 404);
  expectCsp(res, 'gone');
});

test('the 500 and 503 pages carry the CSP', async () => {
  const log = mock.method(console, 'error', () => {});
  const stub = (error) => ({ issuer: 'http://127.0.0.1:9', accountUrl: 'x', bff: { session: async () => { throw error; } } });
  try {
    for (const [status, error] of [[503, new AuthError('unavailable', 'down')], [500, new Error('boom')]]) {
      const server = await startServer({ auth: stub(error) });
      try {
        const res = await fetch(`${server.base}/personal/board`, { headers: { accept: 'text/html' } });
        assert.equal(res.status, status);
        expectCsp(res, String(status));
      } finally {
        await server.close();
      }
    }
  } finally {
    log.mock.restore();
  }
});
