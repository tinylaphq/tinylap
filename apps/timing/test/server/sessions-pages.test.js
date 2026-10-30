// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const T0 = 1_000_000_000_000; // 2001-09-09T01:46:40Z
const clock = { now: T0 };
const TRACK = { id: 't1', shape: 'c30:1:x', name: 'Office loop', snapshotKey: 'k'.repeat(22), layout: '{}' };
let app;
let member;
let office;
let base;
let history;
let records;
let idle;

before(async () => {
  app = await startTiming({ clock });
  const ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  history = app.club(ana, 'History');
  records = app.club(ana, 'Records');
  idle = app.club(ana, 'Idle');
  member = await app.login(ana);
  base = `/clubs/${office.id}`;
});
after(() => app.close());

const get = (path, who = member) => app.api(who, 'GET', path, undefined, { accept: 'text/html' });
/** A passing of `transponder` at server time T0 + `t`. */
const pass = (ws, t, transponder) => {
  clock.now = T0 + t;
  app.engine.ingest({ workspaceId: ws, decoder: `d-${ws}`, via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder, t }] } });
};
/** Drivers by name, each with a transponder named in `codes`. */
async function driversIn(ws, codes) {
  for (const name of Object.keys(codes)) await app.form(member, `/clubs/${ws}/drivers`, { name });
  const drivers = app.store.drivers(ws);
  for (const [name, code] of Object.entries(codes)) app.engine.assign(ws, code, drivers.find((d) => d.name === name).id);
  return Object.fromEntries(drivers.map((d) => [d.name, d]));
}

test('without drivers, the tab starts a practice and points to Setup for a race', async () => {
  const body = await (await get(`${base}/sessions`)).text();
  assert.match(body, /<h1>Sessions<\/h1>/);
  assert.match(body, /<a class="nav-tab" href="[^"]*\/sessions" aria-current="page">Sessions<\/a>/);
  assert.doesNotMatch(body, />Race<\/a>/, 'the tab replaces Race');
  assert.match(body, new RegExp(`<form method="post" action="${base}/sessions"[^>]*>\\s*<input type="hidden" name="kind" value="practice">\\s*<button type="submit" class="btn btn-primary">Start practice</button>`));
  assert.match(body, new RegExp(`<a[^>]*href="${base}/setup#drivers"`));
  assert.doesNotMatch(body, /name="roster"/, 'no race form without drivers');
  assert.match(body, /No sessions yet\./);
});

