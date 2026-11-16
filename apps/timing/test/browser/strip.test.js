// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The strip (board hub spec §3): one component heading every board. Where you
// are on the left, on white; the track record as a filled cell, and while a
// session runs the session's fastest lap as a second; no TR or FL mark, the
// fills say them. With no record yet the record cell keeps its place,
// unfilled. The record cell's left edge falls on the right column's (Last
// laps' while running, the Start column's while idle). The fastest
// lap cell is a polite live region that a swap keeps, so a new fastest lap is
// read out, and a new holder never moves the strip. On a phone the cells
// stack. And a time with its driver reads as a value and its credit wherever
// it shows as one.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
const LONG = 'Maximilian Konstantinopoulos';
let app;
let browser;
let member;
let fresh;
let decoder;
let ws;
let session;
/** The decoder's clock, in step with the server's, and each car's last crossing on it. */
const start = Date.now();
const decoderNow = () => clock.now - start;
const last = new Map();

/** A crossing of `transponder`, `lap` ms after its last one, or now; the server's clock moves on to it, so every lap is fresh. */
async function pass(transponder, lap) {
  const at = lap ? last.get(transponder) + lap : decoderNow();
  if (at > decoderNow()) clock.offset += at - decoderNow();
  last.set(transponder, at);
  const response = await postPassings(app, decoder, [{ transponder, t: at }]);
  assert.equal(response.status, 200);
}

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  // A club that has never driven.
  fresh = await app.login(await app.signUp('Ben'));
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  for (const name of ['Ana', LONG]) await app.form(member, '/personal/drivers', { name });
  const [ana, max] = app.store.drivers(ws);
  app.engine.assign(ws, '10', ana.id);
  app.engine.assign(ws, '20', max.id);
  useTrack(app.store, ws, 'Ring', 'cw', 't1');
  decoder = await (await app.api(member, 'POST', `/workspaces/${ws}/decoders`, { name: 'Start line' })).json();
  // An earlier session sets the record: 8.000, Ana's.
  const first = app.engine.start(ws, { kind: 'practice' }).session;
  clock.offset += 10_000;
  await pass('10');
  await pass('10', 8000);
  app.engine.end(ws, first.id);
  clock.offset += 60_000;
  app.engine.tick();
  session = app.engine.start(ws, { kind: 'practice' }).session;
  clock.offset += 10_000;
  await pass('10');
  await pass('20');
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** The strip as the page lays it out, and as a screen reader reads its cells. */
const read = () => {
  const box = (el) => {
    const r = el?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null;
  };
  const colour = (value) => {
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  };
  const fills = { record: colour('var(--tl-record)'), fastest: colour('var(--tl-fastest)'), surface: colour('var(--p-surface)') };
  /** The text a screen reader gets: aria-hidden parts left out. */
  const spoken = (el) => {
    let text = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) text += ` ${node.textContent} `;
      else if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute('aria-hidden') !== 'true') node.childNodes.forEach(walk);
    };
    walk(el);
    return text.replace(/\s+/g, ' ').trim();
  };
  const strip = document.querySelector('.board-track');
  const cells = [...strip.querySelectorAll('.strip-cell')].map((cell) => {
    const name = cell.querySelector('.strip-by .driver-name');
    const label = cell.querySelector('.strip-label');
    const fill = getComputedStyle(cell).backgroundColor;
    return {
      kind: cell.classList.contains('is-record') ? 'record' : 'fastest',
      box: box(cell),
      fill: Object.keys(fills).find((k) => fills[k] === fill) ?? fill,
      spoken: spoken(cell),
      role: cell.getAttribute('role'),
      marks: cell.querySelectorAll('.mark').length,
      crown: Boolean(cell.querySelector('.strip-crown')),
      // The label keeps one line.
      labelLines: Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight)),
      cut: name ? name.scrollWidth > name.clientWidth + 0.5 : null,
      overflow: name ? getComputedStyle(name).textOverflow : null,
      kept: /** @type {any} */ (cell).kept === true,
    };
  });
  const s = getComputedStyle(strip);
  return {
    strip: box(strip),
    border: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
    shadow: s.boxShadow,
    ink: colour('var(--p-text)'),
    where: box(strip.querySelector('.strip-where')),
    cellsBox: box(strip.querySelector('.strip-cells')),
    cells,
    // The column the record cell lines up with: Last laps while running, the side (Start, Fastest on this track) while idle.
    column: box(document.querySelector('.board-feed, .board-next')),
    pageScroll: document.documentElement.scrollWidth - innerWidth,
  };
};

