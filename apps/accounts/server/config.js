// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Reads the service's configuration from the environment and refuses
// anything unsafe before a socket is opened:
//   TINYLAP_ISSUER      the public origin, which is the OIDC issuer
//   TINYLAP_DEV=1       local development and tests: http issuer, loopback
//                       redirect URIs, an in-memory database by default
//   TINYLAP_DB          SQLite path (default /data/accounts.sqlite)
//   BETTER_AUTH_SECRET  at least 32 characters
//   TINYLAP_CLIENTS     JSON: [{ clientId, clientSecret, redirectUris,
//                       postLogoutRedirectUris, resource, noticeUri?,
//                       noticeToken? }], all trusted. A client that wants
//                       membership notices sets both noticeUri and noticeToken.
//   TINYLAP_FEED_TOKENS comma-separated bearer tokens for /deletions
//   TINYLAP_ACCESS_TTL  access token seconds, dev mode only (tests)
//   TINYLAP_CLIENT_IP_HEADER  the header a trusted proxy puts the client's
//                       address in (Fly-Client-IP on Fly), for rate limits
//   PORT                default 4100

/**
 * @typedef {{ clientId: string, clientSecret: string, redirectUris: string[],
 *   postLogoutRedirectUris: string[], resource: string, noticeUri?: string, noticeToken?: string,
 *   trusted: true }} ClientConfig
 * @typedef {{ issuer: string, dev: boolean, dbPath: string, secret: string, port: number,
 *   clients: ClientConfig[], feedTokens: string[], accessTtlSeconds: number,
 *   clientIpHeader: string | null }} Config
 */

const isLoopback = (hostname) =>
  hostname === 'localhost' || hostname.endsWith('.localhost') || /^127\./.test(hostname) || hostname === '[::1]';

function parseUrl(text, what) {
  try {
    return new URL(text);
  } catch {
    throw new Error(`${what} must be an absolute URL; got "${text}".`);
  }
}

/** A redirect target: https and not loopback, unless in dev mode. */
function checkRedirect(text, what, dev) {
  const url = parseUrl(text, what);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${what} must be http(s); got "${text}".`);
  if (url.hash) throw new Error(`${what} must not have a fragment; got "${text}".`);
  if (dev) return;
  if (isLoopback(url.hostname)) throw new Error(`${what} "${text}" is a loopback address, which is allowed only with TINYLAP_DEV=1.`);
  if (url.protocol !== 'https:') throw new Error(`${what} "${text}" must use https outside TINYLAP_DEV=1.`);
}

const stringList = (value) => Array.isArray(value) && value.every((v) => typeof v === 'string' && v !== '');

function readClients(text, dev) {
  let raw;
  try {
    raw = JSON.parse(text ?? '[]');
  } catch (error) {
    throw new Error(`TINYLAP_CLIENTS must be a JSON array of clients: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(raw)) throw new Error('TINYLAP_CLIENTS must be a JSON array of clients.');
  const ids = new Set();
  return raw.map((c, i) => {
    const where = `TINYLAP_CLIENTS[${i}]`;
    if (!c || typeof c !== 'object') throw new Error(`${where} must be an object.`);
    for (const key of ['clientId', 'clientSecret', 'resource']) {
      if (typeof c[key] !== 'string' || c[key] === '') throw new Error(`${where}.${key} must be a non-empty string.`);
    }
    if (ids.has(c.clientId)) throw new Error(`${where}.clientId "${c.clientId}" appears twice.`);
    ids.add(c.clientId);
    if (!stringList(c.redirectUris) || c.redirectUris.length === 0) throw new Error(`${where}.redirectUris must be a non-empty array of URLs.`);
    const postLogout = c.postLogoutRedirectUris ?? [];
    if (!stringList(postLogout)) throw new Error(`${where}.postLogoutRedirectUris must be an array of URLs.`);
    for (const uri of c.redirectUris) checkRedirect(uri, `${where}.redirectUris`, dev);
    for (const uri of postLogout) checkRedirect(uri, `${where}.postLogoutRedirectUris`, dev);
    checkRedirect(c.resource, `${where}.resource`, dev);
    // The membership notice: where to POST it and the bearer to send, both or neither.
    if ((c.noticeUri === undefined) !== (c.noticeToken === undefined)) throw new Error(`${where}.noticeUri and ${where}.noticeToken must be set together.`);
    if (c.noticeUri !== undefined) {
      if (typeof c.noticeUri !== 'string' || c.noticeUri === '') throw new Error(`${where}.noticeUri must be a URL.`);
      if (typeof c.noticeToken !== 'string' || c.noticeToken === '') throw new Error(`${where}.noticeToken must be a non-empty string.`);
      if (c.noticeToken === c.clientSecret) throw new Error(`${where}.noticeToken must not be the client secret.`);
      checkRedirect(c.noticeUri, `${where}.noticeUri`, dev);
    }
    return {
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      redirectUris: [...c.redirectUris],
      postLogoutRedirectUris: [...postLogout],
      resource: c.resource,
      ...(c.noticeUri === undefined ? {} : { noticeUri: c.noticeUri, noticeToken: c.noticeToken }),
      trusted: /** @type {const} */ (true),
    };
  });
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Config}
 */
export function readConfig(env) {
  const dev = env.TINYLAP_DEV === '1';

  if (!env.TINYLAP_ISSUER) throw new Error('TINYLAP_ISSUER is required: the public origin of this service.');
  const issuerUrl = parseUrl(env.TINYLAP_ISSUER, 'TINYLAP_ISSUER');
  if (issuerUrl.pathname !== '/' || issuerUrl.search || issuerUrl.hash) throw new Error(`TINYLAP_ISSUER must be an origin without a path; got "${env.TINYLAP_ISSUER}".`);
  if (dev && issuerUrl.protocol === 'https:') throw new Error('TINYLAP_DEV=1 is for local development over http; refusing to start with an https issuer.');
  if (!dev && issuerUrl.protocol !== 'https:') throw new Error('TINYLAP_ISSUER must use https outside TINYLAP_DEV=1.');

  const secret = env.BETTER_AUTH_SECRET ?? '';
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be set to at least 32 characters.');

  const portText = env.PORT ?? '4100';
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be a port number; got "${portText}".`);

  let accessTtlSeconds = 600;
  if (env.TINYLAP_ACCESS_TTL !== undefined && env.TINYLAP_ACCESS_TTL !== '') {
    if (!dev) throw new Error('TINYLAP_ACCESS_TTL is for tests and needs TINYLAP_DEV=1.');
    accessTtlSeconds = Number(env.TINYLAP_ACCESS_TTL);
    if (!Number.isInteger(accessTtlSeconds) || accessTtlSeconds < 1) throw new Error(`TINYLAP_ACCESS_TTL must be a whole number of seconds; got "${env.TINYLAP_ACCESS_TTL}".`);
  }

  return {
    issuer: issuerUrl.origin,
    dev,
    dbPath: env.TINYLAP_DB || (dev ? ':memory:' : '/data/accounts.sqlite'),
    secret,
    port,
    clients: readClients(env.TINYLAP_CLIENTS, dev),
    feedTokens: (env.TINYLAP_FEED_TOKENS ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    accessTtlSeconds,
    clientIpHeader: env.TINYLAP_CLIENT_IP_HEADER?.trim().toLowerCase() || null,
  };
}
