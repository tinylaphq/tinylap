// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A plain ZRound decoder, read the way RiCino reads (decoders spec §5.2,
// ricino-receiver.ino:45-206): bytes that come in its boot time are lost;
// its input is read in bursts, and only the last 3-byte chunk of each burst
// counts; it answers %C& with a run of %A&, reading nothing meanwhile; and
// it sends nothing until %I&, which zeroes its clock. It ignores %TL….
import { commands, createTrack } from '@tinylap/timing';

const encode = (line) => new TextEncoder().encode(line);
/** @param {number} n */
const hex = (n) => n.toString(16).toUpperCase();

/**
 * @param {{ lapMs?: number, cars?: number, waitsForStart?: boolean, ignoresStarts?: number, bootMs?: number,
 *   ackMs?: number, acks?: number, clockEveryMs?: number, noise?: { double?: number, miss?: number, garbage?: number, random?: () => number },
 *   random?: () => number }} [options]
 */
export function zroundModel({ lapMs = 8000, cars = 3, waitsForStart = true, ignoresStarts = 0, bootMs = 1500, ackMs = 100, acks = 21, clockEveryMs = 1000, noise = {}, random } = {}) {
  const roster = Array.from({ length: cars }, (_, i) => ({ id: 0x30 + i, lapMs: lapMs + i * 300 }));
  const chance = noise.random ?? Math.random;
  const text = new TextDecoder();
  let track = createTrack({ cars: roster, noise, random });
  let running = !waitsForStart;
  let zero = 0;
  let nextClock = clockEveryMs;
  let starts = 0;
  let input = '';
  let deafUntil = 0;
  /** @type {{ at: number, bytes: Uint8Array }[]} */
  let queue = [];
  /** @param {number} now */
  const due = (now) => {
    const ready = queue.filter((q) => q.at <= now).map((q) => q.bytes);
    queue = queue.filter((q) => q.at > now);
    return ready;
  };
  /** One burst: everything waiting, of which only the last whole 3-byte chunk counts. @param {number} now */
  const read = (now) => {
    const whole = Math.floor(input.length / 3) * 3;
    const command = whole ? input.slice(whole - 3, whole) : '';
    input = input.slice(whole);
    if (command === commands.startup) {
      for (let i = 0; i < acks; i += 1) queue.push({ at: now + i * ackMs, bytes: encode(commands.ack) });
      deafUntil = now + acks * ackMs;
    } else if (command === commands.reset && !running) {
      starts += 1;
      if (starts > ignoresStarts) {
        running = true;
        zero = now;
        nextClock = clockEveryMs;
        track = createTrack({ cars: roster, noise, random });
      }
    } else if (command === '%F&') {
      running = false;
    }
  };
  return {
    transport: /** @type {const} */ ('serial'),
    // An FTDI chip, as on many hobby decoders.
    info: { usbVendorId: 0x0403, usbProductId: 0x6001, simulated: true },
    get running() {
      return running;
    },
    start: () => [],
    /** @param {Uint8Array} bytes @param {number} now */
    write(bytes, now) {
      if (now >= bootMs) input += text.decode(bytes, { stream: true });
      return [];
    },
    /** @param {number} now */
    tick(now) {
      if (input && now >= deafUntil) read(now);
      const out = due(now);
      if (running) {
        const t = now - zero;
        for (; nextClock <= t; nextClock += clockEveryMs) out.push(encode(commands.clock(nextClock)));
        for (const c of track.advance(t)) {
          out.push(encode(commands.lap(hex(c.id), c.t)));
          if (noise.garbage && chance() < noise.garbage) out.push(encode('x!7 '));
        }
      }
      return out;
    },
  };
}
