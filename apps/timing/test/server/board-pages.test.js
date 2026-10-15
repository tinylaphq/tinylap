// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let office;
let base;

before(async () => {
  app = await startTiming({ clock });
  const user = await app.signUp('Ana');
  office = app.club(user, 'Office');
  member = await app.login(user);
  base = `/clubs/${office.id}`;
});
after(() => app.close());

const get = (who, path, headers = {}) => app.api(who, 'GET', path, undefined, { accept: 'text/html', ...headers });
const pass = (t, transponder = '10') => {
  clock.now = 1_000_000_000_000 + t;
  app.engine.ingest({ workspaceId: office.id, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder, t }] } });
};

test('an empty board shows a member how to get the track ready', async () => {
  const res = await get(member, `${base}/board`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<h1 class="board-title">Waiting for the first car<\/h1>/);
  assert.match(body, /aria-labelledby="board-steps-title"/);
  assert.match(body, new RegExp(`<a href="${base}/setup#track">Set the track</a>`));
  assert.match(body, /<noscript><meta http-equiv="refresh" content="10"><\/noscript>/);
  assert.match(body, new RegExp(`<div id="board-live"[^>]* data-events="${base}/board/events"`));
  assert.match(body, /<script type="module" src="\/public\/board.js"><\/script>/);
});

test('laps, a personal best and an unknown car', async () => {
  // Personal bests are per track: set one, and start practice on it.
  app.store.setTrack(office.id, { id: 't1', shape: 'c30:1:x', name: 'Office loop', snapshotKey: 'k'.repeat(22), layout: '{}' }, 'ccw');
  app.engine.restartPractice(office.id);
  await app.form(member, `${base}/drivers`, { name: '<i>Ana</i>' });
  const [ana] = app.store.drivers(office.id);
  app.engine.assign(office.id, '10', ana.id);
  pass(1000);
  pass(9000);
  pass(9500, '4711');
  const body = await (await get(member, `${base}/board`)).text();
  assert.match(body, /<h1 class="board-title">Practice<\/h1>/);
  assert.match(body, /&lt;i&gt;Ana&lt;\/i&gt;/);
  assert.doesNotMatch(body, /<i>Ana<\/i>/);
  assert.match(body, /<td class="num">8\.000<span class="badge pb">PB<\/span><\/td>/);
  assert.match(body, new RegExp(`Unknown car: 4711\\. <a href="${base}/setup#transponders">Assign in Setup</a>`));
  assert.match(body, /<time class="board-clock-time" data-clock data-kind="practice" data-state="running" data-opens="\d+" data-closes="" data-now="\d+">0:09<\/time>/);
});

test('?big is the wall layout, without the members-only notice', async () => {
  const body = await (await get(member, `${base}/board?big`)).text();
  assert.match(body, /<body class="big">/);
  assert.doesNotMatch(body, /Unknown car/);
  assert.match(body, new RegExp(`href="${base}/board">Leave big screen</a>`));
});

test('the watchers board: a page for browsers, JSON for programs, no codes', async () => {
  await app.form(member, `${base}/watch-link`, {});
  const token = app.store.workspace(office.id).watchToken;
  const page = await get(null, `/watch/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const body = await page.text();
  assert.match(body, /&lt;i&gt;Ana&lt;\/i&gt;/);
  assert.doesNotMatch(body, /4711|Unknown car|board-steps|nav-tabs|nav-account/);
  assert.match(body, new RegExp(`data-events="/watch/${token}/events"`));
  const data = await app.api(null, 'GET', `/watch/${token}`, undefined, { accept: 'application/json' });
  assert.match(data.headers.get('content-type'), /^application\/json/);
  assert.equal((await data.json()).session.kind, 'practice');
  const gone = await get(null, '/watch/AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(gone.status, 404);
  assert.match(await gone.text(), /This watchers link no longer works/);
});
