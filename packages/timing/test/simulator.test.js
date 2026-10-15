// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOT_ID, createSimulator, lapsOf } from '../index.js';

/** A seeded random, so laps are repeatable. */
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('cars cross at about their lap time, in time order', () => {
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 8000 }, { transponder: '0B', lapMs: 9000 }], jitterMs: 100, random: seeded() });
  const passings = sim.advance(60_000);
  assert.deepEqual(passings.map((p) => p.t), [...passings.map((p) => p.t)].sort((a, b) => a - b));
  for (const transponder of ['0A', '0B']) {
    const laps = lapsOf(passings.filter((p) => p.transponder === transponder).map((p) => ({ boot: sim.boot, t: p.t })))
      .filter((s) => s.kind === 'lap').map((s) => /** @type {any} */ (s).ms);
    const target = transponder === '0A' ? 8000 : 9000;
    assert.ok(laps.length >= 5, transponder);
    for (const ms of laps) assert.ok(Math.abs(ms - target) <= 100, `${transponder} ${ms}`);
  }
  assert.deepEqual(sim.advance(60_000), [], 'nothing twice');
});

test('the simulator answers hello, pairing, Wi-Fi and a ZRound startup', () => {
  const sim = createSimulator({ cars: [] });
  assert.match(sim.boot, BOOT_ID);
  assert.deepEqual(sim.reply({ type: 'hello-request' }, 0), [`%TLID - ${sim.boot}&`]);
  const token = 't'.repeat(43);
  assert.deepEqual(sim.reply({ type: 'pair', decoder: 'dec_1', token }, 0), ['%TLOK&']);
  assert.equal(sim.decoder, 'dec_1');
  assert.equal(sim.token, token);
  assert.deepEqual(sim.reply({ type: 'wifi', ssid: 'x', password: 'y' }, 0), ['%TLOK&']);
  assert.deepEqual(sim.reply({ type: 'startup' }, 0), ['%A&']);
  assert.deepEqual(sim.reply({ type: 'hello-request' }, 0), [`%TLID dec_1 ${sim.boot}&`]);
});

test('a ZRound reset starts a new boot with its clock at zero, and announces it', () => {
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 8000 }], jitterMs: 0, random: () => 0.5 });
  sim.advance(30_000);
  const before = sim.boot;
  const reply = sim.reply({ type: 'reset' }, 30_000);
  assert.notEqual(sim.boot, before);
  assert.deepEqual(reply, [`%TLID - ${sim.boot}&`], 'it says who it is now, unprompted');
  const next = sim.advance(10_000);
  assert.ok(next.length >= 1);
  assert.ok(next.every((p) => p.t <= 10_000));
});
