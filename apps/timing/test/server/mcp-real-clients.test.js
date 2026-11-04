// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Real MCP clients (timing MCP spec §4): Claude's hosted apps and Claude Code
// sign in with their own Client ID Metadata Documents (copies in
// fixtures/mcp-clients.json, checked by the plugin as at any sign-in), and
// the official client SDK finds its way from
// a bare 401 to a token through discovery alone, as a client in the wild does.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport, UnauthorizedError } from '@modelcontextprotocol/client';
import { CLAUDE, CLAUDE_CODE, startMcpTiming } from './mcp-rig.js';

/** @type {Awaited<ReturnType<typeof startMcpTiming>>} */
let t;
let user;

before(async () => {
  t = await startMcpTiming();
  user = await t.signUp('Ayrton');
  t.club(user, 'Office');
});
after(() => t.close());

test('Claude (claude.ai, Desktop, mobile): its own callback, then a token for /mcp', async () => {
  const { accessToken } = await t.connect(user, { client: CLAUDE, redirect: 'https://claude.ai/api/mcp/auth_callback' });
  const mcp = await t.client(accessToken);
  const { value } = await t.call(mcp, 'list_spaces');
  assert.deepEqual(value.spaces.map((s) => s.name).sort(), ['Ayrton', 'Office']);
  await mcp.close();
});

test('Claude Code: a loopback redirect on localhost or 127.0.0.1, on any port', async () => {
  for (const redirect of ['http://localhost:3118/callback', 'http://127.0.0.1:49152/callback']) {
    const { accessToken } = await t.connect(user, { client: CLAUDE_CODE, redirect });
    assert.ok(accessToken, redirect);
  }
});

test('the consent page warns when an app only returns to this computer', async () => {
  const other = await t.signUp('Brigitte');
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code', client_id: CLAUDE_CODE, redirect_uri: 'http://localhost:3118/callback', scope: 'timing offline_access', state: 's',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${t.base}/mcp`,
  });
  const { navigate, testSession } = await import('../../../accounts/test/helpers.js');
  const jar = await testSession(t.suite.accounts.auth, other.id);
  const { driveAuthorize } = await import('../../../../tools/test-env.js');
  const consent = new URL(/** @type {string} */ ((await driveAuthorize(`${t.suite.issuer}/oauth2/authorize?${query}`, jar)).headers.get('location')), t.suite.issuer);
  assert.equal(consent.pathname, '/consent');
  const html = await (await navigate(consent, { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() })).text();
  assert.match(html, /<strong>claude\.ai<\/strong>/);
  assert.match(html, /runs on this computer/);
});

test('the official client SDK: from a bare 401, through discovery and consent, to a tool call', async () => {
  const redirectUrl = 'http://localhost:3118/callback';
  /** @type {URL | null} */
  let authorizeUrl = null;
  const store = { tokens: undefined, verifier: undefined, discovery: undefined, info: new Map(), state: undefined };
  /** @type {import('@modelcontextprotocol/client').OAuthClientProvider} */
  const provider = {
    get redirectUrl() { return redirectUrl; },
    clientMetadataUrl: CLAUDE_CODE,
    get clientMetadata() { return { client_name: 'Claude Code', redirect_uris: [redirectUrl], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }; },
    state: () => (store.state = randomBytes(8).toString('hex')),
    clientInformation: (ctx) => (ctx ? store.info.get(ctx.issuer) : undefined),
    saveClientInformation: (info, ctx) => { if (ctx) store.info.set(ctx.issuer, info); },
    tokens: () => store.tokens,
    saveTokens: (tokens) => { store.tokens = tokens; },
    saveDiscoveryState: (state) => { store.discovery = state; },
    discoveryState: () => store.discovery,
    redirectToAuthorization: (url) => { authorizeUrl = url; },
    saveCodeVerifier: (v) => { store.verifier = v; },
    codeVerifier: () => store.verifier,
  };
  const url = new URL(`${t.base}/mcp`);
  const first = new Client({ name: 'sdk-oauth', version: '1.0.0' });
  await assert.rejects(first.connect(new StreamableHTTPClientTransport(url, { authProvider: provider })), (error) => error instanceof UnauthorizedError);
  assert.ok(authorizeUrl, 'the SDK found the authorization server and sent the member there');
  const asked = new URL(authorizeUrl);
  assert.equal(asked.origin, t.suite.issuer);
  assert.equal(asked.searchParams.get('client_id'), CLAUDE_CODE, 'it identified itself by its metadata document');
  assert.equal(asked.searchParams.get('resource'), url.href);
  assert.match(asked.searchParams.get('scope') ?? '', /\btiming\b/);

  const { location } = await t.authorize(user, asked);
  assert.equal(location.searchParams.get('state'), store.state);
  const transport = new StreamableHTTPClientTransport(url, { authProvider: provider });
  await transport.finishAuth(location.searchParams);
  const mcp = new Client({ name: 'sdk-oauth', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));
  const result = /** @type {any} */ (await mcp.callTool({ name: 'list_spaces', arguments: {} }));
  assert.equal(result.isError, undefined);
  assert.ok(result.structuredContent.spaces.length >= 2);
  await mcp.close();
});
