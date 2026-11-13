// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The form "Whose transponder is 41?" (drivers and transponders spec §3.3, §3.4):
// each driver a submit button, a new driver by name, the move question, one POST
// and a 303 back to where it was opened from.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let ana;
let owner;
let office;
let base;

before(async () => {
  app = await startTiming();
  ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  owner = await app.login(ana);
  base = `/clubs/${office.id}`;
  app.store.ensureWorkspace(office.id);
  app.store.addDriver(office.id, { id: 'simon', name: 'Simon', colour: '#ff8a00' });
  app.store.addDriver(office.id, { id: 'mia', name: 'Mia Kraus', colour: '#00b3c7' });
});
after(() => app.close());

const get = (who, path) => app.api(who, 'GET', path, undefined, { accept: 'text/html' });
const ws = () => office.id;
const row = (code) => app.store.transponders(ws()).find((t) => t.code === code);
const assign = (code, driverId) => app.store.assignTransponder(ws(), code, driverId, Date.now());

test('the form: each driver a button with what they have, a new driver, and Not now', async () => {
  assign('17', 'simon');
  assign('23', 'mia');
  assign('31', 'mia');
  const res = await get(owner, `${base}/transponders/41?returnTo=${encodeURIComponent(`${base}/board`)}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<h1[^>]*>Whose transponder is <span class="assign-big">41<\/span>\?<\/h1>/);
  assert.match(body, new RegExp(`<form method="post" action="${base}/transponders/41"`));
  assert.match(body, /<p class="pick-group" id="assign-to">Assign it to<\/p>/);
  assert.match(body, /<button type="submit" name="driver" value="mia" class="pick-button"><span class="avatar is-sm" style="--c: #00b3c7" aria-hidden="true">MK<\/span><span class="visually-hidden">Assign to <\/span><span class="pick-name">Mia Kraus<\/span><span class="meta">has 23, 31<\/span><\/button>/);
  assert.match(body, /<button type="submit" name="driver" value="simon" class="pick-button">.*>S<\/span>.*<span class="meta">has 17<\/span><\/button>/);
  assert.match(body, /<label for="new-driver-name">Or a new driver<\/label>/);
  assert.match(body, /<input type="text" id="new-driver-name" name="name" value=""[^>]* form="new-driver"/);
  // The new driver is a form of its own, so Enter in the name submits it, not the first driver.
  assert.match(body, /<button type="submit" name="driver" value="" form="new-driver" class="btn btn-primary">Assign to a new driver<\/button>/);
  assert.match(body, new RegExp(`<form method="post" action="${base}/transponders/41" id="new-driver" hidden><input type="hidden" name="returnTo" value="${base}/board"></form>`));
  assert.match(body, new RegExp(`<input type="hidden" name="returnTo" value="${base}/board">`));
  assert.match(body, new RegExp(`<a href="${base}/board">Not now</a>`));
  assert.doesNotMatch(body, /type="radio"|name="label"/);
  assert.match(body, /<p class="subtitle pick-live crossing-now" data-code="41" hidden>It's on the track now\.<\/p>/);
  assert.doesNotMatch(body.replace(/<[^>]*>/g, ' '), /\bcode\b/i, 'no "code" on screen');
});

test('a transponder that crossed in the last 10 s is on the track now', async () => {
  app.store.seeTransponder(ws(), '52', Date.now() - 2000);
  app.store.insertPassing({ decoder: 'd1', boot: 'b', transponder: '52', t: 1, receivedAt: Date.now() - 2000, via: 'net', workspaceId: ws() });
  const body = await (await get(owner, `${base}/transponders/52`)).text();
  assert.match(body, /<p class="subtitle pick-live crossing-now" data-code="52">It's on the track now\.<\/p>/);
});

test('a number only typed in, just now, is not on the track: only a crossing or passing is', async () => {
  assign('5E', 'simon');
  await app.form(owner, `${base}/transponders/5E/remove`, { returnTo: `${base}/setup` });
  const body = await (await get(owner, `${base}/transponders/5E`)).text();
  assert.match(body, /<p class="subtitle pick-live crossing-now" data-code="5E" hidden>It's on the track now\.<\/p>/);
});

test('a number in another case or with leading zeros is the same transponder', async () => {
  app.store.seeTransponder(ws(), '0A', Date.now() - 60_000);
  for (const path of ['0a', '000A', '0A']) {
    const body = await (await get(owner, `${base}/transponders/${path}`)).text();
    assert.match(body, /Whose transponder is <span class="assign-big">0A<\/span>\?/, path);
    assert.match(body, new RegExp(`action="${base}/transponders/0A"`), path);
  }
  const res = await app.form(owner, `${base}/transponders/000a`, { driver: 'simon', name: '', returnTo: `${base}/board` });
  assert.equal(res.status, 303);
  assert.equal(row('0A').driverId, 'simon');
  assert.equal(app.store.transponders(ws()).filter((t) => /^0*A$/.test(t.code)).length, 1, 'one row');
});

test('a number that is not one is the not-found page', async () => {
  const res = await get(owner, `${base}/transponders/zz`);
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /hex|code/i);
});

test('choosing a driver assigns it and goes back to returnTo', async () => {
  const res = await app.form(owner, `${base}/transponders/64`, { driver: 'mia', name: '', returnTo: `${base}/board` });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/board`);
  assert.equal(row('64').driverId, 'mia');
});

