// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { CLOSED, startPlannerStub } from '../server/planner-stub.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

const clock = { now: Date.now() };
let app;
let planner;
let browser;
let member;
let office;
let decoder;

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ clock, plannerUrl: planner.url });
  browser = await openBrowser();
  const owner = await app.signUp('Ana');
  office = app.club(owner, 'Office');
  member = await app.login(owner);
  decoder = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name: 'Gate' })).json();
});
after(async () => {
  await browser?.close();
  await app?.close();
  await planner?.close();
});

test('setup: drivers, an unknown car, the track and the watchers link', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/#setup');
  await page.getByLabel('New driver').fill('Ana');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await page.getByLabel('New driver').fill('Ben');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Ben' }).waitFor();

  await postPassings(app, decoder, [{ transponder: '4711', t: 1000 }]);
  const row = page.getByRole('row').filter({ hasText: '4711' });
  await row.getByRole('combobox').selectOption({ label: 'Ben' });
  await page.waitForFunction(() => document.querySelector('tr.is-unknown') === null);
  assert.deepEqual(app.store.transponders(office.id).map((x) => x.code), ['4711']);
  assert.notEqual(app.store.transponders(office.id)[0].driverId, null);

  await page.getByLabel('Planner link').fill(`${planner.url}/layouts/${CLOSED}`);
  await page.getByLabel('Track name').fill('Office loop');
  await page.getByLabel('Direction').selectOption('cw');
  await page.getByRole('button', { name: 'Use this track' }).click();
  await page.getByText('Now: Office loop, clockwise.').waitFor();

  await page.getByRole('button', { name: 'Make a watchers link' }).click();
  const link = await page.getByLabel('Watchers link').inputValue();
  assert.match(link, /\/#watch=[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(errors, []);
});

test('race control starts and aborts a race', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/#control');
  await page.getByLabel('Race', { exact: true }).check();
  await page.getByLabel('Minutes').fill('2');
  await page.getByLabel('Countdown (seconds)').fill('0');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('heading', { name: 'Race' }).waitFor();
  await page.getByText('Remaining').waitFor();
  await page.goto('/#control');
  await page.getByRole('button', { name: 'Abort' }).click();
  await page.getByRole('button', { name: 'Start' }).waitFor();
  assert.deepEqual(errors, []);
});

test('tap entry records laps by hand', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto('/#tap');
  const ana = page.getByRole('button', { name: 'Ana' });
  await ana.click();
  clock.now += 8000;
  await ana.click();
  await page.getByText('8.000').waitFor();
  await page.goto('/#board');
  await page.locator('.board-laps').getByText('tap').first().waitFor();
  assert.deepEqual(errors, []);
});

test('setup keeps what is being typed while drivers arrive', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/#setup');
  const input = page.getByLabel('New driver');
  await input.focus();
  await input.pressSequentially('Dan');
  await app.api(member, 'POST', `/workspaces/${office.id}/drivers`, { name: 'Eve' });
  await page.getByRole('listitem').filter({ hasText: 'Eve' }).waitFor();
  assert.equal(await input.inputValue(), 'Dan');
  assert.equal(await input.evaluate((el) => el === document.activeElement), true);
  assert.deepEqual(errors, []);
});
