// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A driver's page (drivers and transponders spec §3.5): avatar, name and colour,
// their transponders with a label and Remove, and their best laps here.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let ana;
let owner;
let office;
let pits;
let base;
let n = 0;

before(async () => {
  app = await startTiming();
  ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  pits = app.club(await app.signUp('Pia'), 'Pits');
  owner = await app.login(ana);
  base = `/clubs/${office.id}`;
  app.store.ensureWorkspace(office.id);
  app.store.ensureWorkspace(pits.id);
});
after(() => app.close());

const ws = () => office.id;
const get = (who, path) => app.api(who, 'GET', path, undefined, { accept: 'text/html' });
const row = (code) => app.store.transponders(ws()).find((t) => t.code === code);
const assign = (code, driverId) => app.store.assignTransponder(ws(), code, driverId, Date.now());

/** A driver of their own for each test. */
function driver(name, colour = '#00b3c7') {
  const id = `d${++n}`;
  app.store.addDriver(ws(), { id, name, colour });
  return id;
}

/** A practice session on the current track and direction, with counted laps `[transponder, driverId, lapMs, at]`. */
function laps(rows, { direction } = {}) {
  const w = app.store.workspace(ws());
  const id = `s${++n}`;
  app.store.addSession({ id, workspaceId: ws(), kind: 'practice', trackId: w.trackId, direction: direction ?? w.direction, roster: null, state: 'done', createdAt: 0, opensAt: 0, closesAt: null, endedAt: 1, durationMs: null });
  for (const [transponder, driverId, lapMs, at] of rows) {
    app.store.addCrossing({ workspaceId: ws(), sessionId: id, decoder: 'd1', boot: 'b00tb00t', transponder, t: ++n, driverId, at, lapMs, counts: true, ref: true, via: 'net', flag: null });
  }
}

const OCT_9 = Date.UTC(2026, 9, 9, 12);
const OCT_2 = Date.UTC(2026, 9, 2, 12);

test('the page: avatar, name, colour, each transponder with its label and Remove', async () => {
  const mia = driver('Mia Kraus');
  assign('923', mia);
  assign('931', mia);
  app.store.labelTransponder(ws(), '923', 'Red Losi');
  const res = await get(owner, `${base}/drivers/${mia}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<span class="avatar is-lg" style="--c: #00b3c7" aria-hidden="true">MK<\/span><h1[^>]*>Mia Kraus<\/h1>/);
  assert.match(body, new RegExp(`<form method="post" action="${base}/drivers/${mia}" class="card-static space-md">`));
  assert.match(body, /<input type="text" id="driver-name" name="name" value="Mia Kraus"/);
  assert.match(body, /<input type="color" id="driver-colour" name="colour" value="#00b3c7"/);
  assert.match(body, /<input type="text" id="label-923" name="label:923" value="Red Losi" maxlength="24"/);
  assert.match(body, /<input type="text" id="label-931" name="label:931" value="" maxlength="24"/);
  assert.match(body, /<button type="submit" form="remove-923" class="driver-remove">Remove<span class="visually-hidden"> transponder 923<\/span><\/button>/);
  assert.match(body, new RegExp(`<form id="remove-923" method="post" action="${base}/transponders/923/remove" hidden></form>`));
  assert.doesNotMatch(body, /Best laps here/, 'no laps, no best laps');
  assert.doesNotMatch(body, /style="margin/, 'no inline margins');
});

test('saving keeps renaming and saves the labels, then goes back to the page', async () => {
  const id = driver('Jonas');
  assign('941', id);
  assign('942', id);
  const res = await app.form(owner, `${base}/drivers/${id}`, { from: 'driver', name: 'Jonas B', colour: '#2bb673', 'label:941': '  Buggy ', 'label:942': '' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/drivers/${id}`);
  assert.deepEqual(app.store.driver(ws(), id), { id, name: 'Jonas B', colour: '#2bb673' });
  assert.equal(row('941').label, 'Buggy');
  assert.equal(row('942').label, null);
});

