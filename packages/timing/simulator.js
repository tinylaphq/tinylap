// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// A pretend decoder: cars that cross the line at about their lap time, and
// the replies a TinyLap decoder gives to ZRound and %TL… commands. Drives
// tools/decoder-sim.js and, when the server's simulator setting is on, the
// bridge page's simulated devices (public/sim/install.js), so the whole chain
// can be tried without hardware.

import { randomBoot } from './passing.js';
import { commands, wifiError } from './zround.js';

/** @import { ZroundMessage } from './types.js' */

/**
 * Cars that cross the line at about their lap time (decoders spec §5.1). Each
 * crossing carries the hits and strength a decoder reports with it.
 * @param {{ cars: { id: number, lapMs: number }[], jitterMs?: number, random?: () => number,
 *   noise?: { double?: number, miss?: number, garbage?: number, random?: () => number } }} options
 */
export function createTrack({ cars, jitterMs = 150, random = Math.random, noise = {} }) {
  const chance = noise.random ?? Math.random;
  /** Each car's next crossing in decoder time. The first comes within one lap. */
  const next = cars.map((car) => ({ ...car, at: 2000 + random() * car.lapMs }));
  const jitter = () => (random() * 2 - 1) * jitterMs;
  /** @type {{ id: number, t: number, hits: number, strength: number }[]} */
  let doubles = [];
  return {
    /** The crossings up to decoder time `until`, in time order. @param {number} until */
    advance(until) {
      /** @type {{ id: number, t: number, hits: number, strength: number }[]} */
      const out = [];
      for (;;) {
        let first = -1;
        for (let i = 0; i < next.length; i += 1) if (first === -1 || next[i].at < next[first].at) first = i;
        if (first === -1 || next[first].at > until) break;
        const car = next[first];
        const crossing = { id: car.id, t: Math.round(car.at), hits: 5 + Math.floor(chance() * 56), strength: 100 + Math.floor(chance() * 156) };
        car.at += Math.max(car.lapMs + jitter(), 1);
        if (noise.miss && chance() < noise.miss) continue;
        out.push(crossing);
        if (noise.double && chance() < noise.double) doubles.push({ ...crossing, t: crossing.t + 50 + Math.floor(chance() * 251) });
      }
      const due = doubles.filter((d) => d.t <= until);
      doubles = doubles.filter((d) => d.t > until);
      return [...out, ...due].sort((a, b) => a.t - b.t);
    },
    /** The clock went to zero at `now`. @param {number} now */
    reset(now) {
      for (const car of next) car.at -= now;
      doubles = doubles.map((d) => ({ ...d, t: d.t - now }));
    },
  };
}

/** The counters of a `stat` line, in the firmware's order (docs/timing.md, Diagnostics). */
const STAT_COUNTERS = ['batches', 'frames', 'rej.start', 'rej.bit', 'rej.stop', 'rej.short', 'rej.burst', 'rej.long', 'rej.parity',
  'overflow', 'ringlow', 'qdrop', 'pass', 'single', 'quiet', 'minlap', 'rxdrop', 'suppressed'];
const STAT_EVERY_MS = 10_000;
const hex = (/** @type {number} */ n) => n.toString(16).toUpperCase();

/**
 * A TinyLap decoder as the firmware behaves (spec §4): power-up and reset lines, a `%T` every whole
 * second of the boot, a `%L` and its `%TLLOG pass` per passing, and a `%TLLOG stat` every 10 s from
 * power-up. Every method takes `now`, one monotonic clock of the caller's; the boot's clock is kept
 * here. The boot started `uptimeMs` before construction; nothing due before construction is caught up.
 * @param {{ cars: { transponder: string, lapMs: number }[], jitterMs?: number, random?: () => number,
 *   decoder?: string | null, token?: string | null, uptimeMs?: number }} options
 */
