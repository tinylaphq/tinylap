// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A simulated EasyLap (decoders spec §5.2): from UART enable, a heartbeat
// every heartbeatMs and a passing per crossing, in Robitronic frames. It
// answers a start (03 B9 01) with 00 and zeroes its clock; a reset (03 B0 02)
// zeroes it too. `corrupt` spoils every checksum, for D13.
import { createTrack, frames } from '@tinylap/timing';

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * @param {{ lapMs?: number, cars?: number, heartbeatMs?: number, waitsForStart?: boolean, corrupt?: boolean,
 *   noise?: { double?: number, miss?: number, random?: () => number }, random?: () => number }} [options]
 */
export function easylapModel({ lapMs = 8000, cars = 3, heartbeatMs = 250, waitsForStart = false, corrupt = false, noise = {}, random } = {}) {
  const roster = Array.from({ length: cars }, (_, i) => ({ id: 0x0a1b2c + i, lapMs: lapMs + i * 300 }));
  const tail = [0x14, 0xd0, 0x01, 0x03];
  let track = createTrack({ cars: roster, noise, random });
  let running = !waitsForStart;
  let zero = 0;
  let nextBeat = 0;
  /** @param {Uint8Array} frame */
  const spoil = (frame) => {
    if (corrupt) frame[1] ^= 0xff;
    return frame;
  };
  /** @param {number} now */
  const restart = (now) => {
    running = true;
    zero = now;
    nextBeat = 0;
    track = createTrack({ cars: roster, noise, random });
  };
  return {
    transport: /** @type {const} */ ('hid'),
    info: { vendorId: 0x10c4, productId: 0x86b9, productName: 'EasyLap USB' },
    start: () => [],
    /** @param {Uint8Array} bytes @param {number} now */
    write(bytes, now) {
      if (same(bytes, frames.start)) {
        restart(now);
        return [Uint8Array.of(0x00)];
      }
      if (same(bytes, frames.reset)) restart(now);
      return [];
    },
    /** @param {number} now */
    tick(now) {
      if (!running) return [];
      const t = now - zero;
      /** @type {Uint8Array[]} */
      const out = [];
      for (; nextBeat <= t; nextBeat += heartbeatMs) out.push(spoil(frames.heartbeat(nextBeat, tail)));
      for (const c of track.advance(t)) out.push(spoil(frames.passing(c.id, c.t, c.hits, c.strength)));
      return out;
    },
  };
}
