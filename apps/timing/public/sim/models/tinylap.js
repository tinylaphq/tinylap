// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A simulated TinyLap decoder (decoders spec §5.2): createSimulator's lines, as bytes on the cable.
// With resetOnOpen, the board resets when the port opens, as many Arduino boards do; without it, it has
// been running for uptimeMs and sends nothing at open, as the TinyLap decoder on its ESP32 does
// (bridge-tinylap-decoder spec §4.2, §9). `nvs` keeps the pairing across picks, as the board's flash does.
import { createReader, createSimulator } from '@tinylap/timing';

const encode = (line) => new TextEncoder().encode(line);

/**
 * @param {{ lapMs?: number, cars?: number, random?: () => number, decoder?: string | null, resetOnOpen?: boolean, uptimeMs?: number,
 *   nvs?: { load: () => { decoder: string, token: string } | null, save: (pairing: { decoder: string, token: string }) => void } }} [options]
 */
export function tinylapModel({ lapMs = 8000, cars = 3, random, decoder = null, resetOnOpen = true, uptimeMs = 60_000, nvs } = {}) {
  const stored = nvs?.load() ?? null;
  const sim = createSimulator({
    cars: Array.from({ length: cars }, (_, i) => ({ transponder: (0x20 + i).toString(16).toUpperCase(), lapMs: lapMs + i * 300 })),
    random, decoder: stored?.decoder ?? decoder, token: stored?.token ?? null, uptimeMs,
  });
  const lines = createReader();
  const text = new TextDecoder();
  return {
    transport: /** @type {const} */ ('serial'),
    // The ids of pid.codes' test product: every simulated decoder is the same device.
    info: { usbVendorId: 0x1209, usbProductId: 0x0001, simulated: true },
    sim,
    /** @param {number} now */
    start: (now) => (resetOnOpen ? sim.start(now).map(encode) : []),
    /** @param {number} now */
    tick: (now) => sim.tick(now).map(encode),
    /** @param {Uint8Array} bytes @param {number} now */
    write: (bytes, now) => lines.push(text.decode(bytes, { stream: true })).flatMap((m) => {
      const reply = sim.reply(m, now);
      if (m.type === 'pair' && nvs) nvs.save({ decoder: sim.decoder, token: sim.token });
      return reply;
    }).map(encode),
  };
}
