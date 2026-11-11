// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startTiming } from './helpers.js';
import { events, next } from './sse.js';

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
  assert.match(body, /<div id="bridge" data-workspace="[^"]*" data-server="http:\/\/[^"]+" data-cable-stream="\/personal\/decoders\/\{id\}\/cable" data-cards-stream="\/personal\/bridge\/events" data-page="[A-Za-z0-9_-]{16}">/, 'the page carries the address the decoder posts to, the streams it holds, and its own id');
  const again = await (await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  assert.notEqual(/data-page="([^"]+)"/.exec(again)[1], /data-page="([^"]+)"/.exec(body)[1], 'one id per render');
  assert.match(body, /<p hidden data-bridge-say="disconnected">Decoder disconnected\.<\/p>/, 'the words the page announces on an unplug');
  for (const state of ['unsupported', 'connect', 'connecting', 'listening', 'unpaired', 'choose', 'ready']) assert.match(body, new RegExp(`data-bridge-state="${state}"`));
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
  assert.equal(body.match(/data-bridge-connect="last"/g).length, 4, 'Try another device (listening, unpaired, unknown, choose)');
  // The cable has one place, its card: no section of its own after an unplug, and no Connect again.
  assert.doesNotMatch(body, /data-bridge-state="disconnected"|Connect again|data-bridge-gap/);
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
  assert.ok(body.indexOf('<dialog id="wifi-dialog"') > body.indexOf('data-bridge-state="ready"'), 'outside the cards, so a swap keeps it');
});

test('a wrong port is never a trap: the pair, re-pair and choose steps offer Try another device', async () => {
  const body = await (await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  for (const state of ['unpaired', 'unknown', 'choose', 'listening']) {
    const section = new RegExp(`<section data-bridge-state="${state}"[\\s\\S]*?</section>`).exec(body)[0];
    assert.match(section, /<button type="button" class="btn [a-z- ]+" data-bridge-connect="last">Try another device<\/button>/, state);
  }
});

const SSE = { accept: 'text/event-stream' };
/** Waits, briefly, until `check()` holds: a closed connection reaches the server a moment later. */
async function until(check) {
  for (const end = Date.now() + 2000; !check() && Date.now() < end;) await new Promise((resolve) => setTimeout(resolve, 10));
  return check();
}
/** A club with one decoder, signed in as its owner. @param {string} name */
async function clubWithGate(name) {
  const user = await app.signUp(name);
  const club = app.club(user, `${name}'s club`);
  const who = await app.login(user);
  const gate = await (await app.api(who, 'POST', `/workspaces/${club.id}/decoders`, { name: 'Gate' })).json();
  const base = `/clubs/${club.id}`;
  const cableOf = () => app.engine.connectionsOf(club.id).find((d) => d.id === gate.id).cable.state;
  return { user, club, who, gate, base, cableOf, bridge: async () => (await app.api(who, 'GET', `${base}/bridge`, undefined, { accept: 'text/html' })).text() };
}

test('a held cable stream: the decoder is on a cable for as long as it is open, and the stream sends this tab\'s cards', async () => {
  const { club, who, gate, base, cableOf, bridge } = await clubWithGate('Dora');
  assert.doesNotMatch(await bridge(), /Connected on another laptop/, 'never heard');
  const res = await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, SSE);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  const it = events(res, { raw: true });
  const first = await next(it, 'bridge');
  assert.match(first.data, /^<div id="bridge-decoders">/);
  assert.match(first.data, new RegExp(`data-decoder="${gate.id}"`));
  assert.doesNotMatch(first.data, /Connected on another laptop/, 'this tab paints its own cable');
  // Without a batch: a plain ZRound decoder with no laps yet.
  assert.equal(cableOf(), 'other');
  assert.match(await bridge(), /Connected on another laptop/);
  assert.deepEqual(app.engine.headerOf(club.id).map((d) => d.state), ['reporting']);
  await it.return();
  assert.ok(await until(() => cableOf() === 'none'), 'the count drops when the tab lets go');
  assert.deepEqual(app.engine.headerOf(club.id).map((d) => d.state), ['offline']);
  assert.doesNotMatch(await bridge(), /Connected on another laptop/);
});

test('the cards stream holds nothing, and sends the cards again when a cable comes or goes', async () => {
  const { who, gate, base, cableOf } = await clubWithGate('Gus');
  const cards = events(await app.api(who, 'GET', `${base}/bridge/events`, undefined, SSE), { raw: true });
  const first = await next(cards, 'bridge');
  assert.match(first.data, /^<div id="bridge-decoders">/);
  assert.doesNotMatch(first.data, /Connected on another laptop/);
  assert.equal(cableOf(), 'none');
  const cable = events(await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, SSE), { raw: true });
  await next(cable, 'bridge');
  assert.match((await next(cards, 'bridge')).data, /Connected on another laptop/, 'another tab connected it');
  await cable.return();
  assert.doesNotMatch((await next(cards, 'bridge')).data, /Connected on another laptop/, 'and unplugged it');
  // Two tabs on one decoder count once, and each sees the other's.
  const one = events(await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, SSE), { raw: true });
  await next(one, 'bridge');
  const two = events(await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, SSE), { raw: true });
  assert.match((await next(two, 'bridge')).data, /Connected on another laptop/);
  await one.return();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(cableOf(), 'other');
  await two.return();
  assert.ok(await until(() => cableOf() === 'none'));
  await cards.return();
});

