// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Passkeys in a real browser: Google Chrome through playwright-core, with
// Chrome's virtual WebAuthn authenticator (CDP) standing in for the device.
// The issuer is http://localhost (a secure context; RP ID "localhost").
// Run with `pnpm test:browser`.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import * as oidc from 'openid-client';
import { authenticatorOptions, launchOptions } from '../../playwright.config.js';
import { startAccounts } from '../helpers.js';

/** @type {import('playwright-core').Browser} */
let browser;
/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
/** The planner stand-in: its callback answers 200 and remembers the URL. */
let planner;
/** @type {string[]} */
const callbacks = [];

before(async () => {
  planner = createServer((req, res) => {
    callbacks.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'text/plain' }).end('planner callback');
  });
  await new Promise((resolve) => planner.listen(0, '127.0.0.1', () => resolve(undefined)));
  accounts = await startAccounts({ hostname: 'localhost', plannerPort: planner.address().port });
  browser = await chromium.launch(launchOptions);
});

after(async () => {
  await browser?.close();
  await accounts?.close();
  planner.closeAllConnections();
  await new Promise((resolve) => planner.close(() => resolve(undefined)));
});

/**
 * A fresh browser profile with its own empty authenticator: a new device.
 * @param {import('node:test').TestContext} t
 * @param {any} [options] the virtual authenticator's options
 */
async function device(t, options = authenticatorOptions) {
  const context = await browser.newContext({ baseURL: accounts.issuer, acceptDownloads: true });
  /** @type {string[]} */
  const errors = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'no script errors on the pages');
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options });
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, cdp, authenticatorId };
}

const credentials = async ({ cdp, authenticatorId }) => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;

/**
 * Signs up on /sign-up and returns the codes once "I've saved them" is done.
 * @param {import('playwright-core').Page} page
 */
async function signUp(page, name, { from = '/sign-up' } = {}) {
  await page.goto(from);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  const list = page.locator('#code-list li');
  await list.nth(9).waitFor();
  const codes = await list.allTextContents();
  return codes;
}

/** Ticks "I've saved them" and continues. */
async function confirmSaved(page) {
  const next = page.getByRole('button', { name: 'Continue' });
  assert.equal(await next.isDisabled(), true, 'Continue waits for the tick');
  await page.getByLabel("I've saved them").check();
  await next.click();
}

const signOut = (page) => page.evaluate(() => fetch('/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status));

const status = (page, id = 'status') => page.locator(`#${id}`);

test('sign-up gives ten codes once, then the same authenticator signs in', async (t) => {
  const d = await device(t);
  const { page } = d;
  const codes = await signUp(page, 'Ayrton');
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, /^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{22,}$/);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .txt' }).click()]);
  assert.equal(download.suggestedFilename(), 'tinylap-recovery-codes.txt');
  const text = await readFile(await download.path(), 'utf8');
  for (const code of codes) assert.ok(text.includes(code), 'every code is in the file');

  await confirmSaved(page);
  await page.getByText('Your account is ready').waitFor();
  assert.equal(await page.locator('#code-list li').count(), 0, 'the codes are gone from the page');

  const [credential] = await credentials(d);
  assert.equal(credential.isResidentCredential, true);
  assert.equal(credential.rpId, 'localhost');
  const user = accounts.db.prepare('SELECT id, name, email FROM "user" WHERE name = ?').get('Ayrton');
  assert.equal(user.email, `${user.id}@users.invalid`);
  const workspace = accounts.db.prepare(`SELECT w.kind, w.name, m.role FROM workspace w JOIN membership m ON m.workspace_id = w.id WHERE m.user_id = ?`).all(user.id);
  assert.deepEqual(workspace.map((w) => ({ ...w })), [{ kind: 'personal', name: 'Ayrton', role: 'owner' }]);
  assert.equal(accounts.db.prepare('SELECT COUNT(*) AS n FROM recovery_code WHERE user_id = ?').get(user.id).n, 10);

  assert.equal(await signOut(page), 200);
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.getByText('Signed in as Ayrton').waitFor();
  const me = await page.request.get('/api/me');
  assert.equal(me.status(), 200);
  assert.deepEqual(await me.json(), { id: user.id, name: 'Ayrton' });
});

test('a passkey the server does not know cannot sign in', async (t) => {
  const d = await device(t);
  // A real, discoverable passkey for localhost on this device, made outside
  // TinyLap: the browser offers it, the server has never seen it.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await d.cdp.send('WebAuthn.addCredential', {
    authenticatorId: d.authenticatorId,
    credential: {
      credentialId: randomBytes(16).toString('base64'),
      isResidentCredential: true,
      rpId: 'localhost',
      privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      userHandle: randomBytes(16).toString('base64'),
      signCount: 0,
    },
  });
  await d.page.goto('/sign-in');
  await d.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await d.page.locator('#status.status-error').waitFor();
  assert.equal((await d.page.request.get('/api/me')).status(), 401);
});

