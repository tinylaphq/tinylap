// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The idle board's Start practice and the line that a car is on the track.
// On a laptop the line has its row kept above the button. On a phone, stacked,
// no row is kept: the line comes under the button. Either way the button never
// moves when the line comes.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
let ws;

const cross = (transponder) => app.engine.ingest({
  workspaceId: ws, decoder: 'd1', via: 'net',
  batch: { boot: 'b00tb00t', passings: [{ transponder, t: clock.now - 100 }] },
});

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  ws = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  await app.form(member, '/personal/drivers', { name: 'Ana' });
  app.engine.assign(ws, '7', app.store.drivers(ws)[0].id);
  // A session has run, so the board is the idle one with the record, not the first-run card.
  const { session } = app.engine.start(ws, { kind: 'practice' });
  clock.offset += 60_000;
  app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [16_500, 8500, 500].map((ago) => ({ transponder: '7', t: clock.now - ago })) } });
  app.engine.end(ws, session.id);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** Where Start practice and the line sit, from the top of the box they share. */
const place = () => {
  const go = document.querySelector('.board-hero-go');
  const top = go.getBoundingClientRect().top + parseFloat(getComputedStyle(go).borderTopWidth) + parseFloat(getComputedStyle(go).paddingTop);
  const button = document.querySelector('.board-hero-go .start-practice').getBoundingClientRect();
  const line = document.querySelector('.board-on-track')?.getBoundingClientRect();
  return { button: Math.round(button.top - top), buttonBottom: Math.round(button.bottom - top), line: line ? { top: Math.round(line.top - top), bottom: Math.round(line.bottom - top) } : null };
};

for (const [size, viewport, kept] of [['phone', { width: 390, height: 844 }, false], ['laptop', { width: 1280, height: 800 }, true]]) {
  test(`on a ${size}, the line that a car is on the track comes ${kept ? 'into its kept row above' : 'under'} Start practice, which never moves`, async (t) => {
    const { context, page, errors } = await pageAs(browser, app, member, { viewport });
    t.after(() => context.close());
    await page.goto('/personal/board');
    const before = await page.evaluate(place);
    assert.equal(before.line, null);
    if (kept) assert.ok(before.button > 20, `a row kept over the button: ${before.button}px`);
    else assert.equal(before.button, 0, 'no row kept: the button is the first thing');
    cross('7');
    await page.locator('.board-on-track').waitFor();
    const now = await page.evaluate(place);
    assert.equal(now.button, before.button, 'the button stays where it was');
    if (kept) assert.ok(now.line.bottom <= now.button, 'the line in its row, above the button');
    else assert.ok(now.line.top >= now.buttonBottom, 'the line under the button');
    assert.match(await page.locator('.board-on-track').innerText(), /Ana is on the track/);
    // The next session clears the idle line for the next test.
    const { session } = app.engine.start(ws, { kind: 'practice' });
    app.engine.end(ws, session.id);
    assert.deepEqual(errors, []);
  });
}
