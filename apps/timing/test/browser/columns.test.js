// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's columns in the browser: a time sits flush under its header,
// its TR or PB mark in a column of its own after it, at every width; and the
// wall layout (?big) and a phone keep a race's columns in view.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

// Server time runs with real time; a test only ever moves it forward.
const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
const NAMES = ['Ana', 'Haris', 'Cyrille Featherstonehaugh', 'Jürgen Böhm', 'Łukasz Wójcik'];
let app;
let browser;
let member;
let ws;

/** Passings of each car, `laps` ms apart, the last one `clock.now - 500`. */
function drive(laps) {
  NAMES.forEach((_, i) => {
    const transponder = String(21 + i);
    let t = clock.now - 500 - i * 50;
    const passings = [{ transponder, t }];
    for (const ms of [...laps(i)].reverse()) { t -= ms; passings.unshift({ transponder, t }); }
    app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings } });
  });
}

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  for (const [i, name] of NAMES.entries()) {
    await app.form(member, '/personal/drivers', { name });
    app.engine.assign(ws, String(21 + i), app.store.drivers(ws).find((d) => d.name === name).id);
  }
  // A practice sets everyone's best; the race then beats some of them: PB marks, and Ana's TR.
  const practice = app.engine.start(ws, { kind: 'practice' }).session;
  clock.offset += 60_000;
  drive((i) => [9400 + i * 100, 9300 + i * 100]);
  app.engine.end(ws, practice.id);
  clock.offset += 10_000;
  app.engine.start(ws, { kind: 'race', roster: app.store.drivers(ws).map((d) => d.id), durationMs: 900_000, countdownMs: 0 });
  clock.offset += 60_000;
  drive((i) => (i % 2 === 0 ? [8500 + i * 120, 8400 + i * 120] : [9900, 9800]));
  app.engine.tick();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** Each numeric column's header and the right edge of its text, and of every time under it; whether the table fits. */
const measure = () => {
  /** The first drawn text of `el`, not a mark, a note or text for screen readers. */
  const right = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.textContent.trim() && !n.parentElement.closest('.mark-cell, .marks, .visually-hidden, .crown, .board-ago') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const node = walker.nextNode();
    if (!node) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    return { text: node.textContent.trim(), right: range.getBoundingClientRect().right };
  };
  const table = document.querySelector('#board-live .board-table');
  const scroll = table.closest('.board-scroll');
  const box = scroll.getBoundingClientRect();
  const heads = [...table.querySelectorAll('thead th')];
  return {
    page: { scrollWidth: document.documentElement.scrollWidth, innerWidth },
    scroll: { scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth },
    marks: table.querySelectorAll('tbody .mark').length,
    shown: heads.filter((th) => th.getClientRects().length && th.getBoundingClientRect().right <= box.right + 0.5).map((th) => right(th)?.text ?? ''),
    columns: heads.map((th, i) => (th.classList.contains('num') && th.getClientRects().length ? {
      head: right(th),
      cells: [...table.querySelectorAll('tbody tr')].map((tr) => right(tr.children[i])).filter((c) => c && c.text !== '—'),
    } : null)).filter(Boolean),
  };
};

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 1280, height: 800, big: true }, { width: 1920, height: 1080, big: true }]) {
  test(`every time sits flush under its header, its mark beside it, at ${viewport.width}${viewport.big ? ' ?big' : ''}`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(`/personal/board${viewport.big ? '?big' : ''}`);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measure);
    assert.ok(m.marks > 0, 'the race has marks to measure against');
    const best = m.columns.find((c) => c.head.text === 'Best');
    assert.ok(best, 'a Best column');
    assert.equal(best.cells.length, NAMES.length);
    for (const { head, cells } of m.columns) {
      for (const cell of cells) assert.ok(Math.abs(cell.right - head.right) <= 1, `${head.text} ${cell.text}: right edge ${cell.right} under the header's ${head.right}`);
    }
    assert.ok(m.page.scrollWidth <= m.page.innerWidth, `no sideways page scroll: ${m.page.scrollWidth} in ${m.page.innerWidth}`);
    assert.deepEqual(errors, []);
  });
}

test('?big at 1280 shows every race column; a phone keeps Pos, Driver, Laps, Best and Time, and lets Last go', async (t) => {
  for (const [viewport, columns] of [
    [{ width: 1280, height: 800, big: true }, ['Pos', 'Driver', 'Laps', 'Best', '', 'Last', 'Time']],
    [{ width: 390, height: 844 }, ['Pos', 'Driver', 'Laps', 'Best', '', 'Time']],
  ]) {
    const { context, page } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(`/personal/board${viewport.big ? '?big' : ''}`);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measure);
    assert.ok(m.scroll.scrollWidth <= m.scroll.clientWidth, `the table fits its box at ${viewport.width}: ${m.scroll.scrollWidth} in ${m.scroll.clientWidth}`);
    assert.deepEqual(m.shown, columns, `the columns in view at ${viewport.width}`);
  }
});
