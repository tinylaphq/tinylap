// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// createBff against a real accounts (tools/test-env.js) and a tiny node:http
// app that mounts the handlers the way an app server would.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { decodeJwt } from 'jose';
import { AuthError, createBff, open, seal } from '../index.js';
import { safeReturnTo } from '../bff.js';
import { driveAuthorize, Jar, navigate, startSuite } from '../../../tools/test-env.js';

const keys = [{ id: 'k1', key: randomBytes(32) }];

/** A SessionStore in a Map, as an app would back it with a table. */
function memoryStore() {
  /** @type {Map<string, import('../types.js').StoredSession>} */
  const rows = new Map();
  /** Reads wait for these first, in order: a test can hold one read back. */
  /** @type {Promise<void>[]} */
  const holds = [];
  return {
    rows,
    holds,
    get: async (/** @type {string} */ id) => {
      const row = rows.get(id) ?? null;
      const hold = holds.shift();
      if (hold) await hold;
      return row;
    },
    set: async (/** @type {string} */ id, /** @type {any} */ session) => void rows.set(id, session),
    delete: async (/** @type {string} */ id) => void rows.delete(id),
    deleteUser: async (/** @type {string} */ userId) => {
      for (const [id, s] of rows) if (s.userId === userId) rows.delete(id);
    },
  };
}

/** Counts calls per path, then fetches. */
function countingFetch() {
  /** @type {Map<string, number>} */
  const calls = new Map();
  /** A test may replace or delay a response: (path, response) => response. */
  /** @type {{ hook: ((path: string, res: Response) => Response | Promise<Response>) | null }} */
  const tap = { hook: null };
  /** @type {typeof fetch} */
  const wrapped = async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    calls.set(path, (calls.get(path) ?? 0) + 1);
    const res = await fetch(input, init);
    return tap.hook ? tap.hook(path, res) : res;
  };
  return { calls, tap, fetch: wrapped };
}

/**
 * Starts an app server on a random port with `handlers` late-bound, then a
 * suite registered for that port.
 */
async function startApp() {
  /** @type {any} */
  let bff;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://app');
    try {
      /** @type {{ status: number, headers?: any, body?: string }} */
      let out;
      if (req.method === 'GET' && url.pathname === '/auth/login') out = await bff.login(req);
      else if (req.method === 'GET' && url.pathname === '/auth/callback') out = await bff.callback(req);
      else if (req.method === 'POST' && url.pathname === '/auth/logout') {
        out = bff.requireSameOrigin(req) ? await bff.logout(req) : { status: 403 };
      } else if (url.pathname === '/me') {
        const session = await bff.session(req);
        out = session ? { status: 200, body: JSON.stringify(session) } : { status: 401 };
      } else out = { status: 404 };
      res.writeHead(out.status, out.headers ?? {}).end(out.body);
    } catch (error) {
      res.writeHead(error instanceof AuthError && error.code === 'unavailable' ? 503 : 500).end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const suite = await startSuite({ plannerPort: port });
  const store = memoryStore();
  const counter = countingFetch();
  /** @type {string[]} */
  const logged = [];
  bff = createBff({
    issuer: suite.issuer,
    clientId: suite.clientId,
    clientSecret: suite.clientSecret,
    redirectUri: suite.redirectUri,
    postLogoutRedirectUri: suite.postLogoutRedirectUri,
    resource: suite.resource,
    store,
    keys,
    fetch: counter.fetch,
    logger: { warn: (/** @type {string} */ msg) => void logged.push(msg) },
  });
  const origin = suite.plannerOrigin(port);
  return {
    suite, store, bff, origin, calls: counter.calls, tap: counter.tap, logged,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      await suite.close();
    },
  };
}

/** @type {Awaited<ReturnType<typeof startApp>>} */
let app;
/** @type {oidc.Configuration} */
let rp;

before(async () => {
  app = await startApp();
  rp = await oidc.discovery(new URL(app.suite.issuer), app.suite.clientId, undefined,
    oidc.ClientSecretBasic(app.suite.clientSecret), { execute: [oidc.allowInsecureRequests] });
});
after(() => app.close());

