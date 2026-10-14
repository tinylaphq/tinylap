// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The library in a real browser: Google Chrome through playwright-core, a
// real accounts (tools/test-env.js) on http://localhost with Chrome's
// virtual WebAuthn authenticator, and the planner on 127.0.0.1. Signs up
// with a passkey, logs in to the planner, saves a track, saves a second
// version, loads the first from the history, renames, shares through the
// confirmation and logs out. Run with `pnpm test:browser`; set
// SCREENSHOT_DIR to also keep screenshots of the dialogs.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { authenticatorOptions, launchOptions } from '../../../accounts/playwright.config.js';
import { startPlanner } from '../server/helpers.js';

const shots = process.env.SCREENSHOT_DIR;

/** @type {import('playwright-core').Browser} */
let browser;
/** @type {Awaited<ReturnType<typeof startPlanner>>} */
let planner;

before(async () => {
  planner = await startPlanner({ hostname: 'localhost' });
  browser = await chromium.launch(launchOptions);
});

after(async () => {
  await browser?.close();
  await planner?.close();
});

/** @param {import('playwright-core').Page} page @param {string} name */
async function shot(page, name) {
  if (shots) await page.screenshot({ path: join(shots, name) });
}

test('save, version, history, rename, share and log out', async (t) => {
  const context = await browser.newContext({ baseURL: planner.base, viewport: { width: 1280, height: 800 } });
  /** @type {string[]} */
  const errors = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'no script errors or CSP violations on the pages');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/status of 40[134]/.test(message.text())) errors.push(message.text());
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions });

  const status = page.locator('#status');
  /** What has the focus: its data-act, id, aria-expanded and the track row it is in. */
  const focused = () => page.evaluate(() => {
    const a = /** @type {HTMLElement} */ (document.activeElement);
    return {
      act: a?.dataset?.act, id: a?.id, expanded: a?.getAttribute('aria-expanded'),
      track: a?.closest('[data-track-id]')?.querySelector('.library-track-name')?.textContent,
    };
  });
  // palace's .btn transitions `all` for 0.1s, padding included: wait it out before measuring.
  const settled = () => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  /** @type {string[]} */
  const versionPosts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/versions$/.test(new URL(r.url()).pathname)) versionPosts.push(r.url()); });
  // Waits until the canvas, as the session store has it, is empty or not.
  // (#btn-clear's hidden attribute is no signal: palace's .btn sets display.)
  const canvasHas = (/** @type {boolean} */ some) => page.waitForFunction((want) => {
    const n = JSON.parse(sessionStorage.getItem('circuit30.layout') ?? '{"pieces":[]}').pieces.length;
    return want ? n > 0 : n === 0;
  }, some);

  const save = page.locator('#btn-save');

  // Logged out, the navbar is as it always was: Save downloads, no library.
  await page.goto('/');
  await page.locator('#btn-login').waitFor();
  assert.equal(await page.locator('#btn-download').isHidden(), true);
  assert.equal(await page.locator('#library-current').isHidden(), true);

  // Sign up with a passkey at accounts, then log in to the planner.
  await page.goto(`${planner.suite.issuer}/sign-up`);
  await page.getByLabel('Display name').fill('Ayrton');
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await page.locator('#code-list li').nth(9).waitFor();
  await page.getByLabel("I've saved them").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Your account is ready').waitFor();
  await page.goto('/');
  await page.locator('#btn-login').click();
  await page.locator('#btn-account').waitFor();
  assert.equal(await page.locator('#btn-account').textContent(), 'Ayrton');
  assert.equal(await page.locator('#btn-download').isVisible(), true);

  // A layout on the canvas: the stock one.
  await page.locator('#btn-presets').click();
  await page.locator('#presets-list button[data-preset-id]').first().click();
  await canvasHas(true);

  // Save: not a library track yet, so it asks for a name.
  await save.click();
  const saveDialog = page.locator('#save-dialog');
  await saveDialog.waitFor();
  const me = await page.evaluate(() => fetch('/auth/me').then((r) => r.json()));
  assert.equal(await page.locator('#save-workspace').inputValue(), me.workspaces[0].id, 'the personal workspace is preselected');
  await page.getByLabel('Name').fill('Monza');
  await page.locator('#save-name').press('Enter');
  await saveDialog.waitFor({ state: 'hidden' });
  await page.getByText('Saved Monza to your library.').waitFor();
  assert.equal(await page.locator('#library-current').textContent(), 'Monza');

  // An edit, then Save again: a second version of the same track. A double
  // click saves once.
  await page.locator('#btn-clear').click();
  await canvasHas(false);
  await save.dblclick();
  await page.getByText('Saved a new version of Monza.').waitFor();
  await page.waitForFunction(() => !(/** @type {HTMLButtonElement} */ (document.querySelector('#btn-save'))).disabled);
  assert.equal(versionPosts.length, 1, 'a double click posts one version');
  assert.equal(await saveDialog.isHidden(), true, 'no name asked the second time');

  // The library: one track, its history has two versions; open the first.
  await page.locator('#btn-account').click();
  await page.getByRole('menuitem', { name: 'Library' }).click();
  const dialog = page.locator('#library-dialog');
  const row = dialog.locator('.library-track', { hasText: 'Monza' });
  await row.waitFor();
  assert.equal(await row.getAttribute('aria-current'), 'true');
  assert.equal(await row.getByRole('button', { name: 'Delete' }).count(), 1, 'the owner may delete');
  assert.match(await row.locator('.library-meta').textContent(), /^Updated (just now|\d+ seconds? ago) by Ayrton$/);
  // By keyboard: Tab from Open to History, Enter. The focus stays on History.
  await row.getByRole('button', { name: 'Open', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal((await focused()).act, 'history');
  await page.keyboard.press('Enter');
  const versions = row.locator('.library-version');
  await versions.nth(1).waitFor();
  assert.deepEqual(await focused(), { act: 'history', id: '', expanded: 'true', track: 'Monza' }, 'focus survives the re-render');
  assert.equal(await versions.count(), 2);
  assert.equal(await versions.first().getAttribute('aria-current'), 'true', 'newest first, and current');
  await shot(page, 'task-9-library-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await settled();
  await shot(page, 'task-9-library-phone.png');
  await page.setViewportSize({ width: 1280, height: 800 });
  await versions.nth(1).getByRole('button', { name: /^Open/ }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText(/^Opened Monza as saved/).waitFor();
  await canvasHas(true);          // the first version had pieces
  assert.equal(await page.locator('#library-current').textContent(), 'Monza');

  // One undo step back to the empty version.
  await page.locator('#canvas').focus();
  await page.keyboard.press('Control+z');
  await canvasHas(false);

  // Rename.
  await page.locator('#btn-account').click();
  await page.getByRole('menuitem', { name: 'Library' }).click();
  await row.waitFor();
  // By keyboard: Enter on Rename puts the focus in the name; Enter saves it
  // and the focus is back on Rename.
  await row.getByRole('button', { name: 'Rename' }).focus();
  await page.keyboard.press('Enter');
  await row.getByLabel('New name').waitFor();
  assert.match((await focused()).id, /^rename-/);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Imola');
  await page.keyboard.press('Enter');
  await dialog.locator('.library-track', { hasText: 'Imola' }).waitFor();
  await page.waitForFunction(() => /** @type {HTMLElement} */ (document.activeElement)?.dataset?.act === 'rename');
  assert.equal((await focused()).track, 'Imola');
  assert.equal(await dialog.locator('.library-track').count(), 1);
  assert.equal(await page.locator('#library-current').textContent(), 'Imola');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // The link belongs to the layout: a stock layout (no link), open Imola,
  // undo. The stock layout is back without a link, so Save asks for a name
  // instead of posting it as a version of Imola.
  await page.locator('#btn-presets').click();
  await page.locator('#presets-list button[data-preset-id]').first().click();
  await page.locator('#library-current').waitFor({ state: 'hidden' });
  await page.locator('#btn-account').click();
  await page.getByRole('menuitem', { name: 'Library' }).click();
  await dialog.locator('.library-track', { hasText: 'Imola' }).getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByText('Opened Imola.').waitFor();
  assert.equal(await page.locator('#library-current').textContent(), 'Imola');
  await page.locator('#canvas').focus();
  await page.keyboard.press('Control+z');
  await page.locator('#library-current').waitFor({ state: 'hidden' });
  await save.click();
  await saveDialog.waitFor();
  await page.locator('#save-cancel').click();
  await saveDialog.waitFor({ state: 'hidden' });
  assert.equal(versionPosts.length, 1, 'no version of Imola was posted');
  // Undo once more: the empty Imola version, and its link, come back.
  await page.locator('#canvas').focus();
  await page.keyboard.press('Control+z');
  await canvasHas(false);
  assert.equal(await page.locator('#library-current').textContent(), 'Imola');

  // Share asks first; Cancel publishes nothing.
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/layouts') posts.push(r.url()); });
  await page.locator('#btn-share').click();
  const confirm = page.locator('#share-dialog');
  await confirm.waitFor();
  assert.equal(await confirm.locator('p').textContent(), 'Publishing makes this layout public at a permanent link. It cannot be undone.');
  await shot(page, 'task-9-share-confirm.png');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await confirm.waitFor({ state: 'hidden' });
  assert.equal(posts.length, 0);
  await page.locator('#btn-share').click();
  await confirm.getByRole('button', { name: 'Publish and copy link' }).click();
  await page.getByText(/^(Link copied|Share link): http/).waitFor();
  assert.equal(posts.length, 1);

  // Phone width: the navbar wraps instead of running off the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await settled();
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.navbar, .navbar *')]
    .filter((n) => n.getClientRects().length && n.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
    .map((n) => n.id || n.className));
  assert.deepEqual(overflow, [], 'nothing in the navbar reaches past the screen');
  await shot(page, 'task-9-navbar-phone.png');
  await page.setViewportSize({ width: 1280, height: 800 });
  await settled();
  assert.equal(await page.locator('.navbar').evaluate((n) => n.getBoundingClientRect().height), 52, 'desktop keeps the one-row bar');

  // Log out: the planner is back to downloads.
  await page.locator('#btn-account').click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.locator('#btn-login').waitFor();
  assert.equal(await page.locator('#btn-download').isHidden(), true);
  assert.equal(await page.locator('#menu-library').isHidden(), true);
  assert.equal(await status.isVisible(), true);
});
