// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createSimulator, readBatch } from '@tinylap/timing';
import { carsOf, createSender, runSerial } from '../decoder-sim.js';

test('cars get distinct transponders and lap times', () => {
  assert.deepEqual(carsOf(3), [{ transponder: '10', lapMs: 7500 }, { transponder: '11', lapMs: 7900 }, { transponder: '12', lapMs: 8300 }]);
});

test('the sender keeps passings until the server holds them', async () => {
  const posts = [];
  let through = 1000;
  let fail = false;
  const fetch = async (url, init) => {
    posts.push({ url, init });
    if (fail) return new Response('down', { status: 503 });
    return Response.json({ stored: 1, duplicates: 0, through });
  };
  const sender = createSender({ url: 'http://timing.test/', decoder: 'd1', token: 't'.repeat(43), boot: 'b00tb00t', fetch });
  sender.add([{ transponder: '10', t: 1000 }, { transponder: '10', t: 9000 }]);
  assert.deepEqual(await sender.flush(), { sent: 2 });
  assert.equal(posts[0].url, 'http://timing.test/decoders/d1/passings');
  assert.equal(posts[0].init.headers.authorization, `Bearer ${'t'.repeat(43)}`);
  assert.deepEqual(JSON.parse(posts[0].init.body), { boot: 'b00tb00t', now: 0, passings: [{ transponder: '10', t: 1000 }, { transponder: '10', t: 9000 }] });
  assert.equal(sender.pending, 1, 'the server only holds up to 1000');
  fail = true;
  await assert.rejects(sender.flush(), /503/);
  assert.equal(sender.pending, 1);
  fail = false;
  through = 9000;
  await sender.flush();
  assert.equal(sender.pending, 0);
  assert.deepEqual(await sender.flush(), { sent: 0 });
});

test('the sender keeps a passing it did not send, even below `through`', async () => {
  let sender;
  const fetch = async (_url, init) => {
    const { passings } = JSON.parse(init.body);
    if (passings.length === 1 && passings[0].t === 9000) sender.add([{ transponder: '11', t: 5000 }]);
    return Response.json({ stored: passings.length, duplicates: 0, through: 9000 });
  };
  sender = createSender({ url: 'http://timing.test', decoder: 'd1', token: 't'.repeat(43), boot: 'b00tb00t', fetch });
  sender.add([{ transponder: '10', t: 9000 }]);
  await sender.flush();
  assert.equal(sender.pending, 1, 'added while the batch was in flight');
  await sender.flush();
  assert.equal(sender.pending, 0);
});

test('the sender stamps `now`, beats every 10 s while in use, and goes quiet after 15 idle minutes', async () => {
  const bodies = [];
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (!readBatch(body).ok) return new Response('refused', { status: 422 });
    bodies.push(body);
    return Response.json({ stored: 0, duplicates: 0, through: null });
  };
  let now = 0;
  const sender = createSender({ url: 'http://timing.test', decoder: 'd1', token: 't'.repeat(43), boot: 'b00tb00t', fetch, clock: () => now });
  now = 9_999;
  assert.deepEqual(await sender.flush(), { sent: 0 }, 'not due yet');
  assert.equal(bodies.length, 0);
  now = 10_000;
  await sender.flush();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].now, 10_000);
  assert.deepEqual(bodies[0].passings, []);
  assert.match(bodies[0].logs[0], /^stat up=10 /);
  assert.equal(bodies[0].quiet, undefined);
  now = 15_000;
  await sender.flush();
  assert.equal(bodies.length, 1, 'the next beat is 10 s later');
  now = 15 * 60_000;
  await sender.flush();
  assert.equal(bodies.at(-1).quiet, true);
  assert.ok(bodies.at(-1).logs.length > 0, 'a logs-only batch needs its stat line');
  const count = bodies.length;
  now += 60_000;
  await sender.flush();
  assert.equal(bodies.length, count, 'silent after the quiet batch');
  sender.add([{ transponder: '10', t: now }]);
  await sender.flush();
  assert.equal(bodies.at(-1).quiet, undefined, 'a passing ends the quiet');
  assert.equal(bodies.at(-1).passings.length, 1);
});

test('an answer with `watched: true` keeps the sender beating past 15 idle minutes, as the board does', async () => {
  const bodies = [];
  let watched = true;
  const fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({ stored: 0, duplicates: 0, through: null, watched });
  };
  let now = 0;
  const sender = createSender({ url: 'http://timing.test', decoder: 'd1', token: 't'.repeat(43), boot: 'b00tb00t', fetch, clock: () => now });
  for (now = 10_000; now <= 30 * 60_000; now += 10_000) await sender.flush();
  assert.ok(bodies.every((b) => b.quiet === undefined), 'never quiet while watched');
  assert.equal(bodies.length, 180, 'a beat every 10 s for 30 minutes');
  watched = false;
  await sender.flush();
  now = 45 * 60_000 - 10_000;
  await sender.flush();
  assert.equal(bodies.at(-1).quiet, undefined, 'still in use just under 15 min after the last watched answer');
  now += 10_000;
  await sender.flush();
  assert.equal(bodies.at(-1).quiet, true, 'quiet 15 min after the last viewer left');
});

const settle = () => new Promise((done) => setImmediate(done));

test('the serial mode answers commands and writes laps', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (d) => { text += d; });
  let now = 0;
  const sim = createSimulator({ cars: carsOf(1), jitterMs: 0, random: () => 0 });
  const serial = runSerial({ input, output, sim, clock: () => now });
  await settle();
  assert.equal(text, `%TLID - ${sim.boot}&%TLLOG boot reason=poweron fw=sim&%TLNET off  0 none&`, 'the power-up lines first');
  input.write('%TLHE');
  input.write('LLO&%C&');
  await settle();
  assert.match(text, new RegExp(`%TLID - ${sim.boot}&%A&`));
  now = 20_000;
  serial.tick();
  await settle();
  assert.match(text, /%L10,7D0&/, 'the first crossing at 2000 ms');
  assert.match(text, /%L10,251C&/, 'the next at 9500 ms');
  serial.stop();
});
