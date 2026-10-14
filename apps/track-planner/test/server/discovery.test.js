// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import openapi from '../../server/openapi.json' with { type: 'json' };
import { startServer } from './helpers.js';

const server = await startServer({ publicUrl: 'https://planner.example' });
test.after(() => server.close());
const get = (path, init) => fetch(server.base + path, init);

test('the description and the schema are served', async () => {
  const doc = await get('/openapi.json');
  assert.equal(doc.headers.get('content-type'), 'application/vnd.oai.openapi+json;version=3.1');
  assert.deepEqual(await doc.json(), openapi);
  const schema = await get('/schemas/layout.json');
  assert.equal(schema.headers.get('content-type'), 'application/schema+json');
  assert.equal((await schema.json()).title, 'TinyLap Circuit 30 layout');
});

test('the api catalog names the description and the docs', async () => {
  const res = await get('/.well-known/api-catalog');
  assert.equal(res.headers.get('content-type'), 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"');
  const [entry] = (await res.json()).linkset;
  assert.equal(entry.anchor, 'https://planner.example/layouts');
  assert.equal(entry['service-desc'][0].href, 'https://planner.example/openapi.json');
  assert.equal(entry['service-doc'][0].href, 'https://planner.example/api');
});

test('problem types redirect to their description', async () => {
  const res = await get('/problems/track-mismatch', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/api#problem-track-mismatch');
  assert.equal((await get('/problems/nope', { redirect: 'manual' })).status, 404);
});

test('the docs page lists every operation and problem type, with no scripts', async () => {
  const res = await get('/api');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  const text = await res.text();
  assert.doesNotMatch(text, /<script/i);
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const method of Object.keys(item)) assert.ok(text.includes(`${method.toUpperCase()}</span> <code>${path.replace(/&/g, '&amp;')}</code>`), `${method} ${path}`);
  }
  for (const name of Object.keys(openapi['x-tinylap-problems'])) assert.match(text, new RegExp(`id="problem-${name}"`));
});
