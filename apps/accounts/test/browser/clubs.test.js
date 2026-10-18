// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Clubs in a real browser (spec §5, §6): an owner starts a club and makes an
// invite link; two people open it signed out, sign up with their own
// passkeys and join; the owner promotes one to admin, and the new admin
// removes the other. Each person is a fresh browser profile with its own
// CDP virtual authenticator. Run with `pnpm test:browser`.
// TINYLAP_SCREENSHOTS=<dir> also saves the club page, desktop and phone.
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
  accounts = await startAccounts({ hostname: 'localhost' });
  browser = await chromium.launch(launchOptions);
});

after(async () => {
  await browser?.close();
  await accounts?.close();
});

/** A new device: its own profile and an empty platform authenticator. */
async function device(t, contextOptions = {}) {
  const context = await browser.newContext({ baseURL: accounts.issuer, ...contextOptions });
  /** @type {string[]} */
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
  return { context, page };
}

/** Fills the sign-up page the browser is on and gets past the codes. */
async function signUpHere(page, name) {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await page.locator('#code-list li').nth(9).waitFor();
  await page.getByLabel("I've saved them").check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

const row = (page, name) => page.locator('#members li', { hasText: name });

/** Opens the invite link signed out, signs up, comes back and joins. */
async function joinWithNewAccount(t, link, name) {
  const { page } = await device(t);
  await page.goto(link);
  await page.getByRole('heading', { name: /^Join / }).waitFor();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await signUpHere(page, name);
  await page.waitForURL(/\/invite\//);
  await page.getByRole('button', { name: /^Join / }).click();
  await page.waitForURL(/\/clubs\/[A-Za-z0-9_-]+$/);
  await row(page, name).getByText('Member').waitFor();
  return page;
}

test('create a club, invite, join with new passkeys, promote, and the new admin removes a member', async (t) => {
  const owner = await device(t, { permissions: ['clipboard-read', 'clipboard-write'] });
  await owner.page.goto('/sign-up');
  await signUpHere(owner.page, 'Olive');
  await owner.page.getByText('Your account is ready').waitFor();

  await owner.page.goto('/clubs');
  await owner.page.getByText('Only you', { exact: true }).waitFor();
  await owner.page.getByLabel('Club name').fill('Night Racers');
  await owner.page.getByRole('button', { name: 'Create club' }).click();
  await owner.page.waitForURL(/\/clubs\/[A-Za-z0-9_-]+$/);
  await owner.page.getByRole('heading', { name: 'Night Racers' }).waitFor();
  const clubId = new URL(owner.page.url()).pathname.split('/').pop();

  // A reusable link, shown once with its expiry and a Copy button.
  await owner.page.getByLabel('Single use').uncheck();
  await owner.page.getByLabel('Expires after').selectOption('30');
  await owner.page.getByRole('button', { name: 'Create invite link' }).click();
  await owner.page.locator('#new-invite').waitFor();
  const link = (await owner.page.locator('#invite-link').textContent()) ?? '';
  assert.match(link, new RegExp(`^${accounts.issuer}/invite/[A-Za-z0-9_-]{43}$`));
  assert.match(await owner.page.locator('#invite-expiry').textContent(), /Reusable, expires \d{1,2} \w{3} \d{4}/);
  await owner.page.getByRole('button', { name: 'Copy link' }).click();
  await owner.page.getByText('Copied').waitFor();
  assert.equal(await owner.page.evaluate(() => navigator.clipboard.readText()), link);
  assert.equal(await owner.page.locator('#invites li').count(), 1, 'the new invite is listed');
  await owner.page.reload();
  assert.equal(await owner.page.locator('#new-invite').isHidden(), true, 'the link is gone after a reload');
  assert.equal((await owner.page.content()).includes(link.split('/').pop()), false);

  const ada = await joinWithNewAccount(t, link, 'Ada');
  const max = await joinWithNewAccount(t, link, 'Max');
  assert.equal(await ada.getByRole('button', { name: 'Remove' }).count(), 0, 'a member removes nobody');
  assert.equal(await ada.locator('#create-invite').count(), 0, 'a member makes no invites');

  // The owner promotes Ada.
  await owner.page.reload();
  await row(owner.page, 'Ada').getByRole('button', { name: 'Make admin' }).click();
  await row(owner.page, 'Ada').getByText('Admin').waitFor();

  // Ada, now an admin, removes Max; cancelling first changes nothing.
  await ada.reload();
  assert.equal(await row(ada, 'Olive').getByRole('button').count(), 0, 'nothing to do to the owner');
  await row(ada, 'Max').getByRole('button', { name: 'Remove' }).click();
  await ada.getByText('Remove Max from Night Racers?').waitFor();
  await ada.getByRole('button', { name: 'Cancel' }).click();
  await ada.reload();
  await row(ada, 'Max').waitFor();
  await row(ada, 'Max').getByRole('button', { name: 'Remove' }).click();
  await ada.locator('#confirm').getByRole('button', { name: 'Remove' }).click();
  await ada.waitForLoadState('load');
  await row(ada, 'Ada').getByText('Admin').waitFor();
  await ada.locator('#members li', { hasText: 'Max' }).waitFor({ state: 'detached' });

  const roles = accounts.db.prepare('SELECT u.name, m.role FROM membership m JOIN "user" u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name').all(clubId);
  assert.deepEqual(roles.map((r) => ({ ...r })), [{ name: 'Ada', role: 'admin' }, { name: 'Olive', role: 'owner' }]);

  // Max no longer sees the club.
  const res = await max.goto(`/clubs/${clubId}`);
  assert.equal(res?.status(), 404);

  const dir = process.env.TINYLAP_SCREENSHOTS;
  if (dir) {
    await owner.page.reload();
    await owner.page.setViewportSize({ width: 1100, height: 900 });
    await owner.page.screenshot({ path: join(dir, 'task-4-club-desktop.png'), fullPage: true });
    await owner.page.getByRole('button', { name: 'Create invite link' }).click();
    await owner.page.locator('#new-invite').waitFor();
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await owner.page.screenshot({ path: join(dir, 'task-4-club-phone.png'), fullPage: true });
    await owner.page.goto('/clubs');
    await owner.page.screenshot({ path: join(dir, 'task-4-clubs-phone.png'), fullPage: true });
  }
});

test('an invalid invite link says so and suggests asking for a new one', async (t) => {
  const { page } = await device(t);
  await page.goto(`/invite/${'A'.repeat(43)}`);
  await page.getByText('This invite link is not valid.').waitFor();
  await page.getByText('Ask the club for a new invite link.').waitFor();
});
