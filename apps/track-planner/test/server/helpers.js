// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLayout, assignTrack, stockL } from '@tinylap/track-format';
import { createHandler } from '../../server/app.js';
import { openStore } from '../../server/store.js';
import { createAuth } from '../../server/auth.js';
import { driveAuthorize, Jar, startSuite } from '../../../../tools/test-env.js';
import { testSession } from '../../../accounts/test/helpers.js';

export { Jar };

export const appDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Starts the real server on a random port. Pass `store: null` for an unavailable database. */
export async function startServer(options = {}) {
  const store = 'store' in options ? options.store : openStore(':memory:');
  const server = createServer(createHandler({ appDir, log: false, ...options, store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    store,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

export const closedLayout = () => assignTrack(createLayout({ pieces: stockL() }));
export const openLayout = () => createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });

/**
 * The planner with log-in on, against a real accounts (tools/test-env.js).
 * The server listens first, so accounts can register its port; the handler
 * is bound once the suite is up.
 * `hostname` is the issuer's host and `env` overrides accounts' environment
 * (see startSuite).
 * @param {{ store?: any, logged?: string[], hostname?: string, env?: Record<string, string>, [key: string]: any }} [options]
 */
export async function startPlanner(options = {}) {
  const { store = openStore(':memory:'), hostname, env, ...rest } = options;
  /** @type {(req: any, res: any) => void} */
  let handler = (_req, res) => res.writeHead(503).end();
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suite = await startSuite({ plannerPort: server.address().port, hostname, env });
  /** @type {string[]} */
  const logged = [];
  const keys = [{ id: 'k1', key: randomBytes(32) }];
  const auth = createAuth({
    issuer: suite.issuer, clientId: suite.clientId, clientSecret: suite.clientSecret,
    keys, publicUrl: base, sessions: store.sessions,
    logger: { warn: (message) => void logged.push(message) },
  });
  handler = createHandler({ appDir, log: false, store, publicUrl: base, auth, ...rest });

  /**
   * Logs a user in through the planner's routes: a new one named `who`, or
   * an existing accounts user. Returns the planner's cookie jar.
   * @param {string} [returnTo] @param {string | { id: string }} [who]
   */
  async function login(returnTo = '/', who = 'Ayrton') {
    const jar = new Jar();
    const start = await fetch(`${base}/auth/login?${new URLSearchParams({ returnTo })}`, { redirect: 'manual' });
    jar.store(start);
    const signedIn = typeof who === 'string'
      ? await suite.signInUser(undefined, who)
      : { user: who, jar: await testSession(suite.accounts.auth, who.id) };
    const back = await driveAuthorize(start.headers.get('location'), signedIn.jar);
    const callback = await fetch(back.headers.get('location'), { redirect: 'manual', headers: { cookie: jar.header() } });
    jar.store(callback);
    return { jar, user: signedIn.user, start, callback };
  }

  return {
    base, store, suite, auth, keys, logged, login,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await suite.close();
    },
  };
}
