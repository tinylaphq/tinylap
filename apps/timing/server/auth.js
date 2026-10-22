// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Log-in to TinyLap (identity spec §6): the timing app is a backend-for-frontend
// through @tinylap/auth, so the browser only ever holds an opaque session
// cookie. Every route here reads that cookie, so they are `credentials`
// routes: no CORS, `Vary: Cookie` (app.js). Without `auth` in the handler's
// context, log-in is off and every workspace route answers 401.
import { AuthError, createBff } from '@tinylap/auth';
import { prefersHtml } from './negotiate.js';
import { esc, page } from './pages.js';
import { page as screen } from './respond.js';
import { html, json, problem } from './responses.js';
import { serverErrorPage, unavailablePage } from './views/notice.js';

/**
 * @typedef {{
 *   bff: import('@tinylap/auth').Bff,
 *   issuer: string,
 *   accountUrl: string,
 *   sessions: import('./store.js').TimingSessions,
 *   userName(accessToken: string): Promise<string | null>,
 * }} Auth
 */

const UNAVAILABLE = 'Sign-in is unavailable right now.';
const NO_STORE = { 'Cache-Control': 'no-store' };
export const isOutage = (/** @type {unknown} */ error) => error instanceof AuthError && error.code === 'unavailable';

/**
 * Log-in for the app served at `publicUrl`: the BFF, the account page's
 * URL, and the display name from the issuer's userinfo.
 * @param {{ issuer: string, clientId: string, clientSecret: string, keys: import('@tinylap/auth').SealKey[],
 *   publicUrl: string, sessions: import('./store.js').TimingSessions, fetchTimeoutMs?: number,
 *   fetch?: typeof fetch, logger?: { warn(message: string): void } }} options
 * @returns {Auth}
 */
