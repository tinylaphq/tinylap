// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wall screen fits its screen (spec 6.1): at 1920×1080, with four drivers,
// a decoder on the strip, both times to beat and a full Last laps, the board
// ends inside 1080: the server sends Last laps' eleven newest, not twelve,
// and every row shows whole.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
const start = Date.now();
const decoderNow = () => clock.now - start;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  const ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  const names = ['Ana', 'Ben', 'Chiara', 'Dominik'];
  for (const name of names) await app.form(member, '/personal/drivers', { name });
  app.store.drivers(ws).forEach((d, i) => app.engine.assign(ws, String(10 + i), d.id));
  useTrack(app.store, ws, 'Ring', 'cw', 't1');
  const decoder = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Start line' })).json();
  app.engine.start(ws, { kind: 'practice' });
  clock.offset += 10_000;
  // Four laps each, a car every ~2 s: 16 laps, more than Last laps keeps.
  const passings = [];
  for (let lap = 0; lap <= 4; lap++) {
    for (let car = 0; car < 4; car++) passings.push({ transponder: String(10 + car), t: decoderNow() + lap * 8000 + car * 1900 + lap * car * 37 });
  }
  clock.offset += 4 * 8000 + 4 * 1900 + 1000;
  assert.equal((await postPassings(app, decoder, passings)).status, 200);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('at 1920×1080 the big board ends inside the screen, and Last laps shows whole rows', async () => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 1920, height: 1080 } });
  await page.goto('/personal/board?big');
  await page.locator('.board-feed .board-laps li').first().waitFor();
  const read = await page.evaluate(() => {
    const feed = document.querySelector('.board-feed');
    const bottom = feed.getBoundingClientRect().bottom;
    const rows = [...feed.querySelectorAll('.board-laps li')];
    const shown = rows.filter((li) => li.getBoundingClientRect().height > 0);
    return {
      height: document.documentElement.scrollHeight,
      decoders: document.querySelectorAll('.board-track .board-decoders').length,
      times: document.querySelectorAll('.board-track-times > p').length,
      drivers: document.querySelectorAll('.standings-table tbody tr').length,
      rows: rows.length,
      shown: shown.length,
      cut: shown.filter((li) => li.getBoundingClientRect().bottom > bottom + 0.5).length,
      feedBottom: bottom,
    };
  });
  assert.equal(read.drivers, 4);
  assert.equal(read.decoders, 1, 'the strip shows its decoder');
  assert.equal(read.times, 2, 'and both times to beat');
  assert.equal(read.rows, 11, 'Last laps shows the eleven newest');
  assert.equal(read.shown, 11);
  assert.ok(read.height <= 1080, `the board is ${read.height}px tall`);
  assert.ok(read.feedBottom <= 1080, `Last laps ends at ${read.feedBottom}px`);
  assert.equal(read.cut, 0, 'no Last laps row is cut');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a laptop\'s board still shows all twelve', async () => {
  const { context, page, errors } = await pageAs(browser, app, member);
  await page.goto('/personal/board');
  await page.locator('.board-feed .board-laps li').first().waitFor();
  const shown = await page.evaluate(() => [...document.querySelectorAll('.board-feed .board-laps li')].filter((li) => li.getBoundingClientRect().height > 0).length);
  assert.equal(shown, 12);
  assert.deepEqual(errors, []);
  await context.close();
});
