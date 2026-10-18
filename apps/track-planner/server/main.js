// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Production: node server/main.js (serves TINYLAP_ROOT, default /srv).
// Development: node server/main.js --dev (serves the source on :8000, with
// an in-memory database unless TINYLAP_DB says otherwise).
//
// Log-in is on when TINYLAP_ISSUER (the accounts origin) is set, and then
// needs all of: TINYLAP_CLIENT_ID, TINYLAP_CLIENT_SECRET, TINYLAP_TOKEN_KEYS
// (`<id>:<base64 32 bytes>,…`, newest first), TINYLAP_FEED_TOKEN, and
// TINYLAP_PUBLIC_URL (in dev it defaults to http://localhost:<port>).
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKeys } from '@tinylap/auth';
import { createHandler } from './app.js';
import { createAuth } from './auth.js';
import { startFeed } from './feed.js';
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

// 0 is allowed (refuse every post); anything else must be a whole number.
const rateLimitText = env.TINYLAP_RATE_LIMIT;
const rateLimit = rateLimitText === undefined || rateLimitText === '' ? undefined : Number(rateLimitText);
if (rateLimit !== undefined && !(Number.isInteger(rateLimit) && rateLimit >= 0)) {
  console.error(`TINYLAP_RATE_LIMIT must be a whole number of posts per hour, 0 or more; got "${rateLimitText}".`);
  process.exit(1);
}

const port = Number(env.PORT ?? (dev ? 8000 : 8080));
const publicUrl = env.TINYLAP_PUBLIC_URL || (dev && env.TINYLAP_ISSUER ? `http://localhost:${port}` : undefined);

/** Refuses to start: log-in half configured must not quietly run without it. */
function refuse(message) {
  console.error(message);
  process.exit(1);
}

let auth = null;
let feed = null;
if (env.TINYLAP_ISSUER) {
  const needed = { TINYLAP_CLIENT_ID: env.TINYLAP_CLIENT_ID, TINYLAP_CLIENT_SECRET: env.TINYLAP_CLIENT_SECRET, TINYLAP_TOKEN_KEYS: env.TINYLAP_TOKEN_KEYS, TINYLAP_FEED_TOKEN: env.TINYLAP_FEED_TOKEN, TINYLAP_PUBLIC_URL: publicUrl };
  const missing = Object.keys(needed).filter((name) => !needed[name]);
  if (missing.length) refuse(`TINYLAP_ISSUER is set, so sign-in also needs ${missing.join(', ')}. Set them, or unset TINYLAP_ISSUER to run without sign-in.`);
  let keys;
  try {
    keys = parseKeys(env.TINYLAP_TOKEN_KEYS);
  } catch (error) {
    refuse(`TINYLAP_TOKEN_KEYS: ${error.message}`);
  }
  if (!store) {
    console.error('sign-in is off: it keeps its sessions in the database, which is unavailable.');
  } else {
    try {
      auth = createAuth({ issuer: env.TINYLAP_ISSUER, clientId: env.TINYLAP_CLIENT_ID, clientSecret: env.TINYLAP_CLIENT_SECRET, keys, publicUrl, sessions: store.sessions });
    } catch (error) {
      refuse(`sign-in: ${error.message}`);
    }
    feed = startFeed({ issuer: env.TINYLAP_ISSUER, token: env.TINYLAP_FEED_TOKEN, store });
  }
}

const handler = createHandler({
  store,
  root: dev ? undefined : env.TINYLAP_ROOT ?? '/srv',
  appDir: resolve(fileURLToPath(new URL('..', import.meta.url))),
  publicUrl,
  rateLimit,
  clientIpHeader: env.TINYLAP_CLIENT_IP_HEADER,
  build: env.TINYLAP_BUILD,
  auth,
});

const host = dev ? '127.0.0.1' : '0.0.0.0';
const server = createServer(handler).listen(port, host, () => console.log(`planner on http://${host}:${port}${dev ? ' (dev, no-store)' : ''}${auth ? `, sign-in through ${env.TINYLAP_ISSUER}` : ''}`));

// Stop accepting, finish what is in flight, close the database, leave.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    feed?.stop();
    server.close(() => {
      store?.close();
      process.exit(0);
    });
    server.closeIdleConnections();
  });
}
