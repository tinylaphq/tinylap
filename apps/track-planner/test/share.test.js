// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, assignTrack, stockL } from '@tinylap/track-format';
import { shareLayout, fetchShared } from '../js/share.js';

const layout = () => assignTrack(createLayout({ pieces: stockL() }));
const reply = (status, body, type = 'application/json') => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': type } });

test('sharing posts the layout as json and returns the link', async () => {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, init });
    return reply(201, { key: 'k', url: 'https://p.example/layouts/k', shapeKey: null })();
  };
  const l = layout();
  assert.equal(await shareLayout(l, { fetch }), 'https://p.example/layouts/k');
  assert.equal(sent[0].url, '/layouts');
  assert.equal(sent[0].init.method, 'POST');
  assert.equal(sent[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(sent[0].init.body), l);
});

test('a refused share throws the problem title', async () => {
  const fetch = reply(429, { type: 'x', title: 'Too many layouts posted', status: 429 }, 'application/problem+json');
  await assert.rejects(shareLayout(layout(), { fetch }), /Too many layouts posted/);
});

test('a share that never reaches the server says so', async () => {
  const fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(shareLayout(layout(), { fetch }), /could not reach/i);
  const html = reply(502, '<html>bad gateway</html>', 'text/html');
  await assert.rejects(shareLayout(layout(), { fetch: html }), /502/);
});

test('opening a shared layout fetches its json', async () => {
  const l = layout();
  const urls = [];
  const fetch = async (url) => { urls.push(url); return reply(200, l)(); };
  assert.deepEqual(await fetchShared('AAAAAAAAAAAAAAAAAAAAAA', { fetch }), l);
  assert.deepEqual(urls, ['/layouts/AAAAAAAAAAAAAAAAAAAAAA.json']);
});

test('a malformed key is refused without a request', async () => {
  const fetch = async () => assert.fail('no request expected');
  await assert.rejects(fetchShared('../x', { fetch }), /not point to a layout/);
});

test('an unknown key throws the problem title', async () => {
  const fetch = reply(404, { type: 'x', title: 'Not found', status: 404 }, 'application/problem+json');
  await assert.rejects(fetchShared('AAAAAAAAAAAAAAAAAAAAAA', { fetch }), /Not found/);
});
