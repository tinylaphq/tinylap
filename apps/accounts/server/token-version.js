// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A member's token version (timing MCP spec §4.2): every access token carries
// it as `tv`, and every membership notice raises it first and names the new
// value. An app that knows a member's version refuses their tokens with an
// older one, so a token issued just before the change is cut off at once,
// whatever the two servers' clocks say.

/** @typedef {import('node:sqlite').DatabaseSync} Db */

/** The member's current token version; 0 until their first notice. @param {Db} db @param {string} userId */
export function tokenVersion(db, userId) {
  const row = db.prepare('SELECT version FROM token_version WHERE user_id = ?').get(userId);
  return row ? Number(row.version) : 0;
}

/**
 * Raises each member's version by one: their next tokens carry the new one.
 * @param {Db} db @param {string[]} userIds @returns {Record<string, number>} the new versions
 */
export function bumpTokenVersions(db, userIds) {
  const bump = db.prepare(`INSERT INTO token_version (user_id, version) SELECT id, 1 FROM "user" WHERE id = ?
    ON CONFLICT (user_id) DO UPDATE SET version = version + 1 RETURNING version`);
  /** @type {Record<string, number>} */
  const versions = {};
  for (const id of new Set(userIds)) {
    const row = bump.get(id);
    if (row) versions[id] = Number(row.version);
  }
  return versions;
}
