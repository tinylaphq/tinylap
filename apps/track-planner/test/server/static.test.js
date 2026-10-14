// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { assemble } from '../../../../tools/assemble.js';
import { startServer, appDir } from './helpers.js';

const SHA = 'abc1234';
const root = mkdtempSync(join(tmpdir(), 'planner-'));
assemble(appDir, root, SHA);

const server = await startServer({ root });
test.after(() => server.close());
const get = (path, headers = {}) => fetch(server.base + path, { headers });

test('the page revalidates and carries the security headers', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.equal(res.headers.get('server'), null);
  assert.match(await res.text(), new RegExp(`<base href="/v/${SHA}/">`));
});

test('versioned assets are immutable and gzipped on request', async () => {
  const path = `/v/${SHA}/js/app.js`;
  const plain = await get(path, { 'accept-encoding': 'identity' });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(plain.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(plain.headers.get('content-encoding'), null);
  const body = await plain.text();

  // fetch decompresses gzip itself and keeps the Content-Encoding header, so
  // the decoded text must equal the plain body.
  const zipped = await fetch(server.base + path, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(zipped.headers.get('content-encoding'), 'gzip');
  assert.match(zipped.headers.get('vary'), /Accept-Encoding/);
  assert.equal(await zipped.text(), body);
  assert.notEqual(zipped.headers.get('etag'), plain.headers.get('etag'));
});

test('a matching etag gives 304', async () => {
  const first = await get(`/v/${SHA}/css/app.css`, { 'accept-encoding': 'identity' });
  const again = await get(`/v/${SHA}/css/app.css`, { 'accept-encoding': 'identity', 'if-none-match': first.headers.get('etag') });
  assert.equal(again.status, 304);
});

test('missing files and escapes are 404 and never cached', async () => {
  for (const path of [`/v/${SHA}/nope.js`, '/../package.json', '/%2e%2e/package.json', `/v/${SHA}/%2e%2e/%2e%2e/index.html.gz`, `/v/${SHA}/js`]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get('cache-control'), 'no-store', path);
  }
});

test('other methods on static paths are 405', async () => {
  const res = await fetch(server.base + '/', { method: 'DELETE' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});

test('dev mode serves the source and caches nothing', async () => {
  const dev = await startServer({});
  try {
    const page = await fetch(dev.base + '/');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(await page.text(), /<base href="\/">/);
    const pkg = await fetch(dev.base + '/pkg/track-format/index.js');
    assert.equal(pkg.status, 200);
    const script = await fetch(dev.base + '/js/app.js');
    assert.equal(script.status, 200);
  } finally {
    await dev.close();
  }
});

test('the gzip twin really is gzip of the file', () => {
  // Guards the assemble step against writing something the server would
  // then label Content-Encoding: gzip.
  const html = gunzipSync(readFileSync(join(root, 'index.html.gz'))).toString();
  assert.match(html, /<base href=/);
});

test('a root with a trailing slash serves files', async () => {
  const slashed = await startServer({ root: `${root}/` });
  try {
    const res = await fetch(`${slashed.base}/v/${SHA}/js/app.js`);
    assert.equal(res.status, 200);
  } finally {
    await slashed.close();
  }
});
