// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Names in tables and lists: the record holder's crown before the name, never
// alone on a line; a name too long for its column cut with "…" on one line,
// whole in its title and for a screen reader.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

// Server time runs with real time; a test only ever moves it forward.
const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
const LONG = 'Maximiliane Featherstonehaugh-Wolstenholme';
const NAMES = [LONG, 'Ana', 'Jürgen Böhm'];
let app;
let browser;
let member;
let ws;

/** Each car's passings, `laps(i)` ms apart, the last just before now. */
function drive(laps) {
  NAMES.forEach((_, i) => {
    const transponder = String(41 + i);
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
    app.engine.assign(ws, String(41 + i), app.store.drivers(ws).find((d) => d.name === name).id);
  }
  // The long name sets the record in a practice, then a race runs: it holds the crown on the board.
  const practice = app.engine.start(ws, { kind: 'practice' }).session;
  clock.offset += 60_000;
  drive((i) => [8000 + i * 300, 7900 + i * 300]);
  app.engine.end(ws, practice.id);
  clock.offset += 10_000;
  app.engine.start(ws, { kind: 'race', roster: app.store.drivers(ws).map((d) => d.id), durationMs: 900_000, countdownMs: 0 });
  clock.offset += 60_000;
  drive((i) => [8600 + i * 100, 8500 + i * 100]);
  app.engine.tick();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** Every name in a table or list: its crown's line, whether it is cut, and how. */
const names = () => [...document.querySelectorAll('.board-driver .driver-name, .board-laps .driver-name')].map((name) => {
  const style = getComputedStyle(name);
  const crown = name.parentElement.querySelector('.crown');
  const box = name.getBoundingClientRect();
  const c = crown?.getBoundingClientRect();
  return {
    text: name.textContent,
    title: name.title,
    cut: name.scrollWidth > name.clientWidth + 0.5,
    oneLine: name.getClientRects().length === 1 && style.whiteSpace === 'nowrap',
    ellipsis: style.textOverflow === 'ellipsis' && style.overflow === 'hidden',
    crown: c ? { sameLine: Math.abs(c.bottom - box.bottom) < box.height / 2, before: c.right <= box.left + 0.5 } : null,
  };
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1920, height: 1080, big: true }]) {
  test(`the crown sits before its name, and a long name is cut with "…" but whole in its title and for screen readers, at ${viewport.width}${viewport.big ? ' ?big' : ''}`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto(`/personal/board${viewport.big ? '?big' : ''}`);
    await page.evaluate(() => document.fonts.ready);
    const all = await page.evaluate(names);
    const crowned = all.filter((n) => n.crown);
    assert.ok(crowned.length >= 1, 'the holder has a crown in the table');
    for (const n of crowned) assert.deepEqual(n.crown, { sameLine: true, before: true }, `${n.text}: the crown on the name's line, before it`);
    for (const n of all) {
      assert.equal(n.title, n.text, `${n.text}: its title is the whole name`);
      assert.ok(n.oneLine && n.ellipsis, `${n.text}: one line, cut with an ellipsis if it must be`);
    }
    assert.ok(all.some((n) => n.text === LONG && n.cut), 'the long name is cut here');
    // A screen reader gets the whole name: the table's accessible tree has it in full.
    assert.match(await page.locator('.standings-table').ariaSnapshot(), new RegExp(`Track record holder.*${LONG}`));
    assert.deepEqual(errors, []);
  });
}
