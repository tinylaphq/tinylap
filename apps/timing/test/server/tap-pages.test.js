// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let office;
let base;
let ana;

before(async () => {
  app = await startTiming({ clock });
  const user = await app.signUp('Ana');
  office = app.club(user, 'Office');
  member = await app.login(user);
  base = `/clubs/${office.id}`;
  await app.form(member, `${base}/drivers`, { name: 'Ana' });
  [ana] = app.store.drivers(office.id);
});
after(() => app.close());

const get = (path) => app.api(member, 'GET', path, undefined, { accept: 'text/html' });

test('a tile per driver, each its own form', async () => {
  const body = await (await get(`${base}/tap`)).text();
  assert.match(body, new RegExp(`<form method="post" action="${base}/tap" class="tap-form">\\s*<input type="hidden" name="driver" value="${ana.id}">\\s*<button type="submit" class="tap-tile"[^>]*>Ana</button>`));
  assert.match(body, /<script type="module" src="\/public\/elements\/tap.js"><\/script>/);
});

/** `s` as a regex that matches it exactly. */
const exact = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));

test('the tap page wraps its screen in tl-tap, with the three templates', async () => {
  const body = await (await get(`${base}/tap`)).text();
  assert.match(body, /<tl-tap>\s*<div class="tap-screen">/);
  assert.match(body, exact('<template data-tap="result"><span class="tap-state"></span> <span class="tap-text"></span></template>'));
  assert.match(body, exact('<template data-tap="alert"><p class="status status-error" role="alert"><span class="tap-state">Failed</span> <span class="tap-text"></span></p></template>'));
  const withQuery = await (await get(`${base}/tap?driver=${ana.id}&result=started`)).text();
  assert.match(withQuery, exact(`<template data-tap="signed-out"><a href="${base}/tap?driver=${ana.id}&amp;result=started">Sign in again</a> to keep tapping.</template>`));
});

test('the 422 page with tiles has tl-tap and its script', async () => {
  const body = await (await app.form(member, `${base}/tap`, { driver: 'nobody' })).text();
  assert.match(body, /<tl-tap>/);
  assert.match(body, /\/public\/elements\/tap.js/);
});

test('a tap is a post and a redirect that says what it did', async () => {
  let res = await app.form(member, `${base}/tap`, { driver: ana.id });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/tap?driver=${ana.id}&result=started`);
  assert.match(await (await get(res.headers.get('location'))).text(), /role="status"[^>]*>\s*<span class="tap-state">Started<\/span>\s*<span class="tap-text">Ana: started<\/span>/);
  clock.now += 8412;
  res = await app.form(member, `${base}/tap`, { driver: ana.id });
  assert.equal(res.headers.get('location'), `${base}/tap?driver=${ana.id}&result=lap&ms=8412`);
  assert.match(await (await get(res.headers.get('location'))).text(), /<span class="tap-text">Ana: 8\.412<\/span>/);
  res = await app.form(member, `${base}/tap`, { driver: ana.id });
  assert.equal(res.headers.get('location'), `${base}/tap?driver=${ana.id}&result=again`, 'the same millisecond');
  const again = await (await get(res.headers.get('location'))).text();
  assert.match(again, /Too fast, tap again\./);
  assert.match(again, /aria-live="polite"/);
});

test('a forged query shows no result line', async () => {
  for (const query of [`driver=nobody&result=lap&ms=5`, `driver=${ana.id}&result=bogus`, `driver=${ana.id}&result=lap&ms=abc`, `driver=${ana.id}&result=lap&ms=-5`, `driver=${ana.id}&result=lap`, `driver=${ana.id}&result=lap&ms=1234567890`, 'driver=%3Cscript%3Ealert(1)%3C/script%3E&result=started']) {
    const body = await (await get(`${base}/tap?${query}`)).text();
    assert.match(body, /Tap a driver as their car crosses the line\./, query);
    const bar = /<div class="tap-bar"[\s\S]*?<\/p><\/div>/.exec(body)[0];
    assert.doesNotMatch(bar, /tap-state/, query);
    assert.doesNotMatch(body, /<script>alert/, query);
  }
  const body = await (await get(`${base}/tap?driver=${ana.id}&result=started&ms=99`)).text();
  assert.match(body, /Ana: started/);
  assert.doesNotMatch(body, /0\.099/, 'ms is dropped for other results');
});

test('asked for JSON, the same post answers in place', async () => {
  clock.now += 9000;
  const res = await app.form(member, `${base}/tap`, { driver: ana.id }, { accept: 'application/json' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { stored: true, lapMs: 9000, text: 'Ana: 9.000' });
});

test('a failed tap comes back as the page with an alert, status 422', async () => {
  const bad = await app.form(member, `${base}/tap`, { driver: 'nobody' });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /<div id="tap-alert"><p class="status status-error" role="alert">/);
  const asJson = await app.form(member, `${base}/tap`, { driver: 'nobody' }, { accept: 'application/json' });
  assert.equal(asJson.status, 422);
  assert.match((await asJson.json()).error, /driver/);
});

test('a rate-limited tap is a 429 with Retry-After, as a page and as JSON', async () => {
  const limited = await startTiming({ clock, limits: { tap: 1 } });
  try {
    const user = await limited.signUp('Lim');
    const club = limited.club(user, 'Lim club');
    const login = await limited.login(user);
    const path = `/clubs/${club.id}`;
    await limited.form(login, `${path}/drivers`, { name: 'Lim' });
    const [lim] = limited.store.drivers(club.id);
    assert.equal((await limited.form(login, `${path}/tap`, { driver: lim.id })).status, 303);
    const html = await limited.form(login, `${path}/tap`, { driver: lim.id });
    assert.equal(html.status, 429);
    assert.ok(Number(html.headers.get('retry-after')) > 0);
    assert.match(await html.text(), /role="alert"[^>]*>[\s\S]*?Try again in \d+ seconds/);
    const asJson = await limited.form(login, `${path}/tap`, { driver: lim.id }, { accept: 'application/json' });
    assert.equal(asJson.status, 429);
    assert.ok(Number(asJson.headers.get('retry-after')) > 0);
    assert.match((await asJson.json()).error, /Try again in/);
  } finally { await limited.close(); }
});

test('without drivers: a link to Setup and no tiles', async () => {
  const solo = await app.signUp('Solo');
  const login = await app.login(solo);
  const body = await (await app.api(login, 'GET', '/personal/tap', undefined, { accept: 'text/html' })).text();
  assert.match(body, /href="\/personal\/setup#drivers"/);
  assert.doesNotMatch(body, /tap-tile/);
  assert.doesNotMatch(body, /<tl-tap>/);
  assert.doesNotMatch(body, /\/public\/elements\/tap.js/);
});