test('a hostile returnTo goes back to Setup', async () => {
  for (const returnTo of ['//evil.example', 'https://evil.example', '/\\evil', 'javascript:alert(1)', '/a/..//evil.example']) {
    const res = await app.form(owner, `${base}/transponders/65`, { driver: 'mia', name: '', returnTo });
    assert.equal(res.status, 303, returnTo);
    assert.equal(res.headers.get('location'), `${base}/setup#transponders`, returnTo);
  }
});

test('a new driver by name', async () => {
  const res = await app.form(owner, `${base}/transponders/66`, { driver: '', name: 'Lena', returnTo: `${base}/board` });
  assert.equal(res.status, 303);
  const lena = app.store.drivers(ws()).find((d) => d.name === 'Lena');
  assert.ok(lena);
  assert.equal(row('66').driverId, lena.id);
});

test('a new driver with a blank name is a 422 on the name, the input kept', async () => {
  const before = app.store.drivers(ws()).length;
  const res = await app.form(owner, `${base}/transponders/67`, { driver: '', name: '   ', returnTo: `${base}/board` });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /<a href="#new-driver-name">Name the new driver\.<\/a>/);
  assert.match(body, /<input type="text" id="new-driver-name" name="name" value=" {3}"[^>]* aria-invalid="true"/);
  assert.match(body, new RegExp(`<input type="hidden" name="returnTo" value="${base}/board">`));
  assert.equal(app.store.drivers(ws()).length, before);
});

test('a driver deleted meanwhile is a 422, the form again, nothing assigned', async () => {
  app.store.addDriver(ws(), { id: 'gone', name: 'Gone', colour: '#2bb673' });
  app.store.deleteDriver(ws(), 'gone');
  const res = await app.form(owner, `${base}/transponders/68`, { driver: 'gone', name: '', returnTo: `${base}/board` });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /That driver is gone\./);
  assert.match(body, /Whose transponder is <span class="assign-big">68<\/span>\?/);
  assert.equal(row('68')?.driverId ?? null, null);
});

test('someone else’s asks first, then moves it', async () => {
  assign('17', 'simon');
  const ask = await app.form(owner, `${base}/transponders/17`, { driver: 'mia', name: '', returnTo: `${base}/board` });
  assert.equal(ask.status, 200);
  const body = await ask.text();
  assert.match(body, /Transponder 17 is Simon's\./);
  assert.match(body, /<button type="submit" class="btn btn-primary">Give it to Mia Kraus<\/button>/);
  assert.match(body, new RegExp(`<a class="btn btn-outline" href="${base}/board">Keep it with Simon</a>`));
  assert.match(body, /<input type="hidden" name="confirm" value="1">/);
  assert.match(body, /<input type="hidden" name="driver" value="mia">/);
  assert.equal(row('17').driverId, 'simon', 'nothing moved yet');
  const done = await app.form(owner, `${base}/transponders/17`, { driver: 'mia', name: '', confirm: '1', returnTo: `${base}/board` });
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), `${base}/board`);
  assert.equal(row('17').driverId, 'mia');
});

test('the same driver again asks nothing', async () => {
  assign('18', 'simon');
  const res = await app.form(owner, `${base}/transponders/18`, { driver: 'simon', name: '', returnTo: `${base}/board` });
  assert.equal(res.status, 303);
});

test('a returnTo outside ASCII is a 303 to it, percent-encoded', async () => {
  for (const [returnTo, location] of [[`${base}/€`, `${base}/%E2%82%AC`], [`${base}/ü`, `${base}/%C3%BC`]]) {
    const res = await app.form(owner, `${base}/transponders/70`, { driver: 'mia', name: '', returnTo });
    assert.equal(res.status, 303, returnTo);
    assert.equal(res.headers.get('location'), location);
  }
});

test('a member of another club gets the not-found page, and nothing is assigned', async () => {
  const ben = await app.signUp('Ben');
  app.club(ben, 'Pits');
  const outsider = await app.login(ben);
  assert.equal((await get(outsider, `${base}/transponders/71`)).status, 404);
  const post = await app.form(outsider, `${base}/transponders/71`, { driver: 'mia', name: '' });
  assert.equal(post.status, 404);
  assert.equal(row('71'), undefined);
});

test('signed out goes to sign-in, and a form changes nothing', async () => {
  const page = await get(null, `${base}/transponders/41`);
  assert.equal(page.status, 303);
  assert.match(page.headers.get('location'), /^\/auth\/login\?returnTo=/);
  const post = await app.form(null, `${base}/transponders/69`, { driver: 'mia', name: '' });
  assert.equal(post.status, 303);
  assert.match(post.headers.get('location'), /^\/auth\/login\?/);
  assert.equal(row('69'), undefined);
});