test('the cable stream sends new cards when only the decoder\'s Wi-Fi state changes', async () => {
  const { club, who, gate, base } = await clubWithGate('Wim');
  const cable = events(await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, SSE), { raw: true });
  const first = await next(cable, 'bridge');
  assert.doesNotMatch(first.data, />Reporting</);
  await new Promise((resolve) => setTimeout(resolve, 100));
  app.engine.ingest({ workspaceId: club.id, decoder: gate.id, via: 'net', batch: { boot: 'b1', passings: [] } });
  assert.match((await next(cable, 'bridge')).data, />Reporting</);
  await cable.return();
});

test('the cable stream: another club\'s decoder or an unknown one is not found; another site or a stranger are refused; a page load goes to the Bridge page', async () => {
  const { user, gate, base, who, cableOf } = await clubWithGate('Eve');
  const theirs = app.club(user, 'Theirs');
  const eve = await app.login(user);
  const other = await (await app.api(eve, 'POST', `/workspaces/${theirs.id}/decoders`, { name: 'Theirs' })).json();
  assert.equal((await app.api(eve, 'GET', `${base}/decoders/${other.id}/cable`, undefined, SSE)).status, 404);
  assert.equal((await app.api(eve, 'GET', `${base}/decoders/nope/cable`, undefined, SSE)).status, 404);
  assert.equal((await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, { ...SSE, origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, { ...SSE, 'sec-fetch-site': 'cross-site' })).status, 403);
  const stranger = await app.login(await app.signUp('Finn'));
  assert.equal((await app.api(stranger, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, SSE)).status, 404);
  assert.equal((await app.api(stranger, 'GET', `${base}/bridge/events`, undefined, SSE)).status, 404);
  const out = await app.api(null, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, SSE);
  assert.equal(out.status, 303);
  assert.match(out.headers.get('location'), /^\/auth\/login\?/);
  assert.equal(cableOf(), 'none', 'none of them counts');
  const get = await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable`, undefined, { accept: 'text/html' });
  assert.equal(get.status, 303);
  assert.equal(get.headers.get('location'), `${base}/bridge`);
  // The old form post is gone.
  assert.equal((await app.form(who, `${base}/decoders/${gate.id}/cable`, { state: 'open' })).status, 405);
});

test('holders are pages: a page\'s cards leave out its own, and its dead connection plus its reconnect count once', async () => {
  const { who, gate, base, cableOf } = await clubWithGate('Hal');
  const PAGE = 'pageAAAAAAAAAAAAAAAA';
  const dead = events(await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable?page=${PAGE}`, undefined, SSE), { raw: true });
  await next(dead, 'bridge');
  const reconnect = events(await app.api(who, 'GET', `${base}/decoders/${gate.id}/cable?page=${PAGE}`, undefined, SSE), { raw: true });
  assert.doesNotMatch((await next(reconnect, 'bridge')).data, /Connected on another laptop/, 'one page, one holder');
  // After an unplug the same page holds its cards stream, maybe before the server saw the cable stream close.
  const mine = events(await app.api(who, 'GET', `${base}/bridge/events?page=${PAGE}`, undefined, SSE), { raw: true });
  assert.doesNotMatch((await next(mine, 'bridge')).data, /Connected on another laptop/);
  const theirs = events(await app.api(who, 'GET', `${base}/bridge/events?page=pageBBBBBBBBBBBBBBBB`, undefined, SSE), { raw: true });
  assert.match((await next(theirs, 'bridge')).data, /Connected on another laptop/);
  await dead.return();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(cableOf(), 'other', 'the reconnect still holds it');
  await reconnect.return();
  assert.ok(await until(() => cableOf() === 'none'));
  await mine.return();
  await theirs.return();
});

test('a member who may pair holds a stream that ends when pairing is no longer theirs', async () => {
  const watched = [];
  const rig = await startTiming({ streams: { watch: (_request, _ws, action, _watcher, end) => { watched.push({ action, end }); return () => {}; } } });
  try {
    const user = await rig.signUp('Jo');
    const club = rig.club(user, 'Pairs');
    const jo = await rig.login(user);
    const gate = await (await rig.api(jo, 'POST', `/workspaces/${club.id}/decoders`, { name: 'Gate' })).json();
    const it = events(await rig.api(jo, 'GET', `/clubs/${club.id}/decoders/${gate.id}/cable`, undefined, SSE), { raw: true });
    assert.match((await next(it, 'bridge')).data, /data-bridge-wifi hidden>Change Wi-Fi/);
    assert.deepEqual(watched.map((w) => w.action), ['timing.run', 'timing.setup']);
    watched[1].end();
    assert.equal(await next(it, 'bridge'), null, 'ended: the page reconnects and gets the cards it may have now');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(rig.engine.connectionsOf(club.id)[0].cable.state, 'none');
  } finally {
    await rig.close();
  }
});

test('a cable stream whose setup throws ends, logs once, and counts nothing', async () => {
  const rig = await startTiming({ streams: { watch: () => { throw new Error('checks are down'); } } });
  const logged = [];
  const error = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const user = await rig.signUp('Ivy');
    const club = rig.club(user, 'Down');
    const ivy = await rig.login(user);
    const gate = await (await rig.api(ivy, 'POST', `/workspaces/${club.id}/decoders`, { name: 'Gate' })).json();
    const res = await rig.api(ivy, 'GET', `/clubs/${club.id}/decoders/${gate.id}/cable`, undefined, SSE);
    await res.text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(logged.length, 1);
    assert.equal(rig.engine.connectionsOf(club.id)[0].cable.state, 'none');
    assert.deepEqual(rig.engine.headerOf(club.id), []);
  } finally {
    console.error = error;
    await rig.close();
  }
});
