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
let decoder;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  await app.form(member, '/personal/drivers', { name: 'Ana' });
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  const personal = me.workspaces[0].id;
  app.engine.assign(personal, '10', app.store.drivers(personal)[0].id);
  decoder = await (await app.api(member, 'POST', `/workspaces/${personal}/decoders`, { name: 'Gate' })).json();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('the board updates live and its clock ticks', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/board');
  await page.getByRole('heading', { name: 'Waiting for the first car' }).waitFor();
  app.engine.start((await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id, { kind: 'practice' });
  await postPassings(app, decoder, [{ transponder: '10', t: 1000 }, { transponder: '10', t: 9000 }]);
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  await page.locator('.board-table').getByText('Ana').waitFor();
  await page.locator('#live-status[data-state="live"]').waitFor();
  const before = await page.locator('time[data-clock]').innerText();
  await page.waitForFunction((was) => document.querySelector('time[data-clock]')?.textContent !== was, before, { timeout: 3000 });
  assert.deepEqual(errors, []);
});

test('on a phone the live status shows', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto('/personal/board');
  const status = page.locator('#live-status');
  await status.and(page.locator('[data-state="live"]')).waitFor();
  assert.equal(await status.innerText(), 'LIVE');
  assert.ok(await status.isVisible());
  assert.deepEqual(errors, []);
});

test('the watchers board says when its stream drops, and gives up once the link is replaced', async (t) => {
  await app.form(member, '/personal/watch-link', {});
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  const token = app.store.workspace(me.workspaces[0].id).watchToken;
  const { context, page } = await pageAs(browser, app, null, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto(`/watch/${token}`);
  await page.locator('#live-status[data-state="live"]').waitFor();
  await app.form(member, '/personal/watch-link', {});
  await page.locator('#live-status[data-state="reconnecting"]').waitFor();
  await page.locator('#live-status[data-state="off"]').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#live-status').innerText(), 'DISCONNECTED');
});

test('the big screen offers full screen and keeps big mode through the stream', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await page.goto('/personal/board?big');
  await page.getByRole('button', { name: 'Full screen' }).waitFor();
  assert.equal(await page.locator('#board-live').getAttribute('data-events'), '/personal/board/events?big');
  await postPassings(app, decoder, [{ transponder: '77', t: 20000 }]);
  await page.locator('.board-laps li').first().waitFor();
  assert.equal(await page.locator('.board-unknown').count(), 0);
  assert.equal(await page.locator('#board-live').getAttribute('data-events'), '/personal/board/events?big');
  assert.deepEqual(errors, []);
});

/** Ends every board stream open now, as a server restart would. */
function boardStreams() {
  const open = [];
  const subscribe = app.hub.subscribe;
  app.hub.subscribe = (workspaceId, options, send) => {
    const sub = subscribe.call(app.hub, workspaceId, options, send);
    open.push(options.onClose);
    return sub;
  };
  return {
    drop: () => open.splice(0).forEach((close) => close?.()),
    restore: () => { app.hub.subscribe = subscribe; },
  };
}

test('a member board says when its stream drops and comes back live', async (t) => {
  const streams = boardStreams();
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => { streams.restore(); return context.close(); });
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  streams.drop();
  await page.locator('#live-status[data-state="reconnecting"]').waitFor();
  await page.locator('#live-status[data-state="live"]').waitFor({ timeout: 5000 });
  assert.deepEqual(errors, []);
});

test('a board whose stream is refused reloads itself', async (t) => {
  const streams = boardStreams();
  const { context, page } = await pageAs(browser, app, member);
  t.after(() => { streams.restore(); return context.close(); });
  await page.clock.install();
  let asked = 0;
  await page.route('**/personal/board/events', (route) => {
    asked += 1;
    return asked === 2 ? route.fulfill({ status: 404, contentType: 'text/html', body: '<p>gone</p>' }) : route.continue();
  });
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  streams.drop();
  await page.locator('#live-status[data-state="off"]').waitFor();
  const reloaded = page.waitForEvent('load');
  await page.clock.fastForward(10_000); // the board waits 10 s before it reloads
  await reloaded;
  assert.equal(new URL(page.url()).pathname, '/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  assert.equal(asked, 3);
});

test('focus stays on the same link, and the notice is not announced again, when the board is replaced', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await postPassings(app, decoder, [{ transponder: '55', t: 40000 }]);
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  const link = page.getByRole('link', { name: 'Assign in Setup' });
  await link.focus();
  await page.evaluate(() => {
    /** @type {any} */ (document.querySelector('#board-live')).stale = true;
    /** @type {any} */ (document.querySelector('.board-unknown')).kept = true;
  });
  await postPassings(app, decoder, [{ transponder: '10', t: 41000 }]);
  await page.waitForFunction(() => !(/** @type {any} */ (document.querySelector('#board-live'))).stale);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '/personal/setup#transponders');
  assert.equal(await page.evaluate(() => /** @type {any} */ (document.querySelector('.board-unknown')).kept), true);
  assert.deepEqual(errors, []);
});

test('the full-screen button toggles', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await page.goto('/personal/board?big');
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.getByRole('button', { name: 'Leave full screen' }).click();
  await page.getByRole('button', { name: 'Full screen' }).waitFor();
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  assert.deepEqual(errors, []);
});

test('the wall screen shows the lamp once the stream is not live', async (t) => {
  const streams = boardStreams();
  const { context, page } = await pageAs(browser, app, member, { viewport: { width: 1920, height: 1080 } });
  t.after(() => { streams.restore(); return context.close(); });
  await page.goto('/personal/board?big');
  await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#live-status').isVisible(), false);
  streams.drop();
  await page.locator('#live-status[data-state="reconnecting"]').waitFor({ state: 'visible' });
});
