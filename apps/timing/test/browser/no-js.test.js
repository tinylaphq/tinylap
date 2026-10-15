// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// AGENTS.md "Web platform first": with JavaScript switched off, every
// screen works through links and forms, and Back and Forward behave.
// The tests run in order and share one club space: the first sets up the track.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { CLOSED, startPlannerStub } from '../server/planner-stub.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let planner;
let browser;
let member;
let personal;

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ plannerUrl: planner.url });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  personal = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
});
after(async () => {
  await browser?.close();
  await app?.close();
  await planner?.close();
});

const pathOf = (page) => new URL(page.url()).pathname;

/** A JavaScript-free page whose context is proven to have scripts off. */
async function plainPage(t, who = member) {
  const { context, page } = await pageAs(browser, app, who, { javaScriptEnabled: false });
  t.after(() => context.close());
  // The bridge page shows its "unsupported" notice only when no script ran: with scripts on, Chrome has Web Serial and the notice is replaced.
  await page.goto('/personal/bridge');
  await page.getByText(/needs Chrome or Edge/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), false);
  return page;
}

test('set the track and manage drivers', async (t) => {
  const page = await plainPage(t);
  await page.goto('/');
  assert.equal(pathOf(page), '/personal/board');
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  assert.equal(pathOf(page), '/personal/setup');

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
  assert.equal(pathOf(page), '/personal/setup');
  await page.goForward();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByText('Benji').waitFor({ state: 'detached' });
  assert.deepEqual(app.store.drivers(personal).map((d) => d.name), ['Ana']);
});

test('assign a transponder that crossed the line', async (t) => {
  const decoder = await (await app.api(member, 'POST', `/workspaces/${personal}/decoders`, { name: 'Gate' })).json();
  const sent = await app.api(member, 'POST', `/decoders/${decoder.id}/passings`, { boot: 'b00tb00t', passings: [{ transponder: '4711', t: 1000 }] });
  assert.ok(sent.ok, `passing: ${sent.status}`);
  const page = await plainPage(t);
  await page.goto('/personal/setup');
  await page.getByLabel('Driver for 4711').selectOption({ label: 'Ana' });
  await page.getByRole('button', { name: 'Assign' }).click();
  await page.waitForURL(/\/personal\/setup/);
  assert.equal(await page.getByLabel('Driver for 4711').inputValue(), app.store.drivers(personal)[0].id);
  assert.equal(app.store.transponders(personal).find((x) => x.code === '4711').driverId, app.store.drivers(personal)[0].id);
});

test('race, tap and Back and Forward across a POST and its 303 change nothing twice', async (t) => {
  const page = await plainPage(t);
  await page.goto('/personal/race');
  await page.getByLabel('Minutes').fill('2');
  await page.getByLabel(/Countdown/).fill('0');
  await page.getByRole('button', { name: 'Start' }).click();
  assert.equal(pathOf(page), '/personal/board');
  await page.getByRole('heading', { name: 'Race' }).waitFor();
  const started = app.engine.snapshot(personal).session?.id;
  assert.ok(started);

  // Back lands before the POST, Forward on the board again: no resubmit, no second session.
  await page.goBack();
  assert.equal(pathOf(page), '/personal/race');
  await page.goForward();
  assert.equal(pathOf(page), '/personal/board');
  assert.equal(app.engine.snapshot(personal).session?.id, started);

  await page.getByRole('link', { name: 'Tap', exact: true }).click();
  await page.getByRole('button', { name: 'Ana' }).click();
  await page.getByRole('status').filter({ hasText: 'Ana: started' }).waitFor();
  const crossings = app.engine.snapshot(personal).crossings.length;
  await page.goBack();
  await page.goForward();
  assert.equal(pathOf(page), '/personal/tap');
  await page.getByRole('status').filter({ hasText: 'Ana: started' }).waitFor();
  assert.equal(app.engine.snapshot(personal).crossings.length, crossings, 'Back and Forward did not tap again');

  await page.getByRole('link', { name: 'Race', exact: true }).click();
  await page.getByRole('link', { name: 'Abort' }).click();
  await page.getByRole('heading', { name: 'Abort the race?' }).waitFor();
  await page.getByRole('button', { name: 'Abort' }).click();
  await page.getByRole('button', { name: 'Start' }).waitFor();
});

test('the bridge page offers its links without JavaScript', async (t) => {
  const page = await plainPage(t);
  await page.getByRole('link', { name: 'Pair over Wi-Fi only' }).click();
  assert.equal(pathOf(page), '/personal/setup');
  await page.goBack();
  await page.getByRole('link', { name: 'tap laps by hand' }).click();
  assert.equal(pathOf(page), '/personal/tap');
});

test('the watchers page works without JavaScript or a log-in', async (t) => {
  await app.form(member, '/personal/watch-link', {});
  const token = app.store.workspace(personal).watchToken;
  const page = await plainPage(t);
  await page.context().clearCookies();
  await page.goto(`/watch/${token}`);
  assert.equal(pathOf(page), `/watch/${token}`);
  assert.equal(await page.getByText('Ana', { exact: true }).first().isVisible(), true);
  assert.equal(await page.getByRole('link', { name: 'Setup' }).count(), 0);
});

test('sign out ends on the start page or the issuer, signed out', async (t) => {
  const { context, page } = await pageAs(browser, app, member, { javaScriptEnabled: false });
  t.after(() => context.close());
  await page.goto('/personal/board');
  await page.locator('summary', { hasText: 'Ana' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForLoadState('load');
  const signedOut = new URL(page.url()).origin === app.base
    ? await page.getByRole('link', { name: 'Sign in' }).first().isVisible()
    : true;
  assert.ok(signedOut, `ended at ${page.url()}`);
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).first().waitFor();
});
