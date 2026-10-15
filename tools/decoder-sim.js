// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pretends to be a TinyLap decoder, to try timing without hardware.
//   node tools/decoder-sim.js net --url http://localhost:8100 --decoder <id> --token <token> [--cars 4]
//     posts passings every second, like a decoder on Wi-Fi.
//   node tools/decoder-sim.js serial [--cars 4]
//     speaks ZRound (and %TL… commands) on stdin/stdout, like a decoder on USB:
//     socat -d -d pty,raw,echo=0,link=/tmp/decoder EXEC:"node tools/decoder-sim.js serial"
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MAX_BATCH, commands, createReader, createSimulator } from '@tinylap/timing';

/** @param {number} n */
export const carsOf = (n) => Array.from({ length: n }, (_, i) => ({ transponder: (0x10 + i).toString(16).toUpperCase(), lapMs: 7500 + i * 400 }));

/**
 * Posts passings in batches and keeps each until a batch carried it and the
 * server's `through` covers it, as a decoder's outbox does (spec §5).
 * @param {{ url: string, decoder: string, token: string, boot: string, fetch?: typeof fetch }} options
 */
export function createSender({ url, decoder, token, boot, fetch: fetchImpl = fetch }) {
  /** @type {{ transponder: string, t: number }[]} */
  let outbox = [];
  const endpoint = `${url.replace(/\/$/, '')}/decoders/${decoder}/passings`;
  return {
    get pending() {
      return outbox.length;
    },
    /** @param {{ transponder: string, t: number }[]} passings */
    add(passings) {
      outbox.push(...passings);
    },
    async flush() {
      if (outbox.length === 0) return { sent: 0 };
      const batch = outbox.slice(0, MAX_BATCH);
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ boot, passings: batch }),
      });
      if (!res.ok) throw new Error(`timing answered ${res.status}: ${await res.text()}`);
      const { through } = await res.json();
      // Drop what this batch carried, up to `through`; a passing it didn't carry stays (spec §5).
      const sent = new Set(batch.filter((p) => through !== null && p.t <= through));
      outbox = outbox.filter((p) => !sent.has(p));
      return { sent: batch.length };
    },
  };
}

/**
 * ZRound on a pair of text streams.
 * @param {{ input: NodeJS.ReadableStream, output: NodeJS.WritableStream, sim: ReturnType<typeof createSimulator>, clock: () => number }} options
 */
export function runSerial({ input, output, sim, clock }) {
  const reader = createReader();
  const onData = (chunk) => {
    for (const message of reader.push(String(chunk))) for (const line of sim.reply(message, clock())) output.write(line);
  };
  input.on('data', onData);
  return {
    tick() {
      for (const p of sim.advance(clock())) output.write(commands.lap(p.transponder, p.t));
    },
    stop() {
      input.off('data', onData);
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { url: { type: 'string' }, decoder: { type: 'string' }, token: { type: 'string' }, cars: { type: 'string', default: '4' } },
  });
  const sim = createSimulator({ cars: carsOf(Number(values.cars)), decoder: values.decoder ?? null, token: values.token ?? null });
  const started = Date.now();
  const clock = () => Date.now() - started;
  if (positionals[0] === 'net') {
    if (!values.url || !values.decoder || !values.token) {
      console.error('net needs --url, --decoder and --token (pair a decoder in Setup to get them).');
      process.exit(2);
    }
    const sender = createSender({ url: values.url, decoder: values.decoder, token: values.token, boot: sim.boot });
    console.error(`decoder ${values.decoder}, boot ${sim.boot}, ${values.cars} cars`);
    setInterval(async () => {
      sender.add(sim.advance(clock()));
      try {
        const { sent } = await sender.flush();
        if (sent) console.error(`sent ${sent}, ${sender.pending} waiting`);
      } catch (error) {
        console.error(`${error.message}; ${sender.pending} waiting`);
      }
    }, 1000);
  } else if (positionals[0] === 'serial') {
    const serial = runSerial({ input: process.stdin, output: process.stdout, sim, clock });
    setInterval(() => serial.tick(), 100);
  } else {
    console.error('usage: decoder-sim.js net --url <origin> --decoder <id> --token <token> [--cars n] | serial [--cars n]');
    process.exit(2);
  }
}
