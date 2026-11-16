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
let quietClub;
let statusClub;
let unassignedClub;
let marksClub;
let feedClub;
let wordsClub;

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
  quietClub = app.club(tess, 'Quiet');
  app.join(tess, quietClub.id, user);
  statusClub = app.club(tess, 'Status');
  unassignedClub = app.club(tess, 'Unassigned');
  const uma = await app.signUp('Uma');
  marksClub = app.club(uma, 'Marks');
  feedClub = app.club(uma, 'Feed');
  app.join(uma, feedClub.id, user);
  wordsClub = app.club(uma, 'Words');
  app.join(uma, wordsClub.id, user);
  app.join(uma, marksClub.id, user);
  app.join(tess, unassignedClub.id, user);
  app.join(tess, statusClub.id, user);
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

test('a club that has never driven: No sessions yet, one sentence, and its first steps in the Start panel\'s place', async () => {
  const res = await get(member, `${base}/board`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<header class="board-track strip">\s*<div class="strip-where">\s*<p class="board-track-name"><strong class="cut-words">Track<\/strong> <svg class="direction-icon"[^>]* role="img"><title>Anticlockwise<\/title>/, 'a new club starts on its "Track"');
  assert.match(body, /<h1 class="board-result-title" id="result-title">No sessions yet<\/h1>/);
  assert.match(body, /<div class="board-none"><p>Start a session and drive\. Every lap shows up here as it is timed, and the first one sets the track record on Track\.<\/p><\/div>/);
  // No drivers: a session would time nothing, so the first steps stand where Start goes (board hub spec §4.1).
  assert.match(body, new RegExp(`<h2 id="start-title" class="board-next-title">Start</h2>\\s*<div class="board-next-body"><div class="start-panel start-first">[\\s\\S]*<a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a>\\s*<a class="btn btn-outline" href="${base}/bridge">Connect the decoder</a>`));
  assert.doesNotMatch(body, /Start practice|Full results|Ended at/);
  assert.doesNotMatch(body, /No track set|Last laps|board-steps|board-hero|board-first"|status-warning/);
  assert.doesNotMatch(body, /http-equiv="refresh"/, 'nothing runs: no refresh, which would reload the form away');
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
  assert.match(body, /<thead><tr><th scope="col"><span class="visually-hidden">Position<\/span><\/th><th scope="col">Driver<\/th>/, 'Pos for screen readers only');
  assert.match(body, /<table class="board-table standings-table">\s*<colgroup><col class="col-pos"><col><col class="col-laps"><col class="col-time"><col class="col-mark"><col class="col-time col-last"><\/colgroup>/);
  // One transponder not assigned yet: the warning links straight to its form, back to the board after.
  assert.match(body, new RegExp(`<p class="status status-warning flag board-unknown" role="status">Transponder 4711 isn't assigned yet, so its laps aren't counted\\. <a href="${base}/transponders/4711\\?returnTo=${encodeURIComponent(`${base}/board`)}">Assign it</a></p>`));
  assert.match(body, /<time class="board-clock-time" data-clock data-kind="practice" data-state="running" data-opens="\d+" data-closes="" data-now="\d+">0:09<\/time>/);
});

test('?big is the wall layout, without the members-only notice', async () => {
  const body = await (await get(member, `${base}/board?big`)).text();
  assert.match(body, /<body class="big">/);
  assert.doesNotMatch(body, /4711|board-unknown|isn't assigned yet/);
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
  assert.doesNotMatch(body, /4711|board-unknown|isn't assigned yet|Assign it|board-steps|nav-tabs|nav-account/);
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
    // The panel holds groups of its own (the clubs, the settings): up to the menu's end.
    const [menu] = body.match(/<div class="nav-account-menu navbar-menu-panel">[^]*?<\/details>/) ?? [];
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
  assert.match(body, new RegExp(`<td class="board-driver"><span class="driver" style="--driver: [^"]+"><span class="driver-name" title="Cleo">Cleo</span><svg class="crown" viewBox="0 0 26 18" role="img"><title>Track record holder</title><path d="[^"]+"/></svg></span><tl-relative-time class="board-ago" now="${clock.now}" min="60000">last lap <time datetime="${escape(new Date(lastAt).toISOString())}">3 min ago</time></tl-relative-time></td>`));

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
  assert.match(body, />Dora<\/span><\/span><\/td>/);
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
  assert.match(body, /<table class="board-table standings-table is-race has-flags">\s*<colgroup><col class="col-pos"><col><col class="col-laps"><col class="col-time"><col class="col-mark"><col class="col-time col-last"><col class="col-total"><\/colgroup>/);
  assert.match(body, /<th scope="col" class="num col-last">Last<\/th><th scope="col" class="num">Time<\/th>/);
  assert.match(body, /<td class="num col-last">—<\/td>/, 'the lap before the start is not the last lap');
  assert.match(body, /<li class="is-not-counted"><span [^>]+><span class="driver-name" title="Cleo">Cleo<\/span><\/span><span class="board-laps-tags"><span class="tag tag-sm">Not counted<\/span><\/span><span class="num">8\.000<\/span><span class="mark-cell"><\/span><\/li>/, 'the tag before the time, and a lap that did not count is never FL');
  app.engine.abort(countedClub.id, session.id);
});

test('Last laps: the mark follows the time, TR and FL only, FL only on the current fastest lap', async () => {
  await driverIn(feedClub, 'Abe', '91');
  await driverIn(feedClub, 'Bea', '92');
  // Abe sets the record in a practice: 8.000.
  clock.now = 1_000_000_000_000 + 50_000_000;
  const first = app.engine.start(feedClub.id, { kind: 'practice' }).session;
  passIn(feedClub.id, 50_001_000, '91');
  passIn(feedClub.id, 50_009_000, '91');
  app.engine.end(feedClub.id, first.id);
  // The next practice: Bea's first laps here (PBs), Abe's 8.800, then Bea's 8.600, then the record falls: Abe's 7.900.
  clock.now = 1_000_000_000_000 + 50_100_000;
  const { session } = app.engine.start(feedClub.id, { kind: 'practice' });
  passIn(feedClub.id, 50_101_000, '91');
  passIn(feedClub.id, 50_101_100, '92');
  passIn(feedClub.id, 50_109_800, '91');
  passIn(feedClub.id, 50_110_100, '92');
  const feedOf = async () => {
    const body = await (await get(member, `/clubs/${feedClub.id}/board`)).text();
    const feed = body.slice(body.indexOf('<aside class="board-feed"'), body.indexOf('</aside>'));
    return [...feed.matchAll(/<li>[\s\S]*?title="(\w+)"[\s\S]*?<span class="num">([\d.]+)<\/span><span class="mark-cell">(?:<abbr class="mark mark-(\w+)"[^>]*>\w+<\/abbr><span class="visually-hidden">[^<]+<\/span>)?<\/span><\/li>/g)].map((m) => `${m[1]} ${m[2]}${m[3] ? ` ${m[3]}` : ''}`);
  };
  assert.deepEqual(await feedOf(), ['Bea 9.000', 'Abe 8.800 fl'], 'FL on the fastest lap; Bea\'s first lap, a PB, has no mark here');
  passIn(feedClub.id, 50_118_700, '92');
  assert.deepEqual(await feedOf(), ['Bea 8.600 fl', 'Bea 9.000', 'Abe 8.800'], 'the beaten lap loses its FL');
  passIn(feedClub.id, 50_117_700, '91');
  assert.deepEqual(await feedOf(), ['Abe 7.900 tr', 'Bea 8.600', 'Bea 9.000', 'Abe 8.800'], 'a record lap is TR, the widest mark');
  app.engine.abort(feedClub.id, session.id);
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
  assert.match(body, /<tr class="is-finished[^"]*" data-driver="[^"]+"(?: data-moment="[^"]+")?>\s*<td class="pos">\d<span class="finish" role="img" aria-label="Finished" title="Finished"><\/span><\/td>\s*<td class="board-driver"><span [^>]+><span class="driver-name" title="Abe">Abe<\/span><svg class="crown" viewBox="0 0 26 18" role="img"><title>Track record holder<\/title><path d="[^"]+"\/><\/svg><\/span><\/td>/);
  assert.match(body, />Bea<\/span><\/span><tl-relative-time class="board-ago"[^>]*>last lap <time [^>]+>3 min ago<\/time>/);

  // Bea finishes too: the race is done, and its result takes the board, the crown after the holder, no notes.
  passIn(finishClub.id, 766_000, '42');
  app.engine.tick();
  assert.equal(app.store.session(session.id).state, 'done');
  body = await (await get(member, `/clubs/${finishClub.id}/board`)).text();
  const results = body.slice(body.indexOf('<div class="result is-race">'), body.indexOf('</section>', body.indexOf('<div class="result is-race">')));
  assert.match(results, /<h3 class="place-name"><span [^>]+><span class="driver-name" title="Abe">Abe<\/span><svg class="crown" viewBox="0 0 26 18" role="img"><title>Track record holder<\/title><path d="[^"]+"\/><\/svg><\/span><\/h3>/);
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
    assert.match(body, /&lt;i&gt;Ana&lt;\/i&gt;<\/span>(?:<svg class="crown"[^]*?<\/svg>)?<\/span><tl-relative-time class="board-ago" now="\d+" min="60000">last lap <time datetime="[^"]+">\d+ min ago<\/time><\/tl-relative-time>/);
  }
});

// The track header, marks, the crown and the idle board (records spec §4.2, §4.3, §5.1, §5.3).
const START = /<form method="post" action="[^"]*\/sessions" class="start-panel"/;
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

  // Never driven (board hub spec §4.1): "No sessions yet" and one sentence on every board; Start beside it for members only.
  let s = await screens();
  for (const body of Object.values(s)) {
    assert.match(body, /<div id="board-live" class="board is-idle"[^>]*>\s*<header class="board-track strip">\s*<div class="strip-where">\s*<p class="board-track-name"><strong class="cut-words">Ring<\/strong> <svg class="direction-icon"[^>]* role="img"><title>Clockwise<\/title>/, 'the strip heads every board, the same on each');
    // No record yet: the record cell keeps its place, unfilled (board hub spec §3).
    assert.match(body, /<div class="strip-cells">\s*<p class="strip-cell is-record is-empty board-record-line"><span class="strip-label">Track record<\/span><span class="strip-none">None yet<\/span><span class="strip-by">The first lap sets it\.<\/span><\/p>\s*<\/div>/);
    assert.doesNotMatch(body, /board-fastest-line|is-band/, 'no fastest lap while nobody races');
    assert.doesNotMatch(body, /class="eyebrow"|Last laps|status-warning|board-hero|board-first/);
    assert.match(body, /<\/header>\s*<section class="board-result is-none" aria-labelledby="result-title">\s*<div class="result-head is-board"><h1 class="board-result-title" id="result-title">No sessions yet<\/h1><\/div>\s*<div class="board-none"><p>Start a session and drive\.[^<]*the first one sets the track record on Ring\.<\/p><\/div>/);
  }
  assert.match(s.board, START, 'with drivers, Start practice in the Start panel\'s place');
  for (const body of [s.big, s.watch]) {
    assert.doesNotMatch(body, /setup#drivers|board-next|board-start|start-panel/, 'no side: nothing to press and no fastest yet');
    assert.doesNotMatch(body, START);
  }

  // A car with no session: a live line for members, naming its driver, over the one Start button; a car without a driver, one quiet line above the result.
  passIn(club.id, 5_000_000, '63');
  passIn(club.id, 5_000_500, '61');
  s = await screens();
  assert.match(s.board, /<div class="start-on-track" id="start-on-track"><p class="board-on-track" role="status"><span><span class="driver" style="--driver: [^"]+"><span class="driver-name" title="Haris">Haris<\/span><\/span> is on the track<\/span><\/p><\/div>\s*<button type="submit"/);
  assert.equal(s.board.match(new RegExp(START, 'g')).length, 1);
  assert.match(s.board, new RegExp(`<div class="board-notices"><p class="board-quiet" role="status">Transponder 63 isn't assigned yet\\. <a href="${path}/transponders/63\\?returnTo=${encodeURIComponent(`${path}/board`)}">Assign it</a></p></div>\\s*<section class="board-result`), 'above the result');
  assert.doesNotMatch(s.board, /board-unknown/, 'a quiet line, not the warning');
  assert.doesNotMatch(s.board, /status-warning/);
  for (const body of [s.big, s.watch]) {
    assert.doesNotMatch(body, /is on the track|isn't assigned yet|transponders\/|board-notices/);
    assert.doesNotMatch(body, START);
  }
  // Two cars without a driver: the line counts them. Once they have one, the line goes.
  passIn(club.id, 5_001_000, '64');
  const two = await (await get(member, `${path}/board`)).text();
  assert.match(two, new RegExp(`<p class="board-quiet" role="status">2 transponders aren't assigned yet\\. <a href="${path}/transponders/new">Assign them</a></p>`));
  assert.match(two, /<span>Transponder 64 is on the track<\/span>/, 'the latest crossing');
  assert.doesNotMatch(two, /status-warning/, 'no yellow box while idle');
  const mia = app.store.drivers(club.id).find((d) => d.name === 'Mia');
  for (const code of ['63', '64']) app.engine.assign(club.id, code, mia.id);
  const assigned = await (await get(member, `${path}/board`)).text();
  assert.doesNotMatch(assigned, /board-notices|isn't assigned yet/);

  // A practice: its clock counts up under "Started 14:32"; Haris sets the first record, then beats it.
  clock.now = 1_000_000_000_000 + 5_100_000;
  const { session } = app.engine.start(club.id, { kind: 'practice' });
  // The strip's cells while a session runs (board hub spec §3): before any lap counts, both keep their place, unfilled.
  const cells = (body) => body.slice(body.indexOf('<div class="strip-cells">'), body.indexOf('</div>', body.indexOf('<div class="strip-cells">')));
  /** What the strip's cells show on screen. */
  const shown = (cell) => cell.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  for (const body of Object.values(await screens())) {
    assert.match(body, /<header class="board-track strip is-live">/);
    const empty = cells(body);
    assert.match(empty, /<p class="strip-cell is-record is-empty board-record-line"><span class="strip-label">Track record<\/span><span class="strip-none">None yet<\/span><span class="strip-by">The first lap sets it\.<\/span><\/p>/);
    assert.match(empty, /<p class="strip-cell is-fastest is-empty board-fastest-line" role="status"><span class="strip-label">Fastest lap<\/span><span class="strip-none">No laps yet<\/span><\/p>/);
    assert.deepEqual([...empty.matchAll(/<p [^>]*>([\s\S]*?)<\/p>/g)].map((m) => shown(m[1])), ['Track record None yet The first lap sets it.', 'Fastest lap No laps yet']);
  }
  passIn(club.id, 5_101_000, '61');
  passIn(club.id, 5_101_500, '62');
  passIn(club.id, 5_109_000, '61');
  passIn(club.id, 5_110_500, '62');
  s = await screens();
  assert.doesNotMatch(s.board, /data-record-new/);
  // The record cell: its label, the time, who and when, and the crown, no TR mark; the fastest lap cell beside it, a live region, no FL mark.
  for (const body of Object.values(s)) {
    const both = cells(body);
    assert.match(both, /<p class="strip-cell is-record board-record-line"><span class="strip-label">Track record<\/span><span class="num strip-figure">8\.000<\/span><span class="strip-by"><span class="driver" [^>]+><span class="driver-name" title="Haris">Haris<\/span><\/span> <span class="strip-when"><tl-local-time format="date"><time datetime="[^"]+">[^<]+<\/time><\/tl-local-time><\/span><\/span><svg class="crown strip-crown" viewBox="0 0 26 18" aria-hidden="true">/);
    assert.match(both, /<p class="strip-cell is-fastest board-fastest-line" role="status"><span class="strip-label">Fastest lap<\/span><span class="num strip-figure">8\.000<\/span><span class="strip-by"><span class="driver" [^>]+><span class="driver-name" title="Haris">Haris<\/span><\/span><\/span><\/p>/);
    assert.doesNotMatch(both, /class="mark/, 'no TR or FL mark: the fill says it');
    assert.equal(both.match(/role="status"/g).length, 1, 'only the fastest lap is a live region');
  }
  passIn(club.id, 5_116_500, '61');
  const recordNew = app.engine.snapshot(club.id).recordNew;
  assert.equal(recordNew?.lapMs, 7500);
  s = await screens();
  for (const body of Object.values(s)) {
    assert.match(body, new RegExp(`<header class="board-track strip is-live" data-record-new="${recordNew.seq}">`));
    const head = body.slice(body.indexOf('<header class="board-track'), body.indexOf('</header>', body.indexOf('<header class="board-track')));
    // The record cell says it (board hub spec §3): "New track record", the new time and holder, and "Beat …".
    assert.match(head, /<p class="strip-cell is-record is-new board-record-line"><span class="strip-label">New track record<\/span><span class="num strip-figure">7\.500<\/span><span class="strip-by"><span class="driver" [^>]+><span class="driver-name" title="Haris">Haris<\/span><\/span><\/span><span class="strip-beat">Beat <span class="num">8\.000<\/span> <span class="driver" [^>]+><span class="driver-name" title="Haris">Haris<\/span><\/span><\/span><svg class="crown strip-crown"/);
    assert.doesNotMatch(head, /·/);
    // The fastest lap cell stays, so its live region is not taken away and given back.
    assert.match(head, /<p class="strip-cell is-fastest board-fastest-line" role="status"><span class="strip-label">Fastest lap<\/span><span class="num strip-figure">7\.500<\/span>/);
    assert.doesNotMatch(body, NOTICE);
    // The crown only after the holder's name (and the strip's own at its record cell's end), TR alone on his best (the fastest lap too), PB on Mia's; no tint.
    assert.equal(body.match(/class="crown"/g).length, 1);
    assert.equal(body.match(/class="crown strip-crown"/g).length, 1);
    assert.match(body, /<td class="pos">1<\/td>\s*<td class="board-driver"><span [^>]+><span class="driver-name" title="Haris">Haris<\/span><svg class="crown" viewBox="0 0 26 18" role="img"><title>Track record holder<\/title><path d="[^"]+"\/><\/svg><\/span>/);
    assert.match(body, /7\.500<\/td>\s*<td class="mark-cell"><abbr class="mark mark-tr"[^>]*>TR<\/abbr><span class="visually-hidden">Track record<\/span><\/td>/);
    assert.match(body, /9\.000<\/td>\s*<td class="mark-cell"><abbr class="mark mark-pb"/);
    assert.doesNotMatch(body, /mark-fl|is-best/, 'the record lap is the fastest lap: TR, not FL');
    assert.match(body, new RegExp(`<span class="stat-label board-clock-label">Started <tl-local-time format="time"><time datetime="${escape(new Date(session.opensAt).toISOString())}">`));
    assert.match(body, /<script type="module" src="\/pkg\/design\/elements\/local-time.js"><\/script>/);
  }

  // Ended (board hub spec §4.1): the strip holds the record; the practice's result takes the left, under its head.
  app.engine.end(club.id, session.id);
  // Ended while the record state lasts: the strip still carries it, so a board knows it has seen it.
  for (const body of Object.values(await screens())) assert.match(body, new RegExp(`<header class="board-track strip" data-record-new="${recordNew.seq}">`));
  clock.now += 60_000;
  app.engine.tick();
  s = await screens();
  const ended = app.store.session(session.id).endedAt;
  const part = (body, start, end = '</section>') => body.slice(body.indexOf(start), body.indexOf(end, body.indexOf(start)));
  for (const body of Object.values(s)) {
    assert.doesNotMatch(body, /data-record-new|is-new|Last laps|board-title|board-unknown|board-hero|board-last|Last session/);
    const head = body.slice(body.indexOf('<header class="board-track'), body.indexOf('</header>', body.indexOf('<header class="board-track')));
    assert.match(head, /<header class="board-track strip">/);
    assert.match(head, /<p class="strip-cell is-record board-record-line"><span class="strip-label">Track record<\/span><span class="num strip-figure">7\.500<\/span><span class="strip-by"><span [^>]+><span class="driver-name" title="Haris">Haris<\/span><\/span> <span class="strip-when"><tl-local-time format="date">/);
    assert.doesNotMatch(body, /board-fastest-line/, 'no fastest lap cell on the idle board');
    const result = part(body, '<section class="board-result"');
    assert.match(result, new RegExp(`<h1 class="board-result-title" id="result-title">Practice result</h1><p class="result-when">Ended at <tl-local-time format="time"><time datetime="${escape(new Date(ended).toISOString())}">`));
    // One list: P1 the fastest lap, the record said from inside; the table from 2. No links inside.
    assert.match(result, /<article class="place is-first">\s*<p class="place-pos"><span class="visually-hidden">Position <\/span>1<\/p>\s*<h3 class="place-name"><span [^>]+><span class="driver-name" title="Haris">Haris<\/span><svg class="crown"/);
    // The first record on this track fell here, twice: the card says it is the first.
    assert.match(result, /<dt>Track record<\/dt><dd><span class="fact-word">First on this track<\/span><\/dd>/);
    assert.deepEqual([...result.matchAll(/<td class="pos">(\d+)<\/td>\s*<td class="board-driver"><span [^>]+><span class="driver-name" title="(\w+)">/g)].map((m) => [m[1], m[2]]), [['2', 'Mia']]);
    assert.match(result, /9\.000<\/td>\s*<td class="mark-cell"><abbr class="mark mark-pb"/);
    assert.doesNotMatch(result.slice(result.indexOf('<div class="result is-')), /<a |result-pbs|Lap times/, 'nothing inside the result is a link; the board leaves the personal bests out');
    assert.equal(body.match(/class="crown"/g).length, 1, 'after the holder in the result');
    assert.equal(body.match(/class="crown strip-crown"/g).length, 1, 'and the strip\'s, at its record cell\'s end');
  }
  // Full results on a member's own screen only; Start and Fastest on this track beside the result.
  assert.match(s.board, new RegExp(`<p class="result-when">[\\s\\S]*?</p><a href="${path}/sessions/${session.id}">Full results</a></div>`));
  for (const body of [s.big, s.watch]) assert.doesNotMatch(body, /Full results|<a href="[^"]*\/sessions/);
  const panel = part(s.board, '<aside id="board-start"', '</aside>');
  assert.match(panel, /<h2 id="start-title" class="board-next-title">Start<\/h2>/);
  assert.match(panel, START);
  const side = part(s.board, '<section class="board-fastest is-side"', '</section>');
  const fastestOf = (body) => [...part(body, '<ol class="board-ranks', '</ol>').matchAll(/>(Haris|Mia)<\/span>[\s\S]*?(\d+\.\d{3})/g)].map((m) => [m[1], m[2]]);
  assert.match(side, /<h2 class="h3" id="board-fastest-title">Fastest on this track<\/h2>/);
  assert.deepEqual(fastestOf(side), [['Haris', '7.500'], ['Mia', '9.000']]);
  // The watchers: Fastest on this track alone at the side; the TV: the strip and the result only (§4.3).
  assert.match(s.watch, /<aside class="board-next" aria-labelledby="board-fastest-title">\s*<h2 class="board-next-title" id="board-fastest-title">Fastest on this track<\/h2>/);
  assert.deepEqual(fastestOf(s.watch), [['Haris', '7.500'], ['Mia', '9.000']]);
  assert.doesNotMatch(s.big, /board-next|Fastest on this track|board-ranks/);
  for (const body of [s.big, s.watch]) assert.doesNotMatch(body, START);
});

test('the result takes the board with its winner (#121): P1 the card, then the rest in the table', async () => {
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
  const result = body.slice(body.indexOf('<div class="result is-practice">'), body.indexOf('</section>', body.indexOf('<div class="result is-practice">')));
  assert.deepEqual([...result.matchAll(/>(Abe|Bea|Cid|Dot)<\/span>/g)].map((m) => m[1]), ['Dot', 'Bea', 'Cid', 'Abe']);
  assert.match(result, /<article class="place is-first[^"]*">[\s\S]*?title="Dot"/);
  const fastest = body.slice(body.indexOf('<section class="board-fastest'), body.indexOf('</section>', body.indexOf('<section class="board-fastest')));
  assert.deepEqual([...fastest.matchAll(/>(Abe|Bea|Cid|Dot)<\/span>/g)].map((m) => m[1]), ['Dot', 'Bea', 'Cid', 'Abe']);
});

test('a decoder that is not reporting shows on every live board, and goes when it is back', async () => {
  const quiet = `/clubs/${quietClub.id}`;
  const sentence = /<p class="status status-warning flag board-offline" role="status">&lt;b&gt;Start&lt;\/b&gt; isn't reporting\. Laps will appear once it's back\.<\/p>/;
  const beat = (t) => {
    clock.now = 1_000_000_000_000 + t;
    app.engine.ingest({ workspaceId: quietClub.id, decoder: 'q1', via: 'net', batch: { boot: 'b00tb00t', passings: [] } });
  };
  app.store.addDecoder(quietClub.id, { id: 'q1', name: '<b>Start</b>', tokenHash: 'h', createdAt: clock.now });
  await app.form(member, `${quiet}/watch-link`, {});
  const token = app.store.workspace(quietClub.id).watchToken;
  beat(0);
  const pages = () => [`${quiet}/board`, `${quiet}/board?big`].map((path) => get(member, path)).concat(get(null, `/watch/${token}`));
  for (const res of await Promise.all(pages())) assert.doesNotMatch(await res.text(), /board-offline/, 'reporting');
  clock.now += 25_000;
  app.engine.tick();
  for (const res of await Promise.all(pages())) {
    const body = await res.text();
    assert.match(body, sentence, 'idle');
    assert.ok(body.indexOf('board-track') < body.indexOf('board-offline'), 'right after the track header');
  }
  app.engine.start(quietClub.id, { kind: 'practice', replace: true });
  for (const res of await Promise.all(pages())) assert.match(await res.text(), sentence, 'session');
  beat(30_000);
  app.engine.tick();
  for (const res of await Promise.all(pages())) assert.doesNotMatch(await res.text(), /board-offline/, 'back');
});

test('every live board says whether each decoder is reporting, idle or not reporting', async () => {
  const club = statusClub;
  const path = `/clubs/${club.id}`;
  await app.form(member, `${path}/watch-link`, {});
  const token = app.store.workspace(club.id).watchToken;
  const pages = async () => (await Promise.all([`${path}/board`, `${path}/board?big`].map((p) => get(member, p)).concat(get(null, `/watch/${token}`)))).map((res) => res.text());
  for (const body of await Promise.all(await pages())) assert.doesNotMatch(body, /board-decoders/, 'a club without decoders');
  clock.now = 1_000_000_000_000;
  app.store.addDecoder(club.id, { id: 's1', name: 'Start <b>', tokenHash: 'h1', createdAt: clock.now });
  app.store.addDecoder(club.id, { id: 's2', name: 'Pit', tokenHash: 'h2', createdAt: clock.now });
  const ingest = (decoder, batch) => app.engine.ingest({ workspaceId: club.id, decoder, via: 'net', batch: { boot: 'b00tb00t', passings: [], ...batch } });
  ingest('s1', {});
  ingest('s2', { quiet: true });
  for (const body of await Promise.all(await pages())) {
    assert.match(body, /<li class="board-decoder is-reporting">Start &lt;b&gt;: reporting<\/li>/);
    assert.match(body, /<li class="board-decoder is-reporting">Pit: reporting<\/li>/);
    assert.ok(body.indexOf('board-track') < body.indexOf('board-decoders'), 'in the track header');
  }
  clock.now += 25_000;
  app.engine.tick();
  for (const body of await Promise.all(await pages())) {
    assert.match(body, /<li class="board-decoder is-offline">Start &lt;b&gt;: not reporting<\/li>/);
    assert.match(body, /<li class="board-decoder is-idle">Pit: idle<\/li>/, 'its last batch said quiet');
    assert.ok(body.indexOf('Pit: idle') < body.indexOf('Start &lt;b&gt;: not reporting'), 'sorted by name');
    assert.match(body, /<ul class="board-decoders" role="list" aria-label="Decoders">/);
  }
  app.engine.start(club.id, { kind: 'practice', replace: true });
  for (const body of await Promise.all(await pages())) assert.match(body, /Start &lt;b&gt;: not reporting/, 'during a session');
});

test('several transponders not assigned yet in a session: one warning, by number, linking to collect; none for watchers', async () => {
  const path = `/clubs/${unassignedClub.id}`;
  await app.form(member, `${path}/watch-link`, {});
  const token = app.store.workspace(unassignedClub.id).watchToken;
  clock.now = 1_000_000_000_000 + 20_000_000;
  app.engine.start(unassignedClub.id, { kind: 'practice', replace: true });
  passIn(unassignedClub.id, 20_001_000, '52');
  passIn(unassignedClub.id, 20_002_000, '41');
  const collect = `<a href="${path}/transponders/new">Assign them</a></p>`;
  assert.match(await (await get(member, `${path}/board`)).text(), new RegExp(`<p class="status status-warning flag board-unknown" role="status">Transponders 41 and 52 aren't assigned yet, so their laps aren't counted\\. ${collect}`));
  passIn(unassignedClub.id, 20_003_000, '66');
  const three = await (await get(member, `${path}/board`)).text();
  assert.match(three, new RegExp(`<p class="status status-warning flag board-unknown" role="status">Transponders 41, 52 and 66 aren't assigned yet, so their laps aren't counted\\. ${collect}`));
  assert.equal(three.match(/board-unknown/g).length, 1);
  for (const body of [await (await get(null, `/watch/${token}`)).text(), await (await get(member, `${path}/board?big`)).text()]) {
    assert.doesNotMatch(body, /board-unknown|isn't assigned yet|Assign them|transponders\/new|\b(41|52|66)\b/);
  }
});

test('a race table: FL on the session\'s fastest lap, also a PB; the crown after the holder; ten rows or more, two digits', async () => {
  const names = ['Abe', 'Bea', ...Array.from({ length: 10 }, (_, i) => `Car ${i + 3}`)];
  const drivers = [];
  for (const [i, name] of names.entries()) drivers.push(await driverIn(marksClub, name, String(61 + i)));
  // Abe sets the record in a practice.
  clock.now = 1_000_000_000_000 + 20_000_000;
  const practice = app.engine.start(marksClub.id, { kind: 'practice' }).session;
  passIn(marksClub.id, 20_001_000, '61');
  passIn(marksClub.id, 20_008_000, '61');
  app.engine.end(marksClub.id, practice.id);
  // A race of twelve: Bea's 8.500 is the session's fastest, and her first lap here, so a PB too.
  clock.now = 1_000_000_000_000 + 20_100_000;
  const { session } = app.engine.start(marksClub.id, { kind: 'race', roster: drivers.map((d) => d.id), durationMs: 600_000, countdownMs: 0 });
  for (const [i] of names.entries()) passIn(marksClub.id, 20_101_000 + i * 10, String(61 + i));
  for (const [i] of names.entries()) passIn(marksClub.id, 20_101_000 + i * 10 + (i === 1 ? 8500 : 9000 + i * 10), String(61 + i));
  const body = await (await get(member, `/clubs/${marksClub.id}/board`)).text();
  assert.match(body, /<table class="board-table standings-table is-race has-two-digit-pos has-flags">/);
  const rows = [...body.matchAll(/<tr(?: class="[^"]*")? data-driver="[^"]+"(?: data-moment="[^"]+")?>\s*<td class="pos">[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.equal(rows.length, 12);
  const bea = rows.find((r) => r.includes('title="Bea"'));
  assert.match(bea, /8\.500<\/td>\s*<td class="mark-cell"><abbr class="mark mark-fl" title="Fastest lap of the session" aria-hidden="true">FL<\/abbr><span class="visually-hidden">Fastest lap<\/span><\/td>/);
  const table = body.slice(body.indexOf('<table'), body.indexOf('</table>'));
  assert.equal(table.match(/class="mark mark-fl"/g).length, 1, 'one FL in the table');
  assert.match(rows.find((r) => r.includes('title="Abe"')), /<span class="driver-name" title="Abe">Abe<\/span><svg class="crown"/);
  assert.doesNotMatch(body, /is-best|table-key/, 'no tint, no key');
  app.engine.abort(marksClub.id, session.id);
  // An aborted race never takes the board (board hub spec §4.1): the practice before it is the latest finished session.
  const idle = await (await get(member, `/clubs/${marksClub.id}/board`)).text();
  assert.match(idle, /<h1 class="board-result-title" id="result-title">Practice result<\/h1>/);
  assert.doesNotMatch(idle, /Race result|Aborted/);
  // A qualifying table is sorted by best lap: FL on P1, Bea's, though it is her PB too.
  clock.now = 1_000_000_000_000 + 20_800_000;
  const q = app.engine.start(marksClub.id, { kind: 'qualifying', roster: drivers.map((d) => d.id), durationMs: 600_000, countdownMs: 0 }).session;
  for (const [i] of names.entries()) passIn(marksClub.id, 20_801_000 + i * 10, String(61 + i));
  for (const [i] of names.entries()) passIn(marksClub.id, 20_801_000 + i * 10 + (i === 1 ? 8400 : 9000 + i * 10), String(61 + i));
  const qbody = await (await get(member, `/clubs/${marksClub.id}/board`)).text();
  assert.match(qbody, /<h1 class="board-title">Qualifying<\/h1>/);
  const qrows = [...qbody.matchAll(/<tr(?: class="[^"]*")? data-driver="[^"]+"(?: data-moment="[^"]+")?>\s*<td class="pos">[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.match(qrows[0], /title="Bea"[\s\S]*8\.400<\/td>\s*<td class="mark-cell"><abbr class="mark mark-fl"/, 'FL on P1');
  app.engine.abort(marksClub.id, q.id);
});

test('no board and no session page says "Session best" or shows SB: the fastest lap is FL', async () => {
  const ws = wordsClub.id;
  const abe = await driverIn(wordsClub, 'Abe', '95');
  const bea = await driverIn(wordsClub, 'Bea', '96');
  const SB = /mark-sb|Session best|session best|>SB</;
  const pages = [];
  const page = async (path) => {
    const res = await get(member, path);
    assert.equal(res.status, 200);
    const body = await res.text();
    pages.push(path);
    return body;
  };
  for (const [i, kind] of ['practice', 'race'].entries()) {
    clock.now = 1_000_000_000_000 + 60_000_000 + i * 100_000;
    const { session } = app.engine.start(ws, kind === 'race' ? { kind, roster: [abe.id, bea.id], durationMs: 600_000, countdownMs: 0 } : { kind });
    const t = 60_001_000 + i * 100_000;
    for (const [dt, code] of [[0, '95'], [100, '96'], [8_600, '95'], [9_100, '96'], [16_900, '95'], [18_000, '96']]) passIn(ws, t + dt, code);
    for (const path of [`/clubs/${ws}/board`, `/clubs/${ws}/board?big`]) {
      const body = await page(path);
      assert.match(body, /class="mark mark-fl"|class="mark mark-tr"/, `${kind} ${path}: the fastest lap is marked`);
      assert.doesNotMatch(body, SB, `${kind} ${path}`);
    }
    app.engine.end(ws, session.id);
    assert.doesNotMatch(await page(`/clubs/${ws}/board`), SB, `the idle board after the ${kind}`);
    const detail = await page(`/clubs/${ws}/sessions/${session.id}`);
    // A practice's P1 card is its fastest lap; a race's or qualifying's facts name it.
    if (kind === 'practice') assert.doesNotMatch(detail, /<dt>Fastest lap<\/dt>/);
    else assert.match(detail, /<dt>Fastest lap<\/dt>/);
    assert.doesNotMatch(detail, SB, `the ${kind}'s page`);
  }
  assert.doesNotMatch(await page(`/clubs/${ws}/sessions`), SB, 'the sessions list');
  assert.equal(pages.length, 9);
});