/** @param {string} line */
const cookieAttrs = (line) => line.split(';').slice(1).map((a) => a.trim());
/** @param {Response} res @param {string} name */
const setCookie = (res, name) => res.headers.getSetCookie().find((l) => l.startsWith(`${name}=`));

/** Logs a fresh user in through the app; returns the app's cookie jar. */
async function login(returnTo = '/tracks?x=1', target = app) {
  const appJar = new Jar();
  const start = await fetch(`${target.origin}/auth/login?${new URLSearchParams({ returnTo })}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  appJar.store(start);
  const { user, jar } = await target.suite.signInUser();
  const back = await driveAuthorize(/** @type {string} */ (start.headers.get('location')), jar);
  const callback = await fetch(/** @type {string} */ (back.headers.get('location')), { redirect: 'manual', headers: { cookie: appJar.header() } });
  appJar.store(callback);
  return { start, callback, appJar, user, accountsJar: jar };
}

/** @param {Jar} jar */
const sessionId = (jar) => createHash('sha256').update(/** @type {string} */ (jar.cookies.get('__Host-tinylap-session'))).digest('hex');
/** @param {Jar} jar */
const reqFor = (jar) => ({ headers: { cookie: jar.header() } });

/** Makes the stored access token look as if it had `ms` left. */
async function expireSoon(/** @type {Jar} */ jar, ms = 10_000, target = app) {
  const id = sessionId(jar);
  const row = /** @type {import('../types.js').StoredSession} */ (await target.store.get(id));
  const tokens = JSON.parse(open(keys, row.sealedTokens, 'tokens'));
  await target.store.set(id, { ...row, sealedTokens: seal(keys, JSON.stringify({ ...tokens, expiresAt: Date.now() + ms }), 'tokens') });
  return tokens;
}

test('login redirects to accounts with PKCE S256, state, nonce and resource, and a sealed login cookie', async () => {
  const res = await fetch(`${app.origin}/auth/login?returnTo=/x`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(/** @type {string} */ (res.headers.get('location')));
  assert.equal(location.origin + location.pathname, `${app.suite.issuer}/oauth2/authorize`);
  const q = location.searchParams;
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.match(q.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
  assert.ok(q.get('state'));
  assert.ok(q.get('nonce'));
  assert.equal(q.get('resource'), app.suite.resource);
  assert.equal(q.get('redirect_uri'), app.suite.redirectUri);
  assert.equal(q.get('client_id'), app.suite.clientId);
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('response_mode'), 'query');
  assert.deepEqual((q.get('scope') ?? '').split(' ').sort(), ['offline_access', 'openid', 'profile']);
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  const cookie = setCookie(res, '__Host-tinylap-login');
  assert.ok(cookie, 'the login cookie is set');
  const attrs = cookieAttrs(cookie);
  for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) assert.ok(attrs.includes(a), `${a} in ${cookie}`);
  assert.ok(!attrs.some((a) => /^domain=/i.test(a)));
  assert.ok(!cookie.includes(/** @type {string} */ (q.get('state'))), 'the state is sealed, not in clear');
});

test('callback sets __Host-tinylap-session (HttpOnly, Secure, SameSite=Lax, Path=/, no Domain) and returns to returnTo', async () => {
  const { callback, appJar, user } = await login('/tracks?x=1');
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), `${app.origin}/tracks?x=1`);
  const cookie = setCookie(callback, '__Host-tinylap-session');
  assert.ok(cookie);
  const attrs = cookieAttrs(cookie);
  for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(attrs.includes(a), `${a} in ${cookie}`);
  assert.ok(!attrs.some((a) => /^domain=/i.test(a)), 'no Domain');
  const spent = setCookie(callback, '__Host-tinylap-login');
  assert.ok(spent && cookieAttrs(spent).includes('Max-Age=0'), 'the login cookie is spent');

  const row = await app.store.get(sessionId(appJar));
  assert.ok(row);
  assert.equal(row.userId, user.id);
  assert.ok(row.expiresAt > Date.now() + 29 * 86_400_000);
  // The sealed value is random base64url, so it may contain "eyJ" by chance; look for the token itself.
  const { accessToken } = /** @type {import('../types.js').BffSession} */ (await app.bff.session(reqFor(appJar)));
  assert.ok(!row.sealedTokens.includes(accessToken), 'tokens are sealed');

  const me = await fetch(`${app.origin}/me`, { headers: { cookie: appJar.header() } });
  assert.equal(me.status, 200);
  const session = await me.json();
  assert.equal(session.userId, user.id);
  assert.equal(session.claims.sub, user.id);
  assert.ok(Array.isArray(session.claims.workspaces));
});

test('a returnTo that leaves the origin ends at /', async () => {
  for (const returnTo of [
    '//evil.test', 'https://evil.test', '/\\evil', 'evil', '/%5Cevil', '/\tevil',
    '/..//evil.test', '/.//evil.test', '/%2e%2e//evil.test', '/a/../..//evil.test', '/%2E//evil.test', '/./%2e/..//evil.test',
  ]) {
    const { callback } = await login(returnTo);
    assert.equal(callback.headers.get('location'), `${app.origin}/`, `returnTo ${JSON.stringify(returnTo)}`);
  }
  // Dot segments that stay on the origin are fine, normalised.
  const { callback } = await login('/a/../b?c=1');
  assert.equal(callback.headers.get('location'), `${app.origin}/b?c=1`);
});

test('safeReturnTo normalises first, then checks: dot segments cannot make //host', () => {
  const o = 'https://app.test';
  for (const v of ['/..//evil.test', '/.//evil.test', '/%2e%2e//evil.test', '/a/../..//evil.test', '//evil.test', '/\\evil', null, '']) {
    assert.equal(safeReturnTo(v, o), '/', JSON.stringify(v));
  }
  assert.equal(safeReturnTo('/a/./b/../c?d=1#e', o), '/a/c?d=1');
});

test('a login cookie and a sealed token store are not interchangeable', async () => {
  const start = await fetch(`${app.origin}/auth/login`, { redirect: 'manual' });
  const sealed = /** @type {string} */ (setCookie(start, '__Host-tinylap-login')).split(';')[0].split('=')[1];
  assert.ok(open(keys, sealed, 'login'));
  assert.throws(() => open(keys, sealed, 'tokens'));
  assert.throws(() => open(keys, sealed));
  const { appJar } = await login();
  const row = /** @type {any} */ (await app.store.get(sessionId(appJar)));
  assert.throws(() => open(keys, row.sealedTokens, 'login'));
  // A stored token blob planted as the login cookie is refused.
  const res = await fetch(`${app.origin}/auth/callback?code=x&state=y`, { redirect: 'manual', headers: { cookie: `__Host-tinylap-login=${row.sealedTokens}` } });
  assert.equal(res.status, 400);
});

test('a callback without the login cookie, or with a forged state, fails with 400 and no session', async () => {
  const start = await fetch(`${app.origin}/auth/login`, { redirect: 'manual' });
  const { jar } = await app.suite.signInUser();
  const back = await driveAuthorize(/** @type {string} */ (start.headers.get('location')), jar);
  const location = /** @type {string} */ (back.headers.get('location'));

  const bare = await fetch(location, { redirect: 'manual' });
  assert.equal(bare.status, 400);
  assert.match(await bare.text(), /sign in again/i);
  assert.equal(setCookie(bare, '__Host-tinylap-session'), undefined);

  const appJar = new Jar();
  appJar.store(start);
  const forged = new URL(location);
  forged.searchParams.set('state', 'forged');
  const res = await fetch(forged, { redirect: 'manual', headers: { cookie: appJar.header() } });
  assert.equal(res.status, 400);
  assert.equal(setCookie(res, '__Host-tinylap-session'), undefined);
  const spent = setCookie(res, '__Host-tinylap-login');
  assert.ok(spent && cookieAttrs(spent).includes('Max-Age=0'), 'the login cookie is single-use');
});

test('session() is null without a cookie, with an unknown cookie, or a garbled one', async () => {
  assert.equal(await app.bff.session({ headers: {} }), null);
  assert.equal(await app.bff.session({ headers: { cookie: `__Host-tinylap-session=${randomBytes(32).toString('base64url')}` } }), null);
  assert.equal(await app.bff.session({ headers: { cookie: '__Host-tinylap-session=x;y' } }), null);
});

test('sessionId() is the store id of the cookie, or null without a well-formed one', async () => {
  const { appJar } = await login();
  assert.equal(app.bff.sessionId(reqFor(appJar)), sessionId(appJar));
  assert.ok(await app.store.get(/** @type {string} */ (app.bff.sessionId(reqFor(appJar)))));
  assert.equal(app.bff.sessionId({ headers: {} }), null);
  assert.equal(app.bff.sessionId({ headers: { cookie: '__Host-tinylap-session=x;y' } }), null);
});

test('a fresh token is used as is: no call to the token endpoint', async () => {
  const { appJar } = await login();
  const before = app.calls.get('/oauth2/token') ?? 0;
  const session = await app.bff.session(reqFor(appJar));
  assert.ok(session);
  assert.equal(app.calls.get('/oauth2/token') ?? 0, before);
});

test('two concurrent session() calls on an expiring token cause one refresh, and both get the new token', async () => {
  const { appJar, user } = await login();
  const old = await expireSoon(appJar);
  const before = app.calls.get('/oauth2/token') ?? 0;
  const [a, b] = await Promise.all([app.bff.session(reqFor(appJar)), app.bff.session(reqFor(appJar))]);
  assert.equal((app.calls.get('/oauth2/token') ?? 0) - before, 1, 'one refresh');
  assert.ok(a && b);
  assert.equal(a.accessToken, b.accessToken);
  assert.notEqual(a.accessToken, old.accessToken);
  assert.equal(a.userId, user.id);
  assert.equal(decodeJwt(a.accessToken).sub, user.id);
  // The rotated refresh token is the one stored; the next refresh works.
  const stored = JSON.parse(open(keys, /** @type {any} */ (await app.store.get(sessionId(appJar))).sealedTokens, 'tokens'));
  assert.notEqual(stored.refreshToken, old.refreshToken);
  assert.equal(stored.accessToken, a.accessToken);
  await expireSoon(appJar);
  const c = await app.bff.session(reqFor(appJar));
  assert.ok(c);
  assert.notEqual(c.accessToken, a.accessToken);
});

test('session() reports refreshAt as the token\'s expiry less 60 s', async () => {
  const { appJar } = await login();
  const s = await app.bff.session(reqFor(appJar));
  assert.ok(s);
  assert.equal(s.refreshAt, s.claims.exp * 1000 - 60_000);
});

/** Lets the clock move past the moment the tokens were obtained. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('a stale mark forces one refresh, not one per call', async () => {
  const { appJar, user } = await login();
  const before = /** @type {any} */ (await app.bff.session(reqFor(appJar)));
  await tick();
  const calls = app.calls.get('/oauth2/token') ?? 0;
  app.bff.stale(user.id);
  const first = await app.bff.session(reqFor(appJar));
  const second = await app.bff.session(reqFor(appJar));
  assert.equal((app.calls.get('/oauth2/token') ?? 0) - calls, 1, 'one refresh');
  assert.ok(first && second);
  assert.notEqual(first.accessToken, before.accessToken);
  assert.equal(second.accessToken, first.accessToken);
});

test('a mark for another user forces nothing', async () => {
  const { appJar } = await login();
  await tick();
  const calls = app.calls.get('/oauth2/token') ?? 0;
  app.bff.stale('someone-else');
  assert.ok(await app.bff.session(reqFor(appJar)));
  assert.equal((app.calls.get('/oauth2/token') ?? 0) - calls, 0);
});

test('a mark made before the tokens were obtained forces nothing', async () => {
  const appJar = new Jar();
  const start = await fetch(`${app.origin}/auth/login`, { redirect: 'manual' });
  appJar.store(start);
  const { user, jar } = await app.suite.signInUser();
  app.bff.stale(user.id);
  await tick();
  const back = await driveAuthorize(/** @type {string} */ (start.headers.get('location')), jar);
  appJar.store(await fetch(/** @type {string} */ (back.headers.get('location')), { redirect: 'manual', headers: { cookie: appJar.header() } }));
  const calls = app.calls.get('/oauth2/token') ?? 0;
  assert.ok(await app.bff.session(reqFor(appJar)));
  assert.equal((app.calls.get('/oauth2/token') ?? 0) - calls, 0);
});

test('a mark made while a refresh is in flight is not lost: the next session() refreshes again', async () => {
  const { appJar, user } = await login();
  const old = await expireSoon(appJar);
  /** @type {() => void} */
  let release = () => {};
  /** @type {() => void} */
  let reached = () => {};
  const atToken = new Promise((resolve) => (reached = () => resolve(undefined)));
  const held = new Promise((resolve) => (release = () => resolve(undefined)));
  app.tap.hook = async (path, res) => {
    if (path === '/oauth2/token') {
      app.tap.hook = null;
      reached();
      await held;
    }
    return res;
  };
  const inFlight = app.bff.session(reqFor(appJar));
  await atToken;
  await tick();
  app.bff.stale(user.id);
  release();
  const first = await inFlight;
  assert.ok(first);
  assert.notEqual(first.accessToken, old.accessToken);
  const calls = app.calls.get('/oauth2/token') ?? 0;
  const second = await app.bff.session(reqFor(appJar));
  assert.equal((app.calls.get('/oauth2/token') ?? 0) - calls, 1, 'refreshed again');
  assert.ok(second);
  assert.notEqual(second.accessToken, first.accessToken);
});

test('a request that read the old row while a refresh ran does not refresh again with the spent token', async () => {
  const { appJar } = await login();
  await expireSoon(appJar);
  const before = app.calls.get('/oauth2/token') ?? 0;
  const first = app.bff.session(reqFor(appJar));
  // The second request reads the row now (still the old tokens) but only
  // sees it once the first refresh has finished and left the flight map.
  /** @type {() => void} */
  let release = () => {};
  app.store.holds.push(new Promise((resolve) => (release = () => resolve(undefined))));
  const second = app.bff.session(reqFor(appJar));
  const a = await first;
  release();
  const b = await second;
  assert.ok(a && b, 'still logged in');
  assert.equal(b.accessToken, a.accessToken);
  assert.equal((app.calls.get('/oauth2/token') ?? 0) - before, 1, 'one refresh');
});

test('a refresh whose new access token does not verify ends the session (logged), not a 500', async () => {
  const { appJar } = await login();
  await expireSoon(appJar);
  app.tap.hook = async (path, res) => {
    if (path !== '/oauth2/token') return res;
    const body = await res.json();
    return Response.json({ ...body, access_token: 'not.a.jwt' }, { status: res.status });
  };
  try {
    assert.equal(await app.bff.session(reqFor(appJar)), null);
  } finally {
    app.tap.hook = null;
  }
  assert.equal(await app.store.get(sessionId(appJar)), null);
  assert.ok(app.logged.some((m) => /refresh/i.test(m)), 'logged');
});

test('a logout while a refresh is in flight stays logged out, and the rotated token is revoked', async () => {
  const { appJar } = await login();
  await expireSoon(appJar);
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((resolve) => (release = () => resolve(undefined)));
  /** @type {any} */
  let rotated;
  app.tap.hook = async (path, res) => {
    if (path !== '/oauth2/token') return res;
    rotated = await res.json();
    await gate;
    return Response.json(rotated, { status: res.status });
  };
  try {
    const pending = app.bff.session(reqFor(appJar));
    while (!rotated) await new Promise((resolve) => setTimeout(resolve, 5));
    const out = await fetch(`${app.origin}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { cookie: appJar.header(), 'sec-fetch-site': 'same-origin' } });
    assert.equal(out.status, 302);
    release();
    assert.equal(await pending, null);
  } finally {
    app.tap.hook = null;
  }
  assert.equal(await app.store.get(sessionId(appJar)), null, 'not resurrected');
  await assert.rejects(
    oidc.refreshTokenGrant(rp, rotated.refresh_token, { resource: app.suite.resource }),
    (/** @type {any} */ error) => error.error === 'invalid_grant',
  );
});

