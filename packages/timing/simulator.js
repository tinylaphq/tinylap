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
 * @param {{ cars: { transponder: string, lapMs: number }[], jitterMs?: number, random?: () => number,
 *   decoder?: string | null, token?: string | null }} options
 */
export function createSimulator({ cars, jitterMs = 150, random = Math.random, decoder = null, token = null }) {
  let boot = randomBoot();
  let paired = decoder;
  let secret = token;
  /** Each car's next crossing in decoder time. The first comes within one lap. */
  const next = cars.map((car) => ({ ...car, at: 2000 + random() * car.lapMs }));
  const jitter = () => (random() * 2 - 1) * jitterMs;

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
      /** @type {{ transponder: string, t: number }[]} */
      const out = [];
      for (;;) {
        let first = -1;
        for (let i = 0; i < next.length; i += 1) if (first === -1 || next[i].at < next[first].at) first = i;
        if (first === -1 || next[first].at > until) return out;
        const car = next[first];
        out.push({ transponder: car.transponder, t: Math.round(car.at) });
        car.at += Math.max(car.lapMs + jitter(), 1);
      }
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
          for (const car of next) car.at -= now;
          // A TinyLap decoder says who it is whenever its boot changes (spec §5).
          return [commands.id(paired, boot)];
        default:
          return [];
      }
    },
  };
}
