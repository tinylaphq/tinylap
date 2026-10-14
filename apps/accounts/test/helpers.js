// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Test helpers: a real accounts server on a random port with an in-memory
// database, a cookie jar, and the browser-like authorize request. Nothing
// here is used by server code.
import { createServer, request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { readConfig } from '../server/config.js';
import { createAccounts } from '../server/app.js';

export const PLANNER_CLIENT_ID = 'planner-test';
export const PLANNER_CLIENT_SECRET = 's3cret-planner-test';

/**
 * Starts accounts with TINYLAP_DEV=1, an in-memory database and one trusted
 * confidential client, `planner-test`, whose redirect URI and resource are
 * on `plannerPort`.
 * @param {{ plannerPort?: number, env?: Record<string, string> }} [overrides]
 */
export async function startAccounts({ plannerPort = 9, env = {} } = {}) {
  /** @type {(req: any, res: any) => void} */
  let handler = (_req, res) => res.writeHead(503).end();
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  const issuer = `http://127.0.0.1:${address.port}`;
  const planner = `http://127.0.0.1:${plannerPort}`;
  const client = {
    clientId: PLANNER_CLIENT_ID,
    clientSecret: PLANNER_CLIENT_SECRET,
    redirectUri: `${planner}/auth/callback`,
    postLogoutRedirectUri: `${planner}/`,
    resource: planner,
  };
  const config = readConfig({
    TINYLAP_DEV: '1',
    TINYLAP_ISSUER: issuer,
    TINYLAP_DB: ':memory:',
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'),
    TINYLAP_CLIENTS: JSON.stringify([{
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUris: [client.redirectUri],
      postLogoutRedirectUris: [client.postLogoutRedirectUri],
      resource: client.resource,
    }]),
    TINYLAP_FEED_TOKENS: 'feed-test',
    ...env,
  });
  const accounts = await createAccounts(config);
  handler = accounts.handler;
  return {
    issuer,
    client,
    config,
    db: accounts.db,
    auth: accounts.auth,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      accounts.close();
    },
  };
}

/** A minimal cookie jar: name → value, as a browser would keep for one origin. */
export class Jar {
  /** @type {Map<string, string>} */
  cookies = new Map();

  /** @param {Response} res */
  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/**
 * Creates a user the way sign-up will (Task 3): a display name and the
 * placeholder email. TEST-ONLY: passkey sign-up replaces this in real use.
 * @param {any} auth
 * @param {string} name
 */
export async function createTestUser(auth, name) {
  const ctx = await auth.$context;
  const id = randomBytes(12).toString('base64url');
  return ctx.internalAdapter.createUser({ id, name, email: `${id}@users.invalid`, emailVerified: false });
}

/**
 * TEST-ONLY. Mints a signed Better Auth session cookie for `userId` through
 * the internal adapter, standing in for a passkey sign-in until Task 3. Never
 * import this from server code. Returns the jar it put the cookie in.
 * @param {any} auth
 * @param {string} userId
 * @param {Jar} [jar]
 */
export async function testSession(auth, userId, jar = new Jar()) {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId, false, {}, true);
  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  jar.cookies.set(ctx.authCookies.sessionToken.name, encodeURIComponent(signed));
  return jar;
}

/**
 * Sends a GET over node:http rather than fetch(): Node's fetch always sends
 * `sec-fetch-mode: cors`, overriding the caller's, so it cannot look like a
 * browser navigation.
 * @param {URL | string} url
 * @param {Record<string, string>} headers
 * @returns {Promise<Response>}
 */
export function navigate(url, headers = { accept: 'text/html', 'sec-fetch-mode': 'navigate' }) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          for (const v of [value].flat()) if (v !== undefined) out.append(name, v);
        }
        const status = res.statusCode ?? 500;
        resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, headers: out }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Sends the authorize request the way a browser navigation does:
 * `accept: text/html`, `sec-fetch-mode: navigate`, the jar's cookies.
 *
 * Finding (better-auth / @better-auth/oauth-provider 1.7.7): /oauth2/authorize
 * answers a real 302 with `Location` to a navigation, both when it sends the
 * browser to the login page and when it sends it back to the client with a
 * code. To a fetch() (`sec-fetch-mode: cors`) or `accept: application/json`
 * it answers 200 JSON `{ redirect: true, url }` instead. Node's own fetch()
 * forces `sec-fetch-mode: cors`, which is why a naive test sees JSON; this
 * helper therefore uses node:http. The JSON branch is a fallback only, so a
 * future Better Auth answering JSON is still followed; the oidc test pins
 * the 302 (a JSON answer is marked `x-test-via: json`).
 * @param {URL | string} authUrl
 * @param {Jar} jar
 * @returns {Promise<Response>} a redirect: status 302 and a `location` header
 */
export async function driveAuthorize(authUrl, jar) {
  const headers = { accept: 'text/html,application/xhtml+xml', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'cross-site' };
  const cookie = jar.header();
  const res = await navigate(authUrl, cookie ? { ...headers, cookie } : headers);
  jar.store(res);
  if (res.status >= 300 && res.status < 400) return res;
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    const body = await res.json();
    if (typeof body?.url === 'string') {
      return new Response(null, { status: 302, headers: { location: new URL(body.url, authUrl).href, 'x-test-via': 'json' } });
    }
    throw new Error(`authorize answered ${res.status} ${JSON.stringify(body)}`);
  }
  throw new Error(`authorize answered ${res.status} ${await res.text()}`);
}
