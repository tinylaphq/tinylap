// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What people read says "sign in", "club" and "personal", and "share": the
// page, the scripts, the server's messages and pages, and the API description.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AuthError, createBff } from '@tinylap/auth';
import { shapeKey } from '@tinylap/track-format';
import { BANNED, exempt, openapiStrings, proseLiterals, visibleText } from '../../../tools/glossary.js';
import { appDir, closedLayout, startServer } from './server/helpers.js';

const banned = (text) => BANNED.test(exempt(text));
const read = (file) => readFileSync(join(appDir, file), 'utf8');

test('the page follows the glossary', () => {
  const text = visibleText(read('index.html'));
  assert.match(text, /Share and copy link/, 'the page is read');
  assert.ok(!banned(text), text.match(BANNED)?.[0]);
});

test('the words in the sources follow the glossary', () => {
  const files = ['js', 'server'].flatMap((dir) => readdirSync(join(appDir, dir)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`));
  const found = files.flatMap((file) => proseLiterals(read(file)).map((l) => ({ ...l, file })));
  assert.ok(found.length > 100, 'the prose is read');
  assert.deepEqual(found.filter((l) => banned(l.text)).map((l) => `${l.file}:${l.line}: ${l.text}`), []);
});

test('the API description follows the glossary', () => {
  const doc = JSON.parse(read('server/openapi.json'));
  assert.equal(doc.info.title, 'TinyLap Planner API');
  const strings = openapiStrings(doc);
  assert.ok(strings.length > 50, 'the description is read');
  assert.deepEqual(strings.filter(banned), []);
});

test('the server’s pages follow the glossary and say TinyLap Planner', async () => {
  // A real BFF: a callback without its sign-in cookie answers 400 with the
  // body the page shows, before it asks the issuer anything.
  const bff = createBff({ issuer: 'http://127.0.0.1:9', clientId: 'x', redirectUri: 'http://127.0.0.1/auth/callback', keys: [{ id: 'k1', key: randomBytes(32) }], store: new Map() });
  const auth = {
    issuer: 'http://127.0.0.1:9',
    accountUrl: 'http://127.0.0.1:9/account',
    bff: { ...bff, login: async () => { throw new AuthError('unavailable', 'down'); }, callback: bff.callback },
    sessions: null,
    userName: async () => null,
  };
  const server = await startServer({ auth });
  try {
    const html = { headers: { accept: 'text/html' } };
    const layout = closedLayout();
    const posted = await fetch(`${server.base}/layouts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(layout) });
    assert.equal(posted.status, 201);
    const pages = {
      down: await (await fetch(`${server.base}/auth/login`, html)).text(),
      failed: await (await fetch(`${server.base}/auth/callback?code=c&state=s`, html)).text(),
      shape: await (await fetch(`${server.base}/shapes/${await shapeKey(layout.track.shape)}`, html)).text(),
    };
    assert.match(pages.down, /<title>Can&#39;t sign in right now · TinyLap Planner<\/title>/);
    assert.match(pages.failed, /<title>The sign-in didn&#39;t finish · TinyLap Planner<\/title>/);
    assert.match(pages.failed, /This sign-in has expired or was started in another browser\. Sign in again\./, 'the BFF says why on the page');
    assert.match(pages.shape, /<title>One build, every snapshot · TinyLap Planner<\/title>/);
    for (const [name, page] of Object.entries(pages)) assert.ok(!banned(visibleText(page)), `${name}: ${visibleText(page)}`);
  } finally {
    await server.close();
  }
});
