// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The history and the records in the browser: on a phone the history keeps
// who was fastest and how fast in view, with the track under the session,
// and a record's date stays on one line; the crown stays beside its name.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '@tinylap/track-format';
import { startTiming } from '../server/helpers.js';
import { closed } from '../server/planner-stub.js';
import { openBrowser, pageAs } from './browser.js';

// Server time runs with real time; a test only ever moves it forward.
const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
const NAMES = ['Cyrille Featherstonehaugh', 'Ana', 'Jörg Müller'];
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
let app;
let browser;
let member;
let ws;

/** A practice on the current track: each car `laps` laps, Cyrille fastest. */
function practice(laps) {
  const { session } = app.engine.start(ws, { kind: 'practice' });
  clock.offset += 60_000;
  NAMES.forEach((_, i) => {
    let t = clock.now - 500 - i * 50;
    const passings = [{ transponder: String(31 + i), t }];
    for (let lap = 0; lap < laps; lap += 1) { t -= 8000 + i * 300 + lap * 10; passings.unshift({ transponder: String(31 + i), t }); }
    app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings } });
  });
  app.engine.end(ws, session.id);
  clock.offset += 86_400_000;
}

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  for (const [i, name] of NAMES.entries()) {
    await app.form(member, '/personal/drivers', { name });
    app.engine.assign(ws, String(31 + i), app.store.drivers(ws).find((d) => d.name === name).id);
  }
  app.store.addTrack(ws, { id: 'garage', name: 'Garage oval behind the workshop, long version' });
  app.store.attachLayout(ws, 'garage', { plannerId: closed.track.id, shape: closed.track.shape, snapshotKey: 'k'.repeat(22), layout: canonicalJson(closed) }, { userId: 'u-ana', name: 'Ana', at: clock.now });
  app.store.setCurrentTrack(ws, 'garage', 'ccw');
  for (let i = 0; i < 4; i += 1) practice(5 - i);
  const race = app.engine.start(ws, { kind: 'qualifying', roster: app.store.drivers(ws).map((d) => d.id), durationMs: 120_000, countdownMs: 0 }).session;
  app.engine.abort(ws, race.id);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** The table's headers in view, whether it fits its box, and the rows' lines. */
const measure = (selector) => {
  const table = document.querySelector(selector);
  const scroll = table.closest('.board-scroll');
  const box = scroll.getBoundingClientRect();
  /** The lines a cell's text takes. */
  const lines = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  };
  return {
    page: { scrollWidth: document.documentElement.scrollWidth, innerWidth },
    fits: scroll.scrollWidth <= scroll.clientWidth,
    widths: [scroll.scrollWidth, scroll.clientWidth],
    cols: [...table.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width)),
    shown: [...table.querySelectorAll('thead th')].filter((th) => th.getClientRects().length && th.getBoundingClientRect().right <= box.right + 0.5).map((th) => th.textContent.trim()),
    rows: [...table.querySelectorAll('tbody tr')].map((tr) => {
      const crown = tr.querySelector('.crown');
      const name = crown?.parentElement.querySelector('.driver-name');
      // The crown's line: the name's, before it, not one of its own.
      let crownAlone = false;
      if (crown && name) {
        const first = name.getClientRects()[0];
        crownAlone = Math.abs(crown.getBoundingClientRect().bottom - first.bottom) >= first.height / 2;
      }
      const track = tr.querySelector('.history-track');
      const tag = tr.querySelector('.history-session .tag');
      const cell = tag?.closest('td').getBoundingClientRect();
      return {
        dates: [...tr.querySelectorAll('td:not(.board-driver):not(.num) a')].filter((a) => a.getClientRects().length).map(lines),
        track: track && track.getClientRects().length ? track.textContent : null,
        trackLines: track && track.getClientRects().length ? Math.round(track.getBoundingClientRect().height / parseFloat(getComputedStyle(track).lineHeight)) : 0,
        crownAlone,
        tagInside: tag ? tag.getBoundingClientRect().right <= cell.right + 0.5 : null,
        best: tr.querySelector('td.num:not(.history-wide)')?.textContent ?? null,
      };
    }),
  };
};

test('a phone\'s history shows Started, Session, Fastest and Best, with the track under the session', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: PHONE });
  t.after(() => context.close());
  await page.goto('/personal/sessions');
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(measure, '.history-table');
  assert.deepEqual(m.shown, ['Started', 'Session', 'Fastest', 'Best', 'Mark']);
  assert.ok(m.fits, `the history fits its box: ${m.widths}`);
  assert.ok(m.page.scrollWidth <= m.page.innerWidth, `no sideways page scroll: ${m.page.scrollWidth} in ${m.page.innerWidth}`);
  assert.equal(m.rows.length, 5);
  for (const row of m.rows) {
    assert.match(row.track, /^Garage oval behind the workshop, long version, anticlockwise$/);
    assert.ok(row.trackLines <= 2, `the track takes at most two lines: ${row.trackLines}`);
    assert.equal(row.crownAlone, false, 'the crown stays on its name\'s line');
  }
  assert.ok(m.rows.slice(1).every((row) => /^\d+\.\d{3}$/.test(row.best)), 'each practice\'s best lap is in view');
  assert.equal(m.rows[0].tagInside, true, 'the Aborted tag stays in its cell');
  assert.deepEqual(errors, []);
});

test('on a desktop the history keeps every column, and the crown stays beside a long name', async (t) => {
  const { context, page } = await pageAs(browser, app, member, { viewport: DESKTOP });
  t.after(() => context.close());
  await page.goto('/personal/sessions');
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(measure, '.history-table');
  assert.deepEqual(m.shown, ['Started', 'Session', 'Track', 'Length', 'Drivers', 'Fastest', 'Best', 'Mark']);
  assert.ok(m.fits, `the history fits its box: ${m.widths}`);
  for (const row of m.rows) {
    assert.equal(row.track, null, 'the second line is for a phone');
    assert.equal(row.crownAlone, false, `the crown stays on its name's line: columns ${m.cols}`);
  }
});

for (const [path, selector] of [['/personal/records', '.records-table'], ['/personal/tracks/garage', '#records-ccw ~ .board-scroll .records-table']]) {
  test(`a record's date stays on one line on a phone and a desktop: ${path}`, async (t) => {
    for (const viewport of [PHONE, DESKTOP]) {
      const { context, page } = await pageAs(browser, app, member, { viewport });
      t.after(() => context.close());
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const m = await page.evaluate(measure, selector);
      assert.ok(m.rows.length > 1, 'records to measure');
      assert.ok(m.fits, `the records fit their box at ${viewport.width}: ${m.widths}`);
      assert.deepEqual(m.shown.slice(0, 3), ['Lap', 'Driver', 'Set'], `who, how fast and when are in view at ${viewport.width}`);
      for (const row of m.rows) assert.ok(row.dates.every((n) => n === 1), `each date one line at ${viewport.width}: ${row.dates}`);
      assert.ok(m.page.scrollWidth <= m.page.innerWidth, `no sideways page scroll at ${viewport.width}`);
    }
  });
}