test('a refresh answered with invalid_grant deletes the session and returns null', async () => {
  const { appJar } = await login();
  const tokens = await expireSoon(appJar);
  await oidc.tokenRevocation(rp, tokens.refreshToken, { token_type_hint: 'refresh_token' });
  assert.equal(await app.bff.session(reqFor(appJar)), null);
  assert.equal(await app.store.get(sessionId(appJar)), null);
});

test('logout revokes the refresh token, clears the cookie and goes to end_session_endpoint with id_token_hint', async () => {
  const { appJar, accountsJar } = await login();
  const id = sessionId(appJar);
  const tokens = JSON.parse(open(keys, /** @type {any} */ (await app.store.get(id)).sealedTokens, 'tokens'));

  const foreign = await fetch(`${app.origin}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { cookie: appJar.header(), origin: 'https://evil.test' } });
  assert.equal(foreign.status, 403);

  const res = await fetch(`${app.origin}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { cookie: appJar.header(), origin: app.origin } });
  assert.equal(res.status, 302);
  const location = new URL(/** @type {string} */ (res.headers.get('location')));
  assert.equal(location.origin + location.pathname, rp.serverMetadata().end_session_endpoint);
  assert.equal(location.searchParams.get('id_token_hint'), tokens.idToken);
  assert.equal(location.searchParams.get('post_logout_redirect_uri'), app.suite.postLogoutRedirectUri);
  const cleared = setCookie(res, '__Host-tinylap-session');
  assert.ok(cleared && cookieAttrs(cleared).includes('Max-Age=0'), 'the session cookie is cleared');
  assert.equal(await app.store.get(id), null);
  await assert.rejects(
    oidc.refreshTokenGrant(rp, tokens.refreshToken, { resource: app.suite.resource }),
    (/** @type {any} */ error) => error.error === 'invalid_grant',
  );
  // accounts honours it: back to the app, and the accounts session is over.
  const end = await navigate(location, { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: accountsJar.header() });
  assert.equal(end.status, 302);
  assert.equal(end.headers.get('location'), app.suite.postLogoutRedirectUri);
});

