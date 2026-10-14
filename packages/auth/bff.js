// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// A backend-for-frontend: the app server logs the browser in with the
// authorization code flow (PKCE, state, nonce), keeps the tokens itself,
// sealed, and gives the browser only an opaque HttpOnly cookie. Standard
// OIDC through openid-client; nothing here knows which provider it talks to.
import { createHash, randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { AuthError, verifyAccessToken } from './verify.js';
import { open, seal } from './crypto.js';

const DAY = 86_400_000;
/** Idle lifetime, renewed on every refresh. */
const SESSION_IDLE_MS = 30 * DAY;
/** Hard cap after login. */
const SESSION_MAX_MS = 90 * DAY;
const LOGIN_TTL_S = 600;
/** Refresh when the access token has less than this left. */
const REFRESH_MARGIN_MS = 60_000;
const COOKIE_VALUE = /^[A-Za-z0-9_-]{43}$/;

/** Raised from inside fetch, so it is found in the cause chain of whatever openid-client throws. */
class IssuerUnavailable extends Error {
  /** @param {string} message @param {unknown} [cause] */
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'IssuerUnavailable';
  }
}

/** @param {unknown} cause */
const unavailable = (cause) => new AuthError('unavailable', 'Log-in is unavailable right now.', { cause });

/**
 * True when `error` comes from the issuer being unreachable, slow or failing
 * (5xx), wherever in the cause chain it sits.
 * @param {unknown} error
 */
function isOutage(error) {
  for (let e = error, depth = 0; e && depth < 10; e = /** @type {any} */ (e).cause, depth++) {
    if (e instanceof IssuerUnavailable) return true;
    if (e instanceof AuthError) return e.code === 'unavailable';
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) return true;
  }
  return false;
}

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} name
 */
