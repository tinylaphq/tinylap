// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// AGENTS.md "Web platform first": with JavaScript switched off, every
// screen works through links and forms, and Back and Forward behave.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { CLOSED, startPlannerStub } from '../server/planner-stub.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let planner;
let browser;
let member;

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ plannerUrl: planner.url });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
});
after(async () => {
  await browser?.close();
  await app?.close();
  await planner?.close();
});

test('set up, race, tap and sign out with JavaScript off', async (t) => {
  const { context, page } = await pageAs(browser, app, member, { javaScriptEnabled: false });
  t.after(() => context.close());
  await page.goto('/');
  assert.equal(new URL(page.url()).pathname, '/personal/board');
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/personal/setup');

  await page.getByLabel('Planner link').fill(`${planner.url}/layouts/${CLOSED}`);
  await page.getByLabel('Track name').fill('Office loop');
  await page.getByLabel('Direction').selectOption('cw');
  await page.getByRole('button', { name: 'Use this track' }).click();
  await page.getByText('Now: Office loop, clockwise.').waitFor();

  for (const name of ['Ana', 'Ben']) {
    await page.getByLabel('New driver').fill(name);
    await page.getByRole('button', { name: 'Add driver' }).click();
  }
  await page.getByLabel('New name for Ben').fill('Benji');
  await page.locator('form', { has: page.getByLabel('New name for Ben') }).getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('New name for Benji').waitFor();

  await page.locator('#drivers li', { has: page.getByLabel('New name for Benji') }).getByRole('link', { name: 'Delete' }).click();
  await page.getByRole('heading', { name: 'Delete Benji?' }).waitFor();
  await page.goBack();
  assert.equal(new URL(page.url()).pathname, '/personal/setup');
  await page.goForward();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByText('Benji').waitFor({ state: 'detached' });

  await page.getByRole('link', { name: 'Race', exact: true }).click();
  await page.getByLabel('Minutes').fill('2');
  await page.getByLabel(/Countdown/).fill('0');
  await page.getByRole('button', { name: 'Start' }).click();
  assert.equal(new URL(page.url()).pathname, '/personal/board');
  await page.getByRole('heading', { name: 'Race' }).waitFor();
  await page.getByRole('link', { name: 'Race', exact: true }).click();
  await page.getByRole('link', { name: 'Abort' }).click();
  await page.getByRole('heading', { name: 'Abort the race?' }).waitFor();
  await page.getByRole('button', { name: 'Abort' }).click();
  await page.getByRole('button', { name: 'Start' }).waitFor();

  await page.getByRole('link', { name: 'Tap', exact: true }).click();
  await page.getByRole('button', { name: 'Ana' }).click();
  await page.getByRole('status').filter({ hasText: 'Ana: started' }).waitFor();

  await page.locator('summary', { hasText: 'Ana' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.origin !== app.base || url.pathname === '/');
});
