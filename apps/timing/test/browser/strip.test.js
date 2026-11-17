// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The strip (strip design): one component heading every board. Where you
// are on the left, on white; the track record as a filled cell, and while a
// session runs the session's fastest lap as a second; no crown and no TR or FL
// mark, the fills say them, and every driver's square sits on a white
// nameplate. With no record yet the record cell keeps its place, unfilled.
// Every cell is one right column wide: the record cell over the right column
// (Last laps while running, the Start panel while idle), the fastest lap on
// its left. Every cell has the same three rows in every state, so the strip
// keeps its height idle, running and while a record falls. The fastest lap
// cell is a polite live region that a swap keeps, so a new fastest lap is
// read out, and a new holder never moves the strip. On a phone the cells sit
// side by side under the track. And a time with its driver reads as a value
// and its credit wherever it shows as one.
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
      crown: Boolean(cell.querySelector('.crown')),
      // Every driver's square on white: on its nameplate, never on the fill.
      onWhite: [...cell.querySelectorAll('.driver')].every((d) => getComputedStyle(d.closest('.strip-who') ?? cell).backgroundColor === fills.surface),
      squares: cell.querySelectorAll('.driver').length,
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
    // The column the record cell lines up with: Last laps while running, the Start panel's while idle.
    column: box(document.querySelector('.board-feed, #board-start')),
    // The standings' head and Last laps' bar.
    tableHead: box(document.querySelector('.standings-table thead tr')),
    feedHead: box(document.querySelector('.board-feed > h2')),
    feedHeadStyle: (() => { const h = document.querySelector('.board-feed > h2'); const th = document.querySelector('.standings-table th'); return h && th && [getComputedStyle(h).backgroundColor, getComputedStyle(th).backgroundColor]; })(),
    pageScroll: document.documentElement.scrollWidth - innerWidth,
  };
};

/** The checks every strip passes: palace's box, no marks and no crown, squares on white, labels on one line, no sideways scroll. */
function box(m, label) {
  assert.deepEqual(m.border, ['2px', '2px', '2px', '2px'], `${label}: palace's box, no bar`);
  assert.equal(m.shadow, `${m.ink} 4px 4px 0px 0px`, `${label}: raised in ink`);
  for (const cell of m.cells) {
    assert.equal(cell.marks, 0, `${label}, ${cell.kind}: no mark, the fill says it`);
    assert.equal(cell.labelLines, 1, `${label}, ${cell.kind}: the label on one line`);
    assert.equal(cell.crown, false, `${label}, ${cell.kind}: no crown, the fill says it`);
    assert.ok(cell.onWhite, `${label}, ${cell.kind}: every driver's square sits on white`);
    assert.ok(cell.squares <= 1, `${label}, ${cell.kind}: one driver per cell`);
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
  const [fastest, record] = m.cells;
  assert.deepEqual(m.cells.map((c) => c.kind), ['fastest', 'record'], 'the fastest lap on the record\'s left');
  assert.match(record.spoken, /^Track record 8\.000 Ana \d+ \w{3}$/, 'the label, the time, who and when');
  assert.equal(record.fill, 'record');
  assert.equal(record.role, null);
  assert.equal(fastest.spoken, 'Fastest lap No laps yet');
  assert.equal(fastest.fill, 'surface', 'unfilled until a lap counts');
  assert.equal(fastest.role, 'status', 'a polite live region');
  assert.deepEqual(errors, []);
});

test('a new fastest lap is read out, and a new holder moves nothing, a long name too; a record changes the record cell’s words to "New track record" and "Beat …"', async (t) => {
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
  assert.equal(before.cells[0].spoken, 'Fastest lap 9.000 Ana');
  assert.equal(before.cells[0].fill, 'fastest');
  assert.ok(before.cells[0].kept, 'the live region stays across the swap, so the change is read out');
  // The car with the long name takes it: 8.950.
  await pass('20', 8950);
  await page.locator('.board-fastest-line .driver-name', { hasText: LONG }).waitFor();
  const after = await page.evaluate(read);
  const fl = after.cells[0];
  assert.equal(fl.spoken, `Fastest lap 8.950 ${LONG}`);
  assert.ok(fl.kept, 'still the same element');
  assert.equal(fl.role, 'status');
  // A full column wide, the cell holds it whole; one that does not fit ends in an ellipsis.
  assert.equal(fl.cut, false, 'the long name shows whole');
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
  assert.equal(record.cells[1].spoken, 'New track record 7.900 Ana Beat 8.000', 'the words say it, with one driver');
  assert.equal(record.cells[1].fill, 'record');
  assert.equal(record.cells[0].spoken, 'Fastest lap 7.900 Ana');
  assert.ok(record.cells[0].kept, 'the fastest lap cell is the same element');
  assert.deepEqual(errors, []);
});

