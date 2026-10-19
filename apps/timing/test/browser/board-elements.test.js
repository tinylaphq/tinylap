// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's elements in the browser (spec step two §7, B1–B7): tl-board's
// stream across pagehide, pageshow and disconnect; tl-countdown and
// tl-relative-time on the server's time; a layout that holds still when
// a "last lap" note appears; and the shared timer's teardown.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock } from '../../public/format.js';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

// Server time runs with real time; a test only ever moves it forward.
const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
let personal;
let ticker;
/** One club per B6 viewport, made before the login so the login carries them. */
const clubs = [];
// Short names alone, where a note is the widest thing in the Driver column, and with a long one.
const NAMES = [['Al', 'Bo'], ['Al', 'Ana Fernández-Oliveira']];
const TRANSPONDER = { Al: '11', Bo: '12', 'Ana Fernández-Oliveira': '13' };
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 1920, height: 1080, big: true }];
const CASES = VIEWPORTS.flatMap((viewport, v) => NAMES.map((names) => ({ viewport, v, names })));

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  for (const v of VIEWPORTS.keys()) clubs.push(app.club(user, `Layout ${v + 1}`));
  member = await app.login(user);
  await app.form(member, '/personal/drivers', { name: 'Ana' });
  personal = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  app.engine.assign(personal, '10', app.store.drivers(personal)[0].id);
  ticker = setInterval(() => app.engine.tick(), 100);
});
after(async () => {
  clearInterval(ticker);
  await browser?.close();
  await app?.close();
});

/** Passings of `transponder` on decoder `decoder`, `ago` ms before server time each. */
const cross = (ws, transponder, agos, decoder = 'd1') => app.engine.ingest({
  workspaceId: ws, decoder, via: 'net',
  batch: { boot: 'b00tb00t', passings: agos.map((ago) => ({ transponder, t: clock.now - ago })) },
});

/** Waits until `fn()` is true, polling in Node. */
async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Counts board stream subscriptions and their ends, as live.test.js wraps the hub. */
function boardStreams() {
  const counts = { subscribed: 0, unsubscribed: 0 };
  const subscribe = app.hub.subscribe;
  app.hub.subscribe = (workspaceId, options, send) => {
    const sub = subscribe.call(app.hub, workspaceId, options, send);
    counts.subscribed += 1;
    const unsubscribe = sub.unsubscribe;
    sub.unsubscribe = () => { counts.unsubscribed += 1; return unsubscribe.call(sub); };
    return sub;
  };
  return { counts, restore: () => { app.hub.subscribe = subscribe; } };
}

test('B1: pagehide ends the stream, and pageshow from the cache reopens it', async (t) => {
  const streams = boardStreams();
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => { streams.restore(); return context.close(); });
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  assert.equal(streams.counts.subscribed, 1);

  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await until(() => streams.counts.unsubscribed === 1, 'the subscription to end');
  cross(personal, '10', [8000, 0]);

  const status = await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    return document.querySelector('#live-status')?.getAttribute('data-state');
  });
  assert.equal(status, 'reconnecting');
  await page.locator('#live-status[data-state="live"]').waitFor();
  await page.locator('.board-table').getByText('Ana').waitFor();
  assert.equal(streams.counts.subscribed, 2);
  assert.deepEqual(errors, []);
});

test('B2: removing tl-board ends its stream without a reload, and putting it back reopens it', async (t) => {
  const streams = boardStreams();
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => { streams.restore(); return context.close(); });
  await page.addInitScript(() => { /** @type {any} */ (globalThis).tinylapReloadMs = 300; });
  let loads = 0;
  page.on('load', () => { loads += 1; });
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();

  await page.evaluate(() => { const board = document.querySelector('tl-board'); /** @type {any} */ (window).board = board; board?.remove(); });
  await until(() => streams.counts.unsubscribed === 1, 'the subscription to end');
  await page.waitForTimeout(1000);
  assert.equal(loads, 1, 'no reload after a disconnect');

  await page.evaluate(() => document.querySelector('main')?.append(/** @type {any} */ (window).board));
  await until(() => streams.counts.subscribed === 2, 'a new subscription');
  await page.locator('tl-board .board-table').getByText('Ana').waitFor();
  assert.equal(loads, 1);
  assert.deepEqual(errors, []);
});

test('B3: with the device an hour behind, the clock and the note follow the server', async (t) => {
  clock.offset += 120_000; // Ana's last crossing (B1) is now two minutes old
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.clock.setSystemTime(clock.now - 3_600_000);
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  await page.waitForTimeout(500);
  const time = page.locator('time[data-clock]');
  const opensAt = Number(await time.getAttribute('data-opens'));
  const [m, s] = (await time.innerText()).split(':').map(Number);
  const expected = formatClock(clock.now - opensAt).split(':').map(Number);
  assert.ok(Math.abs(m * 60 + s - (expected[0] * 60 + expected[1])) <= 2, `${m}:${s} vs ${expected.join(':')}`);
  assert.equal(await page.getByText(/^last lap 2 min ago$/).isVisible(), true);
  assert.deepEqual(errors, []);
});

test('B4: the note appears on its own, with the stream idle', async (t) => {
  cross(personal, '10', [8000, 0]);
  clock.offset += 40_000;
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.clock.install({ time: clock.now });
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  await page.waitForTimeout(300); // the stream's first board has been swapped in
  const note = page.locator('.board-ago');
  assert.equal(await note.count(), 1);
  assert.equal(await note.isVisible(), false, '40 s');
  await page.clock.runFor(15_000);
  assert.equal(await note.isVisible(), false, '55 s');
  await page.clock.runFor(15_000);
  await page.getByText('last lap 1 min ago').waitFor();
  assert.deepEqual(errors, []);
});

