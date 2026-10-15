// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const clock = { now: Date.now() };
let app;
let browser;
let member;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  await app.form(member, '/personal/drivers', { name: 'Ana' });
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('with JavaScript, taps answer in place without a page load', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto('/personal/tap');
  let loads = 0;
  page.on('load', () => { loads += 1; });
  await page.getByRole('button', { name: 'Ana' }).click();
  await page.getByRole('status').filter({ hasText: 'Ana: started' }).waitFor();
  clock.now += 8000;
  await page.getByRole('button', { name: 'Ana' }).click();
  await page.getByRole('status').filter({ hasText: 'Ana: 8.000' }).waitFor();
  assert.equal(loads, 0);
  assert.equal(new URL(page.url()).pathname, '/personal/tap');
  assert.deepEqual(errors, []);
});

test('a failed request shows an alert, keeps the page and never posts again', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto('/personal/tap');
  let posts = 0;
  let navigations = 0;
  page.on('request', (request) => { if (request.method() === 'POST') posts += 1; });
  page.on('framenavigated', () => { navigations += 1; });
  await page.route('**/personal/tap', (route) => route.abort('connectionreset'));
  await page.getByRole('button', { name: 'Ana' }).click();
  const alert = page.getByRole('alert');
  await alert.filter({ hasText: 'No answer from the server. Check the board before tapping again.' }).waitFor();
  assert.ok(await alert.evaluate((el) => el.classList.contains('status-error')));
  await page.waitForTimeout(300);
  assert.equal(posts, 1);
  assert.equal(navigations, 0);
  assert.equal(new URL(page.url()).pathname, '/personal/tap');
  void errors;
});

test('rapid taps: a stale answer does not overwrite the latest', async (t) => {
  const { context, page } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/tap');
  // Hold the first answer until the second has arrived. The clock moves only
  // once the server has handled the first tap, so each tap sees its own time.
  let first = true;
  let handled;
  let release;
  const firstHandled = new Promise((resolve) => { handled = resolve; });
  const firstReleased = new Promise((resolve) => { release = resolve; });
  await page.route('**/personal/tap', async (route) => {
    const response = await route.fetch();
    if (first) {
      first = false;
      handled();
      await firstReleased;
    }
    await route.fulfill({ response });
  });
  clock.now += 5000;
  await page.getByRole('button', { name: 'Ana' }).click();
  await firstHandled;
  clock.now += 7000;
  await page.getByRole('button', { name: 'Ana' }).click();
  await page.getByRole('status').filter({ hasText: 'Ana: 7.000' }).waitFor();
  const settled = page.waitForEvent('requestfinished');
  release();
  await settled;
  // Two frames: the stale answer's script has run by then.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.match(await page.getByRole('status').innerText(), /Ana: 7\.000/);
  assert.equal(await page.getByRole('alert').count(), 0);
});

test('an expired session says to sign in again, with a link back to the page', async (t) => {
  const user = await app.signUp('Ben');
  const who = await app.login(user);
  await app.form(who, '/personal/drivers', { name: 'Ben' });
  const { context, page } = await pageAs(browser, app, who, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto('/personal/tap');
  await context.clearCookies();
  await page.getByRole('button', { name: 'Ben' }).click();
  const alert = page.getByRole('alert');
  await alert.filter({ hasText: 'Sign in again to keep tapping.' }).waitFor();
  assert.equal(await alert.getByRole('link', { name: 'Sign in again' }).getAttribute('href'), '/personal/tap');
  assert.equal(new URL(page.url()).pathname, '/personal/tap');
});
