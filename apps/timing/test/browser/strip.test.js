// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The strip's two times to beat (fastest lap spec §3.1, §4, §7): the track
// record and the session's fastest lap, each as time, mark, driver, with no
// words on screen, in columns the two lines share. A new holder never moves a
// line; a long name is cut. The fastest lap's line is a polite live region
// that a swap keeps, so a new fastest lap is read out, and a record lap is
// not read as a fastest lap too. And a time with its driver reads as a value
// and its credit wherever it shows.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming, useTrack } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
const LONG = 'Maximilian Konstantinopoulos';
let app;
let browser;
let member;
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

/** The strip's lines as the page lays them out, and as a screen reader reads them. */
const read = () => {
  const box = (el) => el?.getBoundingClientRect();
  /** The right edge of an element's text, not its box. */
  const inkRight = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().right;
  };
  /** The text a screen reader gets: aria-hidden parts left out. */
  const spoken = (el) => {
    let text = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
      else if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute('aria-hidden') !== 'true') node.childNodes.forEach(walk);
    };
    walk(el);
    return text.replace(/\s+/g, ' ').trim();
  };
  /** The text on screen: visually hidden parts left out. */
  const visible = (el) => {
    let text = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) text += ` ${node.textContent} `;
      else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('visually-hidden')) node.childNodes.forEach(walk);
    };
    walk(el);
    return text.replace(/\s+/g, ' ').trim();
  };
  const strip = document.querySelector('.board-track');
  const lines = [...document.querySelectorAll('.board-track-times > p')].map((p) => {
    const time = p.querySelector('.board-track-time');
    const mark = p.querySelector('.mark');
    const driver = p.querySelector('.driver');
    const name = p.querySelector('.driver-name');
    const em = parseFloat(getComputedStyle(p).fontSize);
    return {
      kind: p.className,
      top: box(p).top,
      left: box(p).left,
      timeRight: box(time).right,
      timeInk: inkRight(time),
      markLeft: box(mark).left,
      markRight: box(mark).right,
      driverLeft: box(driver)?.left ?? null,
      // The name's column: from the driver's left edge to the line's right edge, in the line's em.
      column: driver ? (box(p).right - box(driver).left) / em : null,
      cut: name ? name.scrollWidth > name.clientWidth + 0.5 : null,
      overflow: name ? getComputedStyle(name).textOverflow : null,
      visible: visible(p),
      spoken: spoken(p),
      title: p.getAttribute('title'),
      role: p.getAttribute('role'),
      timeColour: getComputedStyle(time).color,
      kept: /** @type {any} */ (p).kept === true,
    };
  });
  const name = box(strip?.querySelector('.board-track-name'));
  const decoders = box(strip?.querySelector('.board-decoders'));
  const times = box(strip?.querySelector('.board-track-times'));
  const probe = document.createElement('span');
  probe.style.color = 'var(--p-text-muted)';
  document.body.append(probe);
  const muted = getComputedStyle(probe).color;
  probe.remove();
  return {
    lines,
    muted,
    record: strip?.classList.contains('is-record') ?? false,
    strip: box(strip)?.height,
    left: name && decoders ? { top: name.top, bottom: decoders.bottom, left: name.left } : null,
    times: times ? { top: times.top, bottom: times.bottom, left: times.left, height: times.height } : null,
    pageScroll: document.documentElement.scrollWidth - innerWidth,
  };
};

/** The checks every layout passes: shared columns, the gaps, no words on screen. */
function columns(m, label) {
  assert.equal(m.lines.length, 2, `${label}: two lines`);
  const [tr, fl] = m.lines;
  assert.ok(Math.abs(tr.timeRight - fl.timeRight) <= 0.5, `${label}: the times share a right edge`);
  assert.ok(Math.abs(tr.markLeft - fl.markLeft) <= 0.5, `${label}: the marks share a column`);
  const markEnd = Math.max(tr.markRight, fl.markRight);
  for (const line of m.lines) {
    assert.ok(Math.abs(line.markLeft - line.timeInk - 4) <= 1, `${label}, ${line.kind}: the mark ${(line.markLeft - line.timeInk).toFixed(1)}px after the time`);
    // The names share a column: it starts --p-space-md after the wider mark (TR is a little wider than FL).
    if (line.driverLeft !== null) assert.ok(Math.abs(line.driverLeft - markEnd - 16) <= 1, `${label}, ${line.kind}: the driver ${(line.driverLeft - markEnd).toFixed(1)}px after the marks' column`);
  }
  assert.equal(m.pageScroll, 0, `${label}: the page does not scroll sideways`);
}

