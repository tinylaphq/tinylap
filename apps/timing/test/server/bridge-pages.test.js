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
  assert.match(body, new RegExp(`<div id="bridge" data-workspace="${me.workspaces[0].id}" data-server=`));
  assert.match(body, /<div id="bridge" data-workspace="[^"]*" data-server="http:\/\/[^"]+">/, 'the page carries the address the decoder posts to');
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
  assert.match(body, /<div id="bridge"[^>]*>\s*<p class="visually-hidden" role="status" data-bridge-live><\/p>\s*<p class="status status-error" role="alert" data-bridge-error hidden><\/p>/, 'a failure shows at the top, above the card');
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
  assert.equal(body.match(/data-bridge-connect="last"/g).length, 5, 'Try another device (listening, unpaired, unknown, choose) and Connect again');
  assert.match(body, /<label for="bridge-choose-name">Name for the new decoder<\/label>/);
  assert.equal(body.match(/>Decoder name</g).length, 1, 'exactly one "Decoder name" label');
  assert.match(body, /<h2 class="h3" tabindex="-1" data-bridge-choose-heading>Which decoder is this\?<\/h2>/, 'focusable, for focus after Connect');
  assert.match(body, /<p class="status status-warning" data-bridge-taken hidden>This decoder is connected in another tab\.<\/p>/);
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
  // data-known names every decoder the server knew, the one on Wi-Fi too, so tl-bridge doesn't take it for a new one.
  assert.match(body, new RegExp(`<select id="bridge-choose" name="decoder" data-known="${gate.id} ${wifi.id}" aria-describedby="bridge-choose-hint">`));
});

test('the decoder cards: every decoder of the club by name, above the connect flow, with the Wi-Fi dialog closed beside them', async () => {
  const ana = await app.signUp('Cara');
  const club = app.club(ana, 'Pits');
  const cara = await app.login(ana);
  const zed = await (await app.api(cara, 'POST', `/workspaces/${club.id}/decoders`, { name: 'Zed' })).json();
  const gate = await (await app.api(cara, 'POST', `/workspaces/${club.id}/decoders`, { name: 'Gate' })).json();
  const sent = await fetch(`${app.base}/decoders/${zed.id}/passings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${zed.token}` }, body: JSON.stringify({ boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1000 }] }) });
  assert.equal(sent.status, 200);
  const body = await (await app.api(cara, 'GET', `/clubs/${club.id}/bridge`, undefined, { accept: 'text/html' })).text();
  assert.deepEqual([...body.matchAll(/data-decoder="([^"]+)"/g)].map((m) => m[1]), [gate.id, zed.id], 'by name');
  const cards = body.indexOf('<div id="bridge-decoders">');
  assert.ok(cards > body.indexOf('data-bridge-error') && cards < body.indexOf('data-bridge-state="connect"'), 'under the error, above the flow');
  assert.match(body, /Laps get through over Wi-Fi\./);
  assert.match(body, /If it's on, its laps wait on it\. Connect the cable to see why\./);
  assert.equal(body.match(/data-bridge-wifi hidden>Change Wi-Fi</g).length, 2, 'a member who may pair has it, hidden until the cable is in');
  assert.match(body, /<dialog id="wifi-dialog"/);
  assert.ok(body.indexOf('<dialog id="wifi-dialog"') > body.indexOf('data-bridge-state="disconnected"'), 'outside the cards, so a swap keeps it');
});

test('a wrong port is never a trap: the pair, re-pair and choose steps offer Try another device', async () => {
  const body = await (await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  for (const state of ['unpaired', 'unknown', 'choose', 'listening']) {
    const section = new RegExp(`<section data-bridge-state="${state}"[\\s\\S]*?</section>`).exec(body)[0];
    assert.match(section, /<button type="button" class="btn [a-z- ]+" data-bridge-connect="last">Try another device<\/button>/, state);
  }
});

test('a cable closed on this tab: Not connected at once, then back to the Bridge page', async () => {
  const ana = await app.signUp('Dora');
  const club = app.club(ana, 'Kerbs');
  const dora = await app.login(ana);
  const gate = await (await app.api(dora, 'POST', `/workspaces/${club.id}/decoders`, { name: 'Gate' })).json();
  const sent = await app.api(dora, 'POST', `/decoders/${gate.id}/passings`, { boot: 'b00tb00t', passings: [], logs: ['boot'] });
  assert.equal(sent.status, 200);
  const base = `/clubs/${club.id}`;
  const bridge = async () => (await app.api(dora, 'GET', `${base}/bridge`, undefined, { accept: 'text/html' })).text();
  assert.match(await bridge(), /Connected on another laptop/);
  const res = await app.form(dora, `${base}/decoders/${gate.id}/cable`, { state: 'closed' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/bridge`);
  const body = await bridge();
  assert.doesNotMatch(body, /Connected on another laptop/);
  assert.match(body, /Not connected/);
  assert.deepEqual(app.engine.headerOf(club.id).map((d) => d.state), ['offline']);
  // A GET on it (after a reload) goes to the Bridge page.
  const get = await app.api(dora, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, { accept: 'text/html' });
  assert.equal(get.status, 303);
  assert.equal(get.headers.get('location'), `${base}/bridge`);
});

test('a closed cable: another club\'s decoder or an unknown one is not found; a bad state, another site or a stranger are refused', async () => {
  const ana = await app.signUp('Eve');
  const mine = app.club(ana, 'Mine');
  const theirs = app.club(ana, 'Theirs');
  const eve = await app.login(ana);
  const other = await (await app.api(eve, 'POST', `/workspaces/${theirs.id}/decoders`, { name: 'Theirs' })).json();
  const gate = await (await app.api(eve, 'POST', `/workspaces/${mine.id}/decoders`, { name: 'Gate' })).json();
  const base = `/clubs/${mine.id}`;
  assert.equal((await app.form(eve, `${base}/decoders/${other.id}/cable`, { state: 'closed' })).status, 404);
  assert.equal((await app.form(eve, `${base}/decoders/nope/cable`, { state: 'closed' })).status, 404);
  const bad = await app.form(eve, `${base}/decoders/${gate.id}/cable`, { state: 'open' });
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).type.endsWith('/problems/invalid-request'), true);
  assert.equal((await app.form(eve, `${base}/decoders/${gate.id}/cable`, { state: 'closed' }, { origin: 'https://elsewhere.example' })).status, 403);
  const stranger = await app.login(await app.signUp('Finn'));
  assert.equal((await app.form(stranger, `${base}/decoders/${gate.id}/cable`, { state: 'closed' })).status, 404);
  const out = await app.form(null, `${base}/decoders/${gate.id}/cable`, { state: 'closed' });
  assert.equal(out.status, 303);
  assert.match(out.headers.get('location'), /^\/auth\/login\?/);
});
