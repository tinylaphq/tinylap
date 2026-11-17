// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The record moment (drivers and transponders spec §4, strip design): when a
// swap brings a new track record, tl-board moves the crown from the old holder
// to the new one in a jump, and the new time in the strip's record cell
// bounces once, the only motion in the cell, which gets nothing added. Once
// only, on boards open at that moment, never on load, never with reduced
// motion; nothing it adds stays.
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
/** The decoder's clock, and each car's last crossing on it. */
let t = 1000;
const last = new Map();
let lapMs = 9000;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  for (const name of ['Ana', 'Ben']) await app.form(member, '/personal/drivers', { name });
  const [ana, ben] = app.store.drivers(ws);
  app.engine.assign(ws, '10', ana.id);
  app.engine.assign(ws, '20', ben.id);
  useTrack(app.store, ws, 'Ring', 'cw', 't1');
  decoder = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Gate' })).json();
  app.engine.start(ws, { kind: 'practice' });
  clock.offset += 10_000; // a practice starts clean: the laps begin after its start
  // Both cars cross; Ana sets the first record, which has nothing to beat.
  await pass('10');
  await pass('10', lapMs);
  await pass('20');
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** A crossing of `transponder`, `lap` ms after its last one, or a slow lap, later than every crossing so far. */
async function pass(transponder, lap) {
  const at = lap ? last.get(transponder) + lap : t + 20_000;
  t = Math.max(t, at);
  last.set(transponder, at);
  const response = await postPassings(app, decoder, [{ transponder, t: at }]);
  assert.equal(response.status, 200);
}

/** A new track record by `transponder`, 100 ms faster than the last; its seq. */
async function newRecord(transponder) {
  lapMs -= 100;
  await pass(transponder);
  await pass(transponder, lapMs);
  return app.engine.snapshot(ws).recordNew.seq;
}

