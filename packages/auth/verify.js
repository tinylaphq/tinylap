// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Checks an access token the way any OAuth resource server would: the
// issuer's published keys, RS256 only, the expected issuer and audience,
// and `typ: at+jwt` (RFC 9068), so an ID token never passes as one.
// Nothing here knows which provider issued it.
import { createRemoteJWKSet, jwtVerify } from 'jose';

export class AuthError extends Error {
  /** @param {string} code @param {string} message @param {any} options */
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
}

class KeysUnavailable extends Error {
  /** @param {any} cause */
  constructor(cause) {
    super('Keys unavailable', { cause });
    this.name = 'KeysUnavailable';
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
 * Wraps a key getter to distinguish token errors from outage errors.
 * @param {import('jose').JWTVerifyGetKey} getter
 * @returns {import('jose').JWTVerifyGetKey}
 */
function wrapKeyGetter(getter) {
  return async (protectedHeader, token) => {
    try {
      return await getter(protectedHeader, token);
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'JWKSNoMatchingKey' || name === 'JWKSMultipleMatchingKeys') {
        throw err;
      }
      throw new KeysUnavailable(err);
    }
  };
}

/**
 * @param {string} token
 * @param {{ issuer: string, audience: string, jwks?: import('jose').JWTVerifyGetKey, clockTolerance?: number }} opts
 * @returns {Promise<import('./types.js').AccessClaims>}
 */
export async function verifyAccessToken(token, opts) {
  const { issuer, audience, jwks, clockTolerance = 5 } = opts;
  try {
    const { payload } = await jwtVerify(token, wrapKeyGetter(jwks ?? remoteJwks(issuer)), {
      issuer, audience, algorithms: ['RS256'], typ: 'at+jwt', clockTolerance, requiredClaims: ['exp', 'sub'],
    });
    const workspaces = Array.isArray(payload.workspaces)
      ? payload.workspaces.filter(
          (w) => typeof w === 'object' && w !== null && typeof w.id === 'string' && typeof w.role === 'string'
        )
      : [];
    return /** @type {any} */ ({ ...payload, workspaces });
  } catch (cause) {
    const code = cause instanceof KeysUnavailable ? 'unavailable' : 'invalid_token';
    const message = code === 'unavailable' ? 'The authorization server is unavailable.' : 'The access token is not valid.';
    throw new AuthError(code, message, { cause });
  }
}
