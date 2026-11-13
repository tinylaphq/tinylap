// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Assigning from the board (drivers and transponders spec §4, §7): a transponder
// nobody has assigned crosses during a session, the board warns, "Assign it" goes
// to the form, choosing a driver comes back to the board with the warning gone,
// and the car's next laps count. At a laptop's width and at a phone's.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

// Server time runs with real time; a test only ever moves it forward.
const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
let decoder;
let ws;
let t = 1000;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  useTrack(app.store, ws, 'Ring', 'cw', 't1');
  decoder = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Gate' })).json();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** A crossing `gap` ms after the last one, later than every crossing so far. */
async function pass(transponder, gap = 20_000) {
  t += gap;
  assert.equal((await postPassings(app, decoder, [{ transponder, t }])).status, 200);
}

for (const [size, viewport, code, name] of [['laptop', { width: 1280, height: 800 }, '71', 'Cleo'], ['phone', { width: 390, height: 844 }, '72', 'Dara']]) {
  test(`at ${size} width an unknown transponder is assigned from the board's warning`, async (tc) => {
    await app.form(member, '/personal/drivers', { name });
    app.engine.start(ws, { kind: 'practice' });
    clock.offset += 10_000; // a practice starts clean: the laps begin after its start
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    tc.after(async () => { app.engine.end(ws, app.store.runningSession(ws).id); await context.close(); });
    await page.goto('/personal/board');
    await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.board-unknown').count(), 0);
    await pass(code);
    const warning = page.locator('.board-unknown');
    await warning.waitFor();
    assert.match(await warning.innerText(), new RegExp(`Transponder ${code} isn't assigned yet, so its laps aren't counted\\. Assign it`));
    await warning.getByRole('link', { name: 'Assign it' }).click();
    await page.waitForURL(`**/personal/transponders/${code}?*`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
    await page.getByRole('button', { name: new RegExp(`Assign to ${name}`) }).click();
    await page.waitForURL('**/personal/board');
    await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
    await page.locator('.board-unknown').waitFor({ state: 'detached' });
    // Its later laps count now.
    await pass(code, 5000);
    await pass(code, 9000);
    const row = page.locator('.board-table tr', { hasText: name });
    await row.waitFor();
    assert.ok(Number(await row.locator('td.num').first().innerText()) >= 1, 'a lap counted');
    assert.equal(await page.locator('.board-unknown').count(), 0);
    assert.deepEqual(errors, []);
  });
}

test('Enter in the new driver field assigns to a new driver of that name, not to the first driver', async (tc) => {
  await app.form(member, '/personal/drivers', { name: 'Abe' });
  const { context, page, errors } = await pageAs(browser, app, member);
  tc.after(() => context.close());
  await page.goto('/personal/transponders/74');
  await page.getByLabel('Or a new driver').fill('Esme');
  await page.getByLabel('Or a new driver').press('Enter');
  await Promise.race([page.waitForURL((url) => !url.pathname.endsWith('/transponders/74')), page.getByText('Pick a driver, or name a new one.').first().waitFor()]);
  assert.doesNotMatch(new URL(page.url()).pathname, /\/transponders\/74$/, await page.locator('#page-status').innerText());
  const esme = app.store.drivers(ws).find((d) => d.name === 'Esme');
  assert.ok(esme, 'a new driver Esme');
  assert.equal(app.store.transponders(ws).find((x) => x.code === '74')?.driverId, esme.id);
  assert.deepEqual(errors, []);
});
