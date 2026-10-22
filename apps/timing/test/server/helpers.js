// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createHandler } from '../../server/app.js';
import { openStore } from '../../server/store.js';
import { createHub } from '../../server/live.js';
import { createEngine } from '../../server/engine.js';
import { createAuth } from '../../server/auth.js';
import { readSimulate } from '../../server/simulate.js';
import { driveAuthorize, Jar, startSuite } from '../../../../tools/test-env.js';
import { testSession } from '../../../accounts/test/helpers.js';
import { createClub, createInvite, createPersonalWorkspace, redeemInvite, setRole } from '../../../accounts/server/workspaces.js';

export const appDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Starts the handler on a random port, without log-in. */
export async function startServer(options = {}) {
  const server = createServer(createHandler({ appDir, log: false, ...options }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  };
}

/**
 * The timing app with log-in on, against a real accounts (tools/test-env.js).
 * The server listens first, so accounts can register its port.
 * @param {{ clock?: { now: number }, hostname?: string, env?: Record<string, string>, [key: string]: any }} [options]
 */
export async function startTiming(options = {}) {
  const { clock, hostname, env, simulate = null, ...rest } = options;
  const settings = { simulate: readSimulate(simulate) };
  const now = clock ? () => clock.now : Date.now;
  const store = openStore(':memory:');
  const hub = createHub({ now });
  const engine = createEngine({ store, hub, now });
  let handler = (_req, res) => res.writeHead(503).end();
  const server = createServer((req, res) => handler(req, res));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suite = await startSuite({ plannerPort: server.address().port, hostname, env });
  const keys = [{ id: 'k1', key: randomBytes(32) }];
  const auth = createAuth({
    issuer: suite.issuer, clientId: suite.clientId, clientSecret: suite.clientSecret,
    keys, publicUrl: base, sessions: store.sessions,
    logger: { warn: () => {} },
  });
  handler = createHandler({ appDir, log: false, store, hub, engine, auth, keys, publicUrl: base, now, settings, ...rest });
  const db = suite.accounts.db;

  /** A new accounts user with their personal space, as a real sign-up makes. */
  const signUp = async (name) => {
    const { user } = await suite.signInUser(undefined, name);
    createPersonalWorkspace(db, user.id, name);
    return user;
  };
  /** A club owned by `owner`. */
  const club = (owner, name = 'Office') => createClub(db, owner.id, name);
  /** Adds `member` to `clubId` with `role`. */
  function join(owner, clubId, member, role = 'member') {
    const { link } = createInvite(db, owner.id, clubId);
    redeemInvite(db, member.id, link.split('/').pop());
    if (role !== 'member') setRole(db, owner.id, clubId, member.id, role);
  }
  /** Logs `user` in through the app's routes. Memberships must exist first: the token carries them. */
  async function login(user) {
    const jar = new Jar();
    const start = await fetch(`${base}/auth/login?returnTo=%2F`, { redirect: 'manual' });
    jar.store(start);
    const back = await driveAuthorize(start.headers.get('location'), await testSession(suite.accounts.auth, user.id));
    const callback = await fetch(back.headers.get('location'), { redirect: 'manual', headers: { cookie: jar.header() } });
    jar.store(callback);
    return { jar, user };
  }
  /** A call as `who` (a login, or null), from the app's own origin. */
  function api(who, method, path, body, headers = {}) {
    return fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        origin: base,
        ...(who ? { cookie: who.jar.header() } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** A form post as `who` from the app's own pages; redirects are not followed. */
  function form(who, path, fields, headers = {}) {
    return fetch(base + path, {
      method: 'POST',
      redirect: 'manual',
      headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded', ...(who ? { cookie: who.jar.header() } : {}), ...headers },
      body: new URLSearchParams(fields),
    });
  }

  return {
    base, store, hub, engine, auth, suite, clock, signUp, club, join, login, api, form,
    /** The server's simulator setting (decoders spec §5.4), switchable between tests. */
    get simulate() {
      return settings.simulate;
    },
    set simulate(value) {
      settings.simulate = readSimulate(value);
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await suite.close();
    },
  };
}
