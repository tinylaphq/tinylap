// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// A pretend decoder: cars that cross the line at about their lap time, and
// the replies a TinyLap decoder gives to ZRound and %TL… commands. Drives
// tools/decoder-sim.js and the bridge's ?simulate port, so the whole chain
// can be tried without hardware.

import { randomBoot } from './passing.js';
import { commands } from './zround.js';

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

/**
 * @param {{ cars: { transponder: string, lapMs: number }[], jitterMs?: number, random?: () => number,
 *   decoder?: string | null, token?: string | null }} options
 */
export function createSimulator({ cars, jitterMs = 150, random = Math.random, decoder = null, token = null }) {
  let boot = randomBoot();
  let paired = decoder;
  let secret = token;
  const track = createTrack({ cars: cars.map((car, i) => ({ id: i, lapMs: car.lapMs })), jitterMs, random });

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
    /** The passings up to decoder time `until`, in time order. @param {number} until */
    advance(until) {
      return track.advance(until).map((c) => ({ transponder: cars[c.id].transponder, t: c.t }));
    },
    /** What the decoder answers. `now` is its current clock. @param {ZroundMessage} message @param {number} now @returns {string[]} */
    reply(message, now) {
      switch (message.type) {
        case 'hello-request':
          return [commands.id(paired, boot)];
        case 'pair':
          paired = message.decoder;
          secret = message.token;
          return [commands.ok];
        case 'wifi':
          return [commands.ok];
        case 'startup':
          return [commands.ack];
        case 'reset':
          boot = randomBoot();
          track.reset(now);
          // A TinyLap decoder says who it is whenever its boot changes (spec §5).
          return [commands.id(paired, boot)];
        default:
          return [];
      }
    },
  };
}