export function createAuth({ issuer, clientId, clientSecret, keys, publicUrl, sessions, fetchTimeoutMs = 15_000, fetch: fetchImpl = fetch, logger }) {
  const origin = publicUrl.replace(/\/$/, '');
  const base = issuer.replace(/\/$/, '');
  const bff = createBff({
    issuer: base,
    clientId,
    clientSecret,
    redirectUri: `${origin}/auth/callback`,
    postLogoutRedirectUri: `${origin}/`,
    resource: origin,
    store: sessions,
    keys,
    fetchTimeoutMs,
    fetch: fetchImpl,
    logger,
  });

  /** A call to the issuer; a failure to connect, a timeout or a 5xx is an outage. */
  const call = async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(fetchTimeoutMs) });
    } catch (error) {
      throw new AuthError('unavailable', UNAVAILABLE, { cause: error });
    }
    if (res.status >= 500) throw new AuthError('unavailable', UNAVAILABLE);
    return res;
  };

  /** @type {Promise<string> | null} */
  let userinfoEndpoint = null;
  const discover = () => (userinfoEndpoint ??= (async () => {
    const res = await call(`${base}/.well-known/openid-configuration`);
    const doc = res.ok ? await res.json().catch(() => null) : null;
    if (typeof doc?.userinfo_endpoint !== 'string') throw new AuthError('unavailable', UNAVAILABLE);
    return doc.userinfo_endpoint;
  })().catch((error) => {
    userinfoEndpoint = null;
    throw error;
  }));

  return {
    bff,
    issuer: base,
    accountUrl: `${base}/account`,
    sessions,
    async userName(accessToken) {
      const res = await call(await discover(), { headers: { authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return null;
      const info = await res.json().catch(() => null);
      return typeof info?.name === 'string' && info.name ? info.name : null;
    },
  };
}

/** @param {{ origin: string }} request */
const unavailable = (request) => problem(request, 'unavailable', UNAVAILABLE);

/**
 * Wraps a route handler: `request.session` is the BFF session, or null when
 * logged out or log-in is off. An outage at the issuer answers 503. A page
 * route answers its failures as pages (503, or 500 for anything unexpected,
 * logged here); the API keeps Problem Details.
 * @param {(request: any, match: RegExpExecArray) => any} handler
 * @param {{ pages?: boolean }} [options]
 */
export function withSession(handler, { pages = false } = {}) {
  return async (/** @type {any} */ request, /** @type {RegExpExecArray} */ match) => {
    try {
      request.session = request.auth ? await request.auth.bff.session(request.req) : null;
      return await handler(request, match);
    } catch (error) {
      if (isOutage(error)) return pages ? screen(request, 503, unavailablePage(request)) : unavailable(request);
      if (!pages) throw error;
      console.error(error);
      return screen(request, 500, serverErrorPage(request));
    }
  };
}

/** A navigation gets a page it can act on; anything else, Problem Details. */
function failure(request, name, title, detail, extra = {}) {
  const res = prefersHtml(request.req.headers.accept)
    ? html(problem(request, name, detail).status, page(`${title} · TinyLap Timing`, `<h1>${esc(title)}</h1>
<p>${esc(detail)}</p>
<p><a href="/auth/login">Sign in again</a> &middot; <a href="/">Back to timing</a></p>`), NO_STORE)
    : problem(request, name, detail);
  return { ...res, headers: { ...res.headers, ...extra } };
}

const off = (request) => problem(request, 'not-found', 'Sign-in is not set up on this server.');

/** The BFF's own response, or a 503 when the issuer can't be reached. */
async function viaBff(request, step) {
  try {
    return await step(request.auth.bff);
  } catch (error) {
    if (isOutage(error)) return failure(request, 'unavailable', "Can't sign in right now", `${UNAVAILABLE} Timing keeps recording; try again in a minute.`);
    throw error;
  }
}

async function login(request) {
  if (!request.auth) return off(request);
  return viaBff(request, (bff) => bff.login(request.req));
}

async function callback(request) {
  if (!request.auth) return off(request);
  return viaBff(request, async (bff) => {
    const res = await bff.callback(request.req);
    if (res.status !== 400) return res;
    // The BFF's text says why; the cookie it clears must still go out.
    const cookies = res.headers['Set-Cookie'];
    return failure(request, 'login-failed', "The sign-in didn't finish", res.body ?? 'Sign in again.', cookies ? { 'Set-Cookie': cookies } : {});
  });
}

async function logout(request) {
  if (!request.auth) return off(request);
  if (!request.auth.bff.requireSameOrigin(request.req)) return problem(request, 'forbidden', "Sign out from the app's own page.");
  return request.auth.bff.logout(request.req);
}

/**
 * The logged-in user's display name: cached in the session, else fetched
 * from userinfo once. Call inside withSession, with a session.
 * @param {any} request @returns {Promise<string | null>}
 */
export async function displayName(request) {
  const { auth, session } = request;
  const id = auth.bff.sessionId(request.req);
  let name = id ? auth.sessions.getName(id) : null;
  if (name === null) {
    name = await auth.userName(session.accessToken);
    if (name !== null && id) auth.sessions.setName(id, name);
  }
  return name;
}

const me = withSession(async (request) => {
  const { auth, session } = request;
  if (!auth) return json(200, { loggedIn: false, available: false }, NO_STORE);
  if (!session) return json(200, { loggedIn: false, available: true }, NO_STORE);
  const name = await displayName(request);
  return json(200, {
    loggedIn: true,
    available: true,
    user: { id: session.userId, name },
    workspaces: (session.claims.workspaces ?? []).map(({ id: wid, role, name: wname }) => ({ id: wid, role, ...(wname === undefined ? {} : { name: wname }) })),
    accountUrl: auth.accountUrl,
  }, NO_STORE);
});

export const authRoutes = [
  { pattern: /^\/auth\/login$/, credentials: true, methods: { GET: login } },
  { pattern: /^\/auth\/callback$/, credentials: true, methods: { GET: callback } },
  { pattern: /^\/auth\/logout$/, credentials: true, methods: { POST: logout } },
  { pattern: /^\/auth\/me$/, credentials: true, methods: { GET: me } },
  { pattern: /^\/auth(?:\/.*)?$/, credentials: true, unknown: true, methods: {} },
];
