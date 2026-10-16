// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The sign-up, sign-in and recovery pages, the recovery session and its
// restriction, the passkey plugin's options and the rate limits, over HTTP.
// The passkey ceremonies themselves run in a real browser
// (test/browser/passkeys.test.js).
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_CSP } from '../server/app.js';
import { createRecoveryCodes } from '../server/recovery.js';
import { LOSS_WARNING } from '../server/pages/sign-up.js';
import { createTestUser, driveAuthorize, Jar, navigate, startAccounts, testSession } from './helpers.js';
import { SPECULATION_RULES } from '@tinylap/design/html/speculation.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
before(async () => {
  // Every call() comes from its own address, so these tests never meet the
  // rate limits; the 'rate limits' suite below has its own server without.
  accounts = await startAccounts({ plannerPort: 8124, env: { TINYLAP_CLIENT_IP_HEADER: 'X-Test-Client' } });
});
after(() => accounts.close());

let clients = 0;

/**
 * A same-origin request, as the pages' scripts make them.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, jar?: Jar, headers?: Record<string, string> }} [init]
 */
async function call(path, { method = 'GET', body = undefined, jar = new Jar(), headers = {} } = {}) {
  const res = await fetch(`${accounts.issuer}${path}`, {
    method,
    headers: {
      origin: accounts.issuer,
      'sec-fetch-site': 'same-origin',
      'x-test-client': `198.51.100.${(clients += 1) % 250}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(jar.header() ? { cookie: jar.header() } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.store(res);
  return res;
}

async function recoverySession(name = 'Lost') {
  const user = await createTestUser(accounts.auth, name);
  const codes = createRecoveryCodes(accounts.db, user.id);
  const jar = new Jar();
  const res = await call('/recover', { method: 'POST', body: { code: codes[0] }, jar });
  return { user, codes, jar, res };
}

describe('pages', () => {
  for (const path of ['/sign-in', '/sign-up', '/recover']) {
    test(`${path} is a palace page under the page CSP, with external scripts only`, async () => {
      const res = await navigate(`${accounts.issuer}${path}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-security-policy'), PAGE_CSP);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const html = await res.text();
      assert.match(html, /<link rel="stylesheet" href="\/pkg\/palace-ui\/palace.css">/);
      assert.match(html, /<link rel="stylesheet" href="\/pkg\/design\/design.css">/);
      assert.match(html, /<script type="module" src="\/public\/[a-z-]+\.js"><\/script>/);
      assert.doesNotMatch(html.replace(SPECULATION_RULES, ''), /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script but the speculation rules');
      assert.doesNotMatch(html, /\sstyle=|<style/, 'no inline style');
    });
  }

  test('the sign-in page carries the provider query to recovery and sign-up', async () => {
    const res = await navigate(`${accounts.issuer}/sign-in?client_id=a&sig=b%2Bc`);
    const html = await res.text();
    assert.match(html, /Sign in with a passkey/);
    assert.match(html, /<a href="\/recover\?client_id=a&amp;sig=b%2Bc">Lost your passkey\?<\/a>/);
    assert.match(html, /<a href="\/sign-up\?client_id=a&amp;sig=b%2Bc">/);
  });

  test('the sign-up page warns plainly before you continue', async () => {
    const html = await (await navigate(`${accounts.issuer}/sign-up`)).text();
    assert.equal(LOSS_WARNING, 'Losing every passkey and every recovery code loses this account. Nobody can restore it.');
    assert.ok(html.indexOf(LOSS_WARNING) < html.indexOf('Create a passkey</button>'));
    assert.match(html, /I've saved them/);
  });

  test('a signed-in visitor to /sign-up is offered sign-out, not a second account', async () => {
    const user = await createTestUser(accounts.auth, 'Already <b>here</b>');
    const jar = await testSession(accounts.auth, user.id);
    const html = await (await navigate(`${accounts.issuer}/sign-up`, { accept: 'text/html', cookie: jar.header() })).text();
    assert.match(html, /You are signed in/);
    assert.match(html, /Already &lt;b&gt;here&lt;\/b&gt;/);
    assert.doesNotMatch(html, /display-name/);
  });

  test('the scripts and the mark are served', async () => {
    for (const file of ['webauthn.js', 'sign-in.js', 'sign-up.js', 'recover.js', 'sign-out.js']) {
      const res = await fetch(`${accounts.issuer}/public/${file}`);
      assert.equal(res.status, 200, file);
      assert.match(res.headers.get('content-type'), /^text\/javascript/);
    }
    assert.equal((await fetch(`${accounts.issuer}/public/accounts.css`)).status, 200);
    assert.equal((await fetch(`${accounts.issuer}/pkg/design/mark.svg`)).headers.get('content-type'), 'image/svg+xml', 'the shared mark');
  });

  test('the error page is a TinyLap page', async () => {
    const html = await (await navigate(`${accounts.issuer}/error?error=access_denied`)).text();
    assert.match(html, /\/public\/accounts.css/);
    assert.match(html, /access_denied/);
  });
});

describe('passkey options', () => {
  test('sign-up options: a discoverable credential with user verification, no attestation', async () => {
    const res = await call('/passkey/generate-register-options?context=Ayrton');
    assert.equal(res.status, 200);
    const options = await res.json();
    assert.equal(options.rp.id, new URL(accounts.issuer).hostname);
    assert.equal(options.rp.name, 'TinyLap');
    assert.equal(options.user.name, 'Ayrton');
    assert.equal(options.attestation, 'none');
    assert.equal(options.authenticatorSelection.residentKey, 'required');
    assert.equal(options.authenticatorSelection.userVerification, 'required');
    assert.ok(res.headers.getSetCookie().some((c) => /passkey/.test(c) && /Max-Age=300/i.test(c)), 'challenge lives 5 minutes');
  });

  test('sign-up needs a display name', async () => {
    assert.equal((await call('/passkey/generate-register-options')).status, 400);
    assert.equal((await call(`/passkey/generate-register-options?context=${'x'.repeat(41)}`)).status, 400);
    assert.equal((await call('/passkey/generate-register-options?context=%20%20')).status, 400);
  });

  test('sign-in options ask for any discoverable passkey', async () => {
    const res = await call('/passkey/generate-authenticate-options');
    assert.equal(res.status, 200);
    const options = await res.json();
    assert.equal(options.rpId, new URL(accounts.issuer).hostname);
    assert.equal(options.allowCredentials, undefined);
  });
});

describe('recovery sessions', () => {
  test('a recovery code signs in with a session flagged recovery', async () => {
    const { user, jar, res } = await recoverySession('Lost');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { user: { name: 'Lost' } });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const session = await accounts.auth.api.getSession({ headers: new Headers({ cookie: jar.header() }) });
    assert.equal(session.user.id, user.id);
    assert.equal(/** @type {any} */ (session.session).recovery, true);
  });

  test('a spent or wrong code is refused', async () => {
    const { codes } = await recoverySession();
    const again = await call('/recover', { method: 'POST', body: { code: codes[0] } });
    assert.equal(again.status, 401);
    assert.equal(again.headers.getSetCookie().length, 0);
    assert.equal((await again.json()).detail, 'This recovery code is wrong or has been used.');
    assert.equal((await call('/recover', { method: 'POST', body: { code: 'nonsense' } })).status, 401);
    assert.equal((await call('/recover', { method: 'POST', body: '{' })).status, 400);
  });

  test('redeeming needs a same-origin request', async () => {
    const user = await createTestUser(accounts.auth, 'Csrf');
    const [code] = createRecoveryCodes(accounts.db, user.id);
    const res = await call('/recover', { method: 'POST', body: { code }, headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } });
    assert.equal(res.status, 403);
    assert.equal((await call('/recover', { method: 'POST', body: { code } })).status, 200, 'the code was not spent');
  });

  test('a recovery session is refused everything but adding a passkey and its codes', async () => {
    const { jar } = await recoverySession();
    const me = await call('/api/me', { jar });
    assert.equal(me.status, 403);
    assert.equal(me.headers.get('content-type'), 'application/problem+json');
    assert.equal((await me.json()).title, 'Add a passkey first');
    assert.equal((await call('/get-session', { jar })).status, 403);
    assert.equal((await call('/passkey/list-user-passkeys', { jar })).status, 403);
    assert.equal((await call('/passkey/generate-authenticate-options', { jar })).status, 403);
    assert.equal((await call('/sign-up', { jar })).status, 403);

    const options = await call('/passkey/generate-register-options?name=Lost', { jar });
    assert.equal(options.status, 200, 'adding a passkey is allowed');
    const codes = await call('/recovery-codes', { method: 'POST', body: {}, jar });
    assert.equal(codes.status, 200, 'managing codes is allowed');
    assert.equal((await codes.json()).codes.length, 10);
    assert.equal((await navigate(`${accounts.issuer}/recover`, { accept: 'text/html', cookie: jar.header() })).status, 200);
  });

  test('a recovery session cannot continue an OAuth login', async () => {
    const { jar } = await recoverySession();
    const url = new URL(`${accounts.issuer}/oauth2/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: accounts.client.clientId, redirect_uri: accounts.client.redirectUri,
      scope: 'openid', state: 's', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256',
    }).toString();
    const res = await navigate(url, { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /href="\/recover"/);
    await assert.rejects(driveAuthorize(url, jar), /403/);
  });

  test('the recover page resumes at the passkey step for a recovery session', async () => {
    const { jar } = await recoverySession('Resumer');
    const html = await (await navigate(`${accounts.issuer}/recover`, { accept: 'text/html', cookie: jar.header() })).text();
    assert.match(html, /data-step="passkey"/);
    assert.match(html, /data-name="Resumer"/);
  });

  test('signing out is allowed and ends the recovery session', async () => {
    const { jar } = await recoverySession();
    assert.equal((await call('/sign-out', { method: 'POST', body: {}, jar })).status, 200);
    assert.equal((await call('/api/me', { jar })).status, 401);
  });
});

describe('the account API stub', () => {
  test('GET /api/me: 401 without a session, 200 with one', async () => {
    assert.equal((await call('/api/me')).status, 401);
    const user = await createTestUser(accounts.auth, 'Me');
    const res = await call('/api/me', { jar: await testSession(accounts.auth, user.id) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: user.id, name: 'Me' });
  });

  test('POST /recovery-codes needs a session and a same-origin request', async () => {
    assert.equal((await call('/recovery-codes', { method: 'POST', body: {} })).status, 401);
    const user = await createTestUser(accounts.auth, 'Codes');
    const jar = await testSession(accounts.auth, user.id);
    assert.equal((await call('/recovery-codes', { method: 'POST', body: {}, jar, headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } })).status, 403);
    const res = await call('/recovery-codes', { method: 'POST', body: {}, jar });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await res.json()).codes.length, 10);
  });
});

describe('rate limits', () => {
  /** @type {Awaited<ReturnType<typeof startAccounts>>} */
  let limited;
  before(async () => {
    limited = await startAccounts();
  });
  after(() => limited.close());

  const hit = (path, init = {}) => fetch(`${limited.issuer}${path}`, {
    headers: { origin: limited.issuer, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ...init,
  });

  test('sign-up: 10 an hour per client', async () => {
    for (let i = 0; i < 10; i += 1) assert.equal((await hit('/passkey/generate-register-options?context=A')).status, 200);
    const res = await hit('/passkey/generate-register-options?context=A');
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
    assert.equal(res.headers.get('content-type'), 'application/problem+json');
  });

  test('sign-in: 30 an hour per client', async () => {
    for (let i = 0; i < 30; i += 1) assert.equal((await hit('/passkey/generate-authenticate-options')).status, 200);
    assert.equal((await hit('/passkey/generate-authenticate-options')).status, 429);
  });

  test('recovery: 5 an hour per lookup id, 10 per client', async () => {
    const user = await createTestUser(limited.auth, 'Limited');
    const [code] = createRecoveryCodes(limited.db, user.id);
    const [lookup] = code.split('.');
    const wrong = { method: 'POST', body: JSON.stringify({ code: `${lookup}.${'A'.repeat(22)}` }) };
    for (let i = 0; i < 5; i += 1) assert.equal((await hit('/recover', wrong)).status, 401);
    assert.equal((await hit('/recover', { method: 'POST', body: JSON.stringify({ code }) })).status, 429, 'the lookup id is locked');
    for (let i = 0; i < 4; i += 1) assert.equal((await hit('/recover', { method: 'POST', body: JSON.stringify({ code: 'nonsense' }) })).status, 401);
    assert.equal((await hit('/recover', { method: 'POST', body: JSON.stringify({ code: 'nonsense' }) })).status, 429, 'the client is limited');
  });
});
