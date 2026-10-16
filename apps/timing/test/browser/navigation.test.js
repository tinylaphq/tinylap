// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Moving between pages stays a page load, made quicker by the speculation
// rules from @tinylap/design: a link the pointer rests on is fetched ahead.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;
let member;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('a hovered navbar link is prefetched, and the click uses it', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/board');
  const prefetched = page.waitForRequest((r) => new URL(r.url()).pathname === '/personal/race' && /prefetch/i.test(r.headers()['sec-purpose'] ?? ''));
  await page.getByRole('link', { name: 'Race' }).hover();
  await prefetched;
  await page.getByRole('link', { name: 'Race' }).click();
  await page.waitForURL('**/personal/race');
  assert.equal(await page.evaluate(() => /** @type {any} */ (performance.getEntriesByType('navigation')[0]).deliveryType), 'navigational-prefetch');
  assert.deepEqual(errors, []);
});

test('the sign-out form and sign-in links are never prefetched', async (t) => {
  const { context, page } = await pageAs(browser, app, null);
  t.after(() => context.close());
  const speculative = [];
  page.on('request', (r) => { if (r.headers()['sec-purpose']) speculative.push(new URL(r.url()).pathname); });
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).first().hover();
  await page.waitForTimeout(500);
  assert.deepEqual(speculative.filter((p) => p.startsWith('/auth/')), []);
});
