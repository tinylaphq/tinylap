// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;
let member;
let personal;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  personal = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('connect, pair and forward with the simulated decoder', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/bridge?simulate=fast');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  await page.getByLabel('Decoder name').fill('  Gate  ');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText(/^Forwarding from decoder /).waitFor();
  await page.locator('[data-bridge-preview] li').first().waitFor({ timeout: 20_000 });
  assert.equal(app.store.decoders(personal)[0].name, 'Gate');
  assert.ok(app.engine.snapshot(personal).crossings.length > 0);
  assert.deepEqual(errors, []);
});

test('without JavaScript, the page says what the bridge needs', async (t) => {
  const { context, page } = await pageAs(browser, app, member, { javaScriptEnabled: false });
  t.after(() => context.close());
  await page.goto('/personal/bridge');
  await page.getByText(/needs Chrome or Edge/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), false);
  assert.equal(await page.getByRole('link', { name: 'Pair over Wi-Fi only' }).isVisible(), true);
});

test('without Web Serial, the notice stays and no button is offered', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.addInitScript(() => { delete Navigator.prototype.serial; });
  await page.goto('/personal/bridge');
  await page.getByText(/needs Chrome or Edge/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