test('a label of spaces is no label', async () => {
  const id = driver('Haris');
  assign('951', id);
  app.store.labelTransponder(ws(), '951', 'Old');
  const res = await app.form(owner, `${base}/drivers/${id}`, { from: 'driver', name: 'Haris', colour: '#ff2d9b', 'label:951': '    ' });
  assert.equal(res.status, 303);
  assert.equal(row('951').label, null);
});

test('a label of 25 characters is refused on that field, everything typed kept and nothing saved', async () => {
  const id = driver('Simon', '#ff8a00');
  assign('961', id);
  assign('962', id);
  const long = 'x'.repeat(25);
  const res = await app.form(owner, `${base}/drivers/${id}`, { from: 'driver', name: 'Simon J', colour: '#ff8a00', 'label:961': 'Fine', 'label:962': long });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /<p class="status status-error cut-words" role="alert"><a href="#label-962">A label has at most 24 characters\.<\/a><\/p>/);
  assert.match(body, new RegExp(`<input type="text" id="label-962" name="label:962" value="${long}" maxlength="24" placeholder="Label" aria-invalid="true" aria-describedby="label-962-error">`));
  assert.match(body, /<p class="field-error" id="label-962-error">A label has at most 24 characters\.<\/p>/);
  assert.match(body, /id="label-961" name="label:961" value="Fine"/);
  assert.doesNotMatch(body, /id="label-961"[^>]*aria-invalid/);
  assert.match(body, /id="driver-name" name="name" value="Simon J"/);
  assert.equal(app.store.driver(ws(), id).name, 'Simon', 'nothing saved');
  assert.equal(row('961').label, null);
});

test('a bad colour is refused on the colour field, in palace\'s invalid look', async () => {
  const id = driver('Ida');
  const res = await app.form(owner, `${base}/drivers/${id}`, { from: 'driver', name: 'Ida', colour: 'red' });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /<input type="color" id="driver-colour" name="colour" value="#00b3c7" aria-invalid="true" aria-describedby="driver-colour-error">/);
  assert.match(body, /<a href="#driver-colour">Choose a colour with the swatch\.<\/a>/);
});