test('an issuer answering 429 is unavailable (logged): at the callback no 400, at a refresh the session is kept', async () => {
  const tooMany = (/** @type {string} */ path, /** @type {Response} */ res) => (path === '/oauth2/token'
    ? Response.json({ message: 'Too many requests. Please try again later.' }, { status: 429 })
    : res);
  const appJar = new Jar();
  const start = await fetch(`${app.origin}/auth/login`, { redirect: 'manual' });
  appJar.store(start);
  const { jar } = await app.suite.signInUser();
  const back = await driveAuthorize(/** @type {string} */ (start.headers.get('location')), jar);
  const logged = app.logged.length;
  app.tap.hook = tooMany;
  try {
    const callback = await fetch(/** @type {string} */ (back.headers.get('location')), { redirect: 'manual', headers: { cookie: appJar.header() } });
    assert.equal(callback.status, 503, 'unavailable, not "the log-in did not complete"');
  } finally {
    app.tap.hook = null;
  }
  assert.ok(app.logged.slice(logged).some((m) => /429/.test(m)), 'the 429 is logged');

  const { appJar: signedIn } = await login();
  await expireSoon(signedIn);
  const before = app.logged.length;
  app.tap.hook = tooMany;
  try {
    await assert.rejects(app.bff.session(reqFor(signedIn)), (/** @type {any} */ e) => e instanceof AuthError && e.code === 'unavailable');
  } finally {
    app.tap.hook = null;
  }
  assert.ok(await app.store.get(sessionId(signedIn)), 'the session is kept');
  assert.ok(app.logged.slice(before).some((m) => /refresh/i.test(m)), 'the failed refresh is logged');
});

