// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { get as httpGet } from 'node:http';
import { createEngine } from '../../server/engine.js';
import { createHub } from '../../server/live.js';
import { openStore } from '../../server/store.js';
import { startServer, startTiming } from './helpers.js';

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

const VARY = 'Accept, Sec-Fetch-Mode';
const watchToken = async () => {
  await app.form(member, `${base}/watch-link`, {});
  return app.store.workspace(office.id).watchToken;
};

test('the watchers URL varies on what it negotiates, in every outcome', async () => {
  const token = await watchToken();
  const json = { accept: 'application/json' };
  const gone = 'AAAAAAAAAAAAAAAAAAAAAA';
  for (const [name, path, headers] of [
    ['JSON 200', `/watch/${token}`, json], ['page 200', `/watch/${token}`, {}],
    ['page 404', `/watch/${gone}`, {}], ['JSON 404', `/watch/${gone}`, json],
  ]) {
    const res = await app.api(null, 'GET', path, undefined, name.startsWith('page') ? { accept: 'text/html', ...headers } : headers);
    assert.ok((res.headers.get('vary') ?? '').includes(VARY), name);
    await res.arrayBuffer();
  }
});

test('the watchers page is never cached or passed on, and navigation gets it', async () => {
  const token = await watchToken();
  // fetch drops Sec-* request headers, so ask with http.
  const res = await new Promise((done) => httpGet(`${app.base}/watch/${token}`, { headers: { 'sec-fetch-mode': 'navigate' } }, (r) => { r.resume(); done(r); }));
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('?big on the watchers URL is the wall layout with a way out', async () => {
  const token = await watchToken();
  const body = await (await get(null, `/watch/${token}?big`)).text();
  assert.match(body, /<body class="big">/);
  assert.match(body, new RegExp(`href="/watch/${token}">Leave big screen</a>`));
});

test('a replaced watchers link is a page for browsers and Problem Details for programs', async () => {
  const old = await watchToken();
  await watchToken();
  const page = await get(null, `/watch/${old}`);
  assert.equal(page.status, 404);
  assert.match(await page.text(), /This watchers link no longer works/);
  const data = await app.api(null, 'GET', `/watch/${old}`, undefined, { accept: 'application/json' });
  assert.equal(data.status, 404);
  assert.match(data.headers.get('content-type'), /^application\/problem\+json/);
});

test('JSON on the watchers URL does not depend on the log-in', async () => {
  const store = openStore(':memory:');
  const hub = createHub({ now: () => clock.now });
  const engine = createEngine({ store, hub, now: () => clock.now });
  store.ensureWorkspace('w1');
  const token = 'T'.repeat(22);
  store.setWatchToken('w1', token);
  let asked = 0;
  const auth = { issuer: 'http://issuer.invalid', bff: { session: async () => { asked += 1; throw new Error('issuer down'); } } };
  const server = await startServer({ store, hub, engine, auth, now: () => clock.now });
  try {
    const res = await fetch(`${server.base}/watch/${token}`, { headers: { accept: 'application/json' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).session, null);
    const gone = await fetch(`${server.base}/watch/${'U'.repeat(22)}`, { headers: { accept: 'application/json' } });
    assert.equal(gone.status, 404);
    const page = await fetch(`${server.base}/watch/${token}`, { headers: { accept: 'text/html' } });
    assert.equal(page.status, 200);
    assert.equal(asked, 0, 'the log-in is never asked');
  } finally {
    await server.close();
  }
});
