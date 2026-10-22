// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A simulated TinyLap decoder (decoders spec §5.2): the replies of
// createSimulator, and a %L…& per crossing, as sim-port.js gave until now.
import { commands, createReader, createSimulator } from '@tinylap/timing';

const encode = (line) => new TextEncoder().encode(line);

/** @param {{ lapMs?: number, cars?: number, random?: () => number, decoder?: string | null }} [options] */
export function tinylapModel({ lapMs = 8000, cars = 3, random, decoder = null } = {}) {
  const sim = createSimulator({ cars: Array.from({ length: cars }, (_, i) => ({ transponder: (0x20 + i).toString(16).toUpperCase(), lapMs: lapMs + i * 300 })), random, decoder });
  const lines = createReader();
  const text = new TextDecoder();
  return {
    transport: /** @type {const} */ ('serial'),
    // The ids of pid.codes' test product: every simulated decoder is the same device.
    info: { usbVendorId: 0x1209, usbProductId: 0x0001, simulated: true },
    sim,
    start: () => [],
    /** @param {number} now */
    tick: (now) => sim.advance(now).map((p) => encode(commands.lap(p.transponder, p.t))),
    /** @param {Uint8Array} bytes @param {number} now */
    write: (bytes, now) => lines.push(text.decode(bytes, { stream: true })).flatMap((m) => sim.reply(m, now)).map(encode),
  };
}
