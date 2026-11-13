// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// "Crossing now" (drivers and transponders spec §3.3, §3.6), server first: the
// form, Setup's add list and collect show it lit when the transponder crossed or
// passed in the last 10 s, and say "crossed" only for one that ever did; each page
// wraps its slots in tl-crossing-now for the live stream to light them later.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: Date.UTC(2026, 10, 12, 12, 0, 0) };
let app;
let owner;
let ws;

before(async () => {
  app = await startTiming({ clock });
  owner = await app.login(await app.signUp('Ana'));
  const me = await (await app.api(owner, 'GET', '/auth/me')).json();
  ws = me.workspaces[0].id;
  app.store.addDriver(ws, { id: 'simon', name: 'Simon', colour: '#ff8a00' });
  const pass = (code, ago) => {
    app.store.seeTransponder(ws, code, clock.now - ago);
    app.store.insertPassing({ decoder: 'd1', boot: 'b', transponder: code, t: 1, receivedAt: clock.now - ago, via: 'net', workspaceId: ws });
  };
  pass('41', 3000); // crossing now
  pass('52', 8 * 60_000); // crossed 8 min ago
  // 5E was typed in for Simon and removed again: it never crossed.
  app.store.assignTransponder(ws, '5E', 'simon', clock.now - 1000);
  assert.equal((await app.form(owner, '/personal/transponders/5E/remove', {})).status, 303);
});
after(() => app.close());

const get = async (path) => (await app.api(owner, 'GET', path, undefined, { accept: 'text/html' })).text();

test('the typed-in number is back to unassigned', () => {
  assert.equal(app.store.transponders(ws).find((t) => t.code === '5E').driverId, null);
});

test('the form: the line is a slot tl-crossing-now finds, lit by the server within 10 s', async () => {
  const lit = await get('/personal/transponders/41');
  assert.match(lit, new RegExp(`<tl-crossing-now src="/personal/live">`));
  assert.match(lit, /<script type="module" src="\/public\/elements\/crossing-now\.js"><\/script>/);
  assert.match(lit, /<p class="subtitle pick-live crossing-now" data-code="41" data-left-ms="7000">It's on the track now\.<\/p>/);
  assert.match(await get('/personal/transponders/52'), /<p class="subtitle pick-live crossing-now" data-code="52" hidden>/);
  assert.match(await get('/personal/transponders/5E'), /<p class="subtitle pick-live crossing-now" data-code="5E" hidden>/);
});

test("Setup's add list: lit within 10 s, crossed from the last crossing, and no crossed line for one that never crossed", async () => {
  const body = await get('/personal/setup');
  assert.match(body, new RegExp(`<tl-crossing-now src="/personal/live">\\s*<tl-frame id="drivers"`));
  assert.match(body, /<script type="module" src="\/public\/elements\/crossing-now\.js"><\/script>/);
  const summary = (code) => body.match(new RegExp(`<details class="pick-row" name="add-simon" data-code="${code}">\\s*<summary>([\\s\\S]*?)</summary>`))?.[1];
  assert.match(summary('41'), /<span class="crossing-now" data-left-ms="7000">Crossing now<\/span><span class="crossed">crossed <time[^>]*>just now<\/time><\/span>/);
  assert.match(summary('52'), /<span class="crossing-now" hidden>Crossing now<\/span><span class="crossed">crossed <time[^>]*>8 min ago<\/time><\/span>/);
  assert.match(summary('5E'), /<span class="crossing-now" hidden>Crossing now<\/span><\/span>$/);
  assert.doesNotMatch(summary('5E'), /crossed/);
});

test('collect: the row is lit within 10 s, and the subtitle counts only those that crossed', async () => {
  const body = await get('/personal/transponders/new');
  assert.match(body, /<li class="collect-row is-crossing" data-code="41">[\s\S]*?<span class="crossing-now" data-left-ms="7000">Crossing now<\/span>/);
  assert.match(body, /<li class="collect-row" data-code="52">[\s\S]*?<span class="crossing-now" hidden>Crossing now<\/span><span class="crossed">Crossed <time[^>]*>8 min ago/);
  const typed = body.match(/<li class="collect-row" data-code="5E">[\s\S]*?<\/li>/)[0];
  assert.match(typed, /<p class="collect-seen"><span class="crossing-now" hidden>Crossing now<\/span><\/p>/);
  assert.match(body, /2 crossed the line and aren't assigned yet\./);
});

test('a lit slot says how long it stays lit: the rest of the 10 s, from the crossing', async () => {
  for (const path of ['/personal/transponders/41', '/personal/setup', '/personal/transponders/new']) {
    const left = [...(await get(path)).matchAll(/data-left-ms="(\d+)"/g)].map((m) => Number(m[1]));
    assert.ok(left.length > 0, path);
    for (const ms of left) assert.ok(ms > 0 && ms <= 10_000, `${path}: ${ms}`);
  }
  assert.doesNotMatch(await get('/personal/transponders/52'), /data-left-ms/);
});
