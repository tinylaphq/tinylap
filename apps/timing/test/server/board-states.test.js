// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's states (board hub spec §4): while nobody races the latest
// finished session on the current track and direction, never an aborted one;
// while a session runs, a line under its title with End or Abort for members;
// the TV and the watchers without controls or links, the TV's result stopping
// after P6.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming, useTrack } from './helpers.js';
import { events, next } from './sse.js';

const clock = { now: 2_000_000_000_000 };
let app;
let member;
let club;
let base;
let token;
let drivers;

before(async () => {
  app = await startTiming({ clock });
  const ana = await app.signUp('Ana');
  club = app.club(ana, 'States');
  member = await app.login(ana);
  base = `/clubs/${club.id}`;
  useTrack(app.store, club.id, 'Kitchen Ring', 'cw', 'ring');
  for (const [i, name] of ['Abe', 'Bea', 'Cid', 'Dot', 'Eva', 'Fin', 'Gus', 'Hal'].entries()) {
    await app.form(member, `${base}/drivers`, { name });
    app.engine.assign(club.id, String(70 + i), app.store.drivers(club.id).find((d) => d.name === name).id);
  }
  drivers = app.store.drivers(club.id);
  await app.form(member, `${base}/watch-link`, {});
  token = app.store.workspace(club.id).watchToken;
});
after(() => app.close());

const get = (who, path) => app.api(who, 'GET', path, undefined, { accept: 'text/html' });
const pass = (t, transponder) => {
  clock.now = 2_000_000_000_000 + t;
  app.engine.ingest({ workspaceId: club.id, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder, t }] } });
};
const screens = async () => ({
  board: await (await get(member, `${base}/board`)).text(),
  big: await (await get(member, `${base}/board?big`)).text(),
  watch: await (await get(null, `/watch/${token}`)).text(),
});
/** A practice from `t` in which the first `n` drivers each drive one lap, the first fastest. */
function practice(t, n) {
  clock.now = 2_000_000_000_000 + t;
  const { session } = app.engine.start(club.id, { kind: 'practice' });
  for (let i = 0; i < n; i++) pass(t + 1000 + i * 10, String(70 + i));
  for (let i = 0; i < n; i++) pass(t + 1000 + i * 10 + 8000 + i * 100, String(70 + i));
  app.engine.end(club.id, session.id);
  clock.now += 60_000;
  app.engine.tick();
  return session;
}
const title = (body) => body.match(/<h1 class="board-result-title" id="result-title">([^<]+)<\/h1>/)?.[1];

