// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Checks an access token the way any OAuth resource server would: the
// issuer's published keys, RS256 only, the expected issuer and audience.
// Nothing here knows which provider issued it.
import { createRemoteJWKSet, jwtVerify } from 'jose';

export class AuthError extends Error {
  /** @param {string} code @param {string} message @param {any} options */
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
}

/** @type {Map<string, ReturnType<typeof createRemoteJWKSet>>} */
const remote = new Map();

/** @param {string} issuer */
function remoteJwks(issuer) {
  let set = remote.get(issuer);
  if (!set) remote.set(issuer, (set = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, '')}/jwks`))));
  return set;
}

/**
 * @param {string} token
 * @param {{ issuer: string, audience: string, jwks?: import('jose').JWTVerifyGetKey, clockTolerance?: number }} opts
 * @returns {Promise<import('./types.js').AccessClaims>}
 */
export async function verifyAccessToken(token, opts) {
  const { issuer, audience, jwks, clockTolerance = 5 } = opts;
  try {
    const { payload } = await jwtVerify(token, jwks ?? remoteJwks(issuer), {
      issuer, audience, algorithms: ['RS256'], clockTolerance, requiredClaims: ['exp', 'sub'],
    });
    const workspaces = Array.isArray(payload.workspaces)
      ? payload.workspaces.filter(
          (w) => typeof w === 'object' && w !== null && typeof w.id === 'string' && typeof w.role === 'string'
        )
      : [];
    return /** @type {any} */ ({ ...payload, workspaces });
  } catch (cause) {
    const code = isJwksError(cause) ? 'unavailable' : 'invalid_token';
    const message = code === 'unavailable' ? 'The authorization server is unavailable.' : 'The access token is not valid.';
    throw new AuthError(code, message, { cause });
  }
}

/** @param {any} err */
function isJwksError(err) {
  if (!err) return false;
  const code = err.code ?? err.name ?? '';
  const msg = err.message ?? '';
  return (
    code === 'ERR_JWKS_TIMEOUT'
    || code === 'ERR_JWKS_MULTIPLE_MATCHING_KEYS'
    || msg.includes('getaddrinfo')
    || msg.includes('ECONNREFUSED')
    || msg.includes('ENOTFOUND')
    || msg.includes('fetch')
  );
}