test('Setup\'s own driver row still renames and goes back to Setup', async () => {
  const id = driver('Eve');
  const res = await app.form(owner, `${base}/drivers/${id}`, { name: 'Eva', colour: '#123456' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/setup#drivers`);
  assert.equal(app.store.driver(ws(), id).name, 'Eva');
});

test('best laps: two labelled transponders give one line each, best first, with labels and dates', async () => {
  const id = driver('Lea');
  assign('971', id);
  assign('972', id);
  app.store.labelTransponder(ws(), '971', 'Red Losi');
  app.store.labelTransponder(ws(), '972', 'Buggy');
  const other = driver('Other');
  laps([['971', id, 7900, OCT_2], ['971', id, 7701, OCT_9], ['972', id, 7842, OCT_2], ['972', other, 6000, OCT_2]]);
  laps([['972', id, 5000, OCT_2]], { direction: app.store.workspace(ws()).direction === 'cw' ? 'ccw' : 'cw' });
  assert.deepEqual(app.store.bestLapsByTransponder(ws(), id, app.store.workspace(ws()).trackId, app.store.workspace(ws()).direction),
    [{ transponder: '971', label: 'Red Losi', lapMs: 7701, at: OCT_9 }, { transponder: '972', label: 'Buggy', lapMs: 7842, at: OCT_2 }]);
  const body = await (await get(owner, `${base}/drivers/${id}`)).text();
  const lines = [...body.matchAll(/<div><dt class="num">(?:<strong>)?([^<]*)(?:<\/strong>)?<\/dt><dd>(.*?)<\/dd><\/div>/g)].map((m) => [m[1], m[2].replace(/<[^>]*>/g, '')]);
  assert.deepEqual(lines, [['7.701', 'Red Losi 9 Oct'], ['7.842', 'Buggy 2 Oct']]);
  assert.match(body, /<h2 id="best-laps-title">Best laps here<\/h2>/);
});

test('best laps: with two labelled, an unlabelled or former transponder gets no line', async () => {
  const id = driver('Uma');
  assign('811', id);
  assign('812', id);
  assign('813', id);
  app.store.labelTransponder(ws(), '811', 'Red Losi');
  app.store.labelTransponder(ws(), '812', 'Buggy');
  laps([['811', id, 7701, OCT_9], ['812', id, 7842, OCT_2], ['813', id, 7000, OCT_2], ['814', id, 6900, OCT_2]]);
  const body = await (await get(owner, `${base}/drivers/${id}`)).text();
  const lines = [...body.matchAll(/<div><dt class="num">(?:<strong>)?([^<]*)(?:<\/strong>)?<\/dt><dd>(.*?)<\/dd><\/div>/g)].map((m) => [m[1], m[2].replace(/<[^>]*>/g, '')]);
  assert.deepEqual(lines, [['7.701', 'Red Losi 9 Oct'], ['7.842', 'Buggy 2 Oct']]);
});

test('Save follows the fields, and the best laps are a section after the form', async () => {
  const id = driver('Ben');
  assign('821', id);
  laps([['821', id, 8000, OCT_2]]);
  const body = await (await get(owner, `${base}/drivers/${id}`)).text();
  const start = body.indexOf(`<form method="post" action="${base}/drivers/${id}"`);
  const end = body.indexOf('</form>', start);
  assert.ok(start > 0);
  const form = body.slice(start, end);
  assert.match(form, /id="label-821"[\s\S]*>Save<\/button><\/div>\s*$/);
  assert.doesNotMatch(form, /Best laps here/);
  assert.match(body.slice(end), /^<\/form>\s*<section class="card-static space-sm" aria-labelledby="best-laps-title">/);
});

test('best laps: one transponder gives one line, without a label', async () => {
  const id = driver('Ole');
  assign('981', id);
  app.store.labelTransponder(ws(), '981', 'Truck');
  laps([['981', id, 8100, OCT_9], ['981', id, 8050, OCT_2]]);
  const body = await (await get(owner, `${base}/drivers/${id}`)).text();
  const lines = [...body.matchAll(/<div><dt class="num">(?:<strong>)?([^<]*)(?:<\/strong>)?<\/dt><dd>(.*?)<\/dd><\/div>/g)].map((m) => [m[1], m[2].replace(/<[^>]*>/g, '')]);
  assert.deepEqual(lines, [['8.050', '2 Oct']]);
});

test('Remove: the transponder goes back to Not assigned yet, its label gone, and back to the page', async () => {
  const id = driver('Rae');
  assign('991', id);
  app.store.labelTransponder(ws(), '991', 'Red');
  const res = await app.form(owner, `${base}/transponders/991/remove`, {});
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/drivers/${id}`);
  assert.equal(row('991').driverId, null);
  assert.equal(row('991').label, null);
  const page = await (await get(owner, `${base}/drivers/${id}`)).text();
  assert.doesNotMatch(page, /remove-991/);
  const unknown = await app.form(owner, `${base}/transponders/9999/remove`, {});
  assert.equal(unknown.status, 404);
  const back = await get(owner, `${base}/transponders/991/remove`);
  assert.equal(back.status, 303);
  assert.equal(back.headers.get('location'), `${base}/setup#transponders`);
});

test('members only: signed out signs in, another club or a driver not here is not found', async () => {
  const id = driver('Kai');
  const out = await get(null, `${base}/drivers/${id}`);
  assert.equal(out.status, 303);
  assert.match(out.headers.get('location'), /^\/auth\/login\?returnTo=/);
  assert.equal((await get(owner, `/clubs/${pits.id}/drivers/${id}`)).status, 404);
  assert.equal((await get(owner, `${base}/drivers/nobody`)).status, 404);
  assert.equal((await app.form(owner, `${base}/drivers/nobody`, { from: 'driver', name: 'X' })).status, 404);
  const theirs = `d${++n}`;
  app.store.addDriver(pits.id, { id: theirs, name: 'Pia', colour: '#123456' });
  assert.equal((await app.form(owner, `/clubs/${pits.id}/drivers/${theirs}`, { from: 'driver', name: 'Taken', colour: '#654321' })).status, 404);
  assert.equal(app.store.driver(pits.id, theirs).name, 'Pia', 'nothing saved');
  const removed = await app.form(null, `${base}/transponders/991/remove`, {});
  assert.equal(removed.status, 303);
  assert.match(removed.headers.get('location'), /^\/auth\/login/);
});
