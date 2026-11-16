// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's Start panel (board hub spec §5, §4.1, §10): one form, outside
// #board-live, the only place to start a session; each kind with its own
// fields, shown and hidden without script; POST then 303 to the board, 422
// back as the board with the input kept; the noscript refresh only while a
// session runs.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';
import { events, next } from './sse.js';

const clock = { now: 1_000_000_000_000 };
let app;
/** The owner of the test's club, signed in: each test makes its own. */
let member;

before(async () => {
  app = await startTiming({ clock });
});
after(() => app.close());

const get = (path, headers = {}) => app.api(member, 'GET', path, undefined, { accept: 'text/html', ...headers });
/** A club of its own, owned by `member` from now on, with drivers by name, each with a transponder. */
async function clubWith(name, drivers = []) {
  const owner = await app.signUp(name);
  const club = app.club(owner, name);
  member = await app.login(owner);
  const base = `/clubs/${club.id}`;
  for (const d of drivers) await app.form(member, `${base}/drivers`, { name: d });
  const ids = Object.fromEntries(app.store.drivers(club.id).map((d) => [d.name, d.id]));
  drivers.forEach((d, i) => app.engine.assign(club.id, String(20 + i), ids[d]));
  return { ws: club.id, base, ids };
}
/** The panel's markup on a page. */
const panelOf = (body) => body.match(/<aside id="board-start"[\s\S]*?<\/aside>/)?.[0] ?? null;
/** The checked kind. */
const checkedKind = (panel) => panel.match(/<input type="radio" name="kind" value="(\w+)"(?: id="start-kind")? checked>/)?.[1] ?? null;
/** A part's tag with `data-for="<kind>"`, as one string. */
const partOf = (panel, kind, cls) => panel.match(new RegExp(`<[a-z]+ class="${cls}" data-for="${kind}"[^>]*>`))?.[0] ?? null;

