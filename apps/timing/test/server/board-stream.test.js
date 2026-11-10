// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { removeMember } from '../../../accounts/server/workspaces.js';
import { startTiming } from './helpers.js';
import { events, next } from './sse.js';

let app;
let owner;
let office;
let base;
let ana;

before(async () => {
  app = await startTiming();
  ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  owner = await app.login(ana);
  base = `/clubs/${office.id}`;
  await app.form(owner, `${base}/drivers`, { name: '<b>Ben</b>' });
  app.engine.assign(office.id, '10', app.store.drivers(office.id)[0].id);
  app.engine.start(office.id, { kind: 'practice' });
});
after(() => app.close());

const pass = (t) => app.engine.ingest({ workspaceId: office.id, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '10', t }] } });

test('the board stream sends the rendered board now and after every change', async () => {
  const res = await app.api(owner, 'GET', `${base}/board/events`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  const it = events(res, { raw: true });
  const first = await next(it, 'board');
  assert.match(first.data, /^<div id="board-live"/);
  pass(1000);
  pass(9000);
  const later = await next(it, 'board');
  assert.match(later.data, /&lt;b&gt;Ben&lt;\/b&gt;/);
  assert.match(later.data, /8\.000/);
  await it.return();
});

test('a removed member gets the not-found page, not the stream', async () => {
  const cy = await app.signUp('Cy');
  app.join(ana, office.id, cy);
  removeMember(app.suite.accounts.db, ana.id, office.id, cy.id);
  const res = await app.api(await app.login(cy), 'GET', `${base}/board/events`);
  assert.equal(res.status, 404);
});

test('the watchers stream has no codes and ends when the link is replaced', async () => {
  await app.form(owner, `${base}/watch-link`, {});
  const token = app.store.workspace(office.id).watchToken;
  const res = await fetch(`${app.base}/watch/${token}/events`);
  const it = events(res, { raw: true });
  const first = await next(it, 'board');
  assert.doesNotMatch(first.data, /Unknown car|board-steps/);
  await app.form(owner, `${base}/watch-link`, {});
  assert.equal(await next(it, 'ended'), null);
});

test('?big carries into the stream: the events URL keeps it and the streamed board stays wall-sized', async () => {
  app.engine.ingest({ workspaceId: office.id, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '99', t: 20000 }] } });
  const page = await (await app.api(owner, 'GET', `${base}/board?big`)).text();
  assert.match(page, new RegExp(`data-events="${base}/board/events\\?big"`));
  const plain = events(await app.api(owner, 'GET', `${base}/board/events`), { raw: true });
  assert.match((await next(plain, 'board')).data, /board-unknown/);
  await plain.return();
  const big = events(await app.api(owner, 'GET', `${base}/board/events?big`), { raw: true });
  const first = await next(big, 'board');
  assert.doesNotMatch(first.data, /board-unknown/);
  assert.match(first.data, /\/board\/events\?big"/);
  await big.return();
  await app.form(owner, `${base}/watch-link`, {});
  const token = app.store.workspace(office.id).watchToken;
  const watch = await (await fetch(`${app.base}/watch/${token}?big`, { headers: { accept: 'text/html' } })).text();
  assert.match(watch, new RegExp(`data-events="/watch/${token}/events\\?big"`));
});

test('an unknown watchers link gets the gone page, not a stream', async () => {
  const res = await fetch(`${app.base}/watch/AAAAAAAAAAAAAAAAAAAAAA/events`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /^text\/html/);
});

/** The stream's raw text until `enough` matches it. */
async function rawUntil(res, enough) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  try {
    while (!enough.test(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

test('a name with carriage returns cannot inject event or id fields', async () => {
  // Past the name check on purpose: the stream must hold up on its own.
  app.store.addDriver(office.id, { id: 'crlf', name: 'Eve\revent: ended\rid: 99\r\rdata: x', colour: '#123456' });
  app.engine.assign(office.id, '20', 'crlf');
  app.engine.ingest({ workspaceId: office.id, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '20', t: 30000 }, { transponder: '20', t: 38000 }] } });
  const text = await rawUntil(await app.api(owner, 'GET', `${base}/board/events`), /<\/div>\s*$/);
  const lines = text.split(/\r\n|\r|\n/).filter(Boolean);
  const fields = lines.filter((line) => !line.startsWith('data: ') && !line.startsWith(':'));
  assert.deepEqual(fields, ['retry: 2000', 'event: board']);
  app.store.deleteDriver(office.id, 'crlf');
});

