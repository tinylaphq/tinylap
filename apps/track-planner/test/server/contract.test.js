// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Keeps openapi.json honest: every response below is checked against what
// the description says for its path, method and status, and every response
// the description documents must have been produced at least once.
import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import openapi from '../../server/openapi.json' with { type: 'json' };
import layoutSchema from '@tinylap/track-format/layout.schema.json' with { type: 'json' };
import { canonicalJson, snapshotKey, shapeKey } from '@tinylap/track-format';
import { mediaType } from '../../server/negotiate.js';
import { createHash, randomBytes } from 'node:crypto';
import { seal } from '@tinylap/auth';
import { createAuth } from '../../server/auth.js';
import { openStore } from '../../server/store.js';
import { createClub } from '../../../accounts/server/workspaces.js';
import { startServer, startPlanner, closedLayout, openLayout } from './helpers.js';

const BASE = 'http://tinylap.test';
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(layoutSchema, `${BASE}/schemas/layout.json`);

const local = (ref) => ref.slice(2).split('/').reduce((o, k) => o[k], openapi);
const deref = (node) => {
  if (Array.isArray(node)) return node.map(deref);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) return deref(local(node.$ref));
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(v)]));
};

// Longest first, so /layouts/{key}.json wins over /layouts/{key}.
const templates = Object.keys(openapi.paths)
  .map((path) => ({ path, re: new RegExp(`^${path.replace(/[.]/g, '\\.').replace(/\{[^}]+\}/g, '[^/]+')}$`) }))
  .sort((a, b) => b.path.length - a.path.length);

const seen = new Set();
let schemas = 0;

async function check(method, url, res) {
  const path = new URL(url).pathname;
  const template = templates.find((t) => t.re.test(path));
  assert.ok(template, `undocumented path ${path}`);
  const op = deref(openapi.paths[template.path])[method.toLowerCase()];
  assert.ok(op, `undocumented ${method} ${template.path}`);
  const documented = op.responses[String(res.status)];
  assert.ok(documented, `${method} ${template.path} does not document ${res.status}`);
  seen.add(`${method} ${template.path} ${res.status}`);
  const text = await res.text();
  if (!documented.content) return assert.equal(text, '', `${res.status} has an undocumented body`);
  const type = mediaType(res.headers.get('content-type'));
  const media = documented.content[type];
  assert.ok(media, `${method} ${template.path} ${res.status} does not document ${type}`);
  if (!type.endsWith('json')) return;
  const validate = ajv.compile({ $id: `${BASE}/r/${schemas++}`, ...media.schema });
  assert.ok(validate(JSON.parse(text)), `${method} ${path} ${res.status}: ${ajv.errorsText(validate.errors)}`);
}

const CHROME = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

test('every response matches the description', async () => {
  const up = await startServer();
  const limited = await startServer({ rateLimit: 0 });
  const down = await startServer({ store: null });
  const call = async (base, method, path, init = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', ...init });
    await check(method, base + path, res);
    return res;
  };
  const postJson = (base, body) => call(base, 'POST', '/layouts', { headers: { 'Content-Type': 'application/json' }, body });
  try {
    const layout = closedLayout();
    const key = await snapshotKey(layout);
    const sk = await shapeKey(layout.track.shape);
    const missing = 'AAAAAAAAAAAAAAAAAAAAAA';

    await postJson(up.base, JSON.stringify(layout));            // 201
    await postJson(up.base, JSON.stringify(layout));            // 200
    await postJson(up.base, JSON.stringify(openLayout()));
    await call(up.base, 'POST', '/layouts', { headers: { 'Content-Type': 'text/plain' }, body: 'x' });  // 415
    await postJson(up.base, 'x'.repeat(600 * 1024));            // 413
    const big = { ...openLayout(), pieces: Array.from({ length: 2000 }, (_, i) => ({ type: 'straight', x: i, y: 0, rot: 0 })) };
    await postJson(up.base, JSON.stringify(big));               // 413, once read
    await postJson(up.base, '{oops');                           // 422
    await postJson(limited.base, JSON.stringify(layout));       // 429
    await postJson(down.base, JSON.stringify(layout));          // 503

    for (const suffix of ['', '.json', '.html']) {
      const res = await call(up.base, 'GET', `/layouts/${key}${suffix}`, { headers: { accept: CHROME } });
      await call(up.base, 'GET', `/layouts/${key}${suffix}`, { headers: { accept: CHROME, 'if-none-match': res.headers.get('etag') } });
      await call(up.base, 'GET', `/layouts/${missing}${suffix}`);
      await call(down.base, 'GET', `/layouts/${key}${suffix}`);
    }
    await call(up.base, 'GET', `/layouts/${key}`);
    await call(up.base, 'GET', `/shapes/${sk}`);
    await call(up.base, 'GET', `/shapes/${sk}`, { headers: { accept: CHROME } });
    await call(up.base, 'GET', `/shapes/${missing}`);
    await call(down.base, 'GET', `/shapes/${sk}`);
    for (const path of ['/openapi.json', '/schemas/layout.json', '/.well-known/api-catalog', '/api', '/problems/too-large', '/problems/nope']) {
      await call(up.base, 'GET', path);
    }
  } finally {
    await Promise.all([up.close(), limited.close(), down.close()]);
  }
});

