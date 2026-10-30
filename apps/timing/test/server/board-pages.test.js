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
let topClub;
let countedClub;

before(async () => {
  app = await startTiming({ clock });
  const user = await app.signUp('Ana');
  office = app.club(user, 'Office');
  practiceClub = app.club(user, 'Practice');
  countdownClub = app.club(user, 'Countdown');
  finishClub = app.club(user, 'Finish');
  recordsClub = app.club(user, 'Records');
  const tess = await app.signUp('Tess');
  topClub = app.club(tess, 'Top');
  app.join(tess, topClub.id, user);
  countedClub = app.club(tess, 'Counted');
  app.join(tess, countedClub.id, user);
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

test('a club that has never driven gets one card to get ready, under its track', async () => {
  const res = await get(member, `${base}/board`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<header class="board-track">\s*<p class="board-track-name"><strong>Track<\/strong> <svg class="direction-icon"[^>]* role="img"><title>Anticlockwise<\/title>/, 'a new club starts on its "Track"');
  assert.match(body, /<section class="board-first" aria-labelledby="board-first-title">\s*<h1 id="board-first-title">Ready when your cars are<\/h1>/);
  assert.match(body, new RegExp(`<a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a>\\s*<a href="${base}/bridge">Connect the decoder</a>\\s*<a href="${base}/tap">Tap laps by hand</a>`));
  assert.doesNotMatch(body, /No track set|No session yet|Last laps|board-steps|board-hero|status-warning/);
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
  // The time in its column, its mark in the narrow column after it.
  assert.match(body, /<td class="num">8\.000<\/td>\s*<td class="mark-cell"><abbr class="mark mark-tr"/);
  assert.match(body, /<th scope="col" class="num">Best<\/th><th scope="col" class="mark-cell"><span class="visually-hidden">Mark<\/span><\/th>/);
  assert.match(body, /<table class="board-table standings-table">\s*<colgroup><col class="col-pos"><col><col class="col-laps"><col class="col-time"><col class="col-mark"><col class="col-time col-last"><\/colgroup>/);
  assert.match(body, new RegExp(`<p class="status status-warning flag board-unknown" role="status">Unknown car: 4711\\. <a href="${base}/setup#transponders">Assign in Setup</a>`));
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
  assert.match(body, /<tl-board status="live-status" sound="sound-switch" notify="notify-setting">\s*<div id="board-live"/);
  // A practice's label is the server's alone ("Started 14:32"); a race's follows the clock.
  assert.match(body, /<tl-countdown class="board-clock"><span class="stat-label board-clock-label">Started <tl-local-time format="time">/);
});

test('the board, the big board and the watch link have the Sound icon switch, drawn by the server and hidden until tl-board reveals it', async () => {
  const token = await watchToken();
  for (const path of [`${base}/board`, `${base}/board?big`, `/watch/${token}`]) {
    const body = await (await get(member, path)).text();
    const [button] = body.match(/<button[^>]* id="sound-switch"[^]*?<\/button>/) ?? [];
    assert.ok(button, path);
    assert.match(button, /^<button type="button" class="btn btn-sm btn-outline btn-icon" id="sound-switch" aria-label="Sound" aria-pressed="false" title="Sound" data-title="Sound" data-title-wanted="Tap to turn sound on" hidden>/, path);
    // One icon with every state's parts; CSS shows the ones aria-pressed and data-state call for.
    assert.match(button, /<svg class="sound-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">/, path);
    for (const part of ['sound-speaker', 'sound-waves', 'sound-strike']) assert.match(button, new RegExp(`<path class="${part}" d="[^"]+"/>`), path);
    assert.doesNotMatch(button, /Sound on|<span/, path);
    assert.doesNotMatch(body, /notify-switch|Notify me/, path);
  }
});

const SETTING = /<tl-notify-setting class="nav-account-setting navbar-menu-group" id="notify-setting" hidden>\s*<button type="button" class="navbar-menu-setting" aria-pressed="false">Notifications<\/button>\s*<p class="nav-account-blocked" tabindex="-1">Notifications blocked by the browser<span class="nav-account-hint">Allow them in this site's settings in the address bar, then reload.<\/span><\/p>\s*<\/tl-notify-setting>/;
const SETTING_SCRIPT = '<script type="module" src="/public/elements/notify-setting.js"></script>';

test('a member’s account menu has the Notifications setting on every page, hidden until tl-notify-setting reveals it', async () => {
  for (const path of [`${base}/board`, `${base}/setup`, `${base}/sessions`]) {
    const body = await (await get(member, path)).text();
    const [menu] = body.match(/<div class="nav-account-menu navbar-menu-panel">[^]*?<\/div>/) ?? [];
    assert.match(menu, SETTING, path);
    assert.ok(menu.indexOf('notify-setting') > menu.indexOf('>Account</a>'), `${path}: after Account`);
    assert.ok(menu.indexOf('notify-setting') < menu.indexOf('Sign out'), `${path}: before Sign out`);
    assert.ok(body.includes(SETTING_SCRIPT), path);
  }
});

test('the big board, the watch link and a signed-out page have no Notifications setting', async () => {
  const token = await watchToken();
  for (const [who, path] of [[member, `${base}/board?big`], [member, `/watch/${token}`], [null, `/watch/${token}`]]) {
    const body = await (await get(who, path)).text();
    assert.doesNotMatch(body, /tl-notify-setting|notify-setting\.js|Notifications/, path);
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
  assert.match(body, new RegExp(`<td class="board-driver"><span class="driver" style="--driver: [^"]+">Cleo</span>&#8288;<span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑</span><tl-relative-time class="board-ago" now="${clock.now}" min="60000">last lap <time datetime="${escape(new Date(lastAt).toISOString())}">3 min ago</time></tl-relative-time></td>`));

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

test('a race table: Last shows counted laps only, the mark has its own column, and the feed puts tags before the time', async () => {
  const driver = await driverIn(countedClub, 'Cleo', '51');
  useTrack(app.store, countedClub.id, 'Shed', 'cw');
  clock.now = 1_000_000_000_000 + 900_000;
  const { session } = app.engine.start(countedClub.id, { kind: 'race', roster: [driver.id], durationMs: 120_000, countdownMs: 20_000 });
  // A lap during the countdown: in the feed, marked, but not the table's Last.
  passIn(countedClub.id, 901_000, '51');
  passIn(countedClub.id, 909_000, '51');
  clock.now = session.opensAt + 1000;
  app.engine.tick();
  const body = await (await get(member, `/clubs/${countedClub.id}/board`)).text();
  assert.match(body, /<table class="board-table standings-table is-race">\s*<colgroup><col class="col-pos"><col><col class="col-laps"><col class="col-time"><col class="col-mark"><col class="col-time col-last"><col class="col-total"><\/colgroup>/);
  assert.match(body, /<th scope="col" class="num col-last">Last<\/th><th scope="col" class="num">Time<\/th>/);
  assert.match(body, /<td class="num col-last">—<\/td>/, 'the lap before the start is not the last lap');
  assert.match(body, /<li><span [^>]+>Cleo<\/span><span class="board-laps-tags"><span class="tag">Not counted<\/span><\/span><span class="num">8\.000<\/span><\/li>/);
  app.engine.abort(countedClub.id, session.id);
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
  assert.match(body, /<tr class="is-finished[^"]*">\s*<td class="pos">\d<span class="finish" role="img" aria-label="Finished" title="Finished"><\/span><\/td>\s*<td class="board-driver"><span [^>]+>Abe<\/span>&#8288;<span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑<\/span><\/td>/);
  assert.match(body, />Bea<\/span><tl-relative-time class="board-ago"[^>]*>last lap <time [^>]+>3 min ago<\/time>/);

  app.engine.abort(finishClub.id, session.id);
  body = await (await get(member, `/clubs/${finishClub.id}/board`)).text();
  const results = body.slice(body.indexOf('<section class="board-last"'), body.indexOf('</section>', body.indexOf('<section class="board-last"')));
  assert.match(results, /<span class="board-driver"><span [^>]+>Abe<\/span>&#8288;<span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑<\/span><\/span>/);
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
    assert.match(body, /&lt;i&gt;Ana&lt;\/i&gt;<\/span>(?:&#8288;<span class="crown"[^>]*>👑<\/span>)?<tl-relative-time class="board-ago" now="\d+" min="60000">last lap <time datetime="[^"]+">\d+ min ago<\/time><\/tl-relative-time>/);
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

  // Never driven: the card to get ready for members; the display and the watchers show the record's place.
  let s = await screens();
  for (const body of Object.values(s)) {
    assert.match(body, /<header class="board-track">\s*<p class="board-track-name"><strong>Ring<\/strong> <svg class="direction-icon"[^>]* role="img"><title>Clockwise<\/title>/);
    assert.doesNotMatch(body, /class="eyebrow"|No session yet|Last laps|status-warning/);
  }
  assert.match(s.board, /Ready when your cars are/);
  assert.match(s.board, new RegExp(`<a class="btn btn-primary" href="${path}/bridge">Connect the decoder</a>\\s*<a href="${path}/setup#drivers">Add drivers</a>`), 'with drivers, the decoder is next');
  assert.doesNotMatch(s.board, START);
  for (const body of [s.big, s.watch]) {
    assert.doesNotMatch(body, /Ready when your cars are|setup#drivers/);
    assert.match(body, /<h1 class="board-hero-label">Track record<\/h1>\s*<p class="board-hero-none">No record yet<\/p>/);
    assert.doesNotMatch(body, START);
  }

  // A car with no session: a live line for members, naming its driver, over the one Start button; a car without a driver, one quiet line.
  passIn(club.id, 5_000_000, '63');
  passIn(club.id, 5_000_500, '61');
  s = await screens();
  assert.match(s.board, /<div class="board-hero-go">\s*<p class="board-on-track" role="status"><span><span class="driver" style="--driver: [^"]+">Haris<\/span> is on the track<\/span><\/p>\s*<form method="post"/);
  assert.match(s.board, new RegExp(`<form method="post" action="${path}/sessions" class="start-practice">\\s*<input type="hidden" name="kind" value="practice">`));
  assert.equal(s.board.match(new RegExp(START, 'g')).length, 1);
  assert.match(s.board, new RegExp(`<p class="board-quiet" role="status">1 car has no driver yet\\. <a href="${path}/setup#transponders">Assign it</a></p>`));
  assert.doesNotMatch(s.board, /board-unknown/, 'a quiet line, not the warning');
  assert.match(s.board, /No record yet/);
  assert.doesNotMatch(s.board, /status-warning|Ready when your cars are/);
  for (const body of [s.big, s.watch]) {
    assert.doesNotMatch(body, /is on the track|no driver yet/);
    assert.doesNotMatch(body, START);
  }
  // Two cars without a driver: the line counts them. Once they have one, it offers a qualifying or race instead.
  passIn(club.id, 5_001_000, '64');
  assert.match(await (await get(member, `${path}/board`)).text(), new RegExp(`2 cars have no driver yet\\. <a href="${path}/setup#transponders">Assign them</a>`));
  const mia = app.store.drivers(club.id).find((d) => d.name === 'Mia');
  for (const code of ['63', '64']) app.engine.assign(club.id, code, mia.id);
  assert.match(await (await get(member, `${path}/board`)).text(), new RegExp(`<p class="board-quiet">Or a <a href="${path}/sessions#start-title">qualifying or race</a>\\.</p>`));

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
  // The record's time, holder and date apart by the line's gap, with no literal dots.
  assert.match(s.board, /<p class="board-track-record"><span class="board-track-label">Track record<\/span> <span class="num board-track-time">8\.000<\/span> <span class="board-track-by"><span [^>]+>Haris<\/span><\/span> <span class="board-track-by"><tl-local-time format="date">/);
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
    assert.doesNotMatch(head, /·/);
    assert.doesNotMatch(body, NOTICE);
    // The crown only beside the holder, TR on his best, PB on Mia's, and one session-best row.
    assert.equal(body.match(/class="crown"/g).length, 1);
    assert.match(body, />Haris<\/span>&#8288;<span class="crown" role="img" aria-label="Track record holder"/);
    assert.match(body, /7\.500<\/td>\s*<td class="mark-cell"><abbr class="mark mark-tr"[^>]*>TR<\/abbr><span class="visually-hidden">Track record<\/span><span class="visually-hidden">Session best<\/span><\/td>/);
    assert.match(body, /9\.000<\/td>\s*<td class="mark-cell"><abbr class="mark mark-pb"/);
    assert.equal(body.match(/class="is-best"/g).length, 1);
    assert.match(body, /<tr class="is-best">\s*<td class="pos">1<\/td>\s*<td class="board-driver"><span [^>]+>Haris</);
    assert.match(body, new RegExp(`<span class="stat-label board-clock-label">Started <tl-local-time format="time"><time datetime="${escape(new Date(session.opensAt).toISOString())}">`));
    assert.match(body, /<script type="module" src="\/pkg\/design\/elements\/local-time.js"><\/script>/);
  }

  // Ended, and the record state over: the record is the big thing, then the fastest here and the last session.
  app.engine.end(club.id, session.id);
  clock.now += 60_000;
  app.engine.tick();
  s = await screens();
  const part = (body, start) => body.slice(body.indexOf(start), body.indexOf('</section>', body.indexOf(start)));
  for (const body of Object.values(s)) {
    assert.doesNotMatch(body, /data-record-new|is-record|New track record|No session yet|Last laps|board-title|status-warning/);
    const head = body.slice(body.indexOf('<header class="board-track'), body.indexOf('</header>', body.indexOf('<header class="board-track')));
    assert.doesNotMatch(head, /Track record|7\.500/, 'the record is below, once');
    const hero = part(body, '<section class="board-hero"');
    assert.match(hero, /<h1 class="board-hero-label">Track record<\/h1>\s*<p class="num board-hero-time">7\.500<\/p>/);
    assert.match(hero, /<p class="board-hero-by"><span [^>]+>Haris<\/span>&#8288;<span class="crown"[^>]*>👑<\/span> set <tl-local-time format="datetime-short">[\s\S]*?, beat their own <span class="num">8\.000<\/span><\/p>/, 'his own record: their own, not his name');
    const fastest = part(body, '<section class="board-fastest"');
    assert.match(fastest, /<h2 class="h3" id="board-fastest-title">Fastest on this track<\/h2>/);
    assert.deepEqual([...fastest.matchAll(/>(Haris|Mia)<\/span>[\s\S]*?(\d+\.\d{3})/g)].map((m) => [m[1], m[2]]), [['Haris', '7.500'], ['Mia', '9.000']]);
    const last = part(body, '<section class="board-last"');
    assert.match(last, /<h2 class="h3" id="board-last-title">Last session<\/h2>/);
    assert.match(last, /7\.500<\/span><span class="mark-cell"><abbr class="mark mark-tr"/);
    assert.match(last, /9\.000<\/span><span class="mark-cell"><abbr class="mark mark-pb"/);
    assert.match(last, /Practice, ended <tl-local-time format="datetime-short">/);
    assert.equal(body.match(/class="crown"/g).length, 2, 'beside the holder in the record and in the last session');
  }
  assert.match(s.board, new RegExp(`<a href="${path}/sessions/${session.id}">All laps</a>`));
  for (const body of [s.big, s.watch]) assert.doesNotMatch(body, /All laps/);
  assert.match(s.board, START);
  assert.match(s.board, new RegExp(`Or a <a href="${path}/sessions#start-title">qualifying or race</a>\\.`));
  for (const body of [s.big, s.watch]) assert.doesNotMatch(body, START);
});

test('the last session shows its top three finishers', async () => {
  const club = topClub;
  for (const [i, name] of ['Abe', 'Bea', 'Cid', 'Dot'].entries()) {
    app.store.addDriver(club.id, { id: name, name, colour: '#2d9bff' });
    app.engine.assign(club.id, `7${i}`, name);
  }
  clock.now = 1_000_000_000_000 + 8_000_000;
  const { session } = app.engine.start(club.id, { kind: 'practice' });
  for (const [i, lap] of [9000, 8000, 8500, 7000].entries()) {
    passIn(club.id, 8_001_000 + i * 10, `7${i}`);
    passIn(club.id, 8_001_000 + i * 10 + lap, `7${i}`);
  }
  app.engine.end(club.id, session.id);
  const body = await (await get(member, `/clubs/${club.id}/board`)).text();
  const last = body.slice(body.indexOf('<section class="board-last"'), body.indexOf('</section>', body.indexOf('<section class="board-last"')));
  assert.deepEqual([...last.matchAll(/>(Abe|Bea|Cid|Dot)<\/span>/g)].map((m) => m[1]), ['Dot', 'Bea', 'Cid']);
  const fastest = body.slice(body.indexOf('<section class="board-fastest"'), body.indexOf('</section>', body.indexOf('<section class="board-fastest"')));
  assert.deepEqual([...fastest.matchAll(/>(Abe|Bea|Cid|Dot)<\/span>/g)].map((m) => m[1]), ['Dot', 'Bea', 'Cid', 'Abe']);
});
