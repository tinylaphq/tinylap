// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let member;
let office;
let base;

before(async () => {
  app = await startTiming();
  const ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  member = await app.login(ana);
  base = `/clubs/${office.id}`;
});
after(() => app.close());

const get = (path) => app.api(member, 'GET', path, undefined, { accept: 'text/html' });

test('without drivers, race control points to Setup', async () => {
  const body = await (await get(`${base}/race`)).text();
  assert.match(body, /<h1>Race control<\/h1>/);
  assert.match(body, new RegExp(`<a[^>]*href="${base}/setup#drivers"`));
  assert.doesNotMatch(body, /<form[^>]*action="\/clubs/, 'no start form without drivers');
});

test('start a race from the form, then abort it after confirming', async () => {
  for (const name of ['Ana', 'Ben']) await app.form(member, `${base}/drivers`, { name });
  const [a, b] = app.store.drivers(office.id);
  const form = await (await get(`${base}/race`)).text();
  assert.match(form, /<input type="radio" name="kind" value="race"[^>]* checked/);
  assert.match(form, new RegExp(`<input type="checkbox" name="roster" value="${a.id}"[^>]* checked`));
  assert.doesNotMatch(form, /tl-countdown|countdown\.js/, 'the start form has no clock');
  const started = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['roster', b.id], ['duration', '2'], ['countdown', '0']]);
  assert.equal(started.status, 303);
  assert.equal(started.headers.get('location'), `${base}/board`);
  const session = app.store.runningSession(office.id);
  assert.deepEqual([session.kind, session.durationMs, session.roster], ['race', 120_000, [a.id, b.id]]);

  const running = await (await get(`${base}/race`)).text();
  assert.match(running, /<h2[^>]*>Race, running<\/h2>/);
  assert.match(running, new RegExp(`<a[^>]*href="${base}/sessions/${session.id}/abort"`));
  assert.doesNotMatch(running, /<form[^>]*action="\/clubs/, 'abort needs the confirmation page first');
  assert.match(running, /<tl-countdown class="race-clock" reload-on-phase><span class="stat-label" data-clock-label>Remaining<\/span> <time class="race-clock-time" data-clock data-kind="race" data-state="running" data-opens="\d+" data-closes="\d+" data-now="\d+">\d+:\d\d<\/time><\/tl-countdown>/);
  assert.match(running, /<script type="module" src="\/public\/elements\/countdown.js"><\/script>/);

  const again = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', '2'], ['countdown', '0']]);
  assert.equal(again.status, 409);
  const conflict = await again.text();
  assert.match(conflict, /<p class="status status-error" role="alert">A race is already running here\.<\/p>/);
  assert.match(conflict, /<tl-countdown class="race-clock">/, 'the answer to a POST never reloads');

  const ask = await get(`${base}/sessions/${session.id}/abort`);
  assert.equal(ask.status, 200);
  const confirm = await ask.text();
  assert.match(confirm, /Abort the race\?/);
  assert.match(confirm, new RegExp(`<form method="post" action="${base}/sessions/${session.id}/abort"`));
  assert.equal(app.store.session(session.id).state === 'aborted', false, 'asking does not abort');

  const aborted = await app.form(member, `${base}/sessions/${session.id}/abort`, {});
  assert.equal(aborted.status, 303);
  assert.equal(aborted.headers.get('location'), `${base}/race`);
  assert.equal(app.store.session(session.id).state, 'aborted');

  const gone = await app.form(member, `${base}/sessions/${session.id}/abort`, {});
  assert.equal(gone.status, 404);
  assert.match(await gone.text(), /role="alert"/);
  assert.equal((await get(`${base}/sessions/${session.id}/abort`)).status, 404);
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
  const body = await (await get(`${base}/race`)).text();
  assert.match(body, /<h2[^>]*>Qualifying, running<\/h2>/);
  assert.match(body, /Ana, Ben\. 3 minutes\./);
  await app.form(member, `${base}/sessions/${app.store.runningSession(office.id).id}/abort`, {});
});

test('a session of 30 seconds, started through the API, does not read as a minute', async () => {
  const [a] = app.store.drivers(office.id);
  const started = await app.api(member, 'POST', `/workspaces/${office.id}/sessions`, { kind: 'qualifying', roster: [a.id], durationSeconds: 30 });
  assert.equal(started.status, 201);
  const body = await (await get(`${base}/race`)).text();
  assert.match(body, /\. 30 seconds\./);
  assert.doesNotMatch(body, /1 minute/);
  await app.form(member, `${base}/sessions/${app.store.runningSession(office.id).id}/abort`, {});
});