/** A planner whose accounts can't be reached at all (nothing listens on port 1). */
async function unreachable() {
  const store = openStore(':memory:');
  const keys = [{ id: 'k1', key: randomBytes(32) }];
  const publicUrl = 'http://planner.test';
  const auth = createAuth({ issuer: 'http://127.0.0.1:1', clientId: 'c', clientSecret: 's', keys, publicUrl, sessions: store.sessions, fetchTimeoutMs: 2000 });
  const server = await startServer({ store, auth, publicUrl });
  // A pending log-in, as /auth/login would have set it.
  const pending = seal(keys, JSON.stringify({ state: 's', nonce: 'n', verifier: 'v'.repeat(43), returnTo: '/', expiresAt: Date.now() + 60_000 }), 'login');
  // A session whose access token is spent, so the next request must refresh.
  const value = randomBytes(32).toString('base64url');
  const now = Date.now();
  await store.sessions.set(createHash('sha256').update(value).digest('hex'), {
    userId: 'u', createdAt: now, expiresAt: now + 3_600_000,
    sealedTokens: seal(keys, JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: 0 }), 'tokens'),
  });
  return { ...server, loginCookie: `__Host-tinylap-login=${pending}`, sessionCookie: `__Host-tinylap-session=${value}` };
}

test('every /auth response matches the description', async () => {
  const planner = await startPlanner();
  const off = await startServer();
  const dead = await unreachable();
  const call = async (base, method, path, init = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', ...init });
    await check(method, base + path, res);
    return res;
  };
  try {
    const page = { accept: CHROME };
    await call(planner.base, 'GET', '/auth/login?returnTo=/');                      // 302
    await call(off.base, 'GET', '/auth/login');                                     // 404
    await call(dead.base, 'GET', '/auth/login', { headers: page });                 // 503, a page
    await call(dead.base, 'GET', '/auth/login');                                    // 503, a problem

    const { jar, callback } = await planner.login();
    await check('GET', `${planner.base}/auth/callback`, callback);                  // 302
    await call(planner.base, 'GET', '/auth/callback?code=x&state=y', { headers: page }); // 400, a page
    await call(planner.base, 'GET', '/auth/callback?code=x&state=y');               // 400, a problem
    await call(off.base, 'GET', '/auth/callback');                                  // 404
    await call(dead.base, 'GET', '/auth/callback?code=x&state=s', { headers: { ...page, cookie: dead.loginCookie } }); // 503

    await call(planner.base, 'GET', '/auth/me');                                    // 200, logged out
    await call(planner.base, 'GET', '/auth/me', { headers: { cookie: jar.header() } }); // 200, logged in
    await call(off.base, 'GET', '/auth/me');                                        // 200, log-in off
    await call(dead.base, 'GET', '/auth/me', { headers: { cookie: dead.sessionCookie } }); // 503

    await call(planner.base, 'POST', '/auth/logout', { headers: { origin: 'https://evil.test', cookie: jar.header() } }); // 403
    await call(planner.base, 'POST', '/auth/logout', { headers: { origin: planner.base, cookie: jar.header() } });       // 302
    await call(off.base, 'POST', '/auth/logout', { headers: { origin: off.base } }); // 404
  } finally {
    await Promise.all([planner.close(), off.close(), dead.close()]);
  }
});

