// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { get as httpGet } from 'node:http';
import { createEngine } from '../../server/engine.js';
import { createHub } from '../../server/live.js';
import { openStore } from '../../server/store.js';
import { startServer, startTiming, useTrack } from './helpers.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let office;
let base;
let practiceClub;
let countdownClub;
let finishClub;
let recordsClub;

before(async () => {
  app = await startTiming({ clock });
  const user = await app.signUp('Ana');
  office = app.club(user, 'Office');
  practiceClub = app.club(user, 'Practice');
  countdownClub = app.club(user, 'Countdown');
  finishClub = app.club(user, 'Finish');
  recordsClub = app.club(user, 'Records');
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
  assert.match(body, /<h1 class="board-title">No session yet<\/h1>/);
  assert.match(body, /aria-labelledby="board-steps-title"/);
  assert.match(body, /<header class="board-track">\s*<p class="board-track-name"><strong>Track<\/strong> anticlockwise<\/p>\s*<p class="board-track-record"><span class="board-track-label">No record yet<\/span><\/p>/, 'a new club starts on its "Track"');
  assert.doesNotMatch(body, /No track set|Choose the track/);
  assert.deepEqual([...body.matchAll(/<li class="board-step[^"]*"><h3>([^<]+)<\/h3>/g)].map((m) => m[1]), ['Add drivers', 'Start timing']);
  assert.match(body, /<noscript><meta http-equiv="refresh" content="10"><\/noscript>/);
  assert.match(body, new RegExp(`<div id="board-live"[^>]* data-events="${base}/board/events"`));
  assert.match(body, /<script type="module" src="\/public\/board.js"><\/script>/);
  assert.match(body, /<script type="module" src="\/public\/elements\/board.js"><\/script>/);
  assert.match(body, /<script type="module" src="\/public\/elements\/countdown.js"><\/script>/);
  assert.doesNotMatch(body, /data-fullscreen/, 'full screen is for the big board only');
  assert.match(body, /<script type="module" src="\/pkg\/design\/elements\/relative-time.js"><\/script>/);
});

test('laps, a personal best and an unknown car', async () => {
  // Personal bests are per track: set one, and start practice on it.
  useTrack(app.store, office.id, 'Office loop', 'ccw', 't1');
  clock.now = 1_000_000_000_000 + 1000;
  app.engine.start(office.id, { kind: 'practice', replace: true });
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
  assert.match(body, /<td class="num">8\.000<span class="marks"><abbr class="mark mark-tr"/);
  assert.match(body, new RegExp(`Unknown car: 4711\\. <a href="${base}/setup#transponders">Assign in Setup</a>`));
  assert.match(body, /<time class="board-clock-time" data-clock data-kind="practice" data-state="running" data-opens="\d+" data-closes="" data-now="\d+">0:09<\/time>/);
});

test('?big is the wall layout, without the members-only notice', async () => {
  const body = await (await get(member, `${base}/board?big`)).text();
  assert.match(body, /<body class="big">/);
  assert.doesNotMatch(body, /Unknown car/);
  assert.match(body, new RegExp(`href="${base}/board">Leave big screen</a>`));
  assert.match(body, /<div class="navbar-right">\s*<button type="button" class="btn btn-sm btn-outline" data-fullscreen hidden>Full screen<\/button>/);
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
  assert.match(body, /<tl-board status="live-status" sound="sound-switch" notify="notify-switch">\s*<div id="board-live"/);
  assert.match(body, /<button type="button" class="btn btn-sm btn-outline" id="sound-switch" aria-pressed="false" hidden><span class="sound-on">Sound on<\/span><span class="sound-wanted">Tap to turn sound on<\/span><\/button>/);
  // A practice's label is the server's alone ("Started 14:32"); a race's follows the clock.
  assert.match(body, /<tl-countdown class="board-clock"><span class="stat-label board-clock-label">Started <tl-local-time format="time">/);
});

test('the board, the big board and the watch link have the Notify me switch, hidden until tl-board reveals it', async () => {
  const button = /<button type="button" class="btn btn-sm btn-outline" id="sound-switch"[^]*?<\/button>\s*<button type="button" class="btn btn-sm btn-outline" id="notify-switch" aria-pressed="false" hidden><span class="notify-on">Notify me<\/span><span class="notify-blocked">Notifications blocked<\/span><\/button>/;
  const token = await watchToken();
  for (const path of [`${base}/board`, `${base}/board?big`, `/watch/${token}`]) {
    const body = await (await get(member, path)).text();
    assert.match(body, /<tl-board status="live-status" sound="sound-switch" notify="notify-switch">/, path);
    assert.match(body, button, path);
  }
});

test('a stopped practice driver shows when they last crossed the line, but not within the minute', async () => {
  await driverIn(practiceClub, 'Cleo', '21');
  app.engine.start(practiceClub.id, { kind: 'practice' });
  passIn(practiceClub.id, 200_000, '21');
  passIn(practiceClub.id, 208_000, '21');
  const lastAt = clock.now;
  clock.now = lastAt + 180_000;
  let body = await (await get(member, `/clubs/${practiceClub.id}/board`)).text();
  assert.match(body, new RegExp(`<td class="board-driver"><span class="driver" style="--driver: [^"]+">Cleo</span><span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑</span><tl-relative-time class="board-ago" now="${clock.now}" min="60000">last lap <time datetime="${escape(new Date(lastAt).toISOString())}">3 min ago</time></tl-relative-time></td>`));

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
  assert.match(body, /<tr class="is-finished[^"]*">\s*<td class="pos">\d<\/td>\s*<td class="board-driver"><span [^>]+>Abe<\/span><span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑<\/span><\/td>/);
  assert.match(body, />Bea<\/span><tl-relative-time class="board-ago"[^>]*>last lap <time [^>]+>3 min ago<\/time>/);

  app.engine.abort(finishClub.id, session.id);
  body = await (await get(member, `/clubs/${finishClub.id}/board`)).text();
  const results = body.slice(body.indexOf('<section class="board-results"'), body.indexOf('</section>', body.indexOf('<section class="board-results"')));
  assert.match(results, /<td class="board-driver"><span [^>]+>Abe<\/span><span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑<\/span><\/td>/);
  assert.doesNotMatch(results, /tl-relative-time/);
});

test('no note while the session still says countdown, even for a crossing after the start', async () => {
  // The engine hasn't ticked yet: the state is countdown though opensAt has passed.
  const old = app.store.runningSession(countdownClub.id);
  if (old) app.engine.abort(countdownClub.id, old.id);
  const [dora] = app.store.drivers(countdownClub.id);
  clock.now = 1_000_000_000_000 + 1_000_000;
  const { session } = app.engine.start(countdownClub.id, { kind: 'race', roster: [dora.id], durationMs: 60_000, countdownMs: 30_000 });
  passIn(countdownClub.id, session.opensAt + 5000 - 1_000_000_000_000, '31');
  assert.equal(app.store.runningSession(countdownClub.id).state, 'countdown');
  const body = await (await get(member, `/clubs/${countdownClub.id}/board`)).text();
  assert.match(body, /data-state="countdown"/);
  assert.doesNotMatch(body, /tl-relative-time/);
});

test('the watchers board and the big board show the note too', async () => {
  const token = await watchToken();
  for (const body of [await (await get(null, `/watch/${token}`)).text(), await (await get(member, `${base}/board?big`)).text()]) {
    assert.match(body, /&lt;i&gt;Ana&lt;\/i&gt;<\/span>(?:<span class="crown"[^>]*>👑<\/span>)?<tl-relative-time class="board-ago" now="\d+" min="60000">last lap <time datetime="[^"]+">\d+ min ago<\/time><\/tl-relative-time>/);
  }
});

// The track header, marks, the crown and the idle board (records spec §4.2, §4.3, §5.1, §5.3).
const START = /<button type="submit" class="btn btn-primary">Start practice<\/button>/;
const NOTICE = /No session is running/;
test('the track header, the idle board, the notice, marks, the crown and the record state', async () => {
  const club = recordsClub;
  const path = `/clubs/${club.id}`;
  useTrack(app.store, club.id, 'Ring', 'cw', 't9');
  await driverIn(club, 'Haris', '61');
  await driverIn(club, 'Mia', '62');
  await app.form(member, `${path}/watch-link`, {});
  const token = app.store.workspace(club.id).watchToken;
  const screens = async () => ({
    board: await (await get(member, `${path}/board`)).text(),
    big: await (await get(member, `${path}/board?big`)).text(),
    watch: await (await get(null, `/watch/${token}`)).text(),
  });

  // No session ever: the track, no record, the steps and Start practice for members only.
  let s = await screens();
  for (const body of Object.values(s)) {
    assert.match(body, /<header class="board-track">/);
    assert.match(body, /Ring/);
    assert.match(body, /clockwise/);
    assert.match(body, /No record yet/);
    assert.doesNotMatch(body, /class="eyebrow"/);
  }
  assert.match(s.board, /aria-labelledby="board-steps-title"/);
  assert.match(s.board, new RegExp(`<form method="post" action="${path}/sessions" class="start-practice">\\s*<input type="hidden" name="kind" value="practice">`));
  assert.match(s.board, START);
  for (const body of [s.big, s.watch]) assert.doesNotMatch(body, START);

  // A car with no session: the notice for members, on the normal board only, and one Start button.
  passIn(club.id, 5_000_000, '61');
  s = await screens();
  assert.match(s.board, /<div class="status status-warning idle-notice" role="status">\s*<p>A car crossed the line \(61, Haris\)\. No session is running\.<\/p>/);
  assert.equal(s.board.match(new RegExp(START, 'g')).length, 1);
  for (const body of [s.big, s.watch]) {
    assert.doesNotMatch(body, NOTICE);
    assert.doesNotMatch(body, START);
  }

  // A practice: its clock counts up under "Started 14:32"; Haris sets the first record, then beats it.
  clock.now = 1_000_000_000_000 + 5_100_000;
  const { session } = app.engine.start(club.id, { kind: 'practice' });
  passIn(club.id, 5_101_000, '61');
  passIn(club.id, 5_101_500, '62');
  passIn(club.id, 5_109_000, '61');
  passIn(club.id, 5_110_500, '62');
  s = await screens();
  assert.match(s.board, /Track record/);
  assert.doesNotMatch(s.board, /data-record-new/);
  passIn(club.id, 5_116_500, '61');
  const recordNew = app.engine.snapshot(club.id).recordNew;
  assert.equal(recordNew?.lapMs, 7500);
  s = await screens();
  for (const body of Object.values(s)) {
    assert.match(body, new RegExp(`<header class="board-track is-record" data-record-new="${recordNew.seq}">`));
    const head = body.slice(body.indexOf('<header class="board-track'), body.indexOf('</header>', body.indexOf('<header class="board-track')));
    assert.match(head, /New track record/);
    assert.match(head, /7\.500/);
    assert.match(head, /Haris/);
    assert.match(head, /8\.000/, 'the record it beat');
    assert.match(head, /<tl-local-time format="date">/);
    assert.doesNotMatch(body, NOTICE);
    // The crown only beside the holder, TR on his best, PB on Mia's, and one session-best row.
    assert.equal(body.match(/class="crown"/g).length, 1);
    assert.match(body, />Haris<\/span><span class="crown" role="img" aria-label="Track record holder"/);
    assert.match(body, /7\.500<span class="marks"><abbr class="mark mark-tr"/);
    assert.match(body, /9\.000<span class="marks"><abbr class="mark mark-pb"/);
    assert.equal(body.match(/class="is-best"/g).length, 1);
    assert.match(body, /<tr class="is-best">\s*<td class="pos">1<\/td>\s*<td class="board-driver"><span [^>]+>Haris</);
    assert.match(body, new RegExp(`<span class="stat-label board-clock-label">Started <tl-local-time format="time"><time datetime="${escape(new Date(session.opensAt).toISOString())}">`));
    assert.match(body, /<script type="module" src="\/pkg\/design\/elements\/local-time.js"><\/script>/);
  }

  // Ended, and the record state over: the last session's table under "Ended", with its marks.
  app.engine.end(club.id, session.id);
  clock.now += 60_000;
  app.engine.tick();
  s = await screens();
  for (const body of Object.values(s)) {
    assert.doesNotMatch(body, /data-record-new|is-record|New track record/);
    const head = body.slice(body.indexOf('<header class="board-track'), body.indexOf('</header>', body.indexOf('<header class="board-track')));
    assert.match(head, /Track record/);
    assert.match(head, /7\.500/);
    assert.match(head, /Haris/);
    assert.match(body, /<h1 class="board-title">Practice<\/h1>/);
    assert.match(body, /Ended <tl-local-time format="time">/);
    assert.match(body, /<section class="board-results"/);
    assert.match(body, /7\.500<span class="marks"><abbr class="mark mark-tr"/);
    assert.match(body, /9\.000<span class="marks"><abbr class="mark mark-pb"/);
    assert.equal(body.match(/class="crown"/g).length, 1);
    assert.equal(body.match(/class="is-best"/g).length, 1);
    assert.doesNotMatch(body, /board-steps/);
  }
  assert.match(s.board, START);
  for (const body of [s.big, s.watch]) assert.doesNotMatch(body, START);
});