test('a refresh error other than invalid_grant is logged and keeps the session', async () => {
  const { appJar } = await login();
  await expireSoon(appJar);
  const before = app.logged.length;
  app.tap.hook = (path, res) => (path === '/oauth2/token' ? Response.json({ error: 'invalid_client' }, { status: 401 }) : res);
  try {
    await assert.rejects(app.bff.session(reqFor(appJar)), (/** @type {any} */ e) => e instanceof AuthError && e.code === 'unavailable');
  } finally {
    app.tap.hook = null;
  }
  assert.ok(await app.store.get(sessionId(appJar)), 'the session is kept');
  assert.ok(app.logged.slice(before).some((m) => /refresh/i.test(m) && /invalid_client/.test(m)), 'logged with the error');
});

test('logout at an issuer without end_session_endpoint goes to postLogoutRedirectUri and clears the cookie', async () => {
  /** @type {typeof fetch} */
  const noEndSession = async (input, init) => {
    const res = await fetch(input, init);
    if (new URL(input instanceof Request ? input.url : input).pathname !== '/.well-known/openid-configuration') return res;
    const meta = await res.json();
    delete meta.end_session_endpoint;
    return Response.json(meta);
  };
  const bff = createBff({
    issuer: app.suite.issuer, clientId: app.suite.clientId, clientSecret: app.suite.clientSecret,
    redirectUri: app.suite.redirectUri, postLogoutRedirectUri: app.suite.postLogoutRedirectUri,
    resource: app.suite.resource, store: memoryStore(), keys, fetch: noEndSession, logger: { warn: () => {} },
  });
  const out = await bff.logout({ headers: { cookie: `__Host-tinylap-session=${randomBytes(32).toString('base64url')}` } });
  assert.equal(out.status, 302);
  assert.equal(out.headers.Location, app.suite.postLogoutRedirectUri);
  assert.ok(String(out.headers['Set-Cookie']).includes('Max-Age=0'));
});