test('a running session says what runs under its title, with End or Abort for members only', async () => {
  const cases = [
    [{ kind: 'practice' }, 'Every car with a driver', 'end', 'End'],
    [{ kind: 'race', roster: drivers.slice(0, 4).map((d) => d.id), durationMs: 600_000, countdownMs: 0 }, '4 drivers, 10 min', 'abort', 'Abort'],
    [{ kind: 'qualifying', roster: drivers.slice(0, 1).map((d) => d.id), durationMs: 300_000, countdownMs: 0 }, '1 driver, 5 min', 'abort', 'Abort'],
    [{ kind: 'race', durationMs: 600_000, countdownMs: 0 }, 'Everyone on the track, 10 min', 'abort', 'Abort'],
  ];
  for (const [rules, words, path, button] of cases) {
    const { session } = app.engine.start(club.id, { ...rules, replace: true });
    const s = await screens();
    assert.match(s.board, new RegExp(`<div class="board-title-block">\\s*<h1 class="board-title">[A-Za-z]+</h1>\\s*<p class="board-session-line"><span>${words}</span> <a class="btn btn-outline btn-sm board-stop" href="${base}/sessions/${session.id}/${path}">${button}</a></p>`));
    for (const body of [s.big, s.watch]) {
      assert.match(body, new RegExp(`<p class="board-session-line"><span>${words}</span></p>`), 'the words, nothing to press');
      assert.doesNotMatch(body, /board-stop|\/(end|abort)"/);
    }
    // The confirm page returns to the board: its Cancel, and its POST's redirect.
    const confirm = await (await get(member, `${base}/sessions/${session.id}/${path}`)).text();
    assert.match(confirm, new RegExp(`<a class="btn btn-outline" href="${base}/board">Cancel</a>`));
    const done = await app.form(member, `${base}/sessions/${session.id}/${path}`, {});
    assert.equal(done.status, 303);
    assert.equal(done.headers.get('location'), `${base}/board`);
  }
});

test('the idle board shows the latest finished session on the current track and direction, never an aborted one', async () => {
  const first = practice(10_000_000, 3);
  let s = await screens();
  for (const body of Object.values(s)) assert.equal(title(body), 'Practice result');
  assert.match(s.board, new RegExp(`<a href="${base}/sessions/${first.id}">Full results</a>`));

  // An aborted race after it never takes the board.
  clock.now = 2_000_000_000_000 + 11_000_000;
  const race = app.engine.start(club.id, { kind: 'race', roster: drivers.slice(0, 2).map((d) => d.id), durationMs: 60_000, countdownMs: 0 }).session;
  pass(11_001_000, '70');
  app.engine.abort(club.id, race.id);
  s = await screens();
  for (const body of Object.values(s)) {
    assert.equal(title(body), 'Practice result');
    assert.doesNotMatch(body, /Race result|Aborted/);
  }
  assert.match(s.board, new RegExp(`<a href="${base}/sessions/${first.id}">Full results</a>`));

  // Another direction has no finished session: never driven there. Back, and the result is back.
  useTrack(app.store, club.id, 'Kitchen Ring', 'ccw', 'ring');
  s = await screens();
  for (const body of Object.values(s)) {
    assert.equal(title(body), 'No sessions yet');
    assert.doesNotMatch(body, /class="result is-|Full results|Ended at/);
  }
  useTrack(app.store, club.id, 'Kitchen Ring', 'cw', 'ring');
  assert.equal(title((await screens()).board), 'Practice result');

  // The idle board's stream renders the same result.
  const res = await app.api(member, 'GET', `${base}/board/events`);
  const it = events(res, { raw: true });
  const streamed = await next(it, 'board');
  assert.match(streamed.data, /<h1 class="board-result-title" id="result-title">Practice result<\/h1>/);
  await it.return?.();
  res.body?.cancel?.().catch(() => {});
});

test('the API\'s snapshot is unchanged: the result is the board\'s only', () => {
  assert.equal('latest' in app.engine.snapshot(club.id), false);
  assert.equal('latest' in app.engine.snapshot(club.id, { watcher: true }), false);
  assert.ok(app.engine.snapshot(club.id, { moments: true }).latest);
});

test('the TV stops the result after P6 with how many more; the laptop shows everyone', async () => {
  practice(20_000_000, 8);
  const s = await screens();
  const positions = (body) => [...body.matchAll(/<td class="pos">(\d+)<\/td>/g)].map((m) => Number(m[1]));
  assert.deepEqual(positions(s.big), [2, 3, 4, 5, 6], 'P1 the card, then the table to 6');
  assert.match(s.big, /<p class="result-more">2 more on the results page\.<\/p>/);
  for (const body of [s.board, s.watch]) {
    assert.deepEqual(positions(body.slice(body.indexOf('<div class="result is-'))).slice(0, 7), [2, 3, 4, 5, 6, 7, 8]);
    assert.doesNotMatch(body, /result-more/);
  }
  // The TV: the strip and the result only, nothing to press and no links in the board.
  const live = s.big.slice(s.big.indexOf('<div id="board-live"'), s.big.indexOf('</tl-board>'));
  assert.doesNotMatch(live, /<a |<form|<button|board-next|Fastest on this track/);
  const watch = s.watch.slice(s.watch.indexOf('<div id="board-live"'), s.watch.indexOf('</tl-board>'));
  assert.doesNotMatch(watch, /<a |<form|<button/, 'the watchers\' board has no controls or links either');
});