test('recovery: a code, then a forced passkey; the spent code then fails', async (t) => {
  const old = await device(t);
  const codes = await signUp(old.page, 'Alain');
  await confirmSaved(old.page);

  const fresh = await device(t); // the old device is lost
  const { page } = fresh;
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Lost your passkey?' }).click();
  await page.getByLabel('Recovery code').fill(codes[3]);
  await page.getByRole('button', { name: 'Use this code' }).click();
  await page.getByRole('heading', { name: 'Add a passkey' }).waitFor();

  assert.equal((await page.request.get('/api/me')).status(), 403, 'restricted until a passkey exists');
  await page.goto('/recover');
  await page.getByRole('heading', { name: 'Add a passkey' }).waitFor(); // a reload resumes here

  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await page.getByText('Passkey added').waitFor();
  assert.equal((await credentials(fresh)).length, 1);
  const me = await page.request.get('/api/me');
  assert.equal(me.status(), 200, 'the restriction is lifted');
  assert.equal((await me.json()).name, 'Alain');

  assert.equal(await signOut(page), 200);
  await page.goto('/recover');
  await page.getByLabel('Recovery code').fill(codes[3]);
  await page.getByRole('button', { name: 'Use this code' }).click();
  await status(page).filter({ hasText: 'wrong or has been used' }).waitFor();

  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.getByText('Signed in as Alain').waitFor();
});

test('a recovery session that skips registration gets 403 from the account API', async (t) => {
  const old = await device(t);
  const codes = await signUp(old.page, 'Nigel');
  await confirmSaved(old.page);

  const { page } = await device(t);
  await page.goto('/recover');
  await page.getByLabel('Recovery code').fill(codes[0]);
  await page.getByRole('button', { name: 'Use this code' }).click();
  await page.getByRole('heading', { name: 'Add a passkey' }).waitFor();

  const me = await page.request.get('/api/me');
  assert.equal(me.status(), 403);
  assert.equal((await me.json()).title, 'Add a passkey first');
  await page.goto('/sign-in');
  assert.equal(await page.getByRole('heading', { name: 'Add a passkey first' }).count(), 1, 'pages say what to do');
});

/** An OIDC login as the planner starts it: PKCE, state, nonce, resource. */
async function beginLogin() {
  const config = await oidc.discovery(new URL(accounts.issuer), accounts.client.clientId, undefined,
    oidc.ClientSecretBasic(accounts.client.clientSecret), { execute: [oidc.allowInsecureRequests] });
  const pkceCodeVerifier = oidc.randomPKCECodeVerifier();
  const checks = { pkceCodeVerifier, expectedNonce: oidc.randomNonce(), expectedState: oidc.randomState(), idTokenExpected: true };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: accounts.client.redirectUri,
    scope: 'openid profile offline_access',
    code_challenge: await oidc.calculatePKCECodeChallenge(pkceCodeVerifier),
    code_challenge_method: 'S256',
    nonce: checks.expectedNonce,
    state: checks.expectedState,
    resource: accounts.client.resource,
  });
  return { config, checks, url };
}

/** Waits for the browser to arrive at the planner's callback, and finishes the login there. */
async function finishLogin(page, { config, checks }) {
  await page.waitForURL((u) => u.href.startsWith(accounts.client.redirectUri));
  const callback = new URL(page.url());
  assert.ok(callback.searchParams.get('code'));
  assert.equal(callback.searchParams.get('iss'), accounts.issuer);
  assert.ok(callbacks.includes(`${callback.pathname}${callback.search}`));
  return oidc.authorizationCodeGrant(config, callback, checks, { resource: accounts.client.resource });
}

test('an OIDC login: authorize, the passkey sign-in page, the callback with a code', async (t) => {
  const { page } = await device(t);
  await signUp(page, 'Mika');
  await confirmSaved(page);
  await signOut(page);
  const user = accounts.db.prepare('SELECT id FROM "user" WHERE name = ?').get('Mika');

  const login = await beginLogin();
  await page.goto(login.url.href);
  const signIn = new URL(page.url());
  assert.equal(signIn.pathname, '/sign-in');
  assert.ok(signIn.searchParams.get('sig'), 'the provider signed the query');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  const tokens = await finishLogin(page, login);
  assert.equal(tokens.claims().sub, user.id);
});