function header(headers, name) {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The first cookie called `name`. With `__Host-` names a sibling domain can't
 * plant a second one, so the first is the one we set.
 * @param {{ headers: Record<string, string | string[] | undefined> }} req
 * @param {string} name
 */
function readCookie(req, name) {
  const raw = header(req.headers, 'cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * A same-origin relative path, or `/`. It must start with exactly one `/`,
 * hold no backslash (WHATWG URLs read `\` as `/`) and no control characters,
 * and still resolve to the app origin.
 * @param {string | null} value
 * @param {string} origin
 */
export function safeReturnTo(value, origin) {
  if (typeof value !== 'string' || value.length > 2048) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  if (/%5c/i.test(value)) return '/';
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

/**
 * @param {import('./types.js').BffOptions} options
 * @returns {import('./types.js').Bff}
 */
export function createBff(options) {
  const {
    issuer, clientId, clientSecret, redirectUri, postLogoutRedirectUri, resource, store, keys,
    scope = 'openid profile offline_access',
    secureCookies = true,
    fetchTimeoutMs = 15_000,
    fetch: fetchImpl = globalThis.fetch,
  } = options;
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== 'https:' && issuerUrl.protocol !== 'http:') throw new Error(`createBff: the issuer must be an http(s) URL; got "${issuer}".`);
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('createBff: keys needs at least one key.');
  /** @type {URL} */
  let redirect;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new Error(`createBff: redirectUri must be an absolute URL; got "${redirectUri}".`);
  }
  const appOrigin = redirect.origin;
  // `__Host-` cookies need Secure; without it (plain-http dev on a non-local
  // host) the prefix would make the browser drop the cookie.
  const named = (/** @type {string} */ name) => (secureCookies ? name : name.replace(/^__(Host|Secure)-/, ''));
  const sessionCookie = named(options.cookieName ?? '__Host-tinylap-session');
  const loginCookie = named('__Host-tinylap-login');

  /** @param {string} name @param {string} value @param {number} maxAge */
  const cookie = (name, value, maxAge) =>
    `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly${secureCookies ? '; Secure' : ''}; SameSite=Lax`;

  /**
   * Every call to the issuer: a timeout, and a failure to connect or a 5xx
   * becomes IssuerUnavailable.
   * @type {oidc.CustomFetch}
   */
  const issuerFetch = async (url, init) => {
    const timeout = AbortSignal.timeout(fetchTimeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    /** @type {Response} */
    let res;
    try {
      res = await fetchImpl(url, /** @type {RequestInit} */ ({ ...init, signal }));
    } catch (cause) {
      throw new IssuerUnavailable(`The issuer did not answer ${new URL(url).pathname}.`, cause);
    }
    if (res.status >= 500) {
      await res.body?.cancel();
      throw new IssuerUnavailable(`The issuer answered ${res.status} for ${new URL(url).pathname}.`);
    }
    return res;
  };

  /** @type {Promise<oidc.Configuration> | null} */
  let discovered = null;
  /** Discovery, once per instance; a failure is forgotten so the next call retries. */
  function configuration() {
    discovered ??= oidc.discovery(issuerUrl, clientId, undefined, oidc.ClientSecretBasic(clientSecret), {
      [oidc.customFetch]: issuerFetch,
      execute: issuerUrl.protocol === 'http:' ? [oidc.allowInsecureRequests] : [],
    }).catch((cause) => {
      discovered = null;
      throw isOutage(cause) ? unavailable(cause) : cause;
    });
    return discovered;
  }

  /** @param {string} token */
  const verify = (token) => verifyAccessToken(token, { issuer, audience: resource });

  /**
   * @param {oidc.TokenEndpointResponse} response
   * @param {Partial<import('./types.js').SealedTokens>} [previous]
   */
  async function tokensFrom(response, previous = {}) {
    const claims = await verify(response.access_token);
    const refreshToken = response.refresh_token ?? previous.refreshToken;
    if (!refreshToken) throw new Error('The issuer sent no refresh token; ask for offline_access.');
    /** @type {import('./types.js').SealedTokens} */
    const tokens = {
      accessToken: response.access_token,
      refreshToken,
      idToken: response.id_token ?? previous.idToken,
      expiresAt: claims.exp * 1000,
    };
    return { tokens, claims };
  }

  /** @param {string} value */
  const idOf = (value) => createHash('sha256').update(value).digest('hex');

  /** @param {{ headers: Record<string, string | string[] | undefined> }} req */
  function sessionIdOf(req) {
    const value = readCookie(req, sessionCookie);
    return value && COOKIE_VALUE.test(value) ? idOf(value) : null;
  }

  /**
   * The stored session and its tokens, or null (and the row gone) when it
   * expired or can't be opened any more (its key was retired).
   * @param {string} id
   */
  async function load(id) {
    const row = await store.get(id);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      await store.delete(id);
      return null;
    }
    try {
      return { row, tokens: /** @type {import('./types.js').SealedTokens} */ (JSON.parse(open(keys, row.sealedTokens))) };
    } catch {
      await store.delete(id);
      return null;
    }
  }

  /** @type {Map<string, Promise<import('./types.js').BffSession | null>>} */
  const refreshing = new Map();

  /**
   * One refresh for `id`. It reads the row again first: a refresh that just
   * finished has rotated the refresh token, and using the old one would be
   * refused and end the session.
   * @param {string} id
   * @returns {Promise<import('./types.js').BffSession | null>}
   */
  async function refresh(id) {
    const current = await load(id);
    if (!current) return null;
    const { row, tokens } = current;
    if (tokens.expiresAt - Date.now() >= REFRESH_MARGIN_MS) {
      try {
        return { userId: row.userId, accessToken: tokens.accessToken, claims: await verify(tokens.accessToken) };
      } catch (error) {
        if (!(error instanceof AuthError) || error.code !== 'invalid_token') throw error;
        // Not usable after all (a retired signing key, say): refresh it.
      }
    }
    const config = await configuration();
    /** @type {oidc.TokenEndpointResponse} */
    let response;
    try {
      response = await oidc.refreshTokenGrant(config, tokens.refreshToken, { resource });
    } catch (error) {
      if (error instanceof oidc.ResponseBodyError && error.error === 'invalid_grant') {
        await store.delete(id);
        return null;
      }
      // An outage, or anything else the issuer got wrong: keep the session.
      throw unavailable(error);
    }
    const next = await tokensFrom(response, tokens);
    if (next.claims.sub !== row.userId) {
      await store.delete(id);
      return null;
    }
    const now = Date.now();
    await store.set(id, {
      ...row,
      sealedTokens: seal(keys, JSON.stringify(next.tokens)),
      expiresAt: Math.min(now + SESSION_IDLE_MS, row.createdAt + SESSION_MAX_MS),
    });
    return { userId: row.userId, accessToken: next.tokens.accessToken, claims: next.claims };
  }

  return {
    async login(req) {
      const url = new URL(req.url ?? '/', appOrigin);
      const returnTo = safeReturnTo(url.searchParams.get('returnTo'), appOrigin);
      const config = await configuration();
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const location = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope,
        response_mode: 'query',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
        resource,
      });
      const pending = seal(keys, JSON.stringify({ state, nonce, verifier, returnTo, expiresAt: Date.now() + LOGIN_TTL_S * 1000 }));
      return {
        status: 302,
        headers: { Location: location.href, 'Set-Cookie': [cookie(loginCookie, pending, LOGIN_TTL_S)], 'Cache-Control': 'no-store' },
      };
    },

    async callback(req) {
      const spent = cookie(loginCookie, '', 0);
      /** @param {string} detail */
      const fail = (detail) => ({
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': [spent] },
        body: `${detail} Please log in again.`,
      });
      const sealed = readCookie(req, loginCookie);
      if (!sealed) return fail('This log-in has expired or was started in another browser.');
      /** @type {{ state: string, nonce: string, verifier: string, returnTo: string, expiresAt: number }} */
      let pending;
      try {
        pending = JSON.parse(open(keys, sealed));
      } catch {
        return fail('This log-in could not be read.');
      }
      if (!(pending.expiresAt > Date.now())) return fail('This log-in has expired.');

      const config = await configuration();
      const current = new URL(redirectUri);
      current.search = new URL(req.url ?? '/', appOrigin).search;
      /** @type {Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>} */
      let response;
      try {
        response = await oidc.authorizationCodeGrant(
          config, current,
          { pkceCodeVerifier: pending.verifier, expectedState: pending.state, expectedNonce: pending.nonce, idTokenExpected: true },
          { resource },
        );
      } catch (error) {
        if (isOutage(error)) throw unavailable(error);
        return fail('The log-in did not complete.');
      }
      /** @type {Awaited<ReturnType<typeof tokensFrom>>} */
      let issued;
      try {
        issued = await tokensFrom(response);
      } catch (error) {
        if (error instanceof AuthError && error.code === 'unavailable') throw error;
        return fail('The log-in did not complete.');
      }
      const { tokens, claims } = issued;
      if (response.claims()?.sub !== claims.sub) return fail('The log-in did not complete.');

      const value = randomBytes(32).toString('base64url');
      const now = Date.now();
      // A new id for every login, so a planted cookie never becomes a session.
      const old = sessionIdOf(req);
      if (old) await store.delete(old);
      await store.set(idOf(value), {
        userId: claims.sub,
        sealedTokens: seal(keys, JSON.stringify(tokens)),
        createdAt: now,
        expiresAt: now + SESSION_IDLE_MS,
      });
      return {
        status: 302,
        headers: {
          Location: new URL(pending.returnTo, appOrigin).href,
          'Set-Cookie': [cookie(sessionCookie, value, SESSION_MAX_MS / 1000), spent],
          'Cache-Control': 'no-store',
        },
      };
    },

    async logout(req) {
      const id = sessionIdOf(req);
      const current = id ? await load(id) : null;
      // Gone here first: whatever happens at the issuer, this app forgets it.
      if (id) await store.delete(id);
      const config = await configuration();
      if (current) {
        try {
          await oidc.tokenRevocation(config, current.tokens.refreshToken, { token_type_hint: 'refresh_token' });
        } catch (error) {
          if (isOutage(error)) throw unavailable(error);
          // RFC 7009: anything else means the token is no good anyway.
        }
      }
      /** @type {Record<string, string>} */
      const params = { post_logout_redirect_uri: postLogoutRedirectUri };
      if (current?.tokens.idToken) params.id_token_hint = current.tokens.idToken;
      return {
        status: 302,
        headers: {
          Location: oidc.buildEndSessionUrl(config, params).href,
          'Set-Cookie': [cookie(sessionCookie, '', 0)],
          'Cache-Control': 'no-store',
        },
      };
    },

    async session(req) {
      const id = sessionIdOf(req);
      if (!id) return null;
      const current = await load(id);
      if (!current) return null;
      const { row, tokens } = current;
      if (tokens.expiresAt - Date.now() >= REFRESH_MARGIN_MS) {
        try {
          return { userId: row.userId, accessToken: tokens.accessToken, claims: await verify(tokens.accessToken) };
        } catch (error) {
          if (!(error instanceof AuthError) || error.code !== 'invalid_token') throw error;
        }
      }
      let flight = refreshing.get(id);
      if (!flight) {
        flight = refresh(id).finally(() => refreshing.delete(id));
        refreshing.set(id, flight);
      }
      return flight;
    },

    requireSameOrigin(req) {
      const site = header(req.headers, 'sec-fetch-site');
      if (site !== undefined) return site === 'same-origin';
      return header(req.headers, 'origin') === appOrigin;
    },
  };
}