test('B5: the note pauses while the page is hidden, and catches up when it shows', async (t) => {
  clock.offset += 60_000; // B4's crossing is now well over a minute old
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.clock.install({ time: clock.now });
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  await page.waitForTimeout(300);
  const note = page.locator('.board-ago time');
  const before = await note.innerText();
  assert.match(before, /^1 min ago$/);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(120_000);
  assert.equal(await note.innerText(), before, 'unchanged while hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await note.innerText(), '3 min ago', 'updated at once');
  assert.deepEqual(errors, []);
});

for (const [i, { viewport, v, names }] of CASES.entries()) {
  test(`B6: a note appearing moves no column, at ${viewport.width}${viewport.big ? ' ?big' : ''}, ${names.join(' and ')}`, async (t) => {
    const club = clubs[v];
    const decoder = `b6-${i}`;
    const [first, second] = names.map((name) => TRANSPONDER[name]);
    for (const name of names) {
      if (!app.store.drivers(club.id).some((d) => d.name === name)) await app.form(member, `/clubs/${club.id}/drivers`, { name });
      app.engine.assign(club.id, TRANSPONDER[name], app.store.drivers(club.id).find((d) => d.name === name).id);
    }
    const roster = names.map((name) => app.store.drivers(club.id).find((d) => d.name === name).id);
    const { session } = app.engine.start(club.id, { kind: 'race', roster, durationMs: 600_000, countdownMs: 0 });
    clock.offset += 20_000;
    // After the start: the first at +0, +8 and +16 s (two laps), the second at +1 and +9 s (one lap).
    app.engine.ingest({ workspaceId: club.id, decoder, via: 'net', batch: { boot: 'b00tb00t', passings: [[first, 0], [second, 1000], [first, 8000], [second, 9000], [first, 16_000]].map(([car, at]) => ({ transponder: car, t: clock.now - 19_000 + at })) } });

    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => { app.engine.abort(club.id, session.id); return context.close(); });
    await page.goto(`/clubs/${club.id}/board${viewport.big ? '?big' : ''}`);
    await page.locator('#live-status').and(page.locator('[data-state="live"]')).waitFor({ state: 'attached' });
    await page.waitForTimeout(300);
    const layout = () => page.evaluate(() => ({
      lefts: [...document.querySelectorAll('.board-table thead th')].map((th) => th.getBoundingClientRect().left),
      order: [...document.querySelectorAll('.board-table tbody .driver')].map((d) => d.textContent),
      visibleNotes: [...document.querySelectorAll('.board-ago')].filter((n) => !(/** @type {HTMLElement} */ (n).hidden)).length,
      fits: document.documentElement.scrollWidth <= innerWidth,
    }));
    const was = await layout();
    assert.equal(was.visibleNotes, 0);
    assert.deepEqual(was.order, names);

    // The second goes quiet; the first keeps lapping, which streams a fresh board.
    clock.offset += 70_000;
    app.engine.tick();
    app.engine.ingest({ workspaceId: club.id, decoder, via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: first, t: clock.now - 8000 }, { transponder: first, t: clock.now }] } });
    await page.getByText(/^last lap 1 min ago$/).waitFor();
    const now = await layout();
    assert.equal(now.visibleNotes, 1);
    assert.deepEqual(now.order, was.order);
    now.lefts.forEach((left, n) => assert.ok(Math.abs(left - was.lefts[n]) <= 0.5, `column ${n}: ${was.lefts[n]} → ${left}`));
    assert.equal(now.fits, true, 'no sideways page scroll');
    assert.deepEqual(errors, []);
  });
}

test('B7: when the last note leaves, its shared timer and listener go too', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  // Counts the page's visibilitychange listeners and its 15 s timers.
  await page.addInitScript(() => {
    const spy = { listeners: new Set(), timers: new Set() };
    /** @type {any} */ (window).spy = spy;
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = (type, listener, options) => { if (type === 'visibilitychange') spy.listeners.add(listener); return add(type, listener, options); };
    document.removeEventListener = (type, listener, options) => { if (type === 'visibilitychange') spy.listeners.delete(listener); return remove(type, listener, options); };
    const set = window.setInterval.bind(window);
    const clear = window.clearInterval.bind(window);
    window.setInterval = /** @type {any} */ ((fn, ms, ...rest) => { const id = set(fn, ms, ...rest); if (ms === 15_000) spy.timers.add(id); return id; });
    window.clearInterval = (id) => { spy.timers.delete(id); return clear(id); };
  });
  await page.goto('/personal/board');
  await page.locator('#live-status[data-state="live"]').waitFor();
  const counts = () => page.evaluate(() => { const { spy } = /** @type {any} */ (window); return [document.querySelectorAll('tl-relative-time').length > 0, spy.listeners.size, spy.timers.size]; });
  assert.deepEqual(await counts(), [true, 1, 1]);
  await page.evaluate(() => { const board = document.querySelector('tl-board'); /** @type {any} */ (window).board = board; board?.remove(); });
  assert.deepEqual(await counts(), [false, 0, 0]);
  await page.evaluate(() => document.querySelector('main')?.append(/** @type {any} */ (window).board));
  assert.deepEqual(await counts(), [true, 1, 1]);
  assert.deepEqual(errors, []);
});