/** The live board, counting every element the moment adds as it comes. */
async function boardPage(path = '/personal/board', options = {}) {
  const { context, page, errors } = await pageAs(browser, app, member, options);
  await page.addInitScript(() => {
    window.added = [];
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node instanceof Element && node.matches('.hero-fx, .crown-flyer')) window.added.push({ className: node.getAttribute('class'), hidden: node.getAttribute('aria-hidden') });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(path);
  await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
  return { context, page, errors, added: () => page.evaluate(() => window.added) };
}

/** Nothing of the moment is left, no script animation runs, and every crown shows. */
const settled = (page) => page.waitForFunction(() => !document.querySelector('.hero-fx, .crown-flyer')
  && [...document.querySelectorAll('.crown')].every((c) => getComputedStyle(c).visibility === 'visible')
  && document.getAnimations().filter((a) => !(a instanceof CSSAnimation || a instanceof CSSTransition)).length === 0, null, { timeout: 3000 });

/** The strip's record cell's new time, and the number of script animations on it. */
const bounces = (page, seq) => page.locator(`[data-record-new="${seq}"] .strip-cell.is-record .strip-figure`).evaluate((e) => e.getAnimations().length);
/** What the record cell holds: its children's classes, in order. */
const cellParts = (page) => page.locator('.strip-cell.is-record').evaluate((cell) => [...cell.querySelectorAll('*')].map((e) => e.getAttribute('class') ?? e.localName));

test('a falling record bounces the new time in the record cell, adds nothing to the cell, and the crown jumps to the new holder; then nothing stays', async (t) => {
  const { context, page, errors, added } = await boardPage();
  t.after(() => context.close());
  await page.locator('.board-table .crown').waitFor();
  const seq = await newRecord('20');
  await page.locator(`[data-record-new="${seq}"]`).waitFor();
  const parts = await cellParts(page);
  // The cell's only motion: the new time bounces once.
  assert.equal(await bounces(page, seq), 1, 'the time bounces');
  // The crown flies on its own; the new holder's waits, hidden, until it lands.
  await page.locator('.crown-flyer').waitFor({ state: 'attached' });
  const crown = page.locator('.board-table tr', { hasText: 'Ben' }).locator('.crown');
  assert.equal(await crown.evaluate((c) => getComputedStyle(c).visibility), 'hidden');
  assert.deepEqual(await cellParts(page), parts, 'nothing is added to the cell: no burst, tag or sweep');
  assert.equal(await page.locator('.strip-cell .crown').count(), 0, 'no crown in the cell');
  await settled(page);
  assert.equal(await crown.evaluate((c) => getComputedStyle(c).visibility), 'visible');
  const was = await added();
  assert.deepEqual(was.map((a) => a.className), ['crown crown-flyer'], 'the crown\'s jump alone');
  assert.ok(was.every((a) => a.hidden === 'true'), 'all of it aria-hidden');
  assert.deepEqual(errors, []);
});

test('a swap during the moment carries the bounce over to the new cell, and it still ends clean', async (t) => {
  const { context, page, errors } = await boardPage();
  t.after(() => context.close());
  const seq = await newRecord('10');
  await page.locator(`[data-record-new="${seq}"]`).waitFor();
  const board = await page.locator('#board-live').elementHandle();
  await pass('20'); // a crossing that is no record: the board is swapped again
  await page.waitForFunction((el) => !el.isConnected, board);
  assert.equal(await bounces(page, seq), 1, 'still bouncing, on the new cell');
  await settled(page);
  assert.deepEqual(errors, []);
});

test('a reload while the record still shows plays nothing', async (t) => {
  const { context, page, errors, added } = await boardPage();
  t.after(() => context.close());
  const seq = await newRecord('20');
  await page.locator('.crown-flyer').waitFor({ state: 'attached' });
  await page.reload();
  await page.locator(`[data-record-new="${seq}"]`).waitFor();
  await page.locator('#live-status[data-state="live"]').waitFor({ state: 'attached' });
  await pass('10'); // a swap that brings the same record
  await page.waitForFunction(() => document.querySelector('.board-table'));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(await added(), []);
  assert.deepEqual(errors, []);
});

test('with reduced motion the crown just moves', async (t) => {
  const { context, page, errors, added } = await boardPage();
  t.after(() => context.close());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const seq = await newRecord('10');
  await page.locator(`[data-record-new="${seq}"]`).waitFor();
  await page.locator('.board-table tr', { hasText: 'Ana' }).locator('.crown').waitFor();
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(await added(), []);
  assert.deepEqual(errors, []);
});

test('the big screen plays it too, and a board taken away stops it', async (t) => {
  const { context, page, errors } = await boardPage('/personal/board?big', { viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  const seq = await newRecord('20');
  await page.locator(`[data-record-new="${seq}"]`).waitFor();
  assert.equal(await bounces(page, seq), 1, 'the time bounces');
  await page.locator('tl-board').evaluate((board) => board.remove());
  assert.equal(await page.evaluate(() => document.querySelectorAll('.hero-fx, .crown-flyer').length
    + document.getAnimations().filter((a) => !(a instanceof CSSAnimation || a instanceof CSSTransition)).length), 0, 'no element and no script animation left');
  assert.deepEqual(errors, []);
});

test('the idle board, when the record still shows after its session, plays it on the strip\'s record cell', async (t) => {
  // A record falls only during a session; the strip carries it once that session ends within the window (board hub spec §3).
  const seq = await newRecord('10');
  app.engine.end(ws, app.engine.snapshot(ws).session.id);
  const { context, page, errors, added } = await boardPage();
  t.after(() => context.close());
  await page.locator(`.board.is-idle .board-track[data-record-new="${seq}"]`).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(await added(), [], 'seen on load: nothing plays');
  await page.locator('tl-board').evaluate((board) => /** @type {any} */ (board).playMoment(/** @type {any} */ (board).recordSeq(), null));
  assert.equal(await bounces(page, seq), 1, 'the time bounces');
  assert.equal(await page.locator('.strip-cell.is-record > .hero-fx').count(), 0, 'and nothing else');
  await settled(page);
  assert.deepEqual(errors, []);
});