/** The checks every strip passes: palace's box, no marks, labels on one line, no sideways scroll. */
function box(m, label) {
  assert.deepEqual(m.border, ['2px', '2px', '2px', '2px'], `${label}: palace's box, no bar`);
  assert.equal(m.shadow, `${m.ink} 4px 4px 0px 0px`, `${label}: raised in ink`);
  for (const cell of m.cells) {
    assert.equal(cell.marks, 0, `${label}, ${cell.kind}: no mark, the fill says it`);
    assert.equal(cell.labelLines, 1, `${label}, ${cell.kind}: the label on one line`);
  }
  assert.equal(m.pageScroll, 0, `${label}: the page does not scroll sideways`);
}

test('a club that has never driven: the record cell keeps its place, unfilled, "None yet" and "The first lap sets it."', async (t) => {
  for (const path of ['/personal/board', '/personal/board?big']) {
    const { context, page, errors } = await pageAs(browser, app, fresh, { viewport: { width: 1280, height: 800 } });
    t.after(() => context.close());
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(read);
    box(m, path);
    assert.equal(m.cells.length, 1, 'the record cell alone');
    const [record] = m.cells;
    assert.equal(record.spoken, 'Track record None yet The first lap sets it.');
    assert.equal(record.fill, 'surface', 'unfilled');
    assert.equal(record.crown, false, 'no crown: nobody holds it');
    assert.ok(Math.abs(record.box.right - (m.strip.right - 2)) <= 0.5, 'at the strip\'s right end');
    assert.deepEqual(errors, []);
  }
});

test('before any lap counts: the record from an earlier session, filled, and the fastest lap cell unfilled, a live region', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/board');
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(read);
  box(m, 'empty');
  const [record, fastest] = m.cells;
  assert.match(record.spoken, /^Track record 8\.000 Ana \d+ \w{3}$/, 'the label, the time, who and when; the crown for the eye only');
  assert.equal(record.fill, 'record');
  assert.ok(record.crown, 'the crown at the cell\'s end');
  assert.equal(record.role, null);
  assert.equal(fastest.spoken, 'Fastest lap No laps yet');
  assert.equal(fastest.fill, 'surface', 'unfilled until a lap counts');
  assert.equal(fastest.role, 'status', 'a polite live region');
  assert.deepEqual(errors, []);
});