test('every /library response matches the description', async () => {
  const planner = await startPlanner();
  const dead = await unreachable();
  try {
    const { user } = await planner.suite.signInUser(undefined, 'Lauda');
    const club = createClub(planner.suite.accounts.db, user.id, 'Contract Club');
    const full = createClub(planner.suite.accounts.db, user.id, 'Full Club');
    for (let i = 0; i < 200; i += 1) {
      planner.store.createTrack({ id: `seed-${i}`, workspaceId: full.id, name: `T${i}`, key: String(i).padStart(22, 'A'), json: canonicalJson(openLayout()), userId: user.id, userName: 'Lauda' });
    }
    const { jar } = await planner.login('/', user);
    const as = { cookie: jar.header(), origin: planner.base };
    const call = async (base, method, path, { body, headers = as, type = 'application/json' } = {}) => {
      const init = { method, redirect: 'manual', headers: { ...headers, ...(body === undefined ? {} : { 'content-type': type }) } };
      if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
      const res = await fetch(base + path, init);
      const copy = res.clone();
      await check(method, base + path, res);
      return copy;
    };
    const huge = 'x'.repeat(600 * 1024);
    const unknown = '/library/tracks/nope';

    const closed = closedLayout();
    const created = await (await call(planner.base, 'POST', '/library/tracks', { body: { workspaceId: club.id, name: 'Zandvoort', layout: closed } })).json(); // 201
    const id = created.track.id;
    const t = `/library/tracks/${id}`;
    const { track: bare } = await (await call(planner.base, 'POST', '/library/tracks', { body: { workspaceId: club.id, name: 'Bare', layout: { ...closed, track: undefined } } })).json();
    const { track: doomed } = await (await call(planner.base, 'POST', '/library/tracks', { body: { workspaceId: club.id, name: 'Doomed', layout: openLayout() } })).json();

    // Every route: 401 logged out, 503 with accounts unreachable; writes: 403 from elsewhere.
    const routes = [
      ['GET', '/library'], ['GET', '/library/export'], ['POST', '/library/tracks'], ['PATCH', t], ['DELETE', t],
      ['GET', `${t}/versions`], ['POST', `${t}/versions`], ['DELETE', `${t}/versions/${created.track.currentKey}`],
      ['POST', `${t}/copy`], ['POST', `${t}/share`],
    ];
    for (const [method, path] of routes) {
      await call(planner.base, method, path, { headers: {} });                                         // 401
      await call(dead.base, method, path, { headers: { cookie: dead.sessionCookie } });              // 503
      if (method !== 'GET') await call(planner.base, method, path, { headers: { ...as, origin: 'https://evil.test' } }); // 403
    }
    for (const [method, path] of [['POST', '/library/tracks'], ['PATCH', t], ['POST', `${t}/versions`], ['POST', `${t}/copy`]]) {
      await call(planner.base, method, path, { body: 'x', type: 'text/plain' });                      // 415
      await call(planner.base, method, path, { body: huge });                                          // 413
      await call(planner.base, method, path, { body: '[]' });                                          // 422
    }

    await call(planner.base, 'GET', '/library');                                                       // 200
    await call(planner.base, 'GET', '/library/export');                                                // 200
    await call(planner.base, 'POST', '/library/tracks', { body: { workspaceId: 'nope', name: 'x', layout: openLayout() } }); // 404
    await call(planner.base, 'PATCH', t, { body: { name: 'Renamed' } });                               // 200
    await call(planner.base, 'PATCH', unknown, { body: { name: 'x' } });                               // 404
    await call(planner.base, 'GET', `${t}/versions`);                                                  // 200
    await call(planner.base, 'GET', `${unknown}/versions`);                                            // 404
    const { version } = await (await call(planner.base, 'POST', `${t}/versions`, { body: { layout: openLayout() } })).json(); // 201
    await call(planner.base, 'POST', `${unknown}/versions`, { body: { layout: openLayout() } });       // 404
    await call(planner.base, 'DELETE', `${t}/versions/${version.key}`);                                // 204
    await call(planner.base, 'DELETE', `${t}/versions/${version.key}`);                                // 404
    await call(planner.base, 'POST', `${t}/copy`, { body: { workspaceId: club.id } });                 // 201
    await call(planner.base, 'POST', `${t}/copy`, { body: { workspaceId: 'nope' } });                  // 404
    await call(planner.base, 'POST', `${t}/copy`, { body: { workspaceId: full.id } });                 // 422, quota
    await call(planner.base, 'POST', `${t}/share`);                                                    // 201
    await call(planner.base, 'POST', `${t}/share`);                                                    // 200
    await call(planner.base, 'POST', `/library/tracks/${bare.id}/share`);                              // 422, track-mismatch
    await call(planner.base, 'POST', `${unknown}/share`);                                              // 404
    await call(planner.base, 'DELETE', `/library/tracks/${doomed.id}`);                                // 204
    await call(planner.base, 'DELETE', unknown);                                                       // 404

    // A private snapshot, for its member: 200 and 304; for nobody: 404.
    const priv = `/layouts/${doomed.currentKey}`;
    const { track: kept } = await (await call(planner.base, 'POST', '/library/tracks', { body: { workspaceId: club.id, name: 'Kept', layout: openLayout() } })).json();
    for (const suffix of ['', '.json', '.html']) {
      const path = `/layouts/${kept.currentKey}${suffix}`;
      const res = await call(planner.base, 'GET', path, { headers: { cookie: jar.header(), accept: CHROME } });
      await call(planner.base, 'GET', path, { headers: { cookie: jar.header(), accept: CHROME, 'if-none-match': res.headers.get('etag') } });
      await call(planner.base, 'GET', `${priv}${suffix}`, { headers: {} });
    }
  } finally {
    await Promise.all([planner.close(), dead.close()]);
  }
});

test('every documented response was produced', () => {
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const [method, op] of Object.entries(item)) {
      for (const status of Object.keys(op.responses)) {
        assert.ok(seen.has(`${method.toUpperCase()} ${path} ${status}`), `${method.toUpperCase()} ${path} ${status} was never produced`);
      }
    }
  }
});
