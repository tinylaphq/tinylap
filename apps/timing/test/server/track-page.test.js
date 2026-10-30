// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A track's page (named tracks spec §3.4, §4): its name, its layouts drawn,
// newest first, with who attached them, and its records per direction, each
// naming the layout it was driven on.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '@tinylap/track-format';
import { startTiming } from './helpers.js';
import { closed, other } from './planner-stub.js';

const T0 = 1_000_000_000_000; // 2001-09-09T01:46:40Z
const clock = { now: T0 };
let app;
let member;
let ws;
let base;
let elsewhere;

/** A layout entry for the store, attached at T0 + `t` by `by`. */
const attach = (track, layout, t, by) => app.store.attachLayout(ws, track, {
  plannerId: layout.track.id, shape: layout.track.shape, snapshotKey: `${t}`.padStart(22, 'k'), layout: canonicalJson(layout),
}, { userId: by && `u-${by}`, name: by, at: T0 + t });
/** A passing of transponder 10 at server time T0 + `t`. */
const pass = (t) => {
  clock.now = T0 + t;
  app.engine.ingest({ workspaceId: ws, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '10', t }] } });
};

before(async () => {
  app = await startTiming({ clock });
  const ana = await app.signUp('Ana');
  const club = app.club(ana, 'Tracks');
  ws = club.id;
  base = `/clubs/${ws}`;
  elsewhere = app.club(ana, 'Elsewhere');
  member = await app.login(ana);
  await app.form(member, `${base}/drivers`, { name: 'Ana' });
  app.engine.assign(ws, '10', app.store.drivers(ws)[0].id);

  app.store.addTrack(ws, { id: 'office', name: 'Office' });
  app.store.addTrack(ws, { id: 'bare', name: 'Bare' });
  app.store.setCurrentTrack(ws, 'office', 'ccw');
  app.engine.start(ws, { kind: 'practice' });
  // 10.000 before any layout, 9.500 on the first, 9.400 on the second.
  pass(1000);
  pass(11_000);
  attach('office', closed, 15_000, 'Ann');
  pass(20_500);
  attach('office', other, 25_000, 'Ben');
  pass(29_900);
  app.store.forgetUser('u-Ann');
  app.store.addTrack(elsewhere.id, { id: 'theirs', name: 'Theirs' });
});
after(() => app.close());

const get = (path, who = member) => app.api(who, 'GET', path, undefined, { accept: 'text/html' });

test('a track with layouts shows them all drawn, newest first, with who attached them', async () => {
  const res = await get(`${base}/tracks/office`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<h1>Office<\/h1>/);
  assert.equal(body.match(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/g)?.length, 2, 'both layouts are drawn');
  const ben = body.indexOf('by Ben');
  const former = body.indexOf('by former member');
  assert.ok(ben > 0 && former > ben, 'the newest first; a forgotten member is a former member');
  assert.match(body, new RegExp(`id="layout-${T0 + 25_000}"`));
  assert.match(body, new RegExp(`id="layout-${T0 + 15_000}"`));
  assert.match(body, /<script type="module" src="\/pkg\/design\/elements\/local-time.js"><\/script>/);
  // Looked back on years later: every date has its year, a layout its time too.
  assert.match(body, /Since <tl-local-time format="datetime-year"><time [^>]*>9 Sep 2001, 01:47<\/time><\/tl-local-time>, by Ben/);
  assert.match(body, /<tl-local-time format="datetime-year"><time [^>]*>9 Sep 2001, 01:46<\/time><\/tl-local-time>, by former member/);
  assert.doesNotMatch(body, /format="(date|datetime)"/);
});

test('a layout from a member whose name was unknown says "a member", not "former member"', async () => {
  app.store.addTrack(ws, { id: 'nameless', name: 'Nameless' });
  app.store.attachLayout(ws, 'nameless', {
    plannerId: closed.track.id, shape: closed.track.shape, snapshotKey: 'n'.repeat(22), layout: canonicalJson(closed),
  }, { userId: 'u-quiet', name: null, at: T0 + 30_000 });
  const body = await (await get(`${base}/tracks/nameless`)).text();
  assert.match(body, /<\/tl-local-time>, by a member<\/figcaption>/);
  assert.doesNotMatch(body, /former member/);
});

test('each record names the layout it was driven on, or none', async () => {
  const body = await (await get(`${base}/tracks/office`)).text();
  const ccw = /<section[^>]*aria-labelledby="records-ccw"[\s\S]*?<\/section>/.exec(body)?.[0] ?? '';
  assert.match(ccw, /<h3 id="records-ccw">Anticlockwise<\/h3>/);
  const rows = [...ccw.matchAll(/<tr[^>]*>\s*<td class="num">(\d+\.\d{3})[\s\S]*?<\/tr>/g)];
  assert.deepEqual(rows.map((m) => m[1]), ['9.400', '9.500', '10.000']);
  assert.match(rows[0][0], new RegExp(`<a href="#layout-${T0 + 25_000}">`));
  assert.match(rows[1][0], new RegExp(`<a href="#layout-${T0 + 15_000}">`));
  assert.doesNotMatch(rows[2][0], /#layout-/);
  const cw = /<section[^>]*aria-labelledby="records-cw"[\s\S]*?<\/section>/.exec(body)?.[0] ?? '';
  assert.match(cw, /<h3 id="records-cw">Clockwise<\/h3>/);
  assert.match(cw, /No record yet\./);
});

test('a track without a layout says so', async () => {
  const body = await (await get(`${base}/tracks/bare`)).text();
  assert.match(body, /<h1>Bare<\/h1>/);
  assert.match(body, /No layout/);
  assert.doesNotMatch(body, /<svg xmlns/);
});

test('an archived track without a layout sends nobody to Setup to attach one', async () => {
  assert.match(await (await get(`${base}/tracks/bare`)).text(), /No layout\. Attach one in <a href="[^"]*\/setup#track">Setup<\/a>\./);
  app.store.addTrack(ws, { id: 'old', name: 'Old' });
  app.store.setArchived(ws, 'old', T0);
  const body = await (await get(`${base}/tracks/old`)).text();
  assert.match(body, /<p class="empty">No layout\.<\/p>/);
  assert.doesNotMatch(body, /Attach one/);
});

test('an unknown track, or another club\'s, is a 404', async () => {
  assert.equal((await get(`${base}/tracks/nope`)).status, 404);
  assert.equal((await get(`${base}/tracks/theirs`)).status, 404);
});

test('signed out, the track page goes to sign-in', async () => {
  const res = await get(`${base}/tracks/office`, null);
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/auth\/login\?returnTo=/);
});

test('the records page links to the track page and names each record\'s layout', async () => {
  const body = await (await get(`${base}/records`)).text();
  assert.match(body, new RegExp(`<a href="${base}/tracks/office">Office</a>, anticlockwise`));
  assert.match(body, new RegExp(`<a href="${base}/tracks/office#layout-${T0 + 25_000}"><tl-local-time format="datetime-year">`));
  assert.match(body, /<th scope="col" class="records-wide">Layout<\/th>/, 'a phone lets it go');
});

test('the records page has no Layout column for a track without layouts', async () => {
  app.engine.end(ws, app.store.runningSession(ws).id);
  app.store.setCurrentTrack(ws, 'bare', 'ccw');
  app.engine.start(ws, { kind: 'practice' });
  pass(40_000);
  pass(50_000);
  const body = await (await get(`${base}/records`)).text();
  assert.match(body, /10\.000/);
  assert.doesNotMatch(body, />Layout</);
});
