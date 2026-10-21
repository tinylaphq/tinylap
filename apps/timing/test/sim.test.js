// apps/timing/test/sim.test.js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameReader, frames } from '@tinylap/timing';
import { simulation } from '../public/sim/models.js';
import { easylapModel } from '../public/sim/models/easylap.js';
import { tinylapModel } from '../public/sim/models/tinylap.js';
import { zroundModel } from '../public/sim/models/zround.js';

const enc = (s) => new TextEncoder().encode(s);
const text = (chunks) => chunks.map((c) => new TextDecoder().decode(c)).join('');

test('?simulate picks a model and a lap time (spec §5.4)', () => {
  assert.equal(simulation(''), null);
  assert.deepEqual(simulation('?simulate'), { name: 'tinylap', transport: 'serial', lapMs: 8000 });
  assert.deepEqual(simulation('?simulate=tinylap'), { name: 'tinylap', transport: 'serial', lapMs: 8000 });
  assert.deepEqual(simulation('?simulate=fast'), { name: 'tinylap', transport: 'serial', lapMs: 2000 });
  assert.deepEqual(simulation('?simulate=zround&speed=fast'), { name: 'zround', transport: 'serial', lapMs: 2000 });
  assert.deepEqual(simulation('?simulate=easylap'), { name: 'easylap', transport: 'hid', lapMs: 8000 });
  const warn = console.warn;
  const said = [];
  console.warn = (m) => said.push(m);
  try {
    assert.deepEqual(simulation('?simulate=amb'), { name: 'tinylap', transport: 'serial', lapMs: 8000 });
  } finally {
    console.warn = warn;
  }
  assert.match(said[0], /tinylap, zround, easylap/);
});

test('the TinyLap model answers as today\'s simulated decoder', () => {
  const model = tinylapModel({ cars: 0 });
  assert.equal(text(model.write(enc('%C&'), 0)), '%A&');
  assert.equal(text(model.write(enc('%TLHELLO&'), 0)), `%TLID - ${model.sim.boot}&`);
});

test('the ZRound model reads like RiCino: only the last 3-byte chunk of a burst counts', () => {
  const together = zroundModel({ cars: 0, bootMs: 0, ackMs: 10, acks: 2 });
  together.write(enc('%C&%TLHELLO&'), 0);
  assert.equal(text(together.tick(10)), '', 'the burst ended on "LO&"');
  const apart = zroundModel({ cars: 0, bootMs: 0, ackMs: 10, acks: 2 });
  apart.write(enc('%C&'), 0);
  assert.equal(text(apart.tick(10)), '%A&');
  assert.equal(text(apart.tick(20)), '%A&');
});

test('the ZRound model loses what comes in its boot time, and is silent until %I&', () => {
  const model = zroundModel({ cars: 1, lapMs: 500, bootMs: 100, ackMs: 1, acks: 1, clockEveryMs: 100 });
  model.write(enc('%C&'), 50);
  assert.equal(text(model.tick(60)), '', 'lost while it boots');
  model.write(enc('%C&'), 200);
  assert.equal(text(model.tick(210)), '%A&');
  assert.equal(text(model.tick(5000)), '', 'nothing before %I&');
  model.write(enc('%I&'), 5000);
  model.tick(5010);
  assert.equal(model.running, true);
  assert.match(text(model.tick(8000)), /%T64&[\s\S]*%L30,/);
});

test('the ZRound model ignores as many %I& as it is told to', () => {
  const model = zroundModel({ cars: 0, bootMs: 0, ignoresStarts: 1 });
  model.write(enc('%I&'), 0);
  model.tick(1);
  assert.equal(model.running, false);
  model.write(enc('%I&'), 2);
  model.tick(3);
  assert.equal(model.running, true);
});

test('the EasyLap model sends heartbeats and passings, answers a start with 00, and can spoil its checksums', () => {
  const model = easylapModel({ cars: 1, lapMs: 500, heartbeatMs: 250 });
  const reader = createFrameReader();
  const items = reader.push(Uint8Array.from(model.tick(3000).flatMap((f) => [...f])));
  assert.ok(items.some((x) => x.type === 'heartbeat') && items.some((x) => x.type === 'passing' && /^A1B2C$/.test(x.transponder)));
  assert.deepEqual(model.write(frames.start, 3000).map((x) => [...x]), [[0x00]]);
  const waiting = easylapModel({ cars: 0, waitsForStart: true });
  assert.deepEqual(waiting.tick(1000), []);
  const bad = createFrameReader();
  bad.push(Uint8Array.from(easylapModel({ cars: 0, corrupt: true }).tick(1000).flatMap((f) => [...f])));
  assert.ok(bad.mismatches > 0);
});
