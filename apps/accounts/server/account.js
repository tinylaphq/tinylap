// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The signed-in user's own account (spec §6, §12): their passkeys, how many
// recovery codes are left, and the export. Plain SQL on Better Auth's
// connection; errors are WorkspaceErrors, so the API maps them as usual.
import { listMemberships, WorkspaceError } from './workspaces.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

/** Better Auth's dates are ISO text; anything else is normalised. */
const iso = (value) => new Date(/** @type {any} */ (value)).toISOString();

/**
 * The user's passkeys, oldest first, without key material.
 * @param {Db} db @param {string} userId
 * @returns {{ id: string, name: string | null, createdAt: string, synced: boolean }[]}
 */
export function listPasskeys(db, userId) {
  return db.prepare('SELECT id, name, createdAt, backedUp FROM passkey WHERE userId = ? ORDER BY createdAt, id').all(userId)
    .map((r) => ({ id: String(r.id), name: r.name === null ? null : String(r.name), createdAt: iso(r.createdAt), synced: Boolean(r.backedUp) }));
}

/**
 * Removes one of the user's passkeys, never the last: one statement, so
 * two removals at once cannot leave none.
 * @param {Db} db @param {string} userId @param {string} passkeyId
 */
export function removePasskey(db, userId, passkeyId) {
  const removed = db.prepare(`DELETE FROM passkey WHERE id = ? AND userId = ?
    AND (SELECT COUNT(*) FROM passkey WHERE userId = ?) > 1`).run(passkeyId, userId, userId).changes;
  if (removed === 1) return;
  if (!db.prepare('SELECT 1 FROM passkey WHERE id = ? AND userId = ?').get(passkeyId, userId)) throw new WorkspaceError('not-found', 'You have no such passkey.');
  throw new WorkspaceError('conflict', 'This is your only passkey. Add another one before you remove it.');
}

/** @param {Db} db @param {string} userId */
export const recoveryCodesLeft = (db, userId) =>
  Number(db.prepare('SELECT COUNT(*) AS c FROM recovery_code WHERE user_id = ? AND used_at IS NULL').get(userId)?.c ?? 0);

/** The names of the clubs the user owns, which block deleting the account (spec §7). */
export const ownedClubs = (db, userId) => listMemberships(db, userId).filter((w) => w.kind === 'club' && w.role === 'owner').map((w) => w.name);

/**
 * Everything accounts holds about the user (spec §6), as JSON: no key
 * material, no hashes, no placeholder email. Tracks are in the planner,
 * which has its own export.
 * @param {Db} db @param {string} userId
 */
export function exportAccount(db, userId) {
  const user = db.prepare('SELECT id, name, createdAt FROM "user" WHERE id = ?').get(userId);
  if (!user) throw new WorkspaceError('not-found', 'There is no such user.');
  const invites = db.prepare(`SELECT i.id, i.role, i.expires_at, i.single_use, i.used_by, i.revoked_at, w.id AS workspace_id, w.name AS workspace_name
    FROM invite i JOIN workspace w ON w.id = i.workspace_id WHERE i.created_by = ? ORDER BY i.expires_at, i.id`).all(userId);
  return {
    exportedAt: new Date().toISOString(),
    user: { id: String(user.id), displayName: String(user.name), createdAt: iso(user.createdAt) },
    passkeys: listPasskeys(db, userId).map(({ name, createdAt }) => ({ name, createdAt })),
    recoveryCodesLeft: recoveryCodesLeft(db, userId),
    memberships: listMemberships(db, userId).map(({ id, kind, name, role }) => ({ id, kind, name, role })),
    invitesCreated: invites.map((i) => ({
      id: String(i.id),
      workspace: { id: String(i.workspace_id), name: String(i.workspace_name) },
      role: String(i.role),
      singleUse: Boolean(i.single_use),
      expiresAt: String(i.expires_at),
      used: i.used_by !== null,
      revokedAt: i.revoked_at === null ? null : String(i.revoked_at),
    })),
  };
}