test('logout without a session still clears the cookie and goes to end_session_endpoint', async () => {
  const res = await fetch(`${app.origin}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(res.status, 302);
  const location = new URL(/** @type {string} */ (res.headers.get('location')));
  assert.equal(location.origin + location.pathname, rp.serverMetadata().end_session_endpoint);
  assert.equal(location.searchParams.get('id_token_hint'), null);
  assert.ok(setCookie(res, '__Host-tinylap-session'));
});

test('requireSameOrigin: Sec-Fetch-Site same-origin, else an Origin equal to the app origin', () => {
  const { bff, origin } = app;
  assert.equal(bff.requireSameOrigin({ headers: { 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(bff.requireSameOrigin({ headers: { 'sec-fetch-site': 'cross-site', origin } }), false);
  assert.equal(bff.requireSameOrigin({ headers: { 'sec-fetch-site': 'same-site' } }), false);
  assert.equal(bff.requireSameOrigin({ headers: { 'sec-fetch-site': 'none' } }), false);
  assert.equal(bff.requireSameOrigin({ headers: { origin } }), true);
  assert.equal(bff.requireSameOrigin({ headers: { origin: 'https://evil.test' } }), false);
  assert.equal(bff.requireSameOrigin({ headers: { origin: 'null' } }), false);
  assert.equal(bff.requireSameOrigin({ headers: {} }), false);
});

test('accounts stopped: session() throws unavailable and the stored session survives', async () => {
  const own = await startApp();
  try {
    const { appJar } = await login('/', own);
    // A fresh token still works without accounts: the JWKS is cached.
    await own.suite.close();
    assert.ok(await own.bff.session(reqFor(appJar)));
    await expireSoon(appJar, 10_000, own);
    await assert.rejects(own.bff.session(reqFor(appJar)), (/** @type {any} */ e) => e instanceof AuthError && e.code === 'unavailable');
    assert.ok(await own.store.get(sessionId(appJar)), 'the session is kept');
    const res = await fetch(`${own.origin}/auth/login`, { redirect: 'manual' });
    assert.equal(res.status, 302, 'discovery is cached, so login still builds the URL');
    const id = sessionId(appJar);
    const out = await fetch(`${own.origin}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { cookie: appJar.header(), 'sec-fetch-site': 'same-origin' } });
    assert.equal(out.status, 302, 'logout still works');
    assert.equal(new URL(/** @type {string} */ (out.headers.get('location'))).pathname, '/oauth2/end-session');
    const cleared = setCookie(out, '__Host-tinylap-session');
    assert.ok(cleared && cookieAttrs(cleared).includes('Max-Age=0'));
    assert.equal(await own.store.get(id), null);
    assert.ok(own.logged.some((m) => /revo/i.test(m)), 'the failed revocation is logged');
  } finally {
    await own.close();
  }
});

