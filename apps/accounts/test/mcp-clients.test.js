// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// MCP clients (timing MCP spec §4.3–4.5): a client is the URL of its Client
// ID Metadata Document, served here by a fake fetch. It may ask for the MCP
// resource and the `timing` scope only, the member allows it on the consent
// page, and the account page disconnects it.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { decodeJwt } from 'jose';
import { seedClients } from '../server/auth.js';
import { createTestUser, driveAuthorize, navigate, startAccounts, testSession } from './helpers.js';

const CLIENT = 'https://assistant.example/oauth/client.json';
const OTHER = 'https://other.example/client.json';
const MCP = 'http://127.0.0.1:8124/mcp';

/** The documents the fake fetch serves, by URL. */
const documents = {
  [CLIENT]: { client_id: CLIENT, client_name: 'Example Assistant', redirect_uris: ['http://127.0.0.1/callback', 'https://assistant.example/back'], token_endpoint_auth_method: 'none' },
  [OTHER]: { client_id: OTHER, client_name: 'Example Assistant', redirect_uris: ['https://elsewhere.example/back'], token_endpoint_auth_method: 'none' },
};
const fetched = [];
/** @type {import('@better-auth/oauth-provider').ClientMetadataResourceFetch} */
const fetchMetadata = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push(url);
  const doc = documents[url];
  return doc
    ? new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=600' } })
    : new Response('not found', { status: 404 });
};

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
/** Membership notices accounts sent, as the user lists they named. */
const notices = [];
let noticeServer;

before(async () => {
  noticeServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      notices.push(JSON.parse(body).users);
      res.writeHead(204).end();
    });
  });
  await new Promise((done) => noticeServer.listen(0, '127.0.0.1', done));
  accounts = await startAccounts({
    plannerPort: 8124,
    env: { TINYLAP_MCP_RESOURCE: MCP },
    notice: { uri: `http://127.0.0.1:${noticeServer.address().port}/notices/membership`, token: 'notice-test' },
    fetchMetadata,
  });
});
after(async () => {
  await accounts.close();
  noticeServer.closeAllConnections();
  await new Promise((done) => noticeServer.close(done));
});

/** A signed-in member and their session jar. */
async function member(name = 'Ayrton') {
  const user = await createTestUser(accounts.auth, name);
  return { user, jar: await testSession(accounts.auth, user.id) };
}

/** Starts an authorize request as `client`; answers the redirect and the PKCE verifier. */
async function authorize(jar, { client = CLIENT, scope = 'timing offline_access', resource = MCP, redirectUri = 'http://127.0.0.1:53111/callback' } = {}) {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code', client_id: client, redirect_uri: redirectUri, scope, state: 'st',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource,
  });
  const res = await driveAuthorize(`${accounts.issuer}/oauth2/authorize?${query}`, jar);
  return { location: new URL(res.headers.get('location') ?? '', accounts.issuer), verifier, redirectUri };
}

/** Posts the consent form as the consent page does. */
const answer = (jar, query, accept, headers = { origin: accounts.issuer }) => fetch(`${accounts.issuer}/consent`, {
  method: 'POST',
  redirect: 'manual',
  headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams({ oauth_query: query, accept: accept ? '1' : '0' }),
});

/** Exchanges a code for tokens as a public client. */
async function redeem(code, verifier, redirectUri, client = CLIENT) {
  const res = await fetch(`${accounts.issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: client, code_verifier: verifier, resource: MCP }),
  });
  return { status: res.status, body: await res.json() };
}

/** Authorizes, allows on the consent page, and redeems the code. */
async function connect(jar) {
  const { location, verifier, redirectUri } = await authorize(jar);
  assert.equal(location.pathname, '/consent');
  const allowed = await answer(jar, location.search.slice(1), true);
  assert.equal(allowed.status, 303);
  const back = new URL(allowed.headers.get('location'));
  return redeem(back.searchParams.get('code'), verifier, redirectUri);
}

const refresh = (refreshToken) => fetch(`${accounts.issuer}/oauth2/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT, resource: MCP }),
});

test('discovery advertises client metadata documents', async () => {
  const doc = await (await fetch(`${accounts.issuer}/.well-known/oauth-authorization-server`)).json();
  assert.equal(doc.client_id_metadata_document_supported, true);
  assert.ok(doc.scopes_supported.includes('timing'));
});

test('the consent page names the verified host above the name the client gives itself', async () => {
  const { jar } = await member();
  const { location } = await authorize(jar);
  assert.equal(location.pathname, '/consent');
  const page = await navigate(location, { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Allow Example Assistant to run timing as you\?/);
  assert.match(html, /<strong>assistant\.example<\/strong>/);
  assert.match(html, /Stays connected/);
  assert.doesNotMatch(html, /It will send you back/, 'a loopback redirect is not named');
  assert.match(html, /<form method="post" action="\/consent">/);
});

test('a redirect on another host is named on the consent page', async () => {
  const { jar } = await member();
  const { location } = await authorize(jar, { client: OTHER, redirectUri: 'https://elsewhere.example/back' });
  const html = await (await navigate(location, { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() })).text();
  assert.match(html, /It will send you back to <strong>elsewhere\.example<\/strong>/);
});

test('allowing gives a token for the MCP resource only, with the timing scope and the member name', async () => {
  const { user, jar } = await member('Brigitte');
  const { status, body } = await connect(jar);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.scope, 'timing offline_access');
  assert.ok(body.refresh_token);
  assert.equal(body.id_token, undefined);
  const claims = decodeJwt(body.access_token);
  assert.equal(claims.aud, MCP, 'no userinfo audience: the token works at /mcp only');
  assert.equal(claims.sub, user.id);
  assert.equal(claims.name, 'Brigitte');
  assert.equal(claims.azp, CLIENT);
  assert.deepEqual(claims.workspaces, []);
});