const SIZES = [['a laptop', { width: 1280, height: 800 }, '/personal/board'], ['a phone', { width: 390, height: 844 }, '/personal/board'], ['a big screen', { width: 1920, height: 1080 }, '/personal/board?big']];
/** The strip's height while a session runs, at each size, for the idle board to match. */
const liveHeight = new Map();
/** The record cell's left edge while a session runs, at each size. */
const liveRecord = new Map();

/** Every cell one right column wide, the record cell over the right column, the fastest lap on its left; on a phone, side by side under the track. */
function layout(m, label, phone) {
  const record = m.cells.find((c) => c.kind === 'record');
  if (phone) {
    for (const cell of m.cells) assert.ok(cell.box.top >= m.where.bottom - 0.5, `${label}, ${cell.kind}: under the track`);
    const width = (m.strip.width - 4) / m.cells.length;
    for (const cell of m.cells) assert.ok(Math.abs(cell.box.width - width) <= 0.5, `${label}, ${cell.kind}: ${cell.box.width.toFixed(1)} wide, a share of the strip`);
    assert.ok(Math.abs(record.box.right - (m.strip.right - 2)) <= 0.5, `${label}: the record at the strip's right end`);
    return;
  }
  if (m.column) assert.ok(Math.abs(record.box.left - m.column.left) <= 0.5, `${label}: the record cell's edge ${record.box.left.toFixed(1)}, the column's ${m.column.left.toFixed(1)}`);
  assert.ok(Math.abs(record.box.right - (m.strip.right - 2)) <= 0.5, `${label}: the record at the strip's end`);
  for (const cell of m.cells) {
    assert.ok(Math.abs(cell.box.width - record.box.width) <= 0.5, `${label}, ${cell.kind}: one cell's width`);
    // The column less the strip's border, so the record cell spans from the column's edge to the strip's inside.
    if (m.column) assert.ok(Math.abs(cell.box.width - (m.column.width - 2)) <= 0.5, `${label}, ${cell.kind}: ${cell.box.width.toFixed(1)} wide, the column ${m.column.width.toFixed(1)}`);
  }
  const fastest = m.cells.find((c) => c.kind === 'fastest');
  if (fastest) assert.ok(Math.abs(fastest.box.top - record.box.top) <= 0.5 && Math.abs(fastest.box.right - record.box.left) <= 0.5, `${label}: the fastest lap on the record's left`);
}

for (const [label, viewport, path] of SIZES) {
  test(`on ${label}, while a session runs, the record cell sits over Last laps and the fastest lap on its left, or they sit side by side`, async (t) => {
    // Past the record state.
    clock.offset += 31_000;
    app.engine.tick();
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(read);
    box(m, label);
    assert.deepEqual(m.cells.map((c) => [c.kind, c.fill]), [['fastest', 'fastest'], ['record', 'record']]);
    layout(m, label, viewport.width <= 720);
    // Last laps opens with the standings' black bar, as tall, so both panels open on one line.
    assert.ok(Math.abs(m.feedHead.height - m.tableHead.height) <= 0.5, `${label}: Last laps' bar ${m.feedHead.height.toFixed(1)}px, the standings' head ${m.tableHead.height.toFixed(1)}px`);
    assert.equal(m.feedHeadStyle[0], m.feedHeadStyle[1], `${label}: the same black`);
    if (viewport.width > 720) assert.ok(Math.abs(m.feedHead.top - m.tableHead.top) <= 0.5, `${label}: on one line: ${m.feedHead.top.toFixed(1)}, ${m.tableHead.top.toFixed(1)}`);
    liveHeight.set(label, m.strip.height);
    liveRecord.set(label, m.cells.find((c) => c.kind === 'record').box.left);
    assert.deepEqual(errors, []);
  });
}

for (const [label, viewport, path] of SIZES) {
  test(`on ${label}, while nobody races, the record cell alone, over the Start column or at the right, and the strip as tall as live`, async (t) => {
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
    layout(m, label, viewport.width <= 720);
    // On the TV, which has no Start column, the cell keeps the live board's width and place, so it stays put when a session starts.
    if (path.endsWith('?big')) assert.ok(Math.abs(record.box.left - liveRecord.get(label)) <= 0.5, `${label}: the record cell where it was live: ${liveRecord.get(label)?.toFixed(1)} → ${record.box.left.toFixed(1)}`);
    assert.ok(Math.abs(m.strip.height - liveHeight.get(label)) <= 0.5, `${label}: the strip as tall idle as live: ${liveHeight.get(label)?.toFixed(1)} → ${m.strip.height.toFixed(1)}`);
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
