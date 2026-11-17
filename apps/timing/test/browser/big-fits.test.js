// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wall screen fits its screen (spec 6.1): at 1920×1080, with eight drivers
// (as many as a club night runs at once, #140), a decoder on the strip, its
// record and fastest lap cells and a full Last laps, the board ends inside
// 1080, in a practice, a race and a qualifying alike, while a record falls
// and while drivers have stopped: the server sends Last laps' eleven newest,
// not twelve, and every row shows whole.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

const DRIVERS = ['Ana', 'Ben Okafor', 'Chiara', 'Dominik Featherstone', 'Emil', 'Fatima', 'Gregor', 'Hanna'];
const TV = { width: 1920, height: 1080 };
const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
let decoder;
let ws;
let ids;
let lastAna;
const start = Date.now();
const decoderNow = () => clock.now - start;

/** Starts a session of `kind` with every driver, and drives four laps each, a car every 0.9 s: more laps than Last laps keeps. */
async function drive(kind) {
  const session = app.engine.start(ws, kind === 'practice' ? { kind } : { kind, roster: ids, durationMs: 1_200_000, countdownMs: 0 }).session;
  clock.offset += 10_000;
  const passings = [];
  for (let lap = 0; lap <= 4; lap++) {
    for (let car = 0; car < DRIVERS.length; car++) passings.push({ transponder: String(10 + car), t: decoderNow() + lap * 8000 + car * 900 + lap * car * 37 });
  }
  clock.offset += 4 * 8000 + DRIVERS.length * 900 + 1000;
  assert.equal((await postPassings(app, decoder, passings)).status, 200);
  lastAna = passings.filter((p) => p.transponder === '10').at(-1).t;
  return session;
}

/** What decides whether the big board fits: its height, its parts, and Last laps' rows. */
const measure = (page) => page.evaluate(() => {
  const feed = document.querySelector('.board-feed');
  const bottom = feed.getBoundingClientRect().bottom;
  const rows = [...feed.querySelectorAll('.board-laps li')];
  const shown = rows.filter((li) => li.getBoundingClientRect().height > 0);
  const table = document.querySelector('.standings-table');
  const drivers = [...table.querySelectorAll('tbody tr')];
  return {
    height: document.documentElement.scrollHeight,
    decoders: document.querySelectorAll('.board-track .board-decoders').length,
    cells: document.querySelectorAll('.board-track .strip-cell').length,
    drivers: drivers.length,
    rowHeights: drivers.map((tr) => tr.getBoundingClientRect().height),
    tableBottom: table.getBoundingClientRect().bottom,
    rows: rows.length,
    shown: shown.length,
    cut: shown.filter((li) => li.getBoundingClientRect().bottom > bottom + 0.5).length,
    feedBottom: bottom,
  };
});

function assertFits(read, what) {
  assert.equal(read.drivers, DRIVERS.length, `${what}: every driver has a row`);
  assert.equal(read.decoders, 1, `${what}: the strip shows its decoder`);
  assert.equal(read.cells, 2, `${what}: and both cells, the track record and the fastest lap`);
  assert.equal(read.rows, 11, `${what}: Last laps shows the eleven newest`);
  assert.equal(read.shown, 11, what);
  assert.ok(read.height <= 1080, `${what}: the board is ${read.height}px tall`);
  assert.ok(read.tableBottom <= 1080, `${what}: the standings end at ${read.tableBottom}px`);
  assert.ok(read.feedBottom <= 1080, `${what}: Last laps ends at ${read.feedBottom}px`);
  assert.equal(read.cut, 0, `${what}: no Last laps row is cut`);
}

function assertOneLine(read, what) {
  const spread = Math.max(...read.rowHeights) - Math.min(...read.rowHeights);
  assert.ok(spread < 1.5, `${what}: every standings row is one line: ${read.rowHeights.map((h) => h.toFixed(1))}`);
}

/** Opens the big board, checks it fits, has Ana beat the record by `by` ms, and checks it again, the strip keeping its height. */
async function fitsWhileARecordFalls(kind, beat) {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: TV });
  await page.goto('/personal/board?big');
  await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
  await page.locator('.board-feed .board-laps li').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const read = await measure(page);
  assertFits(read, kind);
  assertOneLine(read, kind);
  const strip = () => page.locator('.board-track').evaluate((el) => el.getBoundingClientRect().height);
  const before = await strip();
  // Ana beats the record: the record cell says New track record, and what it beat.
  clock.offset += 8000;
  assert.equal((await postPassings(app, decoder, [{ transponder: '10', t: lastAna + beat }])).status, 200);
  lastAna += beat;
  await page.locator('.board-track[data-record-new] .strip-cell.is-new .strip-beat').waitFor();
  assertFits(await measure(page), `${kind}, a record falling`);
  assert.ok(Math.abs(await strip() - before) <= 0.5, `${kind}: the strip keeps its height: ${before.toFixed(1)} → ${(await strip()).toFixed(1)}`);
  assert.deepEqual(errors, []);
  await context.close();
}

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  for (const name of DRIVERS) await app.form(member, '/personal/drivers', { name });
  const drivers = app.store.drivers(ws);
  ids = DRIVERS.map((name) => drivers.find((d) => d.name === name).id);
  ids.forEach((id, i) => app.engine.assign(ws, String(10 + i), id));
  useTrack(app.store, ws, 'Ring', 'cw', 't1');
  decoder = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Start line' })).json();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

