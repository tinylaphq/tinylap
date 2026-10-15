// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Production: node server/main.js (serves TINYLAP_ROOT, default /srv).
// Development: node server/main.js --dev (serves the source on :8100, with
// an in-memory database unless TINYLAP_DB says otherwise).
//
// Timing always needs log-in: TINYLAP_ISSUER (the accounts origin),
// TINYLAP_CLIENT_ID, TINYLAP_CLIENT_SECRET, TINYLAP_TOKEN_KEYS
// (`<id>:<base64 32 bytes>,…`, newest first), TINYLAP_FEED_TOKEN,
// TINYLAP_PUBLIC_URL (in dev it defaults to http://localhost:<port>), and
// TINYLAP_PLANNER_URL, the planner tracks are imported from.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKeys } from '@tinylap/auth';
import { createHandler } from './app.js';
import { createAuth } from './auth.js';
import { createEngine } from './engine.js';
import { startFeed } from './feed.js';
import { createHub } from './live.js';
import { openStore } from './store.js';

const env = process.env;
const dev = process.argv.includes('--dev');
const TICK_MS = 250;

/** Refuses to start: a half-configured server must not run. */
function refuse(message) {
  console.error(message);
  process.exit(1);
}

const port = Number(env.PORT ?? (dev ? 8100 : 8080));
const publicUrl = env.TINYLAP_PUBLIC_URL || (dev ? `http://localhost:${port}` : undefined);
const needed = {
  TINYLAP_ISSUER: env.TINYLAP_ISSUER, TINYLAP_CLIENT_ID: env.TINYLAP_CLIENT_ID, TINYLAP_CLIENT_SECRET: env.TINYLAP_CLIENT_SECRET,
  TINYLAP_TOKEN_KEYS: env.TINYLAP_TOKEN_KEYS, TINYLAP_FEED_TOKEN: env.TINYLAP_FEED_TOKEN, TINYLAP_PUBLIC_URL: publicUrl,
  TINYLAP_PLANNER_URL: env.TINYLAP_PLANNER_URL,
};
const missing = Object.keys(needed).filter((name) => !needed[name]);
if (missing.length) refuse(`Timing needs ${missing.join(', ')}. See "Self-hosting timing" in README.md.`);

let keys;
try {
  keys = parseKeys(env.TINYLAP_TOKEN_KEYS);
} catch (error) {
  refuse(`TINYLAP_TOKEN_KEYS: ${error.message}`);
}

let store;
try {
  store = openStore(env.TINYLAP_DB ?? (dev ? ':memory:' : '/data/timing.sqlite'));
} catch (error) {
  // Without its database timing can't record anything; better not to start.
  refuse(`database unavailable: ${error.message}`);
}

const hub = createHub();
const engine = createEngine({ store, hub });
let auth;
try {
  auth = createAuth({ issuer: env.TINYLAP_ISSUER, clientId: env.TINYLAP_CLIENT_ID, clientSecret: env.TINYLAP_CLIENT_SECRET, keys, publicUrl, sessions: store.sessions });
} catch (error) {
  refuse(`log-in: ${error.message}`);
}
const feed = startFeed({ issuer: env.TINYLAP_ISSUER, token: env.TINYLAP_FEED_TOKEN, store });
const ticker = setInterval(() => {
  try {
    engine.tick();
  } catch (error) {
    console.error(error);
  }
}, TICK_MS);

const handler = createHandler({
  store, hub, engine, auth,
  root: dev ? undefined : env.TINYLAP_ROOT ?? '/srv',
  appDir: resolve(fileURLToPath(new URL('..', import.meta.url))),
  publicUrl,
  plannerUrl: env.TINYLAP_PLANNER_URL,
  clientIpHeader: env.TINYLAP_CLIENT_IP_HEADER,
  build: env.TINYLAP_BUILD,
});

const host = dev ? '127.0.0.1' : '0.0.0.0';
const server = createServer(handler).listen(port, host, () => {
  console.log(`timing on http://${host}:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}${dev ? ' (dev, no-store)' : ''}, log-in through ${env.TINYLAP_ISSUER}`);
});

// Stop ticking and accepting, end the open streams, close the database, leave.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    clearInterval(ticker);
    feed.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    // Event streams never go idle; close them too.
    server.closeAllConnections();
  });
}
