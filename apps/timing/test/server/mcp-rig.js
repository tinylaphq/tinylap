// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// TEST-ONLY. Timing with MCP sign-in on: an MCP client whose metadata
// document a fake fetch serves, signed in through accounts' consent page,
// and the official MCP client connected to /mcp with its token.
import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { driveAuthorize } from '../../../../tools/test-env.js';
import { testSession } from '../../../accounts/test/helpers.js';
import { startTiming } from './helpers.js';
import real from './fixtures/mcp-clients.json' with { type: 'json' };

export const CLIENT = 'https://assistant.example/oauth/client.json';
const REDIRECT = 'http://127.0.0.1:53111/callback';

/** The real clients whose documents the fixtures hold. */
export const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
export const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';

/** Every metadata document the fake fetch serves: the test client's, and real clients' as fetched. */
const DOCUMENTS = new Map([
  [CLIENT, { client_id: CLIENT, client_name: 'Example Assistant', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }],
  ...real.documents.map((doc) => /** @type {[string, any]} */ ([doc.client_id, doc])),
]);

/** @type {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} */
const fetchMetadata = async (input) => {
  const doc = DOCUMENTS.get(String(input instanceof Request ? input.url : input));
  if (!doc) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json' } });
};

/** startTiming with MCP sign-in on. @param {Parameters<typeof startTiming>[0]} [options] */
export async function startMcpTiming(options = {}) {
  const t = await startTiming({ ...options, mcp: { fetchMetadata } });
  const token = (body) => fetch(`${t.suite.issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
    .then(async (res) => ({ status: res.status, body: await res.json() }));

  /**
   * Signs `user` in through the authorize URL `url` and allows it, as the browser would: where
   * the provider sends the browser back to the client, with the code. Memberships must exist first.
   * @param {any} user @param {URL | string} url
   */
  async function authorize(user, url) {
    const jar = await testSession(t.suite.accounts.auth, user.id);
    let location = new URL(/** @type {string} */ ((await driveAuthorize(url, jar)).headers.get('location')), t.suite.issuer);
    if (location.pathname === '/consent') {
      const allowed = await fetch(`${t.suite.issuer}/consent`, {
        method: 'POST', redirect: 'manual',
        headers: { cookie: jar.header(), origin: t.suite.issuer, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ oauth_query: location.search.slice(1), accept: '1' }),
      });
      location = new URL(/** @type {string} */ (allowed.headers.get('location')));
    }
    return { jar, location };
  }

  /** Signs `user` in as an MCP client and allows it: their tokens. Memberships must exist first. @param {any} user */
  async function connect(user, { scope = 'timing offline_access', client = CLIENT, redirect = REDIRECT } = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      response_type: 'code', client_id: client, redirect_uri: redirect, scope, state: 's',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${t.base}/mcp`,
    });
    const { jar, location } = await authorize(user, `${t.suite.issuer}/oauth2/authorize?${query}`);
    const code = location.searchParams.get('code');
    if (!code) throw new Error(`no code: ${location.href}`);
    const { status, body } = await token({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client, code_verifier: verifier, resource: `${t.base}/mcp` });
    if (status !== 200) throw new Error(`token ${status} ${JSON.stringify(body)}`);
    return { jar, accessToken: body.access_token, refreshToken: body.refresh_token };
  }

  /** A refreshed access token, or the token endpoint's refusal. @param {string} refreshToken */
  const refresh = (refreshToken) => token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT, resource: `${t.base}/mcp` });

  /** The official MCP client on /mcp with `accessToken`. */
  async function client(accessToken) {
    const mcp = new Client({ name: 'timing-test', version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${t.base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
    return mcp;
  }

  /** Calls a tool; answers its structured content and whether it was an error. */
  async function call(mcp, name, args = {}) {
    const result = /** @type {any} */ (await mcp.callTool({ name, arguments: args }));
    return { error: result.isError === true, value: result.structuredContent, text: result.content?.[0]?.text };
  }

  /** A raw JSON-RPC POST to /mcp, for what the client never sends. */
  const post = (body, headers = {}) => fetch(`${t.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  return { ...t, authorize, connect, refresh, client, call, post };
}
