// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, createReader, createSimulator } from '@tinylap/timing';
import { Bridge } from '../js/bridge.js';
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