test('signing up from the OIDC sign-in page continues the login', async (t) => {
  const { page } = await device(t);
  const login = await beginLogin();
  await page.goto(login.url.href);
  await page.getByRole('link', { name: 'Create an account' }).click();
  assert.equal(new URL(page.url()).pathname, '/sign-up');
  await signUp(page, 'Jackie', { from: page.url() });
  await confirmSaved(page);
  const tokens = await finishLogin(page, login);
  const user = accounts.db.prepare('SELECT id FROM "user" WHERE name = ?').get('Jackie');
  assert.equal(tokens.claims().sub, user.id);
});

// The ceremonies below bypass public/webauthn.js on purpose: it always asks
// for user verification, so the platform would refuse before the server is
// ever asked. These ask for 'discouraged' to reach the server's own check.

/** Registers through the plugin's endpoints directly, as a modified page would. */
const rawRegister = (page, { name, createSession }) => page.evaluate(async ({ name, createSession }) => {
  const options = await (await fetch(`/passkey/generate-register-options?context=${encodeURIComponent(name)}`)).json();
  options.authenticatorSelection = { ...options.authenticatorSelection, userVerification: 'discouraged' };
  const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
  const res = await fetch('/passkey/verify-registration', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ response: /** @type {any} */ (credential).toJSON(), createSession }),
  });
  return { status: res.status, body: await res.json() };
}, { name, createSession });

const NO_UV = { ...authenticatorOptions, hasUserVerification: false, isUserVerified: false };
const count = (sql, ...args) => Number(accounts.db.prepare(sql).get(...args).n);

test('the server refuses a passkey registered without user verification', async (t) => {
  const { page } = await device(t, NO_UV);
  await page.goto('/sign-up');
  const passkeys = count('SELECT COUNT(*) AS n FROM passkey');
  const result = await rawRegister(page, { name: 'NoVerify', createSession: true });
  assert.equal(result.status, 400);
  assert.match(result.body.message, /did not verify you/);
  assert.equal(count('SELECT COUNT(*) AS n FROM passkey'), passkeys, 'no passkey row');
  assert.equal(count('SELECT COUNT(*) AS n FROM "user" WHERE name = ?', 'NoVerify'), 0, 'no user');
  assert.equal((await page.request.get('/api/me')).status(), 401, 'no session');
});

test('a sign-up that does not ask for a session is refused', async (t) => {
  const { page } = await device(t);
  await page.goto('/sign-up');
  const passkeys = count('SELECT COUNT(*) AS n FROM passkey');
  const result = await rawRegister(page, { name: 'NoSession', createSession: false });
  assert.equal(result.status, 400);
  assert.equal(count('SELECT COUNT(*) AS n FROM passkey'), passkeys, 'no passkey row');
  assert.equal(count('SELECT COUNT(*) AS n FROM "user" WHERE name = ?', 'NoSession'), 0, 'no user');
});

test('the server refuses a sign-in without user verification', async (t) => {
  const owner = await device(t);
  await signUp(owner.page, 'Graham');
  await confirmSaved(owner.page);
  const user = accounts.db.prepare('SELECT id FROM "user" WHERE name = ?').get('Graham');

  // The same device, now not verifying its user (no PIN, no fingerprint).
  await signOut(owner.page);
  await owner.cdp.send('WebAuthn.setUserVerified', { authenticatorId: owner.authenticatorId, isUserVerified: false });
  const lax = owner;
  await lax.page.goto('/sign-in');
  const sessions = count('SELECT COUNT(*) AS n FROM session WHERE "userId" = ?', user.id);
  const result = await lax.page.evaluate(async () => {
    const options = await (await fetch('/passkey/generate-authenticate-options')).json();
    const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON({ ...options, userVerification: 'discouraged' });
    const assertion = await navigator.credentials.get({ publicKey });
    const res = await fetch('/passkey/verify-authentication', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response: /** @type {any} */ (assertion).toJSON() }),
    });
    return { status: res.status, body: await res.json() };
  });
  assert.equal(result.status, 401);
  assert.match(result.body.message, /did not verify you/);
  assert.equal(count('SELECT COUNT(*) AS n FROM session WHERE "userId" = ?', user.id), sessions, 'no session created');
  assert.equal((await lax.page.request.get('/api/me')).status(), 401);
});
