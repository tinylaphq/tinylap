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
  const started = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['roster', b.id], ['duration', '2'], ['countdown', '0']]);
  assert.equal(started.status, 303);
  assert.equal(started.headers.get('location'), `${base}/board`);
  const session = app.store.activeSession(office.id);
  assert.deepEqual([session.kind, session.durationMs, session.roster], ['race', 120_000, [a.id, b.id]]);

  const running = await (await get(`${base}/race`)).text();
  assert.match(running, /<h2[^>]*>Race<\/h2>/);
  assert.match(running, new RegExp(`<a[^>]*href="${base}/sessions/${session.id}/abort"`));
  assert.doesNotMatch(running, /<form[^>]*action="\/clubs/, 'abort needs the confirmation page first');

  const again = await app.form(member, `${base}/sessions`, [['kind', 'race'], ['roster', a.id], ['duration', '2'], ['countdown', '0']]);
  assert.equal(again.status, 409);
  const conflict = await again.text();
  assert.match(conflict, /<p class="status status-error" role="alert">A qualifying or race is already running here\.<\/p>/);

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
  const session = app.store.activeSession(office.id);
  assert.equal(session.state, 'countdown');
  await app.form(member, `${base}/sessions/${app.store.activeSession(office.id).id}/abort`, {});
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