test('a new fastest lap is read out, and a new holder moves nothing; a long name is cut; a record fills the record cell with "New track record" and "Beat …"', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/board');
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#live-status[data-state="live"]').waitFor();
  await page.evaluate(() => { /** @type {any} */ (document.querySelector('.board-fastest-line')).kept = true; });
  // Ana's first counted lap: 9.000.
  await pass('10', 9000);
  await page.locator('.board-fastest-line:not(.is-empty)').waitFor();
  const before = await page.evaluate(read);
  box(before, 'Ana');
  assert.equal(before.cells[1].spoken, 'Fastest lap 9.000 Ana');
  assert.equal(before.cells[1].fill, 'fastest');
  assert.ok(before.cells[1].kept, 'the live region stays across the swap, so the change is read out');
  // The car with the long name takes it: 8.950.
  await pass('20', 8950);
  await page.locator('.board-fastest-line .driver-name', { hasText: LONG }).waitFor();
  const after = await page.evaluate(read);
  const fl = after.cells[1];
  assert.equal(fl.spoken, `Fastest lap 8.950 ${LONG}`);
  assert.ok(fl.kept, 'still the same element');
  assert.equal(fl.role, 'status');
  assert.ok(fl.cut, 'the long name is cut');
  assert.equal(fl.overflow, 'ellipsis');
  for (const [i, cell] of after.cells.entries()) {
    for (const key of ['top', 'left', 'width', 'height']) assert.ok(Math.abs(cell.box[key] - before.cells[i].box[key]) <= 0.5, `${cell.kind}: ${key} ${before.cells[i].box[key].toFixed(1)} → ${cell.box[key].toFixed(1)}`);
  }
  assert.ok(Math.abs(after.strip.height - before.strip.height) <= 0.5, 'the strip keeps its height');
  // A track record: the record cell says so, and the fastest lap cell stays, still the same live region.
  await pass('10', 7900);
  await page.locator('.board-track[data-record-new] .strip-cell.is-new').waitFor();
  const record = await page.evaluate(read);
  box(record, 'record');
  assert.ok(Math.abs(record.strip.height - after.strip.height) <= 0.5, `the strip keeps its height when the record falls: ${after.strip.height.toFixed(1)} → ${record.strip.height.toFixed(1)}`);
  for (const [i, cell] of record.cells.entries()) assert.ok(Math.abs(cell.box.top - after.cells[i].box.top) <= 0.5, `${cell.kind}: nothing moves`);
  assert.equal(record.cells[0].spoken, 'New track record 7.900 Ana Beat 8.000 Ana');
  assert.equal(record.cells[0].fill, 'record');
  assert.equal(record.cells[1].spoken, 'Fastest lap 7.900 Ana');
  assert.ok(record.cells[1].kept, 'the fastest lap cell is the same element');
  assert.deepEqual(errors, []);
});

for (const [label, viewport, path] of [['a laptop', { width: 1280, height: 800 }, '/personal/board'], ['a phone', { width: 390, height: 844 }, '/personal/board'], ['a big screen', { width: 1920, height: 1080 }, '/personal/board?big']]) {
  test(`on ${label}, while a session runs, the record cell starts on Last laps' edge, or the cells stack`, async (t) => {
    // Past the record state.
    clock.offset += 31_000;
    app.engine.tick();
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(read);
    box(m, label);
    assert.deepEqual(m.cells.map((c) => [c.kind, c.fill]), [['record', 'record'], ['fastest', 'fastest']]);
    const [record, fastest] = m.cells;
    if (viewport.width <= 720) {
      // Stacked: the track and its decoders, then each cell at full width.
      assert.ok(record.box.top >= m.where.bottom - 0.5, 'the record under the track');
      assert.ok(fastest.box.top >= record.box.bottom - 0.5, 'the fastest lap under the record');
      for (const cell of m.cells) assert.ok(Math.abs(cell.box.width - (m.strip.width - 4)) <= 0.5, `${cell.kind}: full width`);
    } else {
      assert.ok(Math.abs(m.cellsBox.left - m.column.left) <= 0.5, `the record cell's edge ${m.cellsBox.left.toFixed(1)}, Last laps' ${m.column.left.toFixed(1)}`);
      assert.ok(Math.abs(record.box.top - fastest.box.top) <= 0.5 && fastest.box.left > record.box.left, 'the fastest lap beside the record');
      assert.ok(Math.abs(m.cellsBox.right - (m.strip.right - 2)) <= 0.5, 'the cells end at the strip\'s end');
    }
    assert.deepEqual(errors, []);
  });
}