let practice;
test('at 1920×1080 a practice with eight drivers ends inside the screen, and still does while a record falls', async () => {
  practice = await drive('practice');
  // Ana's laps are 8.000; she beats her record.
  await fitsWhileARecordFalls('practice', 7500);
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

test('at 1920×1080 drivers who have stopped keep one line each: "last lap … ago" follows the name', async () => {
  // Ben and Chiara go on lapping for a minute and a quarter; the other six have stopped.
  const passings = [];
  for (let k = 1; k <= 9; k++) for (const car of [1, 2]) passings.push({ transponder: String(10 + car), t: decoderNow() + k * 8100 + car * 300 });
  clock.offset += 75_000;
  assert.equal((await postPassings(app, decoder, passings)).status, 200);
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: TV });
  await page.goto('/personal/board?big');
  await page.locator('.board-feed .board-laps li').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const read = await measure(page);
  const stopped = await page.locator('.standings-table .board-ago:not([hidden])').count();
  assert.equal(stopped, 6, 'six drivers say when their last lap was');
  assertFits(read, 'practice, six drivers stopped');
  assertOneLine(read, 'six drivers stopped');
  // The name comes first: a short one shows whole beside its line.
  const name = await page.locator('.standings-table tbody tr', { hasText: 'Emil' }).locator('.driver-name').evaluate((el) => el.scrollWidth <= el.clientWidth);
  assert.ok(name, 'Emil shows whole');
  assert.deepEqual(errors, []);
  await context.close();
  app.engine.end(ws, practice.id);
});

test('at 1920×1080 a race with eight drivers ends inside the screen, and still does while a record falls', async () => {
  clock.offset += 60_000;
  const race = await drive('race');
  await fitsWhileARecordFalls('race', 7400);
  app.engine.abort(ws, race.id);
});

test('at 1920×1080 a qualifying with eight drivers ends inside the screen, and still does while a record falls', async () => {
  clock.offset += 60_000;
  const qualifying = await drive('qualifying');
  await fitsWhileARecordFalls('qualifying', 7300);
  app.engine.abort(ws, qualifying.id);
});

/**
 * Lets the decoder go quiet past OFFLINE_AFTER_MS, opens the big board, and checks it with the decoder not reporting
 * (#143): the warning shows once, in the strip, in the strip's type and on one line, and the board still ends inside 1080.
 */
async function fitsWhileQuiet(what, { live }) {
  clock.offset += 26_000;
  app.engine.tick();
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: TV });
  await page.goto('/personal/board?big');
  await page.locator('.board-track .board-decoder.is-offline').first().waitFor();
  if (live) await page.locator('.board-feed .board-laps li').first().waitFor();
  else await page.locator('.board-result .result').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const read = await page.evaluate(() => {
    const visible = (el) => el.getBoundingClientRect().height > 0;
    const warning = [...document.querySelectorAll('.board-track .board-decoder.is-offline')].find((li) => li.textContent.startsWith('Start line'));
    const where = document.querySelector('.strip-where').getBoundingClientRect();
    const cells = document.querySelector('.strip-cells').getBoundingClientRect();
    const last = [...document.querySelectorAll('#board-live > *')].filter(visible).at(-1);
    const style = getComputedStyle(warning);
    return {
      banners: [...document.querySelectorAll('.board-offline')].filter(visible).length,
      text: warning.textContent,
      px: parseFloat(style.fontSize),
      lines: Math.round(warning.getBoundingClientRect().height / parseFloat(style.lineHeight)),
      whereHeight: where.height,
      cellsHeight: cells.height,
      height: document.documentElement.scrollHeight,
      bottom: last.getBoundingClientRect().bottom,
    };
  });
  assert.equal(read.banners, 0, `${what}: no banner of its own: the strip says it`);
  assert.match(read.text, /Start line isn't reporting\. Laps will appear once it's back\./, what);
  assert.ok(read.px >= 22, `${what}: the warning reads across a room: ${read.px}px`);
  assert.equal(read.lines, 1, `${what}: the warning is one line`);
  assert.ok(read.whereHeight <= read.cellsHeight + 0.5, `${what}: the warning doesn't make the strip taller: ${read.whereHeight.toFixed(1)} over ${read.cellsHeight.toFixed(1)}`);
  assert.ok(read.height <= 1080, `${what}: the board is ${read.height}px tall`);
  assert.ok(read.bottom <= 1080, `${what}: the board ends at ${read.bottom}px`);
  assert.deepEqual(errors, []);
  await context.close();
}

test('at 1920×1080 the idle board with eight drivers ends inside the screen with a decoder that isn\'t reporting, which the strip says at TV size', async () => {
  // The practice above ended: its eight drivers are the result.
  await fitsWhileQuiet('idle', { live: false });
});

test('at 1920×1080 a practice with eight drivers ends inside the screen with a decoder that isn\'t reporting', async () => {
  clock.offset += 60_000;
  const session = await drive('practice');
  await fitsWhileQuiet('live', { live: true });
  app.engine.end(ws, session.id);
});

test('at 1920×1080 a practice still fits with two decoders that aren\'t reporting: the strip keeps one line', async () => {
  clock.offset += 60_000;
  const session = await drive('practice');
  const second = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Back straight by the pit wall' })).json();
  // It reports once, with nothing to send, then goes quiet with the start line.
  app.engine.ingest({ workspaceId: ws, decoder: second.id, via: 'net', batch: { boot: 'b00tb00t', passings: [] } });
  await fitsWhileQuiet('two quiet', { live: true });
  app.engine.end(ws, session.id);
});
