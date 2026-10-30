// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let stranger;
let office;
let gate;
let spare;
let ana;
const logged = [];

before(async () => {
  app = await startTiming({
    clock,
    limits: { ingest: 5, logs: 4, pair: 50 },
    log: (line) => logged.push({ line, through: line.startsWith('{') ? app.store.through(JSON.parse(line).decoder, JSON.parse(line).boot) : null }),
  });
  const [owner, zed] = await Promise.all(['Ana', 'Zed'].map((n) => app.signUp(n)));
  office = app.club(owner, 'Office');
  app.club(zed, 'Elsewhere');
  member = await app.login(owner);
  stranger = await app.login(zed);
  const pair = async (name) => (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name })).json();
  gate = await pair('Gate');
  spare = await pair('Spare');
  ana = await (await app.api(member, 'POST', `/workspaces/${office.id}/drivers`, { name: 'Ana' })).json();
  app.engine.start(office.id, { kind: 'practice' });
});
after(() => app.close());

const batch = { boot: 'b00tb00t', passings: [{ transponder: '0a', t: 1000 }, { transponder: '0A', t: 9000 }] };
const asDecoder = (decoder, token, body = batch, headers = {}) => fetch(`${app.base}/decoders/${decoder}/passings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
  body: JSON.stringify(body),
});
const decoderLogs = () => logged.filter((l) => l.line.startsWith('{')).map((l) => ({ ...JSON.parse(l.line), through: l.through }));
const bare = (l) => { const copy = { ...l }; delete copy.through; return copy; };
const pairDecoder = async (name) => (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name })).json();
const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal((await res.json()).type, `${app.base}/problems/${name}`);
};

test('a decoder posts with its token; the same batch through the bridge is a duplicate', async () => {
  const net = await asDecoder(gate.id, gate.token);
  assert.equal(net.status, 200);
  assert.deepEqual(await net.json(), { stored: 2, duplicates: 0, through: 9000 });
  const serial = await app.api(member, 'POST', `/decoders/${gate.id}/passings`, batch);
  assert.deepEqual(await serial.json(), { stored: 0, duplicates: 2, through: 9000 });
  const snapshot = await (await app.api(member, 'GET', `/workspaces/${office.id}`)).json();
  assert.deepEqual(snapshot.crossings.map((c) => [c.transponder, c.lapMs, c.via]), [['0A', 8000, 'net'], ['0A', null, 'net']]);
  assert.deepEqual(snapshot.unknown, ['0A']);
});

test('wrong, foreign, malformed and revoked tokens are refused', async () => {
  await problemOf(await asDecoder(gate.id, 'x'.repeat(43)), 401, 'unauthorized');
  await problemOf(await asDecoder(gate.id, spare.token), 401, 'unauthorized');
  await problemOf(await asDecoder(gate.id, gate.token, batch, { authorization: 'Basic abc' }), 401, 'unauthorized');
  const temp = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, {})).json();
  assert.equal((await app.api(member, 'DELETE', `/workspaces/${office.id}/decoders/${temp.id}`)).status, 204);
  await problemOf(await asDecoder(temp.id, temp.token), 401, 'unauthorized');
});

test('the bridge path needs a member of the decoder\'s workspace, from the app', async () => {
  // Signed out or not allowed may change with the next sign-in, so the bridge keeps the passings: 401 and 403.
  await problemOf(await app.api(null, 'POST', `/decoders/${gate.id}/passings`, batch), 401, 'unauthorized');
  await problemOf(await app.api(null, 'POST', '/decoders/nope/passings', batch), 401, 'unauthorized');
  await problemOf(await app.api(stranger, 'POST', `/decoders/${gate.id}/passings`, batch), 403, 'forbidden');
  await problemOf(await app.api(member, 'POST', `/decoders/${gate.id}/passings`, batch, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), 403, 'forbidden');
  await problemOf(await app.api(member, 'POST', '/decoders/nope/passings', batch, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), 403, 'forbidden');
  // A decoder that doesn't exist (never paired, or removed) never will: 404, and the bridge drops them.
  await problemOf(await app.api(member, 'POST', '/decoders/nope/passings', batch), 404, 'not-found');
  const temp = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, {})).json();
  assert.equal((await app.api(member, 'DELETE', `/workspaces/${office.id}/decoders/${temp.id}`)).status, 204);
  await problemOf(await app.api(member, 'POST', `/decoders/${temp.id}/passings`, batch), 404, 'not-found');
});

test('bad batches are refused whole', async () => {
  await problemOf(await asDecoder(spare.id, spare.token, { boot: 'x', passings: [{ transponder: '0A', t: 1 }] }), 422, 'invalid-request');
  await problemOf(await asDecoder(spare.id, spare.token, { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1 }, { transponder: 'q', t: 2 }] }), 422, 'invalid-request');
  assert.equal(app.store.through(spare.id, 'b00tb00t'), null, 'nothing of a bad batch is stored');
  const text = await fetch(`${app.base}/decoders/${spare.id}/passings`, { method: 'POST', headers: { authorization: `Bearer ${spare.token}`, 'content-type': 'text/plain' }, body: 'hi' });
  await problemOf(text, 415, 'unsupported-media-type');
});

test('ingest is rate limited per decoder', async () => {
  // The limit is 5 per minute here; the spare decoder has used 3.
  assert.equal((await asDecoder(spare.id, spare.token)).status, 200);
  assert.equal((await asDecoder(spare.id, spare.token)).status, 200);
  const res = await asDecoder(spare.id, spare.token);
  await problemOf(res, 429, 'rate-limited');
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

const withLogs = (logs, passings = [{ transponder: '0A', t: 1000 }]) => ({ boot: 'b00tb00t', passings, logs });

test('each log line is one JSON line, after the passings, with no workspace', async () => {
  const d = await pairDecoder('Log1');
  logged.length = 0;
  const res = await asDecoder(d.id, d.token, withLogs(['pass id=1F t=1E0A first=1DE2 last=1E32 frames=8']));
  assert.equal(res.status, 200);
  const [entry, ...rest] = decoderLogs();
  assert.equal(rest.length, 0);
  const { through, ...line } = entry;
  assert.deepEqual(line, {
    type: 'decoder-log', decoder: d.id, boot: 'b00tb00t', via: 'net', kind: 'pass',
    fields: { id: '1F', t: '1E0A', first: '1DE2', last: '1E32', frames: '8' },
  });
  assert.deepEqual(Object.keys(line.fields), ['id', 't', 'first', 'last', 'frames']);
  assert.ok(!logged.some((l) => l.line.includes(office.id)), 'no workspace id');
  assert.equal(through, 1000);
});

test('through the bridge the lines say via serial', async () => {
  const d = await pairDecoder('Log2');
  logged.length = 0;
  const res = await app.api(member, 'POST', `/decoders/${d.id}/passings`, withLogs(['stat up=1']));
  assert.equal(res.status, 200);
  assert.deepEqual(decoderLogs().map((l) => [l.via, l.kind]), [['serial', 'stat']]);
});

test('a bad line is skipped and counted, and the passings are still stored', async () => {
  const d = await pairDecoder('Log3');
  logged.length = 0;
  const res = await asDecoder(d.id, d.token, withLogs(['stat up=1', 'BAD', 'stat x="y"']));
  assert.deepEqual(await res.json(), { stored: 1, duplicates: 0, through: 1000 });
  const lines = decoderLogs().map(bare);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, 'decoder-log');
  assert.deepEqual(lines[1], { type: 'decoder-log-skipped', decoder: d.id, boot: 'b00tb00t', unreadable: 2, limited: 0, denied: 0 });
});

test('a line with a secret-looking key is skipped as denied', async () => {
  const d = await pairDecoder('Log4');
  logged.length = 0;
  const res = await asDecoder(d.id, d.token, withLogs(['stat token=SECRETVALUE', 'stat password=SECRETVALUE', 'stat psk=SECRETVALUE', 'stat ssid=SECRETVALUE']));
  assert.equal(res.status, 200);
  const lines = decoderLogs();
  assert.deepEqual(lines.map(bare), [{ type: 'decoder-log-skipped', decoder: d.id, boot: 'b00tb00t', unreadable: 0, limited: 0, denied: 4 }]);
  assert.ok(!logged.some((l) => l.line.includes('SECRETVALUE')));
});

test('past 4 lines a minute the rest are skipped as limited', async (t) => {
  const d = await pairDecoder('Log5');
  const before = clock.now;
  t.after(() => { clock.now = before; });
  logged.length = 0;
  await asDecoder(d.id, d.token, withLogs(['stat a=1', 'stat a=2', 'stat a=3', 'stat a=4', 'stat a=5', 'stat a=6']));
  let lines = decoderLogs();
  assert.equal(lines.filter((l) => l.type === 'decoder-log').length, 4);
  assert.deepEqual(lines.at(-1), { type: 'decoder-log-skipped', decoder: d.id, boot: 'b00tb00t', unreadable: 0, limited: 2, denied: 0, through: 1000 });
  clock.now += 60_000;
  logged.length = 0;
  await asDecoder(d.id, d.token, withLogs(['stat a=7']));
  lines = decoderLogs();
  assert.deepEqual(lines.map((l) => l.type), ['decoder-log']);
});

test('a logs-only batch answers through and updates last_seen_at', async (t) => {
  const d = await pairDecoder('Log6');
  const before = clock.now;
  t.after(() => { clock.now = before; });
  await asDecoder(d.id, d.token, withLogs([]));
  clock.now += 1000;
  const res = await asDecoder(d.id, d.token, { boot: 'b00tb00t', passings: [], logs: ['stat up=1'] });
  assert.deepEqual(await res.json(), { stored: 0, duplicates: 0, through: 1000 });
  assert.equal(app.store.decoders(office.id).find((x) => x.id === d.id).lastSeenAt, clock.now);
});

test('a logs-only batch of a new boot answers through null', async () => {
  const d = await pairDecoder('Log7');
  const res = await asDecoder(d.id, d.token, { boot: 'n3wb00t0', passings: [], logs: ['stat up=1'] });
  assert.deepEqual(await res.json(), { stored: 0, duplicates: 0, through: null });
});

test('no log line on a 401, a 403 or a 404', async () => {
  const body = withLogs(['stat up=1']);
  logged.length = 0;
  await problemOf(await asDecoder(gate.id, 'x'.repeat(43), body), 401, 'unauthorized');
  await problemOf(await app.api(stranger, 'POST', `/decoders/${gate.id}/passings`, body), 403, 'forbidden');
  await problemOf(await app.api(member, 'POST', '/decoders/nope/passings', body), 404, 'not-found');
  assert.deepEqual(decoderLogs(), []);
});

test('a body the bridge never sends is a 422 and logs nothing', async () => {
  const d = await pairDecoder('Log8');
  logged.length = 0;
  await problemOf(await asDecoder(d.id, d.token, withLogs(Array.from({ length: 65 }, () => 'stat up=1'))), 422, 'invalid-request');
  await problemOf(await asDecoder(d.id, d.token, withLogs([`stat k=${'a'.repeat(504)}`])), 422, 'invalid-request');
  assert.deepEqual(decoderLogs(), []);
});

test('tap entry times a driver by hand', async () => {
  const tap = () => app.api(member, 'POST', `/workspaces/${office.id}/tap`, { driverId: ana.id });
  assert.deepEqual(await (await tap()).json(), { stored: true, lapMs: null });
  clock.now += 8000;
  assert.deepEqual(await (await tap()).json(), { stored: true, lapMs: 8000 });
  assert.deepEqual(await (await tap()).json(), { stored: false, lapMs: null }, 'the same millisecond');
  await problemOf(await app.api(member, 'POST', `/workspaces/${office.id}/tap`, { driverId: 'nobody' }), 422, 'invalid-request');
  await problemOf(await app.api(stranger, 'POST', `/workspaces/${office.id}/tap`, { driverId: ana.id }), 404, 'not-found');
});
