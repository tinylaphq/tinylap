// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// tl-crossing-now on Setup's add list and on the form "Whose transponder is 52?"
// (drivers and transponders spec §3.1, §3.3): a passing of that number shows its
// "Crossing now" / "It's on the track now." and nothing else; an event older than
// the hold, as a reconnect replays them, lights nothing.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

const clock = { now: Date.now() };
let app;
let browser;
let member;
let decoder;
let other;
let workspace;
// The decoder's clock runs with real time, so a passing's server time is now.
const T0 = Date.now();
let last = 0;
const tick = () => { last = Math.max(last + 1, Date.now() - T0 + 1000); return last; };

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  for (const name of ['Ana', 'Ben Okafor']) await app.form(member, '/personal/drivers', { name });
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  workspace = me.workspaces[0].id;
  decoder = await (await app.api(member, 'POST', `/workspaces/${me.workspaces[0].id}/decoders`, { name: 'Start line' })).json();
  other = await (await app.api(member, 'POST', `/workspaces/${me.workspaces[0].id}/decoders`, { name: 'Pit lane' })).json();
  // Crossed a minute ago, so nothing is lit by the server; a decoder of its own, so the others' clocks stay true.
  const seed = await (await app.api(member, 'POST', `/workspaces/${me.workspaces[0].id}/decoders`, { name: 'Back straight' })).json();
  clock.now = Date.now() - 60_000;
  await postPassings(app, seed, ['41', '52', '66'].map((transponder, i) => ({ transponder, t: 1000 + i })));
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** The page, once its live stream is open. */
async function openLive(tc, path) {
  clock.now = Date.now();
  const opened = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  tc.after(() => opened.context.close());
  const live = opened.page.waitForResponse((r) => r.url().endsWith('/live'));
  await opened.page.goto(path);
  await live;
  return opened;
}

const slots = (page) => page.locator('.crossing-now').evaluateAll((els) => els.map((el) => ({ code: el.closest('[data-code]')?.getAttribute('data-code'), shown: !el.hidden })));

test("a passing shows Setup's Crossing now on that number's rows only", async (tc) => {
  const { page, errors } = await openLive(tc, '/personal/setup');
  assert.ok((await slots(page)).every((s) => !s.shown), 'nothing lit at first');
  await postPassings(app, decoder, [{ transponder: '52', t: tick() }]);
  await page.locator('[data-code="52"] .crossing-now:not([hidden])').first().waitFor({ state: 'attached' });
  const now = await slots(page);
  assert.equal(now.filter((s) => s.code === '52').length, 2, "one row in each driver's add list");
  for (const s of now) assert.equal(s.shown, s.code === '52', `${s.code}`);
  assert.deepEqual(errors, []);
});

test("a passing shows the form's It's on the track now.", async (tc) => {
  const { page, errors } = await openLive(tc, '/personal/transponders/41');
  const line = page.locator('.pick-live');
  assert.equal(await line.isHidden(), true);
  await postPassings(app, decoder, [{ transponder: '52', t: tick() }]);
  await postPassings(app, decoder, [{ transponder: '41', t: tick() }]);
  await line.waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
});

test('an event older than the hold lights nothing', async (tc) => {
  const { page, errors } = await openLive(tc, '/personal/transponders/new');
  // A passing the server got a minute ago, as a reconnect would replay it (another decoder, so its clock is its own).
  clock.now = Date.now() - 60_000;
  await postPassings(app, other, [{ transponder: '66', t: 5000 }]);
  clock.now = Date.now();
  await postPassings(app, decoder, [{ transponder: '41', t: tick() }]);
  await page.locator('.collect-row[data-code="41"].is-crossing').waitFor();
  assert.equal(await page.locator('.collect-row[data-code="66"]').getAttribute('class'), 'collect-row');
  assert.equal(await page.locator('[data-code="66"] .crossing-now').isHidden(), true);
  assert.deepEqual(errors, []);
});

test('a slot the server lit with 2 s left goes out after about 2 s, not a full hold', async (tc) => {
  // Crossed 8 s before the page loads, on a decoder of its own.
  const chicane = await (await app.api(member, 'POST', `/workspaces/${workspace}/decoders`, { name: 'Chicane' })).json();
  clock.now = Date.now() - 8000;
  await postPassings(app, chicane, [{ transponder: '77', t: 1000 }]);
  const { page, errors } = await openLive(tc, '/personal/transponders/new');
  const slot = page.locator('[data-code="77"] .crossing-now');
  const left = Number(await slot.getAttribute('data-left-ms'));
  assert.ok(left > 1000 && left <= 2500, `${left} ms left`);
  const started = Date.now();
  await slot.waitFor({ state: 'hidden', timeout: 8000 });
  const took = Date.now() - started;
  assert.ok(took <= left + 1500, `went out after ${took} ms, with ${left} ms left`);
  assert.equal(await page.locator('.collect-row[data-code="77"]').getAttribute('class'), 'collect-row');
  assert.deepEqual(errors, []);
});
