// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The record moment (drivers and transponders spec §4): when a swap brings a
// new track record, tl-board moves the crown from the old holder to the new
// one in a jump, and the record card plays a crown and burst behind the new
// time while the time bounces. Once only, on boards open at that moment,
// never on load, never with reduced motion; nothing it adds stays.
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

test('a falling record lights the record card and the crown jumps to the new holder, then nothing stays', async (t) => {
  const { context, page, errors, added } = await boardPage();
  t.after(() => context.close());
  await page.locator('.board-table .crown').waitFor();
  const seq = await newRecord('20');
  await page.locator('.hero-fx').waitFor({ state: 'attached' });
  assert.equal(await page.locator(`[data-record-new="${seq}"] .hero-fx`).count(), 1, 'on the card that says so');
  // The crown flies on its own; the new holder's waits, hidden, until it lands.
  await page.locator('.crown-flyer').waitFor({ state: 'attached' });
  const crown = page.locator('.board-table tr', { hasText: 'Ben' }).locator('.crown');
  assert.equal(await crown.evaluate((c) => getComputedStyle(c).visibility), 'hidden');
  // Behind the time, and clipped to the card: it moves nothing.
  assert.deepEqual(await page.locator('.hero-fx').evaluate((fx) => {
    const s = getComputedStyle(fx);
    return [s.position, s.overflow, s.pointerEvents];
  }), ['absolute', 'hidden', 'none']);
  const time = page.locator(`[data-record-new="${seq}"] .board-track-new .board-track-time`);
  const [front, back] = await time.evaluate((e) => {
    const fx = /** @type {Element} */ (document.querySelector('.hero-fx'));
    const layer = [...(fx.parentElement?.children ?? [])].find((child) => child.contains(e));
    return [getComputedStyle(/** @type {Element} */ (layer)).zIndex, getComputedStyle(fx).zIndex].map(Number);
  });
  assert.ok(front > back, 'the time in front');
  await settled(page);
  assert.equal(await crown.evaluate((c) => getComputedStyle(c).visibility), 'visible');
  const was = await added();
  assert.deepEqual(was.map((a) => a.className).sort(), ['crown crown-flyer', 'hero-fx']);
  assert.ok(was.every((a) => a.hidden === 'true'), 'all of it aria-hidden');
  assert.deepEqual(errors, []);
});

test('a swap during the moment carries it over to the new card, and it still ends clean', async (t) => {
  const { context, page, errors } = await boardPage();
  t.after(() => context.close());
  const seq = await newRecord('10');
  await page.locator('.hero-fx').waitFor({ state: 'attached' });
  const board = await page.locator('#board-live').elementHandle();
  await pass('20'); // a crossing that is no record: the board is swapped again
  await page.waitForFunction((el) => !el.isConnected, board);
  assert.equal(await page.locator(`[data-record-new="${seq}"] .hero-fx`).count(), 1, 'still playing, on the new card');
  await settled(page);
  assert.deepEqual(errors, []);
});

test('a reload while the record still shows plays nothing', async (t) => {
  const { context, page, errors, added } = await boardPage();
  t.after(() => context.close());
  const seq = await newRecord('20');
  await page.locator('.hero-fx').waitFor({ state: 'attached' });
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
  await newRecord('20');
  await page.locator('.hero-fx').waitFor({ state: 'attached' });
  await page.locator('tl-board').evaluate((board) => board.remove());
  assert.equal(await page.evaluate(() => document.querySelectorAll('.hero-fx, .crown-flyer').length
    + document.getAnimations().filter((a) => !(a instanceof CSSAnimation || a instanceof CSSTransition)).length), 0, 'no element and no script animation left');
  assert.deepEqual(errors, []);
});