test('a render that throws ends that stream, logs once and the server keeps going', async () => {
  const it = events(await app.api(owner, 'GET', `${base}/board/events`), { raw: true });
  await next(it, 'board');
  const snapshot = app.engine.snapshot;
  const logged = [];
  const error = console.error;
  console.error = (...args) => logged.push(args);
  app.engine.snapshot = () => { throw new Error('the club is gone'); };
  try {
    pass(50000);
    assert.equal(await next(it, 'board'), null);
  } finally {
    app.engine.snapshot = snapshot;
    console.error = error;
  }
  assert.equal(logged.length, 1);
  const again = events(await app.api(owner, 'GET', `${base}/board/events`), { raw: true });
  assert.ok(await next(again, 'board'));
  await again.return();
});

test('the stream renders the offline banner after a decoders event', async () => {
  const clock = { now: 1_000_000_000_000 };
  const rig = await startTiming({ clock });
  try {
    const user = await rig.signUp('Dee');
    const club = rig.club(user, 'Quiet');
    const who = await rig.login(user);
    rig.store.addDecoder(club.id, { id: 'q1', name: 'Start', tokenHash: 'h', createdAt: clock.now });
    rig.engine.ingest({ workspaceId: club.id, decoder: 'q1', via: 'net', batch: { boot: 'b00tb00t', passings: [] } });
    const it = events(await rig.api(who, 'GET', `/clubs/${club.id}/board/events`), { raw: true });
    const first = (await next(it, 'board')).data;
    assert.doesNotMatch(first, /board-offline/);
    assert.match(first, /<li class="board-decoder is-reporting">Start: reporting<\/li>/);
    clock.now += 25_000;
    rig.engine.tick();
    const later = (await next(it, 'board')).data;
    assert.match(later, /<li class="board-decoder is-offline">Start: not reporting<\/li>/);
    assert.match(later, /<p class="status status-warning flag board-offline" role="status">Start isn't reporting\. Laps will appear once it's back\.<\/p>/);
    await it.return();
  } finally {
    await rig.close();
  }
});

/** A rig whose club has a paired decoder, to ask the ingest answer whether the board is watched. @param {any} [options] */
async function watchedRig(options) {
  const rig = await startTiming(options);
  const user = await rig.signUp('Eve');
  const club = rig.club(user, 'Watched');
  const who = await rig.login(user);
  const gate = await (await rig.api(who, 'POST', `/workspaces/${club.id}/decoders`, { name: 'Gate' })).json();
  const watched = async () => (await (await fetch(`${rig.base}/decoders/${gate.id}/passings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${gate.token}` },
    body: JSON.stringify({ boot: 'b00tb00t', passings: [], logs: ['boot'] }),
  })).json()).watched;
  // Live hub subscriptions, to see that none is left behind.
  const subscribe = rig.hub.subscribe;
  const live = { count: 0 };
  rig.hub.subscribe = (...args) => {
    const sub = subscribe(...args);
    live.count += 1;
    let done = false;
    return { ...sub, unsubscribe: () => { if (!done) { done = true; live.count -= 1; } sub.unsubscribe(); } };
  };
  return { rig, club, who, watched, live };
}

test('a stream whose setup throws ends, logs once, and leaves the club unwatched', async () => {
  const { rig, club, who, watched, live } = await watchedRig({ streams: { watch: () => { throw new Error('checks are down'); } } });
  const logged = [];
  const error = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const res = await rig.api(who, 'GET', `/clubs/${club.id}/board/events`);
    await res.text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(logged.length, 1);
    assert.equal(await watched(), false);
    assert.equal(live.count, 0, 'its hub subscription is gone');
  } finally {
    console.error = error;
    await rig.close();
  }
});

test('a viewer gone before its stream starts is never counted', async () => {
  const { routes } = await import('../../server/routes.js');
  let entered;
  const inRoute = new Promise((resolve) => { entered = resolve; });
  let started;
  const streamed = new Promise((resolve) => { started = resolve; });
  const slow = routes.map((route) => (route.pattern.exec('/clubs/x/board/events') && route.methods.GET
    ? { ...route, methods: { ...route.methods, GET: async (request, ...rest) => {
      entered();
      // The viewer leaves while the server still works on the answer.
      await new Promise((resolve) => (request.req.socket.destroyed ? resolve() : request.req.socket.once('close', resolve)));
      const answer = await route.methods.GET(request, ...rest);
      return { ...answer, stream: (req, res) => { answer.stream(req, res); started(); } };
    } } }
    : route));
  const { rig, club, who, watched, live } = await watchedRig({ routes: slow });
  try {
    const abort = new AbortController();
    const res = fetch(`${rig.base}/clubs/${club.id}/board/events`, { headers: { origin: rig.base, cookie: who.jar.header() }, signal: abort.signal }).catch(() => null);
    await inRoute;
    abort.abort();
    await res;
    await streamed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await watched(), false);
    assert.equal(live.count, 0);
  } finally {
    await rig.close();
  }
});
