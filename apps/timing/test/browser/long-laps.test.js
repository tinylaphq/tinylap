// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The longest times fit their columns: a lap of a minute ("1:00.000", the
// longest a lap can be) on the board, in the feed and in a lap card, and a
// race's total past ten minutes ("14:01.500"). Each sits flush under its
// header, inside its cell, and clear of the mark after it.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

// Server time runs with real time; a test only ever moves it forward.
const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
let ws;
let race;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  const user = await app.signUp('Ana');
  member = await app.login(user);
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  for (const [name, code] of [['Cyrille Featherstonehaugh', '31'], ['Bo', '32']]) {
    await app.form(member, '/personal/drivers', { name });
    app.engine.assign(ws, code, app.store.drivers(ws).find((d) => d.name === name).id);
  }
  race = app.engine.start(ws, { kind: 'race', roster: app.store.drivers(ws).map((d) => d.id), durationMs: 1_200_000, countdownMs: 0 }).session;
  // Fifteen minutes on: Cyrille has lapped once a minute (each lap 1:00.000, his PB), Bo in 8 s.
  clock.offset += 15 * 60_000;
  const start = race.opensAt;
  const cyrille = Array.from({ length: 15 }, (_, i) => ({ transponder: '31', t: start + 1500 + i * 60_000 }));
  const bo = [0, 8000, 16_100, 24_300].map((t) => ({ transponder: '32', t: start + 2000 + t }));
  app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [...bo, ...cyrille].sort((a, b) => a.t - b.t) } });
  app.engine.tick();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** For every table: each time against its header and its cell, and against the mark after it; for the feed, its times' right edges. */
const measure = () => {
  const first = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.textContent.trim() && !n.parentElement.closest('.mark-cell, .visually-hidden, .crown, .board-ago, .tag') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const node = walker.nextNode();
    if (!node) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return { text: node.textContent.trim(), left: r.left, right: r.right };
  };
  const problems = [];
  let long = 0;
  for (const table of document.querySelectorAll('.board-table, .lap-table')) {
    const heads = [...table.querySelectorAll('thead th')];
    heads.forEach((th, i) => {
      if (!th.classList.contains('num') || !th.getClientRects().length) return;
      const head = first(th);
      for (const tr of table.querySelectorAll('tbody tr')) {
        const td = tr.children[i];
        const cell = first(td);
        if (!cell || cell.text === '—') continue;
        if (cell.text.includes(':')) long += 1;
        const box = td.getBoundingClientRect();
        const style = getComputedStyle(td);
        const inner = { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) };
        if (Math.abs(cell.right - head.right) > 1) problems.push(`${head.text} ${cell.text}: right ${cell.right.toFixed(1)}, header ${head.right.toFixed(1)}`);
        if (cell.left < inner.left - 0.5 || cell.right > inner.right + 0.5) problems.push(`${head.text} ${cell.text}: ${cell.left.toFixed(1)}–${cell.right.toFixed(1)} outside its cell ${inner.left.toFixed(1)}–${inner.right.toFixed(1)}`);
        const mark = td.nextElementSibling?.classList.contains('mark-cell') ? td.nextElementSibling.querySelector('.mark') : null;
        if (mark && mark.getBoundingClientRect().left < cell.right - 0.5) problems.push(`${head.text} ${cell.text}: its mark starts at ${mark.getBoundingClientRect().left.toFixed(1)}, before ${cell.right.toFixed(1)}`);
      }
    });
    const scroll = table.closest('.board-scroll');
    if (scroll && scroll.scrollWidth > scroll.clientWidth) problems.push(`${table.className}: ${scroll.scrollWidth} in ${scroll.clientWidth}`);
  }
  const feed = [...document.querySelectorAll('.board-feed .board-laps li')].map((li) => {
    const num = li.querySelector('.num');
    const text = first(num);
    const tags = li.querySelector('.board-laps-tags')?.getBoundingClientRect();
    if (tags && tags.width && tags.right > text.left + 0.5) problems.push(`feed ${text.text}: tags end at ${tags.right.toFixed(1)}, over the time at ${text.left.toFixed(1)}`);
    if (text.right > li.getBoundingClientRect().right + 0.5) problems.push(`feed ${text.text}: past its row`);
    return text.right;
  });
  if (feed.length && Math.max(...feed) - Math.min(...feed) > 1) problems.push(`feed times end at ${Math.min(...feed).toFixed(1)}–${Math.max(...feed).toFixed(1)}`);
  return { problems, long, pageFits: document.documentElement.scrollWidth <= innerWidth };
};

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 1280, height: 800, big: true }, { width: 1920, height: 1080, big: true }]) {
  test(`a minute's lap and a race past ten minutes fit their columns on the board, at ${viewport.width}${viewport.big ? ' ?big' : ''}`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(`/personal/board${viewport.big ? '?big' : ''}`);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measure);
    assert.ok(m.long >= 2, `long times to measure: ${m.long}`);
    assert.deepEqual(m.problems, []);
    assert.ok(m.pageFits, 'no sideways page scroll');
    assert.deepEqual(errors, []);
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`a minute's lap fits the session's table and its lap card, at ${viewport.width}`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(`/personal/sessions/${race.id}`);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measure);
    assert.ok(m.long >= 15, `long times to measure: ${m.long}`);
    assert.deepEqual(m.problems, []);
    assert.ok(m.pageFits, 'no sideways page scroll');
    assert.deepEqual(errors, []);
  });
}

test('a two-digit position and the finish flag share one line in their column', async (t) => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 1920, height: 1080, big: true }]) {
    const { context, page } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(`/personal/board${viewport.big ? '?big' : ''}`);
    await page.evaluate(() => document.fonts.ready);
    // The server's markup for a finished twelfth, in the first row's cell.
    const m = await page.evaluate(() => {
      const td = document.querySelector('.standings-table tbody td.pos');
      td.innerHTML = '12<span class="finish" role="img" aria-label="Finished" title="Finished"></span>';
      const flag = td.querySelector('.finish').getBoundingClientRect();
      const box = td.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(td.firstChild);
      return { digits: range.getBoundingClientRect(), flag: { top: flag.top, bottom: flag.bottom, right: flag.right }, inner: box.right - parseFloat(getComputedStyle(td).paddingRight) };
    });
    assert.ok(m.flag.top >= m.digits.top && m.flag.bottom <= m.digits.bottom, `the flag on the digits' line at ${viewport.width}`);
    assert.ok(m.flag.right <= m.inner + 0.5, `the flag inside its cell at ${viewport.width}: ${m.flag.right} ≤ ${m.inner}`);
  }
});
