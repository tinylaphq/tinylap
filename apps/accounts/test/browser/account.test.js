// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The account page in a real browser (spec §6, §7): add a second passkey on
// another authenticator, remove the first, confirm with the passkey when the
// session is no longer fresh, new recovery codes, sign out everywhere, and
// delete the account by typing the display name. Also: sign-up's "Try
// again" when the codes fail once the passkey exists. Run with
// `pnpm test:browser`. TINYLAP_SCREENSHOTS=<dir> saves the account page.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { authenticatorOptions, launchOptions } from '../../playwright.config.js';
import { startAccounts } from '../helpers.js';

/** @type {import('playwright-core').Browser} */
let browser;
/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;

before(async () => {
  accounts = await startAccounts({ hostname: 'localhost', plannerPort: 8125 });
  browser = await chromium.launch(launchOptions);
});

after(async () => {
  await browser?.close();
  await accounts?.close();
});

/** A new device: its own profile and an empty platform authenticator. */
async function device(t) {
  const context = await browser.newContext({ baseURL: accounts.issuer });
  /** @type {string[]} */
  const errors = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'no script errors on the pages');
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions });
  page.on('pageerror', (error) => errors.push(error.message));
  return { page, cdp, authenticatorId };
}

async function signUpHere(page, name) {
  await page.goto('/sign-up');
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await page.locator('#code-list li').nth(9).waitFor();
  await page.getByLabel("I've saved them").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Your account is ready').waitFor();
}

const userId = (name) => String(accounts.db.prepare('SELECT id FROM "user" WHERE name = ?').get(name)?.id);
const passkeyNames = (id) => accounts.db.prepare('SELECT name FROM passkey WHERE userId = ? ORDER BY createdAt').all(id).map((r) => r.name);
const age = (id) => accounts.db.prepare('UPDATE session SET createdAt = ? WHERE userId = ?').run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), id);

