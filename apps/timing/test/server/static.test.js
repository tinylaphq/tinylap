// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const server = await startServer();
after(() => server.close());
const get = (path, init) => fetch(server.base + path, init);

test('the app CSS, the shared mark and the timing package are served as files', async () => {
  for (const [path, type] of [['/public/app.css', /css/], ['/pkg/design/mark.svg', /svg/], ['/pkg/timing/index.js', /javascript/], ['/pkg/palace-ui/palace.css', /css/]]) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), type, path);
    await res.body?.cancel();
  }
});

test('the timing package is served to the browser, auth is not', async () => {
  const lib = await get('/pkg/timing/index.js');
  assert.equal(lib.status, 200);
  assert.match(lib.headers.get('content-type'), /javascript/);
  await lib.body?.cancel();
  assert.equal((await get('/pkg/auth/index.js')).status, 404);
});

test('discovery: the description, the catalog, problem types, the docs page', async () => {
  const doc = await get('/openapi.json');
  assert.equal(doc.status, 200);
  assert.equal((await doc.json()).info.title, 'TinyLap timing API');
  assert.equal((await get('/.well-known/api-catalog')).status, 200);
  const known = await get('/problems/conflict', { redirect: 'manual' });
  assert.equal(known.status, 302);
  assert.equal(known.headers.get('location'), '/api#problem-conflict');
  const unknown = await get('/problems/nope');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get('content-type'), 'application/problem+json');
  assert.match(await (await get('/api')).text(), /TinyLap timing API/);
});
