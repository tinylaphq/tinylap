// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Marks in the browser (fastest lap spec §2, §3.3): a mark follows its time,
// the way a unit follows a number, in the standings, the lap lists and Last
// laps; its box is trimmed to its capitals, so its letters sit centred in it,
// and it centres on its time's digits. The feed's times stay aligned with or
// without a mark.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
const NAMES = ['Ana', 'Ben Okafor', 'Mia Schulz', 'Dara'];
let app;
let browser;
let member;
let ws;
let practice;

/** Each car's passings, `laps` ms apart, the last one `clock.now - 500`; Ana's last, so her laps lead the feed. */
function drive(laps) {
  [...NAMES.keys()].reverse().forEach((i) => {
    const transponder = String(31 + i);
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
    app.engine.assign(ws, String(31 + i), app.store.drivers(ws).find((d) => d.name === name).id);
  }
  // A first practice sets the record and everyone's best; in the next, Ana's 8.900 is the fastest lap, not a record.
  const first = app.engine.start(ws, { kind: 'practice' }).session;
  clock.offset += 60_000;
  drive((i) => [8000 + i * 500, 9800 + i * 30]);
  app.engine.end(ws, first.id);
  clock.offset += 10_000;
  practice = app.engine.start(ws, { kind: 'practice' }).session;
  clock.offset += 60_000;
  drive((i) => [9400 + i * 100, 9300 + i * 100, 8900 + i * 37]);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** Every mark against the time before it: centres, its letters' padding, the gap; and the feed's time edges. */
const measure = () => {
  const ctx = document.createElement('canvas').getContext('2d');
  /** The ink of an element's first text: its top and bottom, from the font's metrics, and its right edge. */
  const ink = (el) => {
    const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    const cs = getComputedStyle(node.parentElement);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(node.textContent.trim());
    const baseline = rect.top + m.fontBoundingBoxAscent;
    return { top: baseline - m.actualBoundingBoxAscent, bottom: baseline + m.actualBoundingBoxDescent, right: rect.right };
  };
  const marks = [...document.querySelectorAll('.mark')].map((mark) => {
    // In a column of its own after its time's, or on the strip's line after the time.
    const cell = mark.closest('.mark-cell');
    const before = cell ? cell.previousElementSibling : mark.parentElement.querySelector('.board-track-time');
    const time = ink(before);
    const letters = ink(mark);
    const box = mark.getBoundingClientRect();
    return {
      where: `${cell ? cell.closest('table, ol').classList[0] : 'board-track'} ${before.textContent.trim()} ${mark.textContent}`,
      off: (box.top + box.bottom) / 2 - (time.top + time.bottom) / 2,
      padTop: letters.top - box.top,
      padBottom: box.bottom - letters.bottom,
      gap: box.left - time.right,
    };
  });
  const feed = [...document.querySelectorAll('.board-feed .board-laps li')].map((li) => ({
    right: ink(li.querySelector('.num')).right,
    markCellAfterTime: li.querySelector('.num')?.nextElementSibling?.classList.contains('mark-cell') ?? false,
    marked: Boolean(li.querySelector('.mark')),
  }));
  return { marks, feed, trims: CSS.supports('text-box', 'trim-both cap alphabetic') };
};

/** The checks every page with marks passes. */
function check(m, label) {
  assert.ok(m.trims, 'this Chrome trims a box to its text');
  assert.ok(m.marks.length > 0, `${label}: marks to measure`);
  for (const mark of m.marks) {
    assert.ok(Math.abs(mark.off) <= 0.75, `${label}, ${mark.where}: the mark's centre is ${mark.off.toFixed(2)}px off its digits'`);
    assert.ok(Math.abs(mark.padTop - mark.padBottom) <= 0.75, `${label}, ${mark.where}: padding ${mark.padTop.toFixed(2)} above its letters, ${mark.padBottom.toFixed(2)} below`);
    assert.ok(mark.gap > 0 && mark.gap <= 16, `${label}, ${mark.where}: the mark follows its time, ${mark.gap.toFixed(1)}px after it`);
  }
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 1920, height: 1080, big: true }]) {
  const at = `${viewport.width}${viewport.big ? ' ?big' : ''}`;
  test(`a mark follows its time and centres on its digits, on the board and in Last laps, whose times stay aligned, at ${at}`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(`/personal/board${viewport.big ? '?big' : ''}`);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measure);
    check(m, 'board');
    assert.ok(m.marks.some((x) => x.where.startsWith('board-table') && x.where.endsWith('FL')), 'FL on P1 of a practice');
    assert.ok(m.marks.some((x) => x.where.startsWith('board-laps') && x.where.endsWith('FL')), 'FL in Last laps');
    assert.ok(m.feed.every((li) => li.markCellAfterTime), 'every lap in the feed keeps a mark column after its time');
    assert.ok(m.feed.some((li) => li.marked) && m.feed.some((li) => !li.marked), 'laps with a mark and without');
    const rights = m.feed.map((li) => li.right);
    assert.ok(Math.max(...rights) - Math.min(...rights) <= 1, `the feed's times end together: ${Math.min(...rights).toFixed(1)}–${Math.max(...rights).toFixed(1)}`);
    assert.deepEqual(errors, []);
  });
}

