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
