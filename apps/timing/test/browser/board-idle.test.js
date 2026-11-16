// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The idle board's layout (board hub spec §4.1, §4.3, §6.4): after a race of
// six, two columns --p-space-2xl apart, the Start title level with the
// result's, the side's first box level with P1's card, the strip's record cell
// on the side's edge. The TV is the strip and the result in three reads, and
// fits 1920×1080. A phone stacks the side under the result, with no sideways
// scroll.
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
  for (const name of ['Ana', 'Ben Okafor', 'Cyrille Featherstonehaugh', 'Dara', 'Jo', 'Mia Schulz']) await app.form(member, '/personal/drivers', { name });
  const drivers = app.store.drivers(ws);
  drivers.forEach((d, i) => app.engine.assign(ws, String(10 + i), d.id));
  useTrack(app.store, ws, 'Kitchen Ring', 'cw', 't1');
  const decoder = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Start line' })).json();
  // A race of six for 50 s, seven laps each; Mia a lap down.
  const race = app.engine.start(ws, { kind: 'race', roster: drivers.map((d) => d.id), durationMs: 50_000, countdownMs: 0 }).session;
  const t0 = decoderNow() + 500;
  const passings = [];
  let end = t0;
  [7070, 7154, 7218, 7294, 7403, 7639].forEach((lap, car) => {
    let t = t0 + car * 300;
    passings.push({ transponder: String(10 + car), t });
    for (let i = 0; i < (car === 5 ? 6 : 7); i++) {
      t += lap + ((i * 37 + car * 53) % 240);
      passings.push({ transponder: String(10 + car), t });
    }
    end = Math.max(end, t);
  });
  passings.sort((a, b) => a.t - b.t);
  clock.offset += end - decoderNow() + 200;
  assert.equal((await postPassings(app, decoder, passings)).status, 200);
  clock.offset += 61_000;
  app.engine.tick();
  assert.equal(app.store.session(race.id).state, 'done');
  // The decoder reports in, so no warning stands above the result.
  await postPassings(app, decoder, []);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

const measure = () => {
  const box = (selector) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width } : null;
  };
  const board = document.querySelector('.board');
  return {
    // With the Start panel beside it, tl-board is the idle board's grid.
    gap: getComputedStyle(document.querySelector('#board-start:not([hidden])') ? document.querySelector('tl-board') : board).columnGap,
    space2xl: getComputedStyle(document.documentElement).getPropertyValue('--p-space-2xl').trim(),
    font: parseFloat(getComputedStyle(board).fontSize),
    title: box('#result-title'),
    side: box('.board-next'),
    sideTitle: box('.board-next-title'),
    start: box('.start-panel'),
    first: box('.place.is-first'),
    result: box('.board-result .result'),
    record: box('.board-track .strip-cells'),
    p1Name: parseFloat(getComputedStyle(document.querySelector('.place.is-first .place-name')).fontSize),
    p2Name: parseFloat(getComputedStyle(document.querySelector('.place-tier .place-name')).fontSize),
    table: parseFloat(getComputedStyle(document.querySelector('.result-table')).fontSize),
    thead: document.querySelector('.result-table thead').getBoundingClientRect().height,
    rows: document.querySelectorAll('.result-table tbody tr').length,
    height: document.documentElement.scrollHeight,
    sideways: document.documentElement.scrollWidth - innerWidth,
  };
};

test('on a laptop: two columns 48px apart, the side\'s title and first box level with the result\'s, the record cell on the side\'s edge', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/board');
  await page.locator('.board-result .result').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(measure);
  assert.equal(m.gap, m.space2xl, 'the column gap is --p-space-2xl');
  assert.ok(Math.abs(m.sideTitle.top - m.title.top) <= 1, `Start's title at ${m.sideTitle.top}, the result's at ${m.title.top}`);
  assert.ok(Math.abs(m.start.top - m.first.top) <= 1, `the Start box at ${m.start.top}, P1's card at ${m.first.top}`);
  assert.ok(Math.abs(m.record.left - m.side.left) <= 1, `the record cell's edge ${m.record.left}, the side's ${m.side.left}`);
  assert.equal(m.rows, 3, 'the table continues from 4');
  assert.equal(m.sideways, 0);
  assert.deepEqual(errors, []);
});

test('on the TV at 1920×1080: the strip and the result in three reads, fitting the screen', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await page.goto('/personal/board?big');
  await page.locator('.board-result .result').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(measure);
  assert.equal(m.side, null, 'no Start and no Fastest on this track');
  assert.ok(Math.abs(m.p1Name / m.font - 2.3) < 0.02, `who won at 2.3em: ${(m.p1Name / m.font).toFixed(2)}`);
  assert.ok(Math.abs(m.p2Name / m.font - 1.15) < 0.02, `who followed at 1.15em: ${(m.p2Name / m.font).toFixed(2)}`);
  assert.ok(Math.abs(m.table / m.font - 0.8) < 0.02, `everyone else at 0.8em: ${(m.table / m.font).toFixed(2)}`);
  assert.equal(m.thead, 0, 'no table header');
  assert.equal(m.rows, 3);
  assert.ok(m.result.bottom <= 1080, `the result ends at ${m.result.bottom}px`);
  assert.ok(m.height <= 1080, `the board is ${m.height}px tall`);
  assert.equal(await page.locator('.board-live a, #board-live a').count(), 0, 'no links on the TV\'s board');
  assert.deepEqual(errors, []);
});

test('on a phone: the side under the result, nothing sideways', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto('/personal/board');
  await page.locator('.board-result .result').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(measure);
  assert.ok(m.side.top >= m.result.bottom, 'Start and Fastest on this track after the result');
  assert.equal(m.sideways, 0);
  assert.deepEqual(errors, []);
});
