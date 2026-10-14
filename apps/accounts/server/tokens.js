// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Revoking a user's OAuth tokens for every client (spec §3, §6). In
// @better-auth/oauth-provider 1.7.7 refresh tokens are rows of
// `oauthRefreshToken` (one per issued token, rotated ones kept with
// `revoked` set) and opaque access tokens rows of `oauthAccessToken`, both
// keyed by `userId`. The refresh grant looks the token up by its hash and
// answers `invalid_grant` ("session not found") when there is no row, so
// deleting the rows revokes them; that is also what the provider itself does
// to a token family on replay (invalidateRefreshFamily). JWT access tokens
// are not stored: they run out on their own within 10 minutes.
// Consents (`oauthConsent`) are kept: they are not tokens, and trusted
// clients never ask for one.

/**
 * Deletes every refresh token and stored access token of `userId`, for
 * every client. Plain SQL on the same connection Better Auth uses, so it
 * joins any open transaction.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} userId
 * @returns {{ refreshTokens: number, accessTokens: number }}
 */
export function revokeUserTokens(db, userId) {
  const accessTokens = Number(db.prepare('DELETE FROM "oauthAccessToken" WHERE "userId" = ?').run(userId).changes);
  const refreshTokens = Number(db.prepare('DELETE FROM "oauthRefreshToken" WHERE "userId" = ?').run(userId).changes);
  return { refreshTokens, accessTokens };
}
