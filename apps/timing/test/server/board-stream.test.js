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
