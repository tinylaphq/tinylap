// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The app as production serves it: assembled under /v/<sha>/ with
// <base href="/v/<sha>/">. Links inside the app must still lead to its
// screens, not to /v/<sha>/#… (which is a 404).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../../../../tools/assemble.js';
import { appDir, startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;
let member;
let office;

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'timing-assembled-'));
  assemble(appDir, root, 'abc1234');
  app = await startTiming({ root });
  browser = await openBrowser();
  const owner = await app.signUp('Ana');
  office = app.club(owner, 'Office');
  member = await app.login(owner);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('tabs and in-page links lead to their screens under a versioned <base>', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/');
  await page.getByRole('heading', { name: 'Waiting for the first car' }).waitFor();

  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await page.getByRole('heading', { name: 'Setup' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/');

  await page.getByRole('link', { name: 'Race', exact: true }).click();
  await page.getByRole('heading', { name: 'Race control' }).waitFor();
  // Race control without drivers points to Setup.
  await page.locator('main').getByRole('link', { name: 'Setup' }).click();
  await page.getByRole('heading', { name: 'Setup' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  assert.deepEqual(errors, []);
});

test('an empty board tells a member how to get the track ready', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/');
  const steps = page.getByRole('region', { name: 'Get the track ready' });
  await steps.waitFor();
  assert.deepEqual(await steps.getByRole('listitem').locator('h3').allTextContents(), ['Choose the track', 'Add drivers', 'Start timing']);
  await steps.getByRole('link', { name: 'Add drivers' }).click();
  await page.getByRole('heading', { name: 'Setup' }).waitFor();
  await page.getByLabel('New driver').fill('Ana');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Ana' }).waitFor();
  await page.getByRole('link', { name: 'Board', exact: true }).click();
  await steps.getByText('1 driver').waitFor();
  await steps.getByRole('link', { name: 'Tap laps by hand' }).click();
  await page.getByRole('button', { name: 'Ana' }).waitFor();
  assert.deepEqual(errors, []);
});

test('watchers see no setup steps on an empty board', async (t) => {
  const { token } = await (await app.api(member, 'POST', `/workspaces/${office.id}/watch-token`)).json();
  const { context, page } = await pageAs(browser, app, null);
  t.after(() => context.close());
  await page.goto(`/#watch=${token}`);
  await page.getByText('No laps yet.').waitFor();
  assert.equal(await page.getByRole('region', { name: 'Get the track ready' }).count(), 0);
});