test('a loopback redirect may use any port', async () => {
  const { jar } = await member();
  const { location } = await authorize(jar, { redirectUri: 'http://127.0.0.1:61234/callback' });
  assert.equal(location.pathname, '/consent');
});

test('consent is remembered: the next sign-in skips the page', async () => {
  const { jar } = await member();
  await connect(jar);
  const { location } = await authorize(jar);
  assert.equal(location.origin, 'http://127.0.0.1:53111');
  assert.ok(location.searchParams.get('code'));
});

test('cancel sends the member back with access_denied', async () => {
  const { jar } = await member();
  const { location } = await authorize(jar);
  const res = await answer(jar, location.search.slice(1), false);
  assert.equal(res.status, 303);
  const back = new URL(res.headers.get('location'));
  assert.equal(back.origin, 'http://127.0.0.1:53111');
  assert.equal(back.searchParams.get('error'), 'access_denied');
});

test('the consent form refuses a cross-site post and a tampered request', async () => {
  const { jar } = await member();
  const { location } = await authorize(jar);
  const query = location.search.slice(1);
  assert.equal((await answer(jar, query, true, { origin: 'https://evil.example' })).status, 403);
  const tampered = query.replace('scope=timing', 'scope=openid+timing');
  assert.equal((await answer(jar, tampered, true)).status, 410);
  const gone = await navigate(new URL(`/consent?${tampered}`, accounts.issuer), { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() });
  assert.equal(gone.status, 410);
});

test('an MCP client may not ask for another resource or for openid', async () => {
  const { jar } = await member();
  const planner = await authorize(jar, { resource: accounts.client.resource });
  assert.notEqual(planner.location.pathname, '/consent');
  assert.ok(planner.location.searchParams.get('error'), planner.location.href);
  const openid = await authorize(jar, { scope: 'openid timing' });
  assert.equal(openid.location.searchParams.get('error'), 'invalid_scope');
});

test('a first-party client may not ask for the timing scope', async () => {
  const { jar } = await member();
  const res = await authorize(jar, { client: accounts.client.clientId, redirectUri: accounts.client.redirectUri, resource: accounts.client.resource, scope: 'openid timing' });
  assert.equal(res.location.searchParams.get('error'), 'invalid_scope');
});

test('re-seeding the configured clients leaves MCP clients enabled', async () => {
  const { jar } = await member();
  await connect(jar);
  await seedClients(accounts.auth, accounts.config.clients);
  const row = accounts.db.prepare('SELECT disabled FROM oauthClient WHERE clientId = ?').get(CLIENT);
  assert.ok(!row.disabled);
});

test('connected apps: listed on the account page, disconnected with a plain form', async () => {
  const { user, jar } = await member('Clara');
  const tokens = (await connect(jar)).body;
  const page = await (await navigate(new URL('/account', accounts.issuer), { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() })).text();
  assert.match(page, /Connected apps <span class="accounts-count">1<\/span>/);
  assert.match(page, /Example Assistant<span class="accounts-row-sub">assistant\.example · allowed/);
  assert.doesNotMatch(page, /planner-test/, 'first-party clients are not listed');

  const sent = notices.length;
  const res = await fetch(`${accounts.issuer}/account/apps/disconnect`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: jar.header(), origin: accounts.issuer, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client: CLIENT }),
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/account?disconnected=Example%20Assistant#apps');
  assert.equal((await refresh(tokens.refresh_token)).status >= 400, true, 'its refresh token is gone');
  for (let i = 0; i < 50 && notices.length === sent; i++) await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual(notices.at(-1), [user.id], 'timing is told');

  const after = await (await navigate(new URL('/account?disconnected=Example%20Assistant', accounts.issuer), { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() })).text();
  assert.match(after, /Example Assistant is disconnected/);
  assert.match(after, /No apps are connected to your account\./);
  const again = await authorize(jar);
  assert.equal(again.location.pathname, '/consent', 'the next sign-in asks again');
});

test('disconnect refuses a cross-site post', async () => {
  const { jar } = await member();
  const res = await fetch(`${accounts.issuer}/account/apps/disconnect`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: jar.header(), origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client: CLIENT }),
  });
  assert.equal(res.status, 403);
});

test('metadata documents are cached, not fetched on every sign-in', async () => {
  const { jar } = await member();
  const before = fetched.filter((u) => u === CLIENT).length;
  await authorize(jar);
  await authorize(jar);
  assert.equal(fetched.filter((u) => u === CLIENT).length, before);
});

test('authorize requests from MCP clients are limited per client address', async () => {
  const { jar } = await member();
  // The earlier tests spent some of the hour's 60; spend the rest.
  let last;
  for (let i = 0; i < 61; i++) {
    last = await navigate(new URL(`/oauth2/authorize?client_id=${encodeURIComponent(CLIENT)}`, accounts.issuer), { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() });
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  // A first-party client is not limited this way.
  const planner = await navigate(new URL(`/oauth2/authorize?client_id=${accounts.client.clientId}`, accounts.issuer), { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() });
  assert.notEqual(planner.status, 429);
});
