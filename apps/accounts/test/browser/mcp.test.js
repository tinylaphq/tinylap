// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An MCP client's sign-in in a real browser (timing MCP spec §4.3–4.5): the
// passkey sign-in in front of the consent page, Allow and Cancel, and
// Disconnect on the account page. Chrome's virtual authenticator stands in
// for the device; the client's metadata document comes from a fake fetch.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { decodeJwt } from 'jose';
import { authenticatorOptions, launchOptions } from '../../playwright.config.js';
import { startAccounts } from '../helpers.js';

const CLIENT = 'https://assistant.example/oauth/client.json';
const MCP = 'http://127.0.0.1:9/mcp';

/** @type {import('playwright-core').Browser} */
let browser;
/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
/** The assistant's loopback callback, on a port of its own as a desktop client's would be. */
let callbackServer;
let redirectUri;

before(async () => {
  callbackServer = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('assistant callback'));
  await new Promise((done) => callbackServer.listen(0, '127.0.0.1', done));
  redirectUri = `http://127.0.0.1:${callbackServer.address().port}/callback`;
  const doc = { client_id: CLIENT, client_name: 'Example Assistant', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' };
  accounts = await startAccounts({
    hostname: 'localhost',
    env: { TINYLAP_MCP_RESOURCE: MCP },
    fetchMetadata: async (input) => (String(input instanceof Request ? input.url : input) === CLIENT
      ? new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json' } })
      : new Response('not found', { status: 404 })),
  });
  browser = await chromium.launch(launchOptions);
});

after(async () => {
  await browser?.close();
  await accounts?.close();
  callbackServer.closeAllConnections();
  await new Promise((done) => callbackServer.close(done));
});

/** A fresh profile with its own authenticator, and no script errors allowed. */
async function device(t) {
  const context = await browser.newContext({ baseURL: accounts.issuer });
  const errors = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'no script errors on the pages');
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions });
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}

/** The authorize URL an MCP client opens, and its PKCE verifier. */
function authorizeUrl() {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code', client_id: CLIENT, redirect_uri: redirectUri, scope: 'timing offline_access', state: 'st',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: MCP,
  });
  return { url: `${accounts.issuer}/oauth2/authorize?${query}`, verifier };
}

/** Signs up from the sign-in page the authorize request led to, which carries the request on. */
async function signUpFromSignIn(page, name) {
  assert.equal(new URL(page.url()).pathname, '/sign-in');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await page.locator('#code-list li').nth(9).waitFor();
  await page.getByLabel("I've saved them").check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('signed out: sign up with a passkey, then the consent page, then Allow sends a code back', async (t) => {
  const page = await device(t);
  const { url, verifier } = authorizeUrl();
  await page.goto(url);
  await signUpFromSignIn(page, 'Mika');
  await page.waitForURL((u) => u.pathname === '/consent');
  await assert.doesNotReject(page.getByRole('heading', { name: 'Allow Example Assistant to run timing as you?' }).waitFor());
  assert.equal(await page.locator('.accounts-consent-host').textContent(), 'assistant.example');
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL((u) => u.href.startsWith(redirectUri));
  const back = new URL(page.url());
  assert.equal(back.searchParams.get('state'), 'st');
  const res = await fetch(`${accounts.issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: /** @type {string} */ (back.searchParams.get('code')), redirect_uri: redirectUri, client_id: CLIENT, code_verifier: verifier, resource: MCP }),
  });
  assert.equal(res.status, 200);
  const claims = decodeJwt((await res.json()).access_token);
  assert.equal(claims.aud, MCP);
  assert.equal(claims.name, 'Mika');
});

test('signed in with an existing passkey: consent, and Cancel sends access_denied back', async (t) => {
  const page = await device(t);
  // Make the account first, signed out of it again.
  await page.goto('/sign-up');
  await page.getByLabel('Display name').fill('Noor');
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await page.locator('#code-list li').nth(9).waitFor();
  await page.getByLabel("I've saved them").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.evaluate(() => fetch('/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));

  await page.goto(authorizeUrl().url);
  assert.equal(new URL(page.url()).pathname, '/sign-in');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.waitForURL((u) => u.pathname === '/consent');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForURL((u) => u.href.startsWith(redirectUri));
  assert.equal(new URL(page.url()).searchParams.get('error'), 'access_denied');
});

test('the account page lists the app, and Disconnect removes it', async (t) => {
  const page = await device(t);
  await page.goto(authorizeUrl().url);
  await signUpFromSignIn(page, 'Oskar');
  await page.waitForURL((u) => u.pathname === '/consent');
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL((u) => u.href.startsWith(redirectUri));

  await page.goto('/account');
  const apps = page.locator('#apps');
  await assert.doesNotReject(apps.getByText('Example Assistant').waitFor());
  assert.match(await apps.textContent(), /assistant\.example · allowed/);
  await apps.getByRole('button', { name: 'Disconnect' }).click();
  await page.waitForURL((u) => u.pathname === '/account' && u.searchParams.has('disconnected'));
  assert.match(await apps.textContent(), /Example Assistant is disconnected/);
  assert.match(await apps.textContent(), /No apps are connected to your account\./);

  // The next sign-in asks again.
  await page.goto(authorizeUrl().url);
  await page.waitForURL((u) => u.pathname === '/consent');
});
