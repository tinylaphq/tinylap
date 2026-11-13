// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One shadow size on the board: the strip, the clock, the standings and Last
// laps each measure a 4px offset, at a laptop and at a big screen's width. And
// the standings header's bottom line is the header's own colour, so no light
// line shows between it and a row.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
let ws;
let session;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  await app.form(member, '/personal/drivers', { name: 'Ana' });
  app.engine.assign(ws, '7', app.store.drivers(ws).find((d) => d.name === 'Ana').id);
  session = app.engine.start(ws, { kind: 'practice' }).session;
  clock.offset += 60_000;
  const passings = [16_500, 8500, 500].map((ago) => ({ transponder: '7', t: clock.now - ago }));
  app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings } });
  app.engine.tick();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

for (const [label, viewport, path] of [['a laptop', { width: 1280, height: 800 }, '/personal/board'], ['a big screen', { width: 1920, height: 1080 }, '/personal/board?big']]) {
  test(`${label}: the board's four boxes measure a 4px shadow, and no light line sits under the header`, async () => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    await page.goto(path);
    await page.locator('.standings-table tbody tr').first().waitFor();
    const read = await page.evaluate(() => {
      const box = (selector) => getComputedStyle(document.querySelector(selector)).boxShadow;
      const th = getComputedStyle(document.querySelector('.standings-table th'));
      const table = getComputedStyle(document.querySelector('.standings-table'));
      return {
        shadows: { strip: box('.board-track'), clock: box('.board-clock'), standings: box('.standings-table'), feed: box('.board-feed') },
        header: { line: th.borderBottomColor, fill: th.backgroundColor, collapse: table.borderCollapse, spacing: table.borderSpacing },
      };
    });
    for (const [name, shadow] of Object.entries(read.shadows)) assert.match(shadow, /\b4px 4px 0px\b/, `${name}: ${shadow}`);
    assert.equal(read.header.line, read.header.fill, 'the header cells\' bottom line is the header\'s colour');
    assert.equal(read.header.collapse, 'separate');
    assert.equal(read.header.spacing, '0px');
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('the session page\'s Laps cards and the idle board\'s lists carry the same 4px ink shadow as the tables', async () => {
  app.engine.end(ws, session.id);
  const { context, page, errors } = await pageAs(browser, app, member);
  const shadow = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).boxShadow);
  await page.goto(`/personal/sessions/${session.id}`);
  const table = await shadow('.standings-table');
  assert.match(table, /4px 4px 0px/);
  assert.equal(await shadow('.session-laps'), table, 'a Laps card matches the Final table');
  await page.locator('.session-laps').first().hover();
  assert.equal(await shadow('.session-laps'), table, 'and keeps it under the pointer');
  await page.goto('/personal/board');
  assert.equal(await shadow('.board-ranks'), table, 'an idle board list matches too');
  assert.deepEqual(errors, []);
  await context.close();
});
