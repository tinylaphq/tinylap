// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotKey, shapeKey, shapeOf, assignTrack, canonicalJson } from '@tinylap/track-format';
import { exportHtml } from '../../js/storage.js';
import { startServer, closedLayout, openLayout } from './helpers.js';

const CHROME = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

const server = await startServer({ publicUrl: 'https://planner.example', build: 'b1' });
test.after(() => server.close());

const post = (body, type = 'application/json', base = server.base) =>
  fetch(`${base}/layouts`, { method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const problemOf = async (res) => {
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.status, res.status);
  assert.match(body.type, /^https:\/\/planner\.example\/problems\/[a-z-]+$/);
  return body;
};

test('posting a layout stores it once', async () => {
  const layout = closedLayout();
  const first = await post(layout);
  assert.equal(first.status, 201);
  const key = await snapshotKey(layout);
  assert.equal(first.headers.get('location'), `/layouts/${key}`);
  assert.deepEqual(await first.json(), {
    key,
    url: `https://planner.example/layouts/${key}`,
    shapeKey: await shapeKey(shapeOf(layout)),
  });
  const again = await post(layout);
  assert.equal(again.status, 200);
});

test('an exported page stores the same snapshot as its json', async () => {
  const layout = closedLayout();
  const fromHtml = await (await post(exportHtml(layout), 'text/html')).json();
  assert.equal(fromHtml.key, await snapshotKey(layout));
});

test('open layouts are stored without a shape key', async () => {
  const res = await post(openLayout());
  assert.equal(res.status, 201);
  assert.equal((await res.json()).shapeKey, null);
});

test('bad posts get problem details', async () => {
  assert.equal((await problemOf(await post('{}', 'text/plain'))).title, 'Unsupported media type');
  assert.equal((await problemOf(await post('x'.repeat(600 * 1024)))).status, 413);
  assert.match((await problemOf(await post('{"version":9,"pieces":[]}'))).detail, /newer planner/);
  assert.equal((await problemOf(await post('{oops'))).status, 422);

  const closed = closedLayout();
  const { track, ...untracked } = closed;
  assert.ok(track);
  const wrongShape = { ...closed, track: { ...track, shape: 'c30:1:other' } };
  const trackedOpen = { ...openLayout(), track };
  for (const body of [untracked, wrongShape, trackedOpen]) {
    const p = await problemOf(await post(body));
    assert.match(p.type, /track-mismatch$/);
    assert.match(p.detail, /assignTrack/);
  }
});

test('a browser gets the page, everything else gets json', async () => {
  const layout = closedLayout();
  const { key } = await (await post(layout)).json();
  const page = await fetch(`${server.base}/layouts/${key}`, { headers: { accept: CHROME } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.equal(page.headers.get('etag'), `"${key}-b1"`);
  assert.match(await page.text(), new RegExp(`href="/\\?layout=${key}"`));

  for (const accept of [undefined, '*/*', 'application/json']) {
    const res = await fetch(`${server.base}/layouts/${key}`, { headers: accept ? { accept } : {} });
    assert.equal(res.headers.get('content-type'), 'application/json', String(accept));
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(res.headers.get('etag'), `"${key}"`);
    assert.equal(res.headers.get('vary'), 'Accept');
    // Stored in canonical form: pieces sorted, so compare against that.
    assert.deepEqual(await res.json(), JSON.parse(canonicalJson(layout)));
  }
});

test('suffixes override accept, and etags give 304', async () => {
  const { key } = await (await post(closedLayout())).json();
  const asJson = await fetch(`${server.base}/layouts/${key}.json`, { headers: { accept: CHROME } });
  assert.equal(asJson.headers.get('content-type'), 'application/json');
  const asHtml = await fetch(`${server.base}/layouts/${key}.html`);
  assert.match(asHtml.headers.get('content-type'), /^text\/html/);
  const cached = await fetch(`${server.base}/layouts/${key}`, { headers: { 'if-none-match': `"${key}"` } });
  assert.equal(cached.status, 304);
  const cachedPage = await fetch(`${server.base}/layouts/${key}.html`, { headers: { 'if-none-match': `"${key}-b1"` } });
  assert.equal(cachedPage.status, 304);
});

test('unknown and malformed keys are 404 problems', async () => {
  for (const path of ['/layouts/AAAAAAAAAAAAAAAAAAAAAA', '/layouts/short', '/shapes/AAAAAAAAAAAAAAAAAAAAAA', '/shapes/x.json']) {
    assert.equal((await problemOf(await fetch(server.base + path))).status, 404, path);
  }
});

test('a shape lists every snapshot of the build, across track ids', async () => {
  const a = closedLayout();
  const b = assignTrack({ ...a, track: undefined, room: { w: 30, h: 30 } });
  assert.notEqual(a.track.id, b.track.id);
  await post(a);
  await post(b);
  const sk = await shapeKey(a.track.shape);
  const res = await fetch(`${server.base}/shapes/${sk}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  const listing = await res.json();
  assert.equal(listing.shapeKey, sk);
  assert.equal(listing.shape, a.track.shape);
  const ids = new Set(listing.layouts.map((l) => l.trackId));
  assert.ok(ids.has(a.track.id) && ids.has(b.track.id));
  const page = await fetch(`${server.base}/shapes/${sk}`, { headers: { accept: CHROME } });
  assert.match(await page.text(), new RegExp(`/layouts/${await snapshotKey(a)}`));
});

test('the api answers cross-origin and points at its description', async () => {
  const res = await post(openLayout());
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('link'), '</openapi.json>; rel="service-desc"');
  const preflight = await fetch(`${server.base}/layouts`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type');
  const wrong = await fetch(`${server.base}/layouts`, { method: 'GET' });
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'POST, OPTIONS');
});

test('posts over the limit are refused with retry-after', async () => {
  const limited = await startServer({ rateLimit: 1 });
  try {
    assert.equal((await post(openLayout(), 'application/json', limited.base)).status, 201);
    const res = await post(openLayout(), 'application/json', limited.base);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
  } finally {
    await limited.close();
  }
});

test('a client ip header is trusted only when configured', async () => {
  const forged = (base, ip) => fetch(`${base}/layouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Fly-Client-IP': ip, 'X-Forwarded-For': ip },
    body: JSON.stringify(openLayout()),
  });
  const plain = await startServer({ rateLimit: 1 });
  const fly = await startServer({ rateLimit: 1, clientIpHeader: 'Fly-Client-IP' });
  try {
    assert.equal((await forged(plain.base, '1.1.1.1')).status, 201);
    assert.equal((await forged(plain.base, '2.2.2.2')).status, 429, 'an unconfigured header must not reset the limit');
    assert.equal((await forged(fly.base, '1.1.1.1')).status, 201);
    assert.equal((await forged(fly.base, '2.2.2.2')).status, 200, 'a configured header names the client');
  } finally {
    await plain.close();
    await fly.close();
  }
});

test('without a database the api is unavailable', async () => {
  const down = await startServer({ store: null });
  try {
    const res = await post(openLayout(), 'application/json', down.base);
    assert.equal(res.status, 503);
    assert.equal((await fetch(`${down.base}/layouts/AAAAAAAAAAAAAAAAAAAAAA`)).status, 503);
  } finally {
    await down.close();
  }
});

test('a stored layout may be at most 64 KiB once read', async () => {
  const big = { ...openLayout(), pieces: Array.from({ length: 2000 }, (_, i) => ({ type: 'straight', x: i, y: 0, rot: 0 })) };
  assert.ok(JSON.stringify(big).length < 512 * 1024);
  const p = await problemOf(await post(big));
  assert.equal(p.status, 413);
  assert.match(p.type, /too-large$/);
  assert.match(p.detail, /64 KiB/);
});

test('a piece that is not an object is a readable 422', async () => {
  const p = await problemOf(await post('{"version":2,"pieces":[null]}'));
  assert.equal(p.status, 422);
  assert.match(p.detail, /^Invalid piece/);
});

test('ipv6 clients share a window per /64', async () => {
  const fly = await startServer({ rateLimit: 1, clientIpHeader: 'Fly-Client-IP' });
  const from = (ip) => fetch(`${fly.base}/layouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Fly-Client-IP': ip },
    body: JSON.stringify(openLayout()),
  });
  try {
    assert.equal((await from('2001:db8:0:1::1')).status, 201);
    assert.equal((await from('2001:db8:0:1:aaaa::2')).status, 429);
    assert.equal((await from('2001:db8:0:2::1')).status, 200);
  } finally {
    await fly.close();
  }
});

test('unknown paths under the api prefixes are problems, not static 404s', async () => {
  for (const path of ['/layouts/', '/layouts/a/b', '/shapes/', '/shapes/a/b']) {
    const res = await fetch(server.base + path);
    assert.equal((await problemOf(res)).status, 404, path);
    assert.equal(res.headers.get('access-control-allow-origin'), '*', path);
  }
  const post = await fetch(`${server.base}/layouts/`, { method: 'POST' });
  assert.equal(post.status, 404);
  assert.equal((await fetch(`${server.base}/layoutsfoo`)).headers.get('content-type'), 'text/plain; charset=utf-8');
});

test('405 lists every method the url takes, HEAD and OPTIONS included', async () => {
  const key = 'AAAAAAAAAAAAAAAAAAAAAA';
  const get = await fetch(`${server.base}/layouts/${key}`, { method: 'DELETE' });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'GET, HEAD, OPTIONS');
  const posts = await fetch(`${server.base}/layouts`, { method: 'PUT' });
  assert.equal(posts.headers.get('allow'), 'POST, OPTIONS');
});