test('/race goes to the Sessions tab', async () => {
  const res = await get(`${base}/race`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/sessions`);
});

test('start a race from the form, confirm before replacing it, then abort it after confirming', async () => {
  for (const name of ['Ana', 'Ben']) await app.form(member, `${base}/drivers`, { name });
  const [a, b] = app.store.drivers(office.id);
  const form = await (await get(`${base}/sessions`)).text();
  assert.match(form, /<input type="radio" name="kind" value="race"[^>]* checked/);
  assert.match(form, new RegExp(`<input type="checkbox" name="roster" value="${a.id}"[^>]* checked`));
  assert.doesNotMatch(form, /tl-countdown|countdown\.js/, 'the start form has no clock');
  const started = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['roster', b.id], ['duration', '2'], ['countdown', '0']]);
  assert.equal(started.status, 303);
  assert.equal(started.headers.get('location'), `${base}/board`);
  const session = app.store.runningSession(office.id);
  assert.deepEqual([session.kind, session.durationMs, session.roster], ['race', 120_000, [a.id, b.id]]);

  const running = await (await get(`${base}/sessions`)).text();
  assert.match(running, /<h2[^>]*>Race, running<\/h2>/);
  assert.match(running, new RegExp(`<a[^>]*href="${base}/sessions/${session.id}/abort"`));
  assert.doesNotMatch(running, /action="[^"]*\/abort"/, 'abort needs the confirmation page first');
  assert.match(running, /<tl-countdown class="race-clock" reload-on-phase><span class="stat-label" data-clock-label>Remaining<\/span> <time class="race-clock-time" data-clock data-kind="race" data-state="running" data-opens="\d+" data-closes="\d+" data-now="\d+">\d+:\d\d<\/time><\/tl-countdown>/);
  assert.match(running, /<script type="module" src="\/public\/elements\/countdown.js"><\/script>/);

  clock.now += 3 * 60_000;
  const again = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', '2'], ['countdown', '0']]);
  assert.equal(again.status, 200);
  const ask = await again.text();
  assert.match(ask, /A race is running \(3 min, 2 drivers\)\. Starting this race ends it\./);
  assert.doesNotMatch(ask, /tl-countdown/, 'the answer to a POST never reloads');
  const fields = [...ask.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(fields, [['kind', 'race'], ['roster', a.id], ['duration', '2'], ['countdown', '0'], ['replace', session.id]]);
  assert.match(ask, new RegExp(`<form method="post" action="${base}/sessions"`));
  assert.match(ask, /<button type="submit" class="btn btn-danger">Start<\/button>/);
  assert.equal(app.store.runningSession(office.id).id, session.id, 'asking ends nothing');

  const confirm = await (await get(`${base}/sessions/${session.id}/abort`)).text();
  assert.match(confirm, /Abort the race\?/);
  assert.match(confirm, new RegExp(`<form method="post" action="${base}/sessions/${session.id}/abort"`));
  assert.equal(app.store.session(session.id).state === 'aborted', false, 'asking does not abort');

  const aborted = await app.form(member, `${base}/sessions/${session.id}/abort`, {});
  assert.equal(aborted.status, 303);
  assert.equal(aborted.headers.get('location'), `${base}/sessions`);
  assert.equal(app.store.session(session.id).state, 'aborted');

  const gone = await app.form(member, `${base}/sessions/${session.id}/abort`, {});
  assert.equal(gone.status, 404);
  assert.match(await gone.text(), /role="alert"/);
  assert.equal((await get(`${base}/sessions/${session.id}/abort`)).status, 404);
});

test('confirming ends the running session and starts the new one', async () => {
  const [a] = app.store.drivers(office.id);
  await app.form(member, `${base}/sessions`, [['kind', 'practice']]);
  const practice = app.store.runningSession(office.id);
  const started = await app.form(member, `${base}/sessions`, [['kind', 'qualifying'], ['roster', a.id], ['duration', '5'], ['countdown', '10'], ['replace', practice.id]]);
  assert.equal(started.status, 303);
  assert.equal(app.store.session(practice.id).state, 'done');
  const running = app.store.runningSession(office.id);
  assert.equal(running.kind, 'qualifying');
  await app.form(member, `${base}/sessions/${running.id}/abort`, {});
});

test('a confirmation ends only the session it named', async () => {
  const [a] = app.store.drivers(office.id);
  const race = [['kind', 'race'], ['roster', a.id], ['duration', '2'], ['countdown', '0']];
  await app.form(member, `${base}/sessions`, [['kind', 'practice']]);
  const named = app.store.runningSession(office.id);
  // Meanwhile someone else replaced it with a qualifying, a minute ago.
  clock.now += 60_000;
  app.engine.start(office.id, { kind: 'qualifying', roster: [a.id], durationMs: 300_000, replace: true });
  const now = app.store.runningSession(office.id);
  clock.now += 60_000;
  const stale = await app.form(member, `${base}/sessions`, [...race, ['replace', named.id]]);
  assert.equal(stale.status, 200);
  const ask = await stale.text();
  assert.match(ask, /A qualifying is running \(1 min, 1 driver\)\. Starting this race ends it\./);
  assert.match(ask, new RegExp(`<input type="hidden" name="replace" value="${now.id}">`));
  assert.match(ask, new RegExp(`<input type="hidden" name="roster" value="${a.id}">`), 'the fields are kept');
  assert.equal(app.store.runningSession(office.id).id, now.id, 'nothing ended');

  // Sent twice: the first ends the qualifying it named, the second finds the race the first started.
  const first = await app.form(member, `${base}/sessions`, [...race, ['replace', now.id]]);
  assert.equal(first.status, 303);
  const started = app.store.runningSession(office.id);
  assert.equal(started.kind, 'race');
  const again = await app.form(member, `${base}/sessions`, [...race, ['replace', now.id]]);
  assert.equal(again.status, 303);
  assert.equal(again.headers.get('location'), `${base}/board`);
  assert.equal(app.store.runningSession(office.id).id, started.id, 'one session, the first one');

  // Once nothing runs, the confirmation just starts.
  app.engine.abort(office.id, started.id);
  const late = await app.form(member, `${base}/sessions`, [...race, ['replace', started.id]]);
  assert.equal(late.status, 303);
  const fresh = app.store.runningSession(office.id);
  assert.notEqual(fresh.id, started.id);
  assert.equal(fresh.kind, 'race');
  app.engine.abort(office.id, fresh.id);
});

test('Start practice pressed twice starts one practice and lands on the board', async () => {
  const first = await app.form(member, `${base}/sessions`, [['kind', 'practice']]);
  assert.equal(first.status, 303);
  const started = app.store.runningSession(office.id);
  clock.now += 2000;
  const again = await app.form(member, `${base}/sessions`, [['kind', 'practice']]);
  assert.equal(again.status, 303);
  assert.equal(again.headers.get('location'), `${base}/board`);
  assert.equal(app.store.runningSession(office.id).id, started.id, 'one practice, the first one');
  const bad = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['duration', '2']]);
  assert.equal(bad.status, 422, 'a form with a mistake still says so');
  clock.now += 10_000;
  const later = await app.form(member, `${base}/sessions`, [['kind', 'practice']]);
  assert.equal(later.status, 200, 'after 10 s it asks again');
  assert.match(await later.text(), /Starting this practice ends it\./);
  app.engine.end(office.id, started.id);
});

test('Start practice on the Tap page leads back to the Tap page', async () => {
  const first = await app.form(member, `${base}/sessions`, [['kind', 'practice'], ['from', 'tap']]);
  assert.equal(first.status, 303);
  assert.equal(first.headers.get('location'), `${base}/tap`);
  const started = app.store.runningSession(office.id);
  clock.now += 2000;
  const again = await app.form(member, `${base}/sessions`, [['kind', 'practice'], ['from', 'tap']]);
  assert.equal(again.headers.get('location'), `${base}/tap`, 'pressed twice: back to Tap too');
  clock.now += 10_000;
  const ask = await (await app.form(member, `${base}/sessions`, [['kind', 'practice'], ['from', 'tap']])).text();
  const fields = [...ask.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(fields, [['kind', 'practice'], ['from', 'tap'], ['replace', started.id]], 'the confirmation keeps where it came from');
  const replaced = await app.form(member, `${base}/sessions`, fields);
  assert.equal(replaced.headers.get('location'), `${base}/tap`);
  app.engine.end(office.id, app.store.runningSession(office.id).id);
  clock.now += 20_000;
  const forged = await app.form(member, `${base}/sessions`, [['kind', 'practice'], ['from', 'https://example.com/']]);
  assert.equal(forged.headers.get('location'), `${base}/board`, 'only tap is a place to go back to');
  app.engine.end(office.id, app.store.runningSession(office.id).id);
});

test('a practice\'s confirmation carries only its kind and the session it ends', async () => {
  const [a] = app.store.drivers(office.id);
  await app.form(member, `${base}/sessions`, [['kind', 'qualifying'], ['roster', a.id], ['duration', '5']]);
  const running = app.store.runningSession(office.id);
  clock.now += 60_000;
  const res = await app.form(member, `${base}/sessions`, [['kind', 'practice'], ['roster', a.id], ['duration', '9']]);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Starting this practice ends it\./);
  const fields = [...body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(fields, [['kind', 'practice'], ['replace', running.id]]);
  app.engine.abort(office.id, running.id);
});

test('a blank countdown means the default', async () => {
  const [a] = app.store.drivers(office.id);
  const started = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', '1'], ['countdown', '']]);
  assert.equal(started.status, 303);
  const session = app.store.runningSession(office.id);
  assert.equal(session.state, 'countdown');
  await app.form(member, `${base}/sessions/${app.store.runningSession(office.id).id}/abort`, {});
});

test('a bad form comes back with one summary and what was chosen', async () => {
  const [a] = app.store.drivers(office.id);
  const none = await app.form(member, `${base}/sessions`, [['kind', 'qualifying'], ['duration', '5'], ['countdown', '10']]);
  assert.equal(none.status, 422);
  const body = await none.text();
  assert.match(body, /<p class="status status-error" role="alert"><a href="#race-roster">Pick 1 to 20 drivers\.<\/a><\/p>/);
  assert.equal(body.match(/role="alert"/g).length, 1);
  assert.match(body, /<input type="radio" name="kind" value="qualifying"[^>]* checked/);
  assert.doesNotMatch(body, new RegExp(`value="${a.id}"[^>]* checked`), 'unticked stays unticked');
  const long = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', '120'], ['countdown', '10']]);
  assert.equal(long.status, 422);
  const text = await long.text();
  assert.match(text, /<a href="#race-duration">/);
  assert.match(text, /id="race-duration"[^>]*value="120"[^>]*aria-invalid="true"/);
});

test('a bad minutes or countdown value says what is allowed and keeps the input', async () => {
  const [a] = app.store.drivers(office.id);
  for (const duration of ['abc', '1e3', '1e1', '0x10', ' 5', '-5', '0.0001']) {
    const res = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', duration], ['countdown', '10']]);
    assert.equal(res.status, 422, duration);
    const body = await res.text();
    assert.match(body, /<p class="status status-error" role="alert"><a href="#race-duration">A session lasts 1 to 60 minutes\.<\/a><\/p>/, duration);
    assert.match(body, /id="race-duration"[^>]*aria-invalid="true"/, duration);
    if (duration !== 'abc') assert.match(body, new RegExp(`id="race-duration"[^>]*value="${duration}"`), duration);
  }
  for (const countdown of ['1e1', '0x10', ' 5']) {
    const res = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', '5'], ['countdown', countdown]]);
    assert.equal(res.status, 422, countdown);
    assert.match(await res.text(), /<a href="#race-countdown">The countdown is 0 to 30 seconds\.<\/a>/, countdown);
  }
  const res = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', '5'], ['countdown', '2.5']]);
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /<a href="#race-countdown">The countdown is 0 to 30 seconds\.<\/a>/);
  assert.match(body, /id="race-countdown"[^>]*value="2.5"[^>]*aria-invalid="true"/);
  assert.equal(app.store.runningSession(office.id), null);
});

test('a running session names its drivers and length', async () => {
  const drivers = app.store.drivers(office.id);
  await app.form(member, `${base}/sessions`, [['kind', 'qualifying'], ...drivers.map((d) => ['roster', d.id]), ['duration', '3']]);
  const body = await (await get(`${base}/sessions`)).text();
  assert.match(body, /<h2[^>]*>Qualifying, running<\/h2>/);
  assert.match(body, /Ana, Ben\. 3 minutes\./);
  await app.form(member, `${base}/sessions/${app.store.runningSession(office.id).id}/abort`, {});
});

test('a session of 30 seconds, started through the API, does not read as a minute', async () => {
  const [a] = app.store.drivers(office.id);
  const started = await app.api(member, 'POST', `/workspaces/${office.id}/sessions`, { kind: 'qualifying', roster: [a.id], durationSeconds: 30 });
  assert.equal(started.status, 201);
  const body = await (await get(`${base}/sessions`)).text();
  assert.match(body, /\. 30 seconds\./);
  assert.doesNotMatch(body, /1 minute/);
  await app.form(member, `${base}/sessions/${app.store.runningSession(office.id).id}/abort`, {});
});

test('a practice: Start practice, its start time, End after confirming', async () => {
  clock.now = T0 + 3_600_000;
  const started = await app.form(member, `${base}/sessions`, [['kind', 'practice']]);
  assert.equal(started.status, 303);
  assert.equal(started.headers.get('location'), `${base}/board`);
  const session = app.store.runningSession(office.id);
  assert.equal(session.kind, 'practice');
  const body = await (await get(`${base}/sessions`)).text();
  assert.match(body, /<h2[^>]*>Practice, running<\/h2>/);
  assert.match(body, /Started <tl-local-time format="time"><time datetime="2001-09-09T02:46:40.000Z">02:46<\/time><\/tl-local-time>/);
  assert.match(body, /<script type="module" src="\/pkg\/design\/elements\/local-time.js"><\/script>/);
  assert.match(body, new RegExp(`<a class="btn btn-danger" href="${base}/sessions/${session.id}/end">End</a>`));
  assert.doesNotMatch(body, /\/abort"/);

  const ask = await get(`${base}/sessions/${session.id}/end`);
  assert.equal(ask.status, 200);
  const confirm = await ask.text();
  assert.match(confirm, /End the practice\?/);
  assert.match(confirm, new RegExp(`<form method="post" action="${base}/sessions/${session.id}/end"`));
  assert.equal(app.store.runningSession(office.id).id, session.id, 'asking ends nothing');
  const ended = await app.form(member, `${base}/sessions/${session.id}/end`, {});
  assert.equal(ended.status, 303);
  assert.equal(ended.headers.get('location'), `${base}/sessions`);
  assert.equal(app.store.session(session.id).state, 'done');
  assert.equal((await app.form(member, `${base}/sessions/${session.id}/end`, {})).status, 404);
  assert.equal((await get(`${base}/sessions/${session.id}/end`)).status, 404);
});

test('starting a race while a practice runs names the practice', async () => {
  const ws = history.id;
  await driversIn(ws, { Ana: '10', Ben: '20', Cem: '30' });
  clock.now = T0;
  app.engine.start(ws, { kind: 'practice' });
  for (const code of ['10', '20', '30']) pass(ws, 1000, code);
  for (const code of ['10', '20', '30']) pass(ws, 9000, code);
  clock.now = T0 + 12 * 60_000;
  const roster = app.store.drivers(ws).map((d) => ['roster', d.id]);
  const res = await app.form(member, `/clubs/${ws}/sessions`, [['kind', 'race'], ...roster, ['duration', '5'], ['countdown', '10']]);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /A practice is running \(12 min, 3 drivers\)\. Starting this race ends it\./);
  const running = app.store.runningSession(ws);
  assert.match(body, new RegExp(`<input type="hidden" name="replace" value="${running.id}">`));
  app.engine.end(ws, running.id);
});

test('history: newest first, with kind, length, drivers and the best lap with its marks; 20 a page', async () => {
  const ws = history.id;
  const hbase = `/clubs/${ws}`;
  app.store.setTrack(ws, TRACK, 'cw');
  // 20 more practices, a minute apart, then one with laps: 22 in all, the first from the test before.
  for (let i = 0; i < 20; i += 1) {
    clock.now = T0 + (20 + i) * 60_000;
    const { session } = app.engine.start(ws, { kind: 'practice' });
    app.engine.end(ws, session.id);
  }
  clock.now = T0 + 3_600_000;
  const { session } = app.engine.start(ws, { kind: 'practice' });
  pass(ws, 3_601_000, '10');
  pass(ws, 3_602_000, '20');
  pass(ws, 3_609_000, '10'); // Ana 8.000
  pass(ws, 3_609_500, '20'); // Ben 7.500
  pass(ws, 3_616_000, '10'); // Ana 7.000: the record
  pass(ws, 3_618_000, '20'); // Ben 8.500
  app.engine.end(ws, session.id);

  const body = await (await get(`${hbase}/sessions`)).text();
  const rows = [...body.matchAll(/<tr class="history-row[^"]*">([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  assert.equal(rows.length, 20);
  const [newest] = rows;
  assert.match(newest, new RegExp(`<a href="${hbase}/sessions/${session.id}"><tl-local-time format="datetime"><time datetime="2001-09-09T02:46:40.000Z">9 Sep, 02:46</time></tl-local-time></a>`));
  assert.match(newest, /<td>Practice<\/td>/);
  assert.match(newest, /<td class="num">18 s<\/td>/, 'from its start to its last passing');
  assert.match(newest, /<td class="num">2<\/td>/);
  assert.match(newest, /Ana<\/span><span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑<\/span>/);
  assert.match(newest, /7\.000<span class="marks"><abbr class="mark mark-tr" title="Track record" aria-hidden="true">TR<\/abbr><span class="visually-hidden">Track record<\/span><\/span>/);
  assert.match(rows[1], /<td class="num">0 s<\/td>/);
  assert.match(rows[1], /<td class="num">0<\/td>/);
  const twentieth = app.store.listSessions(ws, 21)[19];
  const cursor = `${twentieth.createdAt}.${twentieth.id}`;
  assert.match(body, new RegExp(`<a[^>]* href="${hbase}/sessions\\?before=${cursor}#history"[^>]*>Older sessions</a>`));

  const older = await (await get(`${hbase}/sessions?before=${cursor}`)).text();
  const olderRows = [...older.matchAll(/<tr class="history-row[^"]*">/g)];
  assert.equal(olderRows.length, 2);
  assert.doesNotMatch(older, /Older sessions/);
  assert.match(older, /<td class="num">9 s<\/td>[\s\S]*?<td class="num">3<\/td>/, 'the practice of the test before');
});

test('a session page: the final table with marks and crown, then every lap', async () => {
  const ws = history.id;
  const hbase = `/clubs/${ws}`;
  const [session] = app.store.listSessions(ws, 1);
  const res = await get(`${hbase}/sessions/${session.id}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<h1>Practice<\/h1>/);
  assert.match(body, /Started[\s\S]*?02:46[\s\S]*?Ended[\s\S]*?02:46/);
  assert.match(body, /<a class="nav-tab" href="[^"]*\/sessions" aria-current="page">Sessions<\/a>/);
  const table = /<table class="board-table">[\s\S]*?<\/table>/.exec(body)[0];
  const rows = [...table.matchAll(/<tr( class="is-best")?>[\s\S]*?<\/tr>/g)].slice(1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], ' class="is-best"', 'the session’s best lap is one row');
  assert.match(rows[0][0], /Ana<\/span><span class="crown"/);
  assert.match(rows[0][0], /7\.000<span class="marks"><abbr class="mark mark-tr" title="Track record" aria-hidden="true">TR<\/abbr><span class="visually-hidden">Track record<\/span><\/span>/);
  assert.equal(rows[1][1], undefined);
  assert.match(rows[1][0], /7\.500<span class="marks"><abbr class="mark mark-pb" title="Personal best" aria-hidden="true">PB<\/abbr><span class="visually-hidden">Personal best<\/span><\/span>/);
  assert.doesNotMatch(rows[1][0], /crown/);
  const laps = /<section[^>]*aria-labelledby="laps-title"[\s\S]*?<\/section>/.exec(body)[0];
  const times = [...laps.matchAll(/<td class="num">(\d+\.\d{3})/g)].map((m) => m[1]);
  assert.deepEqual(times, ['8.000', '7.000', '7.500', '8.500'], 'each driver’s laps in order, Ana first');

  assert.equal((await get(`${hbase}/sessions/nope`)).status, 404);
  assert.equal((await get(`/clubs/${office.id}/sessions/${session.id}`)).status, 404, 'another club’s session is not here');
});

