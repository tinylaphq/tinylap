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
      issuer, audience, algorithms: ['RS256'], clockTolerance,
    });
    const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
    return /** @type {any} */ ({ ...payload, workspaces });
  } catch (cause) {
    throw new AuthError('invalid_token', 'The access token is not valid.', { cause });
  }
}
