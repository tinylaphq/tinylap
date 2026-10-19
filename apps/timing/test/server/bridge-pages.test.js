// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startTiming } from './helpers.js';

let app;
let member;

before(async () => {
  app = await startTiming();
  member = await app.login(await app.signUp('Ana'));
});
after(() => app.close());

test('the bridge page: every state rendered, the explanation shown, the import map allowed by hash', async () => {
  const res = await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' });
  assert.equal(res.status, 200);
  const body = await res.text();
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  assert.match(body, new RegExp(`<div id="bridge" data-workspace="${me.workspaces[0].id}">`));
  for (const state of ['unsupported', 'connect', 'connecting', 'not-tinylap', 'unpaired', 'ready', 'disconnected']) assert.match(body, new RegExp(`data-bridge-state="${state}"`));
  assert.match(body, /<section data-bridge-state="unsupported"[^>]*>[\s\S]*Chrome or Edge/);
  assert.match(body, /<section data-bridge-state="connect" hidden/);
  assert.match(body, /Pair over Wi-Fi only/);
  assert.match(body, /token for your personal space/);
  assert.doesNotMatch(body, /this space/);
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(body)[1];
  assert.deepEqual(JSON.parse(map), { imports: { '@tinylap/timing': '/pkg/timing/index.js' } });
  const hash = createHash('sha256').update(map).digest('base64');
  assert.match(res.headers.get('content-security-policy'), new RegExp(`script-src 'self' '[^']+' 'sha256-${hash.replace(/[+/=]/g, (c) => `\\${c}`)}'`));
  assert.match(body, /<script type="module" src="\/public\/bridge-page.js"><\/script>/);
});

/** `s` as a regex source that matches it exactly. */
const exact = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

test('the preview rows are server templates, right after the list', async () => {
  const body = await (await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  const list = '<ol class="board-laps" data-bridge-preview></ol>';
  const first = '<template data-bridge-row="first"><li><span class="bridge-code"></span><span class="bridge-first">first pass</span></li></template>';
  const lap = '<template data-bridge-row="lap"><li><span class="bridge-code"></span><span class="num"></span></li></template>';
  assert.match(body, new RegExp(`${exact(list)}\\s*${exact(first)}\\s*${exact(lap)}`));
});