test('a signed-out request for a session page goes to sign-in', async () => {
  const [session] = app.store.listSessions(history.id, 1);
  const res = await get(`/clubs/${history.id}/sessions/${session.id}`, null);
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/auth\/login\?returnTo=/);
});

test('the tab shows the five latest track records, /records all of them, newest first', async () => {
  const ws = records.id;
  const rbase = `/clubs/${ws}`;
  await driversIn(ws, { Ana: '10' });
  app.store.setTrack(ws, TRACK, 'cw');
  clock.now = T0;
  const { session } = app.engine.start(ws, { kind: 'practice' });
  let t = 1000;
  pass(ws, t, '10');
  for (const lap of [10_000, 9000, 8000, 7500, 7000, 6500]) pass(ws, (t += lap), '10');
  app.engine.end(ws, session.id);

  const tab = await (await get(`${rbase}/sessions`)).text();
  const section = /<section[^>]*aria-labelledby="records-title"[\s\S]*?<\/section>/.exec(tab)[0];
  assert.match(section, /Office loop, clockwise/);
  const shown = [...section.matchAll(/<td class="num">(\d+\.\d{3})/g)].map((m) => m[1]);
  assert.deepEqual(shown, ['6.500', '7.000', '7.500', '8.000', '9.000']);
  assert.match(section, new RegExp(`<a href="${rbase}/records">All track records</a>`));

  const all = await get(`${rbase}/records`);
  assert.equal(all.status, 200);
  const page = await all.text();
  assert.match(page, /<h1>Track records<\/h1>/);
  assert.deepEqual([...page.matchAll(/<td class="num">(\d+\.\d{3})/g)].map((m) => m[1]), ['6.500', '7.000', '7.500', '8.000', '9.000', '10.000']);
  assert.match(page, /<tl-local-time format="datetime">/);
  assert.match(page, /<script type="module" src="\/pkg\/design\/elements\/local-time.js"><\/script>/);
});

test('a car with no session running shows the notice and Start practice on the tab', async () => {
  const ws = idle.id;
  await driversIn(ws, { Haris: '21' });
  pass(ws, 5000, '21');
  const body = await (await get(`/clubs/${ws}/sessions`)).text();
  assert.match(body, /<div class="status status-warning flag idle-notice" role="status">\s*<p>A car crossed the line \(21, Haris\)\. No session is running\.<\/p>/);
  assert.equal(body.match(/>Start practice<\/button>/g).length, 2, 'the notice has its own button');
  app.engine.start(ws, { kind: 'practice' });
  assert.doesNotMatch(await (await get(`/clubs/${ws}/sessions`)).text(), /A car crossed the line/);
});
