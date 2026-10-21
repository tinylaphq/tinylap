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
  for (const state of ['unsupported', 'connect', 'connecting', 'listening', 'unpaired', 'choose', 'ready', 'disconnected']) assert.match(body, new RegExp(`data-bridge-state="${state}"`));
  assert.doesNotMatch(body, /not-tinylap/);
  assert.match(body, /<section data-bridge-state="unsupported"[^>]*>[\s\S]*Chrome or Edge/);
  assert.match(body, /The bridge needs Chrome or Edge on a laptop, with JavaScript on: it reads the decoder over USB with Web Serial, or an EasyLap with WebHID\./);
  assert.match(body, /<section data-bridge-state="connect" hidden/);
  assert.match(body, /Pair over Wi-Fi only/);
  assert.match(body, /token for your personal space/);
  assert.doesNotMatch(body, /this space/);
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(body)[1];
  assert.deepEqual(JSON.parse(map), { imports: { '@tinylap/timing': '/pkg/timing/index.js' } });
  const hash = createHash('sha256').update(map).digest('base64');
  assert.match(res.headers.get('content-security-policy'), new RegExp(`script-src 'self' '[^']+' 'sha256-${hash.replace(/[+/=]/g, (c) => `\\${c}`)}'`));
  assert.match(body, /<script type="module" src="\/public\/elements\/bridge.js"><\/script>/);
  assert.match(body, /<tl-bridge>\s*<div id="bridge" data-workspace=/);
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

test('two Connect buttons, the serial one first; the missing-API notes hidden; the choose form with its own name field', async () => {
  const body = await (await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  const serial = body.indexOf('data-bridge-connect="serial"');
  const hid = body.indexOf('data-bridge-connect="hid"');
  assert.ok(serial > 0 && hid > serial, 'Connect decoder comes first');
  assert.ok(body.indexOf('data-bridge-connect') === serial, 'and is the first [data-bridge-connect] of all');
  assert.match(body, />Connect decoder<\/button>/);
  assert.match(body, />Connect EasyLap<\/button>/);
  assert.match(body, /<p>An EasyLap\? Use Connect EasyLap: it doesn't show up in the decoder list\.<\/p>/);
  assert.match(body, /<p class="status status-warning" data-bridge-missing="serial" hidden>This browser can't reach USB decoders, only an EasyLap\.<\/p>/);
  assert.match(body, /<p class="status status-warning" data-bridge-missing="hid" hidden>This browser can't reach an EasyLap, only other USB decoders\.<\/p>/);
  assert.equal(body.match(/data-bridge-connect="last"/g).length, 2, 'Try another device and Connect again');
  assert.match(body, /<label for="bridge-choose-name">Name for the new decoder<\/label>/);
  assert.equal(body.match(/>Decoder name</g).length, 1, 'exactly one "Decoder name" label');
  assert.match(body, /<h2 class="h3" data-bridge-choose-heading>Which decoder is this\?<\/h2>/);
  assert.match(body, /<p data-bridge-kind data-where="your personal space"><\/p>/);
  assert.match(body, /If it comes unplugged, crossings until you connect again are lost, and each car's lap starts over\./);
  assert.match(body, /Choose an existing decoder only if it is this same device\. A decoder that another laptop uses needs its own\./);
  assert.match(body, /<button type="submit" class="btn btn-primary">Use this decoder<\/button>/);
  assert.match(body, /<p class="status status-warning" data-bridge-listening>Connected, but nothing has come from this device yet\.<\/p>/);
  assert.match(body, /<p class="status status-warning" data-bridge-unreadable hidden>Data is coming, but it can't be read\. Report this device\.<\/p>/);
  assert.match(body, /<p>A decoder answers within a few seconds\. If this is the wrong device, try another\.<\/p>/);
  assert.match(body, /<p data-bridge-gap hidden>Crossings while it is unplugged are lost, and each car's lap starts over when you connect again\.<\/p>/);
});

test('the choose list: the club\'s decoders, escaped, "A new decoder" last; none that sends over Wi-Fi', async () => {
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  const space = me.workspaces[0].id;
  const gate = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Gate <1>' })).json();
  const wifi = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Over Wi-Fi' })).json();
  const res = await fetch(`${app.base}/decoders/${wifi.id}/passings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${wifi.token}` }, body: JSON.stringify({ boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1000 }] }) });
  assert.equal(res.status, 200);
  const body = await (await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  const select = /<select id="bridge-choose" name="decoder"[^>]*>([\s\S]*?)<\/select>/.exec(body)[1];
  assert.match(select, new RegExp(`<option value="${gate.id}" data-name="Gate &lt;1&gt;">Gate &lt;1&gt;</option>`));
  assert.doesNotMatch(select, /Over Wi-Fi/);
  assert.match(select, /<option value="" selected>A new decoder<\/option>\s*$/);
  assert.match(body, /<select id="bridge-choose" name="decoder" aria-describedby="bridge-choose-hint">/);
});
