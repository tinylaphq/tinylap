// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup's markup for tl-frame and tl-copy (custom elements spec, step one):
// the cards a submit swaps, the slots it fills, and the modules it loads.
// The elements themselves are tested in the browser (test/browser/frames.test.js).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDir, startTiming } from './helpers.js';

let app;
let owner;
const base = '/personal';

before(async () => {
  app = await startTiming();
  owner = await app.login(await app.signUp('Ana'));
});
after(() => app.close());

const setup = async () => (await app.api(owner, 'GET', `${base}/setup`, undefined, { accept: 'text/html' })).text();

test('four cards are frames; drivers refreshes transponders; decoders is not a frame', async () => {
  const body = await setup();
  for (const id of ['track', 'transponders', 'watchers']) assert.match(body, new RegExp(`<tl-frame id="${id}">\\s*<section`), id);
  assert.match(body, /<tl-frame id="drivers" refreshes="transponders">\s*<section/);
  assert.match(body, /<section[^>]* id="decoders"/);
  assert.match(body, new RegExp(`<form method="post" action="${base}/decoders" class="inline-form" data-frame="off">`));
});

test('the status slots are always there, the summary fills the first on a 422', async () => {
  assert.match(await setup(), /<h1>Setup<\/h1>\s*<div id="page-status"><\/div>\s*<p class="visually-hidden" role="status" id="frame-status"><\/p>/);
  const res = await app.form(owner, `${base}/drivers`, { name: '   ' });
  assert.equal(res.status, 422);
  assert.match(await res.text(), /<div id="page-status"><p class="status status-error" role="alert">/);
});

test('setup loads the two element modules', async () => {
  const body = await setup();
  for (const name of ['frame', 'copy']) assert.match(body, new RegExp(`<script type="module" src="/pkg/design/elements/${name}.js"></script>`), name);
});

test('no server module imports an element file (they need a browser)', () => {
  const files = readdirSync(join(appDir, 'server'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.js'));
  for (const f of files) assert.doesNotMatch(readFileSync(join(appDir, 'server', f), 'utf8'), /(from\s*|import\(\s*)['"][^'"]*design\/elements\//, f);
});
