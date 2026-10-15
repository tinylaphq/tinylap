// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

let app;
let browser;
let member;
let office;
let decoder;
let ana;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  const owner = await app.signUp('Ana');
  office = app.club(owner, 'Office');
  member = await app.login(owner);
  ana = await (await app.api(member, 'POST', `/workspaces/${office.id}/drivers`, { name: 'Ana' })).json();
  await app.api(member, 'PUT', `/workspaces/${office.id}/transponders/10`, { driverId: ana.id });
  decoder = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name: 'Gate' })).json();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('the board shows laps as they arrive, and unknown cars', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/');
  await page.getByRole('heading', { name: 'Waiting for the first car' }).waitFor();
  await postPassings(app, decoder, [{ transponder: '10', t: 1000 }, { transponder: '10', t: 9000 }, { transponder: '4711', t: 9500 }]);
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  await page.locator('.board-table').getByText('Ana').waitFor();
  // Laps, Best, Last: the best cell holds the time and its PB badge.
  assert.match(await page.locator('.board-table td.num').nth(1).innerText(), /^8\.000\s*PB$/);
  await page.getByRole('status').filter({ hasText: 'Unknown car: 4711' }).waitFor();
  assert.deepEqual(errors, []);
});

test('watchers see the board without setup, until the link is rotated', async (t) => {
  const { token } = await (await app.api(member, 'POST', `/workspaces/${office.id}/watch-token`)).json();
  const { context, page, errors } = await pageAs(browser, app, null, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto(`/#watch=${token}`);
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  assert.equal(await page.locator('#nav').isVisible(), false);
  assert.equal(await page.getByText('4711').count(), 0, 'no transponder codes for watchers');
  await app.api(member, 'POST', `/workspaces/${office.id}/watch-token`);
  await page.getByRole('heading', { name: 'This watchers link no longer works' }).waitFor();
  assert.deepEqual(errors.filter((e) => !/EventSource|404/.test(e)), []);
});

test('a finished race stays on the board as results while practice runs', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto('/');
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  // A two-second race, shorter than the API allows, so the test doesn't wait minutes.
  const { session } = app.engine.start(office.id, { kind: 'race', roster: [ana.id], durationMs: 2000, countdownMs: 0 });
  await page.getByRole('heading', { name: 'Race' }).waitFor();
  await postPassings(app, decoder, [{ transponder: '10', t: 20_000 }], 'raceb00t');
  await new Promise((done) => setTimeout(done, 2100));
  app.engine.tick();
  await postPassings(app, decoder, [{ transponder: '10', t: 28_000 }], 'raceb00t');
  assert.equal(app.store.session(session.id).state, 'done');
  await postPassings(app, decoder, [{ transponder: '10', t: 40_000 }], 'raceb00t');
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  const results = page.getByRole('region', { name: 'Results' });
  await results.getByRole('heading', { name: /Race results\s*Finished/ }).waitFor();
  assert.match(await results.locator('tbody tr').first().innerText(), /^1\s+Ana\s+1\s+8\.000\s+8\.\d{3}$/);
  // The phone layout scrolls tables inside the board, never the page sideways.
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
});
