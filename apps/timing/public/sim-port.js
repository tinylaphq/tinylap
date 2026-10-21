// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A SerialPort look-alike with a simulated TinyLap decoder at the other end,
// for trying the bridge without hardware (?simulate, ?simulate=fast).
import { commands, createReader, createSimulator } from '@tinylap/timing';

export function simulatedPort({ lapMs = 8000, cars = 3 } = {}) {
  const sim = createSimulator({ cars: Array.from({ length: cars }, (_, i) => ({ transponder: (0x20 + i).toString(16).toUpperCase(), lapMs: lapMs + i * 300 })) });
  const started = performance.now();
  const clock = () => Math.round(performance.now() - started);
  const lines = createReader();
  const encoder = new TextEncoder();
  let controller;
  let timer;
  const send = (line) => controller.enqueue(encoder.encode(line));
  return {
    readable: new ReadableStream({ start(c) { controller = c; }, cancel() { clearInterval(timer); } }),
    writable: new WritableStream({
      write(chunk) {
        for (const message of lines.push(new TextDecoder().decode(chunk))) for (const line of sim.reply(message, clock())) send(line);
      },
    }),
    async open() {
      timer = setInterval(() => {
        for (const p of sim.advance(clock())) send(commands.lap(p.transponder, p.t));
      }, 100);
    },
    async close() {
      clearInterval(timer);
    },
    // The ids of pid.codes' test product: every simulated decoder is the same device.
    getInfo: () => ({ usbVendorId: 0x1209, usbProductId: 0x0001, simulated: true }),
  };
}