export function createSimulator({ cars, jitterMs = 150, random = Math.random, decoder = null, token = null, uptimeMs = 0 }) {
  let boot = randomBoot();
  let paired = decoder;
  let secret = token;
  const track = createTrack({ cars: cars.map((car, i) => ({ id: i, lapMs: car.lapMs })), jitterMs, random });
  /** The boot's start and the power-up, on `now`'s clock. */
  let bootStart = -uptimeMs;
  let powerUp = -uptimeMs;
  /** The next `%T`, on the boot's clock, and the next `stat`, on `now`'s. */
  let nextSecond = (Math.floor(uptimeMs / 1000) + 1) * 1000;
  let nextStat = powerUp + (Math.floor(uptimeMs / STAT_EVERY_MS) + 1) * STAT_EVERY_MS;
  let passings = 0;
  // The cars start at construction, not at the boot's start.
  track.reset(-uptimeMs);

  /** A new boot at `now`: the clock from zero, and the old boot's crossings not yet sent are dropped. @param {number} now */
  const newBoot = (now) => {
    track.advance(now - bootStart);
    track.reset(now - bootStart);
    boot = randomBoot();
    bootStart = now;
    nextSecond = 1000;
  };
  /** The passings up to `now`, on the boot's clock. @param {number} now */
  const crossings = (now) => track.advance(now - bootStart).map((c) => ({ transponder: cars[c.id].transponder, t: c.t }));
  const stat = (/** @type {number} */ up) =>
    `%TLLOG stat up=${up} ${STAT_COUNTERS.map((key) => `${key}=${key === 'pass' ? passings : 0}`).join(' ')} heap=200000&`;

  return {
    get boot() {
      return boot;
    },
    get decoder() {
      return paired;
    },
    get token() {
      return secret;
    },
    /** Power-up at `now`: a new boot, and the `stat` timer and its counters from zero. @param {number} now @returns {string[]} */
    start(now) {
      newBoot(now);
      powerUp = now;
      nextStat = now + STAT_EVERY_MS;
      passings = 0;
      return [commands.id(paired, boot), '%TLLOG boot reason=poweron fw=sim&'];
    },
    /** The lines due up to `now`, in time order: a `%L` (with its `pass` line) before a `%T` of the same millisecond, then `stat`. @param {number} now @returns {string[]} */
    tick(now) {
      /** @type {{ at: number, order: number, lines: () => string[] }[]} */
      const due = [];
      for (const { transponder, t } of crossings(now)) {
        due.push({ at: bootStart + t, order: 0, lines: () => {
          passings += 1;
          return [commands.lap(transponder, t), `%TLLOG pass id=${transponder} t=${hex(t)} first=${hex(Math.max(t - 40, 0))} last=${hex(t + 40)} frames=8&`];
        } });
      }
      for (; bootStart + nextSecond <= now; nextSecond += 1000) {
        const t = nextSecond;
        due.push({ at: bootStart + t, order: 1, lines: () => [commands.clock(t)] });
      }
      for (; nextStat <= now; nextStat += STAT_EVERY_MS) {
        const up = (nextStat - powerUp) / 1000;
        due.push({ at: nextStat, order: 2, lines: () => [stat(up)] });
      }
      return due.sort((a, b) => a.at - b.at || a.order - b.order).flatMap((d) => d.lines());
    },
    /** The passings up to `now`, stamped on the boot's clock (for `net` mode, which sends no lines). @param {number} now */
    advance(now) {
      const out = crossings(now);
      passings += out.length;
      return out;
    },
    /** What the decoder answers at `now`. @param {ZroundMessage} message @param {number} now @returns {string[]} */
    reply(message, now) {
      switch (message.type) {
        case 'hello-request':
          return [commands.id(paired, boot)];
        case 'pair':
          paired = message.decoder;
          secret = message.token;
          return [commands.ok];
        case 'wifi': {
          const error = wifiError(message.ssid, message.password);
          return [error ? commands.error(error) : commands.ok];
        }
        case 'startup':
          return [commands.ack];
        case 'reset':
          newBoot(now);
          // A TinyLap decoder says who it is whenever its boot changes (spec §5); the stat timer runs on.
          return [commands.id(paired, boot), '%TLLOG boot reason=reset fw=sim&'];
        default:
          return [];
      }
    },
  };
}
