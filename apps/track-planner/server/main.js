// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Production: node server/main.js (serves TINYLAP_ROOT, default /srv).
// Development: node server/main.js --dev (serves the source on :8000, with
// an in-memory database unless TINYLAP_DB says otherwise).
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './app.js';
import { openStore } from './store.js';

const env = process.env;
const dev = process.argv.includes('--dev');

let store = null;
try {
  store = openStore(env.TINYLAP_DB ?? (dev ? ':memory:' : '/data/tinylap.sqlite'));
} catch (error) {
  // The planner still works without a database; the API answers 503.
  console.error(`database unavailable: ${error.message}`);
}

const handler = createHandler({
  store,
  root: dev ? undefined : env.TINYLAP_ROOT ?? '/srv',
  appDir: resolve(fileURLToPath(new URL('..', import.meta.url))),
  publicUrl: env.TINYLAP_PUBLIC_URL,
  rateLimit: env.TINYLAP_RATE_LIMIT ? Number(env.TINYLAP_RATE_LIMIT) : undefined,
  clientIpHeader: env.TINYLAP_CLIENT_IP_HEADER,
  build: env.TINYLAP_BUILD,
});

const port = Number(env.PORT ?? (dev ? 8000 : 8080));
const host = dev ? '127.0.0.1' : '0.0.0.0';
createServer(handler).listen(port, host, () => console.log(`planner on http://${host}:${port}${dev ? ' (dev, no-store)' : ''}`));