/** A bff whose issuer is `issuer`, for outage tests. */
const bffAt = (/** @type {string} */ issuer, extra = {}) => createBff({
  issuer, clientId: 'c', clientSecret: 's', redirectUri: 'http://127.0.0.1:9/auth/callback',
  postLogoutRedirectUri: 'http://127.0.0.1:9/', resource: 'http://127.0.0.1:9', store: memoryStore(), keys, ...extra,
});

test('discovery that fails is unavailable, and the next call tries again', async () => {
  const counter = countingFetch();
  const bff = bffAt('http://127.0.0.1:1', { fetch: counter.fetch });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(bff.login({ url: '/auth/login', headers: {} }), (/** @type {any} */ e) => e instanceof AuthError && e.code === 'unavailable');
  }
  assert.equal(counter.calls.get('/.well-known/openid-configuration'), 2);
});

test('logout without discovery goes to postLogoutRedirectUri, clears the cookie, and does not wait for a hanging issuer', async () => {
  /** @type {import('node:http').ServerResponse[]} */
  const hanging = [];
  const server = createServer((_req, res) => void hanging.push(res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  try {
    for (const issuer of ['http://127.0.0.1:1', `http://127.0.0.1:${port}`]) {
      const started = Date.now();
      const bff = bffAt(issuer, { logger: { warn: () => {} } });
      const out = await bff.logout({ headers: { cookie: `__Host-tinylap-session=${randomBytes(32).toString('base64url')}` } });
      assert.equal(out.status, 302);
      assert.equal(out.headers.Location, 'http://127.0.0.1:9/');
      assert.ok(String(out.headers['Set-Cookie']).includes('Max-Age=0'));
      assert.ok(Date.now() - started < 5000, `${issuer}: quick`);
    }
  } finally {
    for (const res of hanging) res.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test('an issuer answering 5xx, or not answering within fetchTimeoutMs, is unavailable', async () => {
  /** @type {import('node:http').ServerResponse[]} */
  const hanging = [];
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/slow')) hanging.push(res);
    else res.writeHead(502, { 'content-type': 'text/html' }).end('<h1>Bad gateway</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  try {
    await assert.rejects(bffAt(`http://127.0.0.1:${port}`).login({ url: '/auth/login', headers: {} }), (/** @type {any} */ e) => e.code === 'unavailable');
    const started = Date.now();
    // An issuer with a path is not valid OIDC, but it lets one server do both.
    const slow = bffAt(`http://127.0.0.1:${port}/slow`, { fetchTimeoutMs: 150 });
    await assert.rejects(slow.login({ url: '/auth/login', headers: {} }), (/** @type {any} */ e) => e.code === 'unavailable');
    assert.ok(Date.now() - started < 5000, 'the timeout applies');
  } finally {
    for (const res of hanging) res.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test('createBff refuses an issuer, redirect URI or keys it cannot use', () => {
  assert.throws(() => bffAt('ftp://x'), /issuer/);
  assert.throws(() => bffAt('http://127.0.0.1:9', { keys: [] }), /key/);
  assert.throws(() => bffAt('http://127.0.0.1:9', { redirectUri: '/auth/callback' }), /redirectUri/);
});
