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
let practiceClub;
let countdownClub;
let finishClub;

before(async () => {
  app = await startTiming({ clock });
  const user = await app.signUp('Ana');
  office = app.club(user, 'Office');
  practiceClub = app.club(user, 'Practice');
  countdownClub = app.club(user, 'Countdown');
  finishClub = app.club(user, 'Finish');
  member = await app.login(user);
  base = `/clubs/${office.id}`;
});
after(() => app.close());

const get = (who, path, headers = {}) => app.api(who, 'GET', path, undefined, { accept: 'text/html', ...headers });
const pass = (t, transponder = '10') => {
  clock.now = 1_000_000_000_000 + t;
  app.engine.ingest({ workspaceId: office.id, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder, t }] } });
};
const passIn = (ws, t, transponder = '10') => {
  clock.now = 1_000_000_000_000 + t;
  app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder, t }] } });
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
  assert.match(body, /<script type="module" src="\/public\/elements\/countdown.js"><\/script>/);
  assert.match(body, /<script type="module" src="\/pkg\/design\/elements\/relative-time.js"><\/script>/);
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

// The board elements (step two spec §5.1, §2.3). `t` only ever grows: clock.now follows it.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A driver named `name` in `club`, on `transponder`. */
async function driverIn(club, name, transponder) {
  await app.form(member, `/clubs/${club.id}/drivers`, { name });
  const driver = app.store.drivers(club.id).find((d) => d.name === name);
  app.engine.assign(club.id, transponder, driver.id);
  return driver;
}

test('the board is a tl-board, and its clock a tl-countdown', async () => {
  const body = await (await get(member, `${base}/board`)).text();
  assert.match(body, /<tl-board status="live-status">\s*<div id="board-live"/);
  assert.match(body, /<tl-countdown class="board-clock"><span class="stat-label board-clock-label" data-clock-label>/);
});

test('a stopped practice driver shows when they last crossed the line, but not within the minute', async () => {
  await driverIn(practiceClub, 'Cleo', '21');
  passIn(practiceClub.id, 200_000, '21');
  passIn(practiceClub.id, 208_000, '21');
  const lastAt = clock.now;
  clock.now = lastAt + 180_000;
  let body = await (await get(member, `/clubs/${practiceClub.id}/board`)).text();
  assert.match(body, new RegExp(`<td class="board-driver"><span class="driver" style="--driver: [^"]+">Cleo</span><tl-relative-time class="board-ago" now="${clock.now}" min="60000">last lap <time datetime="${escape(new Date(lastAt).toISOString())}">3 min ago</time></tl-relative-time></td>`));

  passIn(practiceClub.id, 396_000, '21');
  passIn(practiceClub.id, 404_000, '21');
  clock.now += 30_000;
  body = await (await get(member, `/clubs/${practiceClub.id}/board`)).text();
  assert.match(body, new RegExp(`<tl-relative-time class="board-ago" now="${clock.now}" min="60000" hidden>last lap <time datetime="[^"]+">just now</time></tl-relative-time>`));
});

test('no note during a race countdown, nor for a crossing before the start', async () => {
  const driver = await driverIn(countdownClub, 'Dora', '31');
  clock.now = 1_000_000_000_000 + 500_000;
  const { session } = app.engine.start(countdownClub.id, { kind: 'race', roster: [driver.id], durationMs: 60_000, countdownMs: 30_000 });
  passIn(countdownClub.id, 505_000, '31');
  let body = await (await get(member, `/clubs/${countdownClub.id}/board`)).text();
  assert.match(body, /data-state="countdown"/);
  assert.match(body, />Dora<\/span><\/td>/);
  assert.doesNotMatch(body, /tl-relative-time/);

  // Running, and the only crossing was before the start.
  clock.now = session.opensAt + 30_000;
  app.engine.tick();
  body = await (await get(member, `/clubs/${countdownClub.id}/board`)).text();
  assert.match(body, /data-state="running"/);
  assert.doesNotMatch(body, /tl-relative-time/);
});

test('no note on a finished row, nor in the results', async () => {
  const a = await driverIn(finishClub, 'Abe', '41');
  const b = await driverIn(finishClub, 'Bea', '42');
  clock.now = 1_000_000_000_000 + 700_000;
  const { session } = app.engine.start(finishClub.id, { kind: 'race', roster: [a.id, b.id], durationMs: 60_000, countdownMs: 0 });
  passIn(finishClub.id, 701_000, '41');
  passIn(finishClub.id, 701_500, '42');
  passIn(finishClub.id, 709_000, '41');
  passIn(finishClub.id, 709_500, '42');
  clock.now = session.closesAt + 1000;
  app.engine.tick();
  passIn(finishClub.id, 765_000, '41');
  clock.now += 180_000;
  let body = await (await get(member, `/clubs/${finishClub.id}/board`)).text();
  assert.match(body, /data-state="finishing"/);
  assert.match(body, /<tr class="is-finished">\s*<td class="pos">\d<\/td>\s*<td class="board-driver"><span [^>]+>Abe<\/span><\/td>/);
  assert.match(body, />Bea<\/span><tl-relative-time class="board-ago"[^>]*>last lap <time [^>]+>3 min ago<\/time>/);

  app.engine.abort(finishClub.id, session.id);
  body = await (await get(member, `/clubs/${finishClub.id}/board`)).text();
  const results = body.slice(body.indexOf('<section class="board-results"'), body.indexOf('</section>', body.indexOf('<section class="board-results"')));
  assert.match(results, /<td class="board-driver"><span [^>]+>Abe<\/span><\/td>/);
  assert.doesNotMatch(results, /tl-relative-time/);
});

test('the watchers board and the big board show the note too', async () => {
  const token = await watchToken();
  for (const body of [await (await get(null, `/watch/${token}`)).text(), await (await get(member, `${base}/board?big`)).text()]) {
    assert.match(body, /&lt;i&gt;Ana&lt;\/i&gt;<\/span><tl-relative-time class="board-ago" now="\d+" min="60000">last lap <time datetime="[^"]+">\d+ min ago<\/time><\/tl-relative-time>/);
  }
});
