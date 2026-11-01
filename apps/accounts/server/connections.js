// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Apps a member connected (timing MCP spec §4.5): MCP clients that sign in
// with a Client ID Metadata Document and that the member allowed on the
// consent page. First-party clients (seeded, no discovery id) never appear.
// Plain SQL on Better Auth's tables, as account.js does.

/** @typedef {import('node:sqlite').DatabaseSync} Db */

/** Better Auth's dates are ISO text or epoch numbers; anything else is normalised. */
const iso = (value) => new Date(/** @type {any} */ (value)).toISOString();

/** The host of a client id URL, the only part of a client accounts has verified. */
export function clientHost(clientId) {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
}

/** A client's name as shown: plain text, at most 60 characters, its host when it has none. */
export function clientName(name, clientId) {
  const text = typeof name === 'string' ? name.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, '');
  if (!clean) return clientHost(clientId);
  const chars = [...clean];
  return chars.length > 60 ? `${chars.slice(0, 59).join('')}…` : clean;
}

/**
 * The member's connected apps, newest consent first. `lastUsedAt` is when
 * the newest refresh token was issued (each refresh issues one), or null.
 * @param {Db} db @param {string} userId
 * @returns {{ clientId: string, name: string, host: string, allowedAt: string, lastUsedAt: string | null }[]}
 */
export function listConnections(db, userId) {
  return db.prepare(`SELECT c.clientId AS clientId, c.name AS name, MIN(k.createdAt) AS allowedAt,
      (SELECT MAX(r.createdAt) FROM oauthRefreshToken r WHERE r.clientId = c.clientId AND r.userId = k.userId) AS lastUsedAt
    FROM oauthConsent k JOIN oauthClient c ON c.clientId = k.clientId
    WHERE k.userId = ? AND c.clientDiscoveryId IS NOT NULL
    GROUP BY c.clientId ORDER BY allowedAt DESC, c.clientId`).all(userId)
    .map((r) => ({
      clientId: String(r.clientId),
      name: clientName(r.name, String(r.clientId)),
      host: clientHost(String(r.clientId)),
      allowedAt: iso(r.allowedAt),
      lastUsedAt: r.lastUsedAt === null ? null : iso(r.lastUsedAt),
    }));
}

/**
 * Disconnects one app: its consent and every token it holds for the member
 * go. Its access tokens are JWTs that can't be recalled; the notice the
 * caller sends makes timing refuse them (spec §4.2). True if it was connected.
 * @param {Db} db @param {string} userId @param {string} clientId
 */
export function disconnect(db, userId, clientId) {
  const client = db.prepare('SELECT 1 FROM oauthClient WHERE clientId = ? AND clientDiscoveryId IS NOT NULL').get(clientId);
  if (!client) return false;
  db.exec('BEGIN');
  try {
    const removed = db.prepare('DELETE FROM oauthConsent WHERE clientId = ? AND userId = ?').run(clientId, userId).changes;
    db.prepare('DELETE FROM oauthAccessToken WHERE clientId = ? AND userId = ?').run(clientId, userId);
    db.prepare('DELETE FROM oauthRefreshToken WHERE clientId = ? AND userId = ?').run(clientId, userId);
    db.exec('COMMIT');
    return removed > 0;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