for (const [label, viewport, path] of [['a laptop', { width: 1280, height: 800 }, '/personal/board'], ['a phone', { width: 390, height: 844 }, '/personal/board'], ['a big screen', { width: 1920, height: 1080 }, '/personal/board?big']]) {
  test(`on ${label}, while nobody races, the record cell alone, on the Start column's edge or at the right`, async (t) => {
    if (app.store.runningSession(ws)) app.engine.end(ws, session.id);
    clock.offset += 31_000;
    app.engine.tick();
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(path);
    await page.locator('.board-result').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(read);
    box(m, label);
    assert.equal(m.cells.length, 1, 'no fastest lap cell');
    const [record] = m.cells;
    assert.equal(record.fill, 'record');
    assert.match(record.spoken, /^Track record 7\.900 Ana \d+ \w{3}$/);
    if (viewport.width <= 720) {
      assert.ok(record.box.top >= m.where.bottom - 0.5, 'the record under the track');
      assert.ok(Math.abs(record.box.width - (m.strip.width - 4)) <= 0.5, 'at full width');
    } else if (path.endsWith('?big')) {
      assert.ok(Math.abs(record.box.right - (m.strip.right - 2)) <= 0.5, 'at the right: the big screen has no Start column');
    } else {
      assert.ok(Math.abs(m.cellsBox.left - m.column.left) <= 0.5, `the record cell's edge ${m.cellsBox.left.toFixed(1)}, the Start column's ${m.column.left.toFixed(1)}`);
    }
    assert.deepEqual(errors, []);
  });
}

/** A time and who set it in the page (fastest lap spec §7): the time's and the name's type, and the gap between. */
const credits = (selector) => {
  const colour = (value) => {
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  };
  const text = colour('var(--p-text)');
  const secondary = colour('var(--p-text-secondary)');
  return [...document.querySelectorAll(selector)].map((el) => {
    const time = el.querySelector('.num');
    const driver = el.querySelector('.driver');
    const name = el.querySelector('.driver-name');
    const after = el.querySelector('.num ~ .mark') ?? time;
    const range = document.createRange();
    range.selectNodeContents(after);
    const s = { time: getComputedStyle(time), name: getComputedStyle(name), driver: getComputedStyle(driver), square: getComputedStyle(driver, '::before') };
    return {
      where: `${el.className} ${time.textContent}`,
      timeWeight: s.time.fontWeight,
      timeMono: /JetBrains Mono/.test(s.time.fontFamily),
      timeText: s.time.color === text,
      nameWeight: s.name.fontWeight,
      nameSecondary: s.name.color === secondary,
      square: s.square.marginRight,
      nowrap: s.driver.whiteSpace === 'nowrap',
      // The gap from the time (or its mark) to the driver, where the driver follows it.
      gap: driver.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_PRECEDING ? driver.getBoundingClientRect().left - after.getBoundingClientRect().right : null,
    };
  });
};

test('a time and who set it: the idle board’s list, and none in a practice’s facts', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  const check = (list, label, { gap }) => {
    assert.ok(list.length > 0, `${label}: something to measure`);
    for (const c of list) {
      assert.equal(c.timeWeight, '700', `${c.where}: the time bold`);
      assert.ok(c.timeMono && c.timeText, `${c.where}: the time in JetBrains Mono, in the text colour`);
      assert.equal(c.nameWeight, '400', `${c.where}: the name regular`);
      assert.ok(c.nameSecondary, `${c.where}: the name in the secondary colour`);
      assert.equal(c.square, '4px', `${c.where}: the square --p-space-xs before the name`);
      assert.ok(c.nowrap, `${c.where}: the square stays with the name`);
      if (gap) assert.ok(Math.abs(c.gap - 16) <= 1, `${c.where}: the driver ${c.gap}px after the time`);
    }
  };
  if (app.store.runningSession(ws)) app.engine.end(ws, session.id);
  await page.goto('/personal/board');
  await page.locator('.board-result').waitFor();
  check(await page.evaluate(credits, '.board-ranks li'), 'the idle list', { gap: false });
  // A practice's page names its fastest lap on its P1 card, not in its facts; results.test.js measures a race's.
  await page.goto(`/personal/sessions/${session.id}`);
  assert.equal(await page.locator('.session-facts .lap-credit').count(), 0);
  assert.deepEqual(errors, []);
});
