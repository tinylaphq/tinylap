// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOOT_ID, createSimulator, createTrack, lapsOf, parseMessage } from '../index.js';

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
  assert.deepEqual(sim.reply({ type: 'startup' }, 0), ['%A&']);
  assert.deepEqual(sim.reply({ type: 'hello-request' }, 0), [`%TLID dec_1 ${sim.boot}&`]);
});

test('a ZRound reset starts a new boot with its clock at zero, and announces it', () => {
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 8000 }], jitterMs: 0, random: () => 0.5 });
  sim.advance(30_000);
  const before = sim.boot;
  const reply = sim.reply({ type: 'reset' }, 30_000);
  assert.notEqual(sim.boot, before);
  assert.deepEqual(reply, [`%TLID - ${sim.boot}&`, '%TLLOG boot reason=reset fw=sim&'], 'it says who it is now, unprompted');
  const next = sim.advance(40_000);
  assert.ok(next.length >= 1);
  assert.ok(next.every((p) => p.t <= 10_000));
});

test('the track gives the same crossings as the simulator, for the same random', () => {
  const cars = [{ transponder: '0A', lapMs: 8000 }, { transponder: '0B', lapMs: 9000 }];
  const sim = createSimulator({ cars, jitterMs: 100, random: seeded() });
  const track = createTrack({ cars: cars.map((c, i) => ({ id: i, lapMs: c.lapMs })), jitterMs: 100, random: seeded() });
  assert.deepEqual(track.advance(60_000).map((c) => [cars[c.id].transponder, c.t]), sim.advance(60_000).map((p) => [p.transponder, p.t]));
});

test('noise: a double read comes 50 to 300 ms later, and a miss drops the crossing', () => {
  const cars = [{ id: 7, lapMs: 5000 }];
  const doubled = createTrack({ cars, jitterMs: 0, random: () => 0.5, noise: { double: 1, random: () => 0.5 } }).advance(20_000);
  for (let i = 0; i < doubled.length; i += 2) {
    const gap = doubled[i + 1].t - doubled[i].t;
    assert.ok(gap >= 50 && gap <= 300, `gap ${gap}`);
  }
  assert.deepEqual(createTrack({ cars, jitterMs: 0, random: () => 0.5, noise: { miss: 1, random: () => 0.5 } }).advance(20_000), []);
  for (const c of createTrack({ cars, random: () => 0.5 }).advance(20_000)) {
    assert.ok(c.hits >= 5 && c.hits <= 60 && c.strength >= 100 && c.strength <= 255);
  }
});

const vectors = JSON.parse(readFileSync(new URL('./zround-vectors.json', import.meta.url), 'utf8'));
const stat = (up, pass) => `%TLLOG stat up=${up} batches=0 frames=0 rej.start=0 rej.bit=0 rej.stop=0 rej.short=0 rej.burst=0 rej.long=0 rej.parity=0 overflow=0 ringlow=0 qdrop=0 pass=${pass} single=0 quiet=0 minlap=0 rxdrop=0 suppressed=0 heap=200000&`;

test('start gives %TLID, then %TLLOG boot', () => {
  const sim = createSimulator({ cars: [], decoder: 'dec_1' });
  const before = sim.boot;
  const lines = sim.start(0);
  assert.notEqual(sim.boot, before, 'a new boot');
  assert.deepEqual(lines, [`%TLID dec_1 ${sim.boot}&`, '%TLLOG boot reason=poweron fw=sim&']);
});

test('%T3E8& comes first, then one a second, caught up after a late tick', () => {
  const sim = createSimulator({ cars: [] });
  sim.start(0);
  assert.deepEqual(sim.tick(999), []);
  assert.deepEqual(sim.tick(3500), ['%T3E8&', '%T7D0&', '%TBB8&']);
  assert.deepEqual(sim.tick(3999), []);
  assert.deepEqual(sim.tick(4000), ['%TFA0&']);
});

test('a %L comes before a %T of the same millisecond, with its pass line after it', () => {
  // random 0: the first crossing is at 2000 ms, as is the second %T.
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 8000 }], jitterMs: 0, random: () => 0 });
  sim.start(0);
  assert.deepEqual(sim.tick(2000), ['%T3E8&', '%L0A,7D0&', '%TLLOG pass id=0A t=7D0 first=7A8 last=7F8 frames=8&', '%T7D0&']);
});

test('stat every 10 s from power-up, not reset by %I&', () => {
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 3000 }], jitterMs: 0, random: () => 0 });
  sim.start(0);
  sim.tick(4000);
  sim.reply({ type: 'reset' }, 4000);
  const lines = sim.tick(10_000);
  // Crossings at 2000 (the old boot), then every 3 s from 5000 (the new boot's 1000).
  assert.deepEqual(lines.filter((l) => l.startsWith('%TLLOG stat')), [stat(10, 3)]);
  assert.equal(lines.at(-1), stat(10, 3), 'last, after the %T of the same millisecond');
  assert.deepEqual(sim.tick(19_999).filter((l) => l.startsWith('%TLLOG stat')), []);
  assert.deepEqual(sim.tick(20_000).filter((l) => l.startsWith('%TLLOG stat')), [stat(20, 7)], 'the crossing at 20 000 counts');
});

test('%I& gives %TLID, a reset boot line, a clock from zero and no early crossings', () => {
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 8000 }], jitterMs: 0, random: () => 0.5 });
  sim.start(0);
  sim.advance(30_000);
  const reply = sim.reply({ type: 'reset' }, 30_000);
  assert.deepEqual(reply, [`%TLID - ${sim.boot}&`, '%TLLOG boot reason=reset fw=sim&']);
  const lines = sim.tick(32_000);
  assert.deepEqual(lines.filter((l) => l.startsWith('%T') && !l.startsWith('%TL')), ['%T3E8&', '%T7D0&'], 'the clock from zero');
  const next = sim.advance(40_000);
  assert.ok(next.length >= 1);
  assert.ok(next.every((p) => p.t <= 10_000));
});

test('a tick at the reset\'s now sends nothing of the old boot', () => {
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 1000 }], jitterMs: 0, random: () => 0 });
  sim.start(0);
  sim.reply({ type: 'reset' }, 5000);
  assert.deepEqual(sim.tick(5000), []);
});

test('the boot starts uptimeMs before construction, and nothing before construction is caught up', () => {
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 8000 }], jitterMs: 0, random: () => 0, uptimeMs: 60_000 });
  assert.deepEqual(sim.tick(999), []);
  assert.deepEqual(sim.tick(1000), ['%TEE48&']);
  assert.deepEqual(sim.tick(2000).slice(0, 2), ['%L0A,F230&', '%TLLOG pass id=0A t=F230 first=F208 last=F258 frames=8&']);
  assert.deepEqual(sim.tick(10_000).filter((l) => l.startsWith('%TLLOG stat')), [stat(70, 2)], 'the crossings at 2000 and 10 000');
});

test('%TLWIFI answers through the wifi vectors', () => {
  const sim = createSimulator({ cars: [] });
  for (const { ssid, password, reply } of vectors.wifi) {
    assert.deepEqual(sim.reply(parseMessage(`TLWIFI ${ssid} ${password}`), 0), [reply], `${ssid} / ${password}`);
  }
});
