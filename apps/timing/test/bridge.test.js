// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, createReader, createSimulator } from '@tinylap/timing';
import { Bridge, sendOutbox } from '../js/bridge.js';
import { memoryOutbox } from '../js/outbox.js';

/** A serial port whose other end is `sim` (or silence). */
function fakePort(sim) {
  let controller;
  const reader = createReader();
  const port = {
    readable: new ReadableStream({ start(c) { controller = c; } }),
    writable: new WritableStream({
      write(chunk) {
        if (!sim) return;
        for (const message of reader.push(new TextDecoder().decode(chunk))) {
          for (const line of sim.reply(message, 0)) controller.enqueue(new TextEncoder().encode(line));
        }
      },
    }),
    open: async () => {},
    close: async () => {},
  };
  return { port, send: (line) => controller.enqueue(new TextEncoder().encode(line)), end: () => controller.close() };
}

const until = async (fn) => {
  for (let i = 0; i < 200; i += 1) {
    if (await fn()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error('timed out');
};

test('an unpaired decoder is paired, then forwards passings', async () => {
  const sim = createSimulator({ cars: [] });
  const { port, send } = fakePort(sim);
  const posts = [];
  const outbox = memoryOutbox();
  const bridge = new Bridge({ port, outbox, post: async (decoder, batch) => { posts.push({ decoder, batch }); return { through: Math.max(...batch.passings.map((x) => x.t)) }; } });
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  await bridge.pair('dec_1', 't'.repeat(43), { ssid: 'Office', password: 'secret' });
  await until(() => bridge.state === 'ready');
  assert.equal(sim.decoder, 'dec_1');
  assert.equal(bridge.decoder, 'dec_1');

  const seen = [];
  bridge.addEventListener('passing', (event) => seen.push(event.detail));
  send(commands.lap('0A', 1000));
  send(commands.lap('0A', 9000));
  await until(async () => (await outbox.count()) === 0 && posts.length > 0 && seen.length === 2);
  assert.deepEqual(seen.map((x) => x.lapMs), [null, 8000], 'the local preview computes laps');
  assert.deepEqual(posts.flatMap((x) => x.batch.passings.map((y) => y.t)).sort((a, b) => a - b), [1000, 9000]);
  assert.ok(posts.every((x) => x.decoder === 'dec_1' && x.batch.boot === sim.boot));
  await bridge.close();
});

test('offline, passings wait in the outbox and go when the server is back', async () => {
  const sim = createSimulator({ cars: [], decoder: 'dec_1' });
  const { port, send } = fakePort(sim);
  let down = true;
  const outbox = memoryOutbox();
  const bridge = new Bridge({ port, outbox, retryMs: 10_000, post: async (_decoder, batch) => {
    if (down) throw new Error('offline');
    return { through: Math.max(...batch.passings.map((x) => x.t)) };
  } });
  await bridge.start();
  await until(() => bridge.state === 'ready');
  send(commands.lap('0A', 1000));
  await until(() => bridge.online === false);
  assert.equal(await outbox.count(), 1);
  assert.equal(bridge.lastError.message, 'offline');
  down = false;
  await bridge.flush();
  assert.equal(await outbox.count(), 0);
  assert.equal(bridge.online, true);
  await bridge.close();
});

test('a device that does not answer is not a TinyLap decoder; a lost port is disconnected', async () => {
  const silent = fakePort(null);
  const bridge = new Bridge({ port: silent.port, outbox: memoryOutbox(), post: async () => ({ through: null }), helloMs: 20 });
  await bridge.start();
  await until(() => bridge.state === 'not-tinylap');
  silent.end();
  await until(() => bridge.state === 'disconnected');
});

test('a group the server refuses for good does not block the others', async () => {
  const outbox = memoryOutbox();
  await outbox.add({ decoder: 'd1', boot: 'b1', transponder: '0A', t: 1 });
  await outbox.add({ decoder: 'd2', boot: 'b2', transponder: '0B', t: 2 });
  const posted = [];
  const bridge = new Bridge({ port: fakePort(null).port, outbox, retryMs: 10_000, post: async (decoder, batch) => {
    if (decoder === 'd1') throw Object.assign(new Error('no'), { status: 401 });
    posted.push(decoder);
    return { through: batch.passings.at(-1).t };
  } });
  await bridge.flush();
  assert.deepEqual(posted, ['d2']);
  assert.deepEqual((await outbox.list()).map((x) => x.decoder), ['d1']);
  assert.equal(bridge.lastError.message, 'no');
  await bridge.close();
});

test('a decoder that reboots with the port open is asked again who it is', async () => {
  const sim = createSimulator({ cars: [], decoder: 'dec_1' });
  const { port, send } = fakePort(sim);
  const bridge = new Bridge({ port, outbox: memoryOutbox(), post: async () => ({ through: null }) });
  await bridge.start();
  await until(() => bridge.state === 'ready');
  const before = bridge.boot;
  send(commands.clock(5000));
  send(commands.clock(9000));
  sim.reply({ type: 'reset' }, 9000); // the reset's own %TLID got lost on the cable
  send(commands.clock(100));
  await until(() => bridge.state === 'ready' && bridge.boot === sim.boot);
  assert.notEqual(bridge.boot, before);
  await bridge.close();
});

test('a reply that came too late does not answer the next request', async () => {
  const { port, send } = fakePort(null);
  const bridge = new Bridge({ port, outbox: memoryOutbox(), post: async () => ({ through: null }), helloMs: 10_000, replyMs: 30 });
  await bridge.start();
  await assert.rejects(bridge.pair('dec_1', 't'.repeat(43)), /didn't answer/);
  const second = bridge.pair('dec_1', 't'.repeat(43));
  send(commands.ok);
  await second;
  await bridge.close();
});

test('sending drops only the passings a batch carried, up to `through`', async () => {
  const outbox = memoryOutbox();
  const p = (t) => ({ decoder: 'd1', boot: 'b1', transponder: '0A', t });
  await outbox.add(p(1000));
  await outbox.add(p(9000));
  const posted = [];
  await sendOutbox(outbox, async (_decoder, batch) => {
    posted.push(batch.passings.map((x) => x.t));
    // The cable reads an older passing while the Wi-Fi copy already put 9000 on the server.
    if (posted.length === 1) await outbox.add(p(5000));
    return { through: 9000 };
  });
  assert.deepEqual(posted, [[1000, 9000], [5000]]);
  assert.equal(await outbox.count(), 0);
});