test('the idle board has one Start panel, outside #board-live: the kinds in night order, the last kind checked', async () => {
  const { base } = await clubWith('Panel', ['Ana', 'Ben']);
  const body = await (await get(`${base}/board`)).text();
  const live = body.indexOf('<div id="board-live"');
  const start = body.indexOf('<aside id="board-start"');
  assert.ok(live > -1 && start > live, 'the panel follows the live region');
  assert.ok(!body.slice(live, start).includes('class="start-panel"'), 'not inside #board-live');
  const panel = panelOf(body);
  assert.match(panel, /<h2 id="start-title"[^>]*>Start<\/h2>/);
  assert.match(panel, new RegExp(`<form method="post" action="${base}/sessions" class="start-panel" aria-labelledby="start-title">`));
  assert.deepEqual([...panel.matchAll(/name="kind" value="(\w+)"/g)].map((m) => m[1]), ['practice', 'qualifying', 'race']);
  assert.equal(checkedKind(panel), 'practice', 'never driven: Practice');
  assert.equal((body.match(/action="[^"]*\/sessions"/g) ?? []).length, 1, 'one start form on the board');
  // Practice chosen: the other kinds' settings, words and hints are off; Practice's on.
  assert.match(partOf(panel, 'qualifying', 'start-settings'), /data-off/);
  assert.match(partOf(panel, 'race', 'start-settings'), /data-off/);
  assert.doesNotMatch(partOf(panel, 'practice', 'start-hint'), /data-off/);
  assert.match(panel, /<button type="submit" class="btn btn-primary start-go">Start <span data-for="practice">practice<\/span><span data-for="qualifying" data-off>qualifying<\/span><span data-for="race" data-off>race<\/span><\/button>/);
  assert.match(panel, /Runs until you end it, timing every car with a driver\./);
  assert.match(panel, /Ranked by each driver’s best lap\./, 'no qualifying yet: what it does');
  assert.match(panel, /Counts down, then runs for its length\./, 'no race yet: what it does');
  assert.doesNotMatch(panel, /\shidden[\s>]/, 'not `hidden`, which CSS cannot undo');
});

test('each kind has its own fields, the drivers two choices, the roster under Chosen drivers', async () => {
  const { base, ids } = await clubWith('Fields', ['Ana', 'Ben']);
  const panel = panelOf(await (await get(`${base}/board`)).text());
  for (const kind of ['qualifying', 'race']) {
    assert.match(panel, new RegExp(`<input type="radio" name="${kind}-drivers" value="everyone" id="${kind}-drivers" checked>`));
    assert.match(panel, /<strong>Everyone on the track<\/strong><small>Whoever’s car crosses the line\.<\/small>/);
    assert.match(panel, new RegExp(`<input type="radio" name="${kind}-drivers" value="chosen">`));
    assert.match(panel, new RegExp(`<div class="choices start-roster" data-off>[\\s\\S]*?name="${kind}-roster" value="${ids.Ana}"[^>]* checked`), 'every driver ticked, hidden while Everyone');
    assert.match(panel, new RegExp(`<input type="number" id="${kind}-minutes" name="${kind}-minutes" value="5" required min="1" max="60" inputmode="numeric">`));
  }
  assert.match(panel, /<small>Only their laps count\.<\/small>/);
  assert.match(panel, /<small>Only their laps count\. The race waits for each of them\.<\/small>/);
  assert.match(panel, /<input type="number" id="race-countdown" name="race-countdown" value="10" min="0" max="30" inputmode="numeric">/);
  assert.doesNotMatch(panel, /qualifying-countdown/);
  assert.match(panel, /<span class="input-unit-word">min<\/span>/);
  assert.match(panel, /<span class="input-unit-word">s<\/span>/);
});

test('defaults come from the last session of each kind, and the last session\'s kind is checked', async () => {
  const { ws, base, ids } = await clubWith('Defaults', ['Ana', 'Ben', 'Cy']);
  const race = app.engine.start(ws, { kind: 'race', roster: [ids.Ana, ids.Ben], durationMs: 180_000, countdownMs: 5000 });
  app.engine.abort(ws, race.session.id);
  const quali = app.engine.start(ws, { kind: 'qualifying', roster: null, durationMs: 420_000, countdownMs: 0 });
  app.engine.abort(ws, quali.session.id);
  const panel = panelOf(await (await get(`${base}/board`)).text());
  assert.equal(checkedKind(panel), 'qualifying');
  assert.match(panel, /name="qualifying-minutes" value="7"/);
  assert.match(panel, /name="qualifying-drivers" value="everyone" id="qualifying-drivers" checked/);
  assert.match(panel, /name="race-minutes" value="3"/);
  assert.match(panel, /name="race-countdown" value="5"/);
  assert.match(panel, /name="race-drivers" value="chosen" checked/);
  assert.match(panel, new RegExp(`name="race-roster" value="${ids.Cy}">`), 'Cy was not in the last race');
  assert.match(panel, /<div class="choices start-roster">[\s\S]*?name="race-roster"/, 'the race\'s roster open');
  assert.match(panel, /Same drivers and length as the last qualifying\./);
  assert.match(panel, /Same drivers, length and countdown as the last race\./);
  assert.match(panel, /<span data-for="qualifying">qualifying<\/span>/);
});

test('a race from the panel: POST, then 303 to the board, with only the race\'s fields read', async () => {
  const { ws, base, ids } = await clubWith('Race', ['Ana', 'Ben']);
  const res = await app.form(member, `${base}/sessions`, [
    ['kind', 'race'], ['race-drivers', 'chosen'], ['race-roster', ids.Ben], ['race-minutes', '2'], ['race-countdown', '0'],
    ['qualifying-drivers', 'nonsense'], ['qualifying-minutes', '999'],
  ]);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/board`);
  const session = app.store.runningSession(ws);
  assert.equal(session.kind, 'race');
  assert.deepEqual(session.roster, [ids.Ben]);
  assert.equal(session.durationMs, 120_000);
  app.engine.abort(ws, session.id);
  const everyone = await app.form(member, `${base}/sessions`, [['kind', 'qualifying'], ['qualifying-drivers', 'everyone'], ['qualifying-roster', ids.Ana], ['qualifying-minutes', '']]);
  assert.equal(everyone.status, 303);
  assert.equal(app.store.runningSession(ws).roster, null, 'Everyone on the track: no roster');
  app.engine.abort(ws, app.store.runningSession(ws).id);
});

test('a failed start is the board again, 422, with the error at its field and the input kept', async () => {
  const { ws, base, ids } = await clubWith('Bad', ['Ana', 'Ben']);
  const res = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['race-drivers', 'chosen'], ['race-roster', ids.Ben], ['race-minutes', '90'], ['race-countdown', '45']]);
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /<div id="board-live"/, 'the board');
  const panel = panelOf(body);
  assert.equal(checkedKind(panel), 'race', 'the kind sent stays checked');
  assert.match(panel, /<input type="number" id="race-minutes" name="race-minutes" value="90"[^>]* aria-invalid="true" aria-describedby="race-minutes-error">/);
  assert.match(panel, /<p class="field-error" id="race-minutes-error">A session lasts 1 to 60 minutes\.<\/p>/);
  assert.match(panel, /<input type="number" id="race-countdown" name="race-countdown" value="45"[^>]* aria-invalid="true"/);
  assert.match(panel, /name="race-drivers" value="chosen" checked/);
  assert.match(panel, new RegExp(`name="race-roster" value="${ids.Ben}" checked`));
  assert.match(panel, new RegExp(`name="race-roster" value="${ids.Ana}" id="race-roster">`), 'Ana was not ticked');
  assert.match(panel, /<div class="status status-error cut-words" role="alert"><ul class="error-list"><li><a href="#race-minutes">/, 'one summary, linking to the fields');
  assert.equal(app.store.runningSession(ws), null);
  const none = await app.form(member, `${base}/sessions`, [['kind', 'qualifying'], ['qualifying-drivers', 'chosen']]);
  assert.equal(none.status, 422);
  assert.match(panelOf(await none.text()), /id="qualifying-roster-error">Pick 1 to/);
});

test('starting while a session runs asks first, and the confirmation sends the same fields', async () => {
  const { ws, base, ids } = await clubWith('Replace', ['Ana']);
  await app.form(member, `${base}/sessions`, [['kind', 'practice']]);
  const running = app.store.runningSession(ws);
  clock.now += 60_000;
  const ask = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['race-drivers', 'chosen'], ['race-roster', ids.Ana], ['race-minutes', '3'], ['race-countdown', '0']]);
  assert.equal(ask.status, 200);
  const text = await ask.text();
  assert.match(text, /Starting this race ends it\./);
  assert.match(text, new RegExp(`<a class="btn btn-outline" href="${base}/board">`), 'Back goes to the board');
  const fields = [...text.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(fields, [['kind', 'race'], ['race-drivers', 'chosen'], ['race-roster', ids.Ana], ['race-minutes', '3'], ['race-countdown', '0'], ['replace', running.id]]);
  const confirmed = await app.form(member, `${base}/sessions`, fields);
  assert.equal(confirmed.status, 303);
  assert.equal(app.store.runningSession(ws).kind, 'race');
  app.engine.abort(ws, app.store.runningSession(ws).id);
});

test('the noscript refresh only while a session runs, and no panel then', async () => {
  const { ws, base } = await clubWith('Refresh', ['Ana']);
  const idle = await (await get(`${base}/board`)).text();
  assert.doesNotMatch(idle, /http-equiv="refresh"/, 'idle: a refresh would reload the form away');
  const { session } = app.engine.start(ws, { kind: 'practice' });
  const running = await (await get(`${base}/board`)).text();
  assert.match(running, /<noscript><meta http-equiv="refresh" content="10"><\/noscript>/);
  assert.match(running, /<aside id="board-start" class="board-next" data-key="run [^"]+" hidden><\/aside>/, 'an empty slot the stream fills when it ends');
  assert.doesNotMatch(running, /start-panel/);
  app.engine.end(ws, session.id);
});

test('a club with no drivers sees its first steps in the panel\'s place', async () => {
  const { base } = await clubWith('Empty');
  const panel = panelOf(await (await get(`${base}/board`)).text());
  assert.doesNotMatch(panel, /<form/);
  assert.match(panel, new RegExp(`<a class="btn btn-primary" href="${base}/setup#drivers">Add drivers</a>\\s*<a class="btn btn-outline" href="${base}/bridge">Connect the decoder</a>`));
});

test('a car on the track is the reason to press Start: its line sits in the panel above the button', async () => {
  const { ws, base } = await clubWith('Track', ['Ana']);
  app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '20', t: clock.now }] } });
  const body = await (await get(`${base}/board`)).text();
  const panel = panelOf(body);
  assert.match(panel, /<div class="start-on-track" id="start-on-track"><p class="board-on-track" role="status"><span><span class="driver"[^>]*><span class="driver-name" title="Ana">Ana<\/span><\/span> is on the track<\/span><\/p><\/div>\s*<button type="submit"/);
  assert.equal((body.match(/is on the track<\/span>/g) ?? []).length, 1, 'once, in the panel');
});

test('the TV and the watchers\' link get no panel', async () => {
  const { base } = await clubWith('Tv', ['Ana']);
  assert.doesNotMatch(await (await get(`${base}/board?big`)).text(), /board-start|start-panel/);
  await app.form(member, `${base}/watch-link`, {});
  const token = app.store.workspace(base.split('/')[2]).watchToken;
  assert.doesNotMatch(await (await fetch(`${app.base}/watch/${token}`, { headers: { accept: 'text/html' } })).text(), /board-start|start-panel/);
});

test('the stream sends the panel beside #board-live, keyed so a page replaces it only when a session starts or ends', async () => {
  const { ws, base } = await clubWith('Stream', ['Ana']);
  const res = await app.api(member, 'GET', `${base}/board/events`);
  const it = events(res, { raw: true });
  const first = await next(it, 'board');
  assert.match(first.data, /^<div id="board-live"[\s\S]*<\/div>\n<aside id="board-start" class="board-next" data-key="idle" aria-labelledby="start-title">/);
  const { session } = app.engine.start(ws, { kind: 'practice' });
  const running = await next(it, 'board');
  assert.match(running.data, new RegExp(`<aside id="board-start" class="board-next" data-key="run ${session.id}" hidden></aside>`));
  await it.return();
  app.engine.end(ws, session.id);
  // The TV's stream has no panel.
  const tv = events(await app.api(member, 'GET', `${base}/board/events?big`), { raw: true });
  assert.doesNotMatch((await next(tv, 'board')).data, /board-start/);
  await tv.return();
});

test('the Sessions page has no start form: the board is the only place to start', async () => {
  const { base } = await clubWith('History', ['Ana']);
  const body = await (await get(`${base}/sessions`)).text();
  assert.doesNotMatch(body, /method="post" action="[^"]*\/sessions"/);
  assert.doesNotMatch(body, /Start practice|Qualifying or race|start-title/);
});