test('on the big screen at 1920×1080, Last laps keeps whole names beside a "Not counted" tag and the mark column; a time that did not count is muted', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await page.goto('/personal/board?big');
  await page.evaluate(() => document.fonts.ready);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.board-feed .board-laps li')].map((li) => {
    const name = li.querySelector('.driver-name');
    return {
      name: name.textContent,
      cut: name.scrollWidth > name.clientWidth + 0.5,
      tagged: /Not counted/.test(li.querySelector('.board-laps-tags').textContent),
      marked: Boolean(li.querySelector('.mark')),
      notCounted: li.classList.contains('is-not-counted'),
      colour: getComputedStyle(li.querySelector('.num')).color,
      muted: (() => { const probe = document.createElement('span'); probe.style.color = 'var(--p-text-muted)'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; })(),
    };
  }));
  assert.ok(rows.some((r) => r.marked), 'a mark in the feed');
  const tagged = rows.filter((r) => r.tagged);
  // The big screen's eleven rows reach Ben's lap that did not count, not Mia's.
  assert.ok(tagged.some((r) => r.name === 'Ben Okafor'), 'a long name beside the tag');
  for (const r of rows) {
    assert.ok(!r.cut, `${r.name}${r.tagged ? ' (Not counted)' : ''}: the name is whole`);
    assert.equal(r.notCounted, r.tagged, `${r.name}: muted exactly when it did not count`);
    if (r.notCounted) assert.equal(r.colour, r.muted, `${r.name}: a time that did not count is muted`);
    else assert.notEqual(r.colour, r.muted);
  }
  assert.deepEqual(errors, []);
});

test('on the session page a mark follows its time and centres on its digits, in the table and the lap lists', async (t) => {
  app.engine.end(ws, practice.id);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(`/personal/sessions/${practice.id}`);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(measure);
    check(m, `session page at ${viewport.width}`);
    assert.deepEqual(m.marks.filter((x) => x.where.endsWith('FL')).map((x) => x.where.split(' ')[0]), ['board-table', 'lap-table'], 'FL once in the table, once in the laps');
    // The fact: the time, then the driver, a gap apart, on one baseline.
    const fact = await page.evaluate(() => {
      const dd = document.querySelector('.session-facts .lap-credit');
      const time = dd.querySelector('.num').getBoundingClientRect();
      const driver = dd.querySelector('.driver').getBoundingClientRect();
      return { gap: driver.left - time.right, text: dd.textContent.replace(/\s+/g, ' ').trim(), weight: getComputedStyle(dd.querySelector('.driver-name')).fontWeight };
    });
    assert.equal(fact.text, '8.900 Ana');
    assert.ok(Math.abs(fact.gap - 16) <= 1, `the driver ${fact.gap}px after the time`);
    assert.equal(fact.weight, '400');
    assert.deepEqual(errors, []);
  }
});