test('passkeys, a fresh-session confirm, new codes, and sign out everywhere', async (t) => {
  const { page, cdp, authenticatorId } = await device(t);
  await signUpHere(page, 'Paula');
  const id = userId('Paula');
  await page.goto('/account');
  await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor();
  await page.getByText('10 of 10').waitFor();
  assert.equal(await page.locator('#passkeys button[data-action="remove"]').isDisabled(), true, 'the only passkey cannot be removed');

  // A second passkey on a second device (another authenticator).
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions });
  await page.getByLabel('Name it').fill('Phone');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await page.locator('#passkeys li', { hasText: 'Phone' }).waitFor();
  assert.deepEqual(passkeyNames(id), [null, 'Phone']);

  const dir = process.env.TINYLAP_SCREENSHOTS;
  if (dir) {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.reload();
    await page.screenshot({ path: join(dir, 'task-5-account-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(dir, 'task-5-account-phone.png'), fullPage: true });
    await page.goto('/privacy');
    await page.screenshot({ path: join(dir, 'task-5-privacy-phone.png'), fullPage: true });
    await page.goto('/account');
  }

  // Remove the first, after confirming; the session is stale by now, so
  // the passkey (the Phone one, the only one this device has) is asked for.
  age(id);
  await page.locator('#passkeys li', { hasText: 'Passkey 1' }).getByRole('button', { name: 'Remove' }).click();
  await page.getByText('Remove Passkey 1?').waitFor();
  await page.locator('#confirm').getByRole('button', { name: 'Remove passkey' }).click();
  await page.getByText('Confirm it is you with your passkey').waitFor();
  await page.getByRole('button', { name: 'Use my passkey' }).click();
  await page.locator('#passkeys li', { hasText: 'Passkey 1' }).waitFor({ state: 'detached' });
  assert.deepEqual(passkeyNames(id), ['Phone']);

  // New recovery codes, once more through the passkey confirm.
  age(id);
  await page.getByRole('button', { name: 'Make new recovery codes' }).click();
  await page.locator('#confirm').getByRole('button', { name: 'Make new codes' }).click();
  await page.getByRole('button', { name: 'Use my passkey' }).click();
  await page.locator('#code-list li').nth(9).waitFor();
  const codes = await page.locator('#code-list li').allTextContents();
  assert.equal(new Set(codes).size, 10);
  await page.getByRole('button', { name: "I've saved them" }).click();
  await page.getByText('10 of 10').waitFor();
  assert.equal(await page.locator('#code-list li').count(), 0, 'the codes are gone after saving');

  // Sign out everywhere.
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await page.locator('#confirm').getByRole('button', { name: 'Sign out everywhere' }).click();
  await page.waitForURL(/\/signed-out$/);
  await page.getByRole('heading', { name: 'You are signed out' }).waitFor();
  assert.equal(accounts.db.prepare('SELECT COUNT(*) AS c FROM session WHERE userId = ?').get(id).c, 0);
  const res = await page.goto('/account');
  assert.match(page.url(), /\/sign-in\?next=%2Faccount$/, `signed out: ${res?.status()}`);
});

test('deleting the account asks for the display name', async (t) => {
  const { page } = await device(t);
  await signUpHere(page, 'Dora');
  const id = userId('Dora');
  await page.goto('/account');
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.locator('#delete-dialog');
  await dialog.getByLabel('Display name').fill('dora');
  assert.equal(await dialog.getByRole('button', { name: 'Delete account' }).isDisabled(), true);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.ok(accounts.db.prepare('SELECT 1 FROM "user" WHERE id = ?').get(id), 'cancel keeps it');

  await page.getByRole('button', { name: 'Delete account' }).click();
  await dialog.getByLabel('Display name').fill('Dora');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await page.waitForURL(/\/signed-out\?deleted$/);
  await page.getByRole('heading', { name: 'Your account is deleted' }).waitFor();
  assert.equal(accounts.db.prepare('SELECT 1 FROM "user" WHERE id = ?').get(id), undefined);
});

test('sign-up: if the codes fail after the passkey, "Try again" makes only the codes', async (t) => {
  const { page } = await device(t);
  let failed = false;
  await page.route('**/recovery-codes', (route) => {
    if (failed) return route.continue();
    failed = true;
    return route.abort('connectionreset');
  });
  await page.goto('/sign-up');
  await page.getByLabel('Display name').fill('Rita');
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await page.getByText('only the codes are missing', { exact: false }).or(page.getByText('recovery codes could not be made')).waitFor();
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.locator('#code-list li').nth(9).waitFor();
  const id = userId('Rita');
  assert.equal(passkeyNames(id).length, 1, 'no second passkey');
  assert.equal(accounts.db.prepare('SELECT COUNT(*) AS c FROM recovery_code WHERE user_id = ?').get(id).c, 10);
});

test('a passkey name is trimmed and at most 40 characters, as on the account page', async (t) => {
  const { page } = await device(t);
  await signUpHere(page, 'Clark');
  const id = userId('Clark');
  const count = () => passkeyNames(id).length;
  const add = (passkeyName) => page.evaluate(async (passkeyName) => {
    const options = await (await fetch('/passkey/generate-register-options?name=Clark')).json();
    // This authenticator already holds the sign-up passkey; let it make another.
    options.excludeCredentials = [];
    const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
    const res = await fetch('/passkey/verify-registration', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: /** @type {any} */ (credential).toJSON(), name: passkeyName }),
    });
    return { status: res.status, body: await res.json() };
  }, passkeyName);
  const before = count();
  const long = await add('x'.repeat(41));
  assert.equal(long.status, 400);
  assert.match(long.body.message, /40 characters/);
  assert.equal(count(), before, 'no passkey row');
  assert.equal((await add('  Work   laptop ')).status, 200);
  assert.ok(passkeyNames(id).includes('Work laptop'), passkeyNames(id).join(', '));
});