test('before any lap counts, the fastest lap line is a muted dash and FL, no driver, and says "No laps yet"', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/board');
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(read);
  columns(m, 'empty');
  const [tr, fl] = m.lines;
  assert.equal(tr.visible, '8.000 TR Ana', 'the record from an earlier session');
  assert.equal(tr.spoken, 'Track record 8.000, Ana');
  assert.equal(fl.visible, '— FL');
  assert.equal(fl.spoken, 'Fastest lap: no laps yet');
  assert.equal(fl.title, 'No laps yet');
  assert.equal(fl.driverLeft, null, 'no driver');
  assert.equal(fl.timeColour, m.muted, 'the dash is muted');
  assert.equal(fl.role, 'status', 'a polite live region');
  assert.deepEqual(errors, []);
});

test('a new fastest lap is read out, and a new holder moves neither line; a long name is cut; a record lap hides the line', async (t) => {
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
  columns(before, 'Ana');
  assert.equal(before.lines[1].spoken, 'Fastest lap 9.000, Ana');
  assert.ok(before.lines[1].kept, 'the live region stays across the swap, so the change is read out');
  // The car with the long name takes it: 8.950.
  await pass('20', 8950);
  await page.locator('.board-fastest-line .driver-name', { hasText: LONG }).waitFor();
  const after = await page.evaluate(read);
  columns(after, LONG);
  const [, fl] = after.lines;
  assert.equal(fl.spoken, `Fastest lap 8.950, ${LONG}`);
  assert.equal(fl.visible, `8.950 FL ${LONG}`);
  assert.ok(fl.kept, 'still the same element');
  assert.ok(fl.cut, 'the long name is cut');
  assert.equal(fl.overflow, 'ellipsis');
  assert.ok(fl.column >= 9 - 0.05 && fl.column <= 12 + 0.05, `the name's column is ${fl.column.toFixed(2)}em`);
  for (const [i, line] of after.lines.entries()) {
    for (const key of ['top', 'left', 'timeRight', 'markLeft', 'driverLeft']) {
      assert.ok(Math.abs(line[key] - before.lines[i][key]) <= 0.5, `${line.kind}: ${key} ${before.lines[i][key].toFixed(1)} → ${line[key].toFixed(1)}`);
    }
  }
  assert.ok(Math.abs(after.strip - before.strip) <= 0.5, 'the strip keeps its height');
  // A track record: the strip shows it, and the fastest lap line goes, so it is not read out as well.
  await pass('10', 7900);
  await page.locator('.board-track.is-record').waitFor();
  const record = await page.evaluate(read);
  assert.equal(record.lines.length, 0);
  assert.equal(await page.locator('.board-fastest-line').count(), 0, 'no fastest lap line while the strip shows the record');
  assert.deepEqual(errors, []);
});

for (const [label, viewport, path] of [['a laptop', { width: 1280, height: 800 }, '/personal/board'], ['a phone', { width: 390, height: 844 }, '/personal/board'], ['a big screen', { width: 1920, height: 1080 }, '/personal/board?big']]) {
  test(`on ${label}, the two lines share columns and sit where they belong`, async (t) => {
    // Past the record state, so the strip shows its two lines again.
    clock.offset += 31_000;
    app.engine.tick();
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(read);
    columns(m, label);
    assert.deepEqual(m.lines.map((line) => line.visible), ['7.900 TR Ana', '7.900 FL Ana']);
    if (viewport.width <= 720) {
      // Stacked: the track, its decoders, then the lines, at the left.
      assert.ok(m.times.top >= m.left.bottom, 'the lines under the decoders');
      assert.ok(Math.abs(m.times.left - m.left.left) <= 0.5, 'the lines start where the track name does');
    } else {
      assert.ok(m.times.top < m.left.bottom && m.times.left > m.left.left, 'the lines beside the track, at the right');
      for (const line of m.lines) assert.ok(line.column >= 9 - 0.05 && line.column <= 12 + 0.05, `${line.kind}: the name's column is ${line.column.toFixed(2)}em`);
    }
    // The big screen: the two lines are no taller than the track and its decoders beside them, so the strip does not grow.
    if (path.endsWith('?big')) assert.ok(m.times.height <= m.left.bottom - m.left.top + 0.5, `the lines ${m.times.height.toFixed(1)}px, the left side ${(m.left.bottom - m.left.top).toFixed(1)}px`);
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

test('a time and who set it: the strip, the idle board’s record card and lists, and the session page’s Fastest lap', async (t) => {
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
  await page.goto('/personal/board');
  check(await page.evaluate(credits, '.board-track-times > p:not(.is-empty)'), 'the strip', { gap: false }); // the strip's gaps: columns() above
  app.engine.end(ws, session.id);
  clock.offset += 31_000;
  app.engine.tick();
  await page.goto('/personal/board');
  await page.locator('.board-hero').waitFor();
  check(await page.evaluate(credits, '.board-hero-record'), 'the record card', { gap: false });
  check(await page.evaluate(credits, '.board-ranks li'), 'the idle lists', { gap: false });
  await page.goto(`/personal/sessions/${session.id}`);
  check(await page.evaluate(credits, '.session-facts .lap-credit'), 'the session page', { gap: true });
  assert.deepEqual(errors, []);
});
