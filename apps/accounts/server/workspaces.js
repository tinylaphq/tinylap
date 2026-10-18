// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Workspaces, memberships and invites (spec §4, §5, §6). Every change a
// person makes is checked with can() from @tinylap/auth against their live
// memberships, the same matrix the apps check against the token claim.
// Outsiders get `not-found`: a club you are not in does not exist for you.
// All functions are synchronous on the one SQLite connection; multi-step
// changes run in a savepoint, so they also nest inside an open transaction.
import { createHash, randomBytes } from 'node:crypto';
import { can } from '@tinylap/auth';
import { recordDeletion } from './deletions.js';
import { revokeUserTokens } from './tokens.js';

/** Spec §4, quotas. */
export const CLUB_QUOTA = 5;
export const INVITE_QUOTA = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export class WorkspaceError extends Error {
  /**
   * @param {'forbidden' | 'not-found' | 'quota-exceeded' | 'invalid' | 'conflict'} code
   * @param {string} message meant for the person in front of the page
   */
  constructor(code, message) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

/** @typedef {import('node:sqlite').DatabaseSync} Db */
/** @typedef {'owner' | 'admin' | 'member'} Role */

const newId = () => randomBytes(12).toString('base64url');
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const now = () => new Date().toISOString();

/** Runs `fn` in a savepoint: all of it or none of it. */
function atomically(db, fn) {
  db.exec('SAVEPOINT workspaces');
  try {
    const result = fn();
    db.exec('RELEASE workspaces');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO workspaces');
    db.exec('RELEASE workspaces');
    throw error;
  }
}

/** A club name: trimmed, inner spaces collapsed, 1–60 characters, no control characters. */
function clubNameOf(value) {
  const name = typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  // eslint-disable-next-line no-control-regex
  if (name.length < 1 || [...name].length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new WorkspaceError('invalid', 'Choose a club name of 1 to 60 characters.');
  }
  return name;
}

/**
 * The personal workspace every user gets at sign-up (spec §4), with the
 * user as its owner and only member.
 * @param {Db} db @param {string} userId @param {string} name
 * @returns {string} its id
 */
export function createPersonalWorkspace(db, userId, name) {
  const id = newId();
  atomically(db, () => {
    db.prepare("INSERT INTO workspace (id, kind, name, created_at) VALUES (?, 'personal', ?, ?)").run(id, name, now());
    db.prepare("INSERT INTO membership (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(id, userId);
  });
  return id;
}

/**
 * The user's workspaces: the personal one first, then clubs by name.
 * @param {Db} db @param {string} userId
 * @returns {{ id: string, kind: 'personal' | 'club', name: string, role: Role }[]}
 */
export function listMemberships(db, userId) {
  return db.prepare(`
    SELECT w.id, w.kind, w.name, m.role FROM membership m JOIN workspace w ON w.id = m.workspace_id
    WHERE m.user_id = ? ORDER BY w.kind = 'club', w.name COLLATE NOCASE, w.id`).all(userId)
    .map((r) => ({ id: String(r.id), kind: /** @type {any} */ (r.kind), name: String(r.name), role: /** @type {Role} */ (r.role) }));
}

/** The user's live memberships in the shape can() reads. @param {Db} db @param {string} userId */
export function claimsOf(db, userId) {
  return { workspaces: listMemberships(db, userId).map(({ id, role }) => ({ id, role })) };
}

/**
 * Finds the workspace for `actor`: not-found unless they are a member,
 * forbidden unless their role may do `action`. `clubOnly` refuses a
 * personal workspace as invalid.
 * @param {Db} db @param {string} actor @param {string} workspaceId @param {import('@tinylap/auth').Action} action
 */
function authorize(db, actor, workspaceId, action, { clubOnly = true, forbidden = 'Your role in this club cannot do that.' } = {}) {
  const row = db.prepare(`SELECT w.id, w.kind, w.name, m.role FROM workspace w JOIN membership m ON m.workspace_id = w.id
    WHERE w.id = ? AND m.user_id = ?`).get(String(workspaceId), String(actor));
  if (!row) throw new WorkspaceError('not-found', 'There is no such club, or you are not a member.');
  if (clubOnly && row.kind !== 'club') throw new WorkspaceError('invalid', 'Your personal space has no other members, invites or settings.');
  if (!can(claimsOf(db, actor), String(row.id), action)) throw new WorkspaceError('forbidden', forbidden);
  return { id: String(row.id), kind: String(row.kind), name: String(row.name), role: /** @type {Role} */ (row.role) };
}

/** The role of `userId` in a workspace, or not-found. */
function memberRole(db, workspaceId, userId) {
  const row = db.prepare('SELECT role FROM membership WHERE workspace_id = ? AND user_id = ?').get(workspaceId, String(userId));
  if (!row) throw new WorkspaceError('not-found', 'That person is not a member of this club.');
  return /** @type {Role} */ (row.role);
}

/** How many clubs `userId` owns: the quota is at most 5 clubs owned per account. */
const ownedClubs = (db, userId) => Number(db.prepare("SELECT COUNT(*) AS n FROM membership m JOIN workspace w ON w.id = m.workspace_id WHERE m.user_id = ? AND m.role = 'owner' AND w.kind = 'club'").get(userId).n);

/**
 * A new club with `userId` as its owner. A user can own 5 clubs.
 * @param {Db} db @param {string} userId @param {unknown} name
 */
export function createClub(db, userId, name) {
  const clean = clubNameOf(name);
  return atomically(db, () => {
    if (ownedClubs(db, userId) >= CLUB_QUOTA) throw new WorkspaceError('quota-exceeded', `You can own at most ${CLUB_QUOTA} clubs.`);
    const id = newId();
    db.prepare("INSERT INTO workspace (id, kind, name, created_at) VALUES (?, 'club', ?, ?)").run(id, clean, now());
    db.prepare("INSERT INTO membership (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(id, userId);
    return { id, kind: 'club', name: clean, role: /** @type {Role} */ ('owner') };
  });
}

/**
 * A workspace as its member sees it, or not-found.
 * @param {Db} db @param {string} actor @param {string} workspaceId
 */
export function getWorkspace(db, actor, workspaceId) {
  return authorize(db, actor, workspaceId, 'track.read', { clubOnly: false });
}

/**
 * The members, owner first, then admins, then members, each by name.
 * @param {Db} db @param {string} actor @param {string} workspaceId
 */
export function listMembers(db, actor, workspaceId) {
  const { id } = authorize(db, actor, workspaceId, 'track.read', { clubOnly: false });
  return db.prepare(`SELECT u.id, u.name, m.role FROM membership m JOIN "user" u ON u.id = m.user_id WHERE m.workspace_id = ?
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name COLLATE NOCASE, u.id`).all(id)
    .map((r) => ({ id: String(r.id), name: String(r.name), role: /** @type {Role} */ (r.role) }));
}

/** What counts toward the invite quota and can still be redeemed. */
const ACTIVE = 'revoked_at IS NULL AND expires_at > ? AND NOT (single_use = 1 AND used_by IS NOT NULL)';

const inviteOf = (r) => ({
  id: String(r.id),
  role: String(r.role),
  singleUse: r.single_use === 1,
  expiresAt: String(r.expires_at),
  createdBy: r.created_by_name == null ? null : String(r.created_by_name),
});

/**
 * A new invite link (role member). The token is shown once: only its hash
 * is stored. `link` is the page's path, `/invite/<token>`.
 * @param {Db} db @param {string} actor @param {string} workspaceId
 * @param {{ singleUse?: unknown, ttlDays?: unknown }} [options]
 */
export function createInvite(db, actor, workspaceId, { singleUse = true, ttlDays = 7 } = {}) {
  const { id: wid } = authorize(db, actor, workspaceId, 'invite.manage', { forbidden: 'Only the owner and admins can invite people.' });
  if (typeof singleUse !== 'boolean') throw new WorkspaceError('invalid', 'singleUse must be true or false.');
  if (!Number.isInteger(ttlDays) || /** @type {number} */ (ttlDays) < 1 || /** @type {number} */ (ttlDays) > 30) {
    throw new WorkspaceError('invalid', 'An invite lasts 1 to 30 days.');
  }
  return atomically(db, () => {
    const active = Number(db.prepare(`SELECT COUNT(*) AS n FROM invite WHERE workspace_id = ? AND ${ACTIVE}`).get(wid, now()).n);
    if (active >= INVITE_QUOTA) throw new WorkspaceError('quota-exceeded', `A club can have at most ${INVITE_QUOTA} open invites. Revoke one first.`);
    const id = newId();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + /** @type {number} */ (ttlDays) * DAY_MS).toISOString();
    db.prepare("INSERT INTO invite (id, workspace_id, role, token_hash, expires_at, single_use, created_by) VALUES (?, ?, 'member', ?, ?, ?, ?)")
      .run(id, wid, hashToken(token), expiresAt, singleUse ? 1 : 0, actor);
    const name = db.prepare('SELECT name FROM "user" WHERE id = ?').get(actor)?.name ?? null;
    return { link: `/invite/${token}`, invite: inviteOf({ id, role: 'member', single_use: singleUse ? 1 : 0, expires_at: expiresAt, created_by_name: name }) };
  });
}

/**
 * The club's open invites (not revoked, expired or used up), newest first.
 * @param {Db} db @param {string} actor @param {string} workspaceId
 */
export function listInvites(db, actor, workspaceId) {
  const { id } = authorize(db, actor, workspaceId, 'invite.manage', { forbidden: 'Only the owner and admins can see invites.' });
  return db.prepare(`SELECT i.id, i.role, i.single_use, i.expires_at, u.name AS created_by_name FROM invite i LEFT JOIN "user" u ON u.id = i.created_by
    WHERE i.workspace_id = ? AND ${ACTIVE.replace(/(revoked_at|expires_at|single_use|used_by)/g, 'i.$1')} ORDER BY i.expires_at DESC, i.id`).all(id, now()).map(inviteOf);
}

/** @param {Db} db @param {string} actor @param {string} workspaceId @param {string} inviteId */
export function revokeInvite(db, actor, workspaceId, inviteId) {
  const { id } = authorize(db, actor, workspaceId, 'invite.manage', { forbidden: 'Only the owner and admins can revoke invites.' });
  const { changes } = db.prepare('UPDATE invite SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND workspace_id = ?').run(now(), String(inviteId), id);
  if (changes !== 1) throw new WorkspaceError('not-found', 'There is no such invite.');
}

/**
 * What an invite link leads to, for the invite page: the club's name and
 * whether it can still be used, without spending it.
 * @param {Db} db @param {unknown} token
 * @returns {{ workspace: { id: string, name: string }, problem: string | null, row: Record<string, any> } | null}
 */
export function inspectInvite(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = db.prepare(`SELECT i.*, w.name, w.kind FROM invite i JOIN workspace w ON w.id = i.workspace_id WHERE i.token_hash = ?`).get(hashToken(token));
  if (!row) return null;
  let problem = null;
  if (row.kind !== 'club') problem = 'This invite link is not valid.';
  else if (row.revoked_at) problem = 'This invite link was revoked.';
  else if (String(row.expires_at) <= now()) problem = 'This invite link has expired.';
  else if (row.single_use === 1 && row.used_by) problem = 'This invite link has already been used.';
  return { workspace: { id: String(row.workspace_id), name: String(row.name) }, problem, row };
}

/**
 * Joins `userId` to the invite's club as a member. Someone already in the
 * club keeps their role and spends nothing (`joined: false`). A single-use
 * invite is spent with one UPDATE … WHERE used_by IS NULL.
 * @param {Db} db @param {string} userId @param {unknown} token
 */
export function redeemInvite(db, userId, token) {
  return atomically(db, () => {
    const found = inspectInvite(db, token);
    if (!found) throw new WorkspaceError('invalid', 'This invite link is not valid. Ask the club for a new one.');
    const { workspace, problem, row } = /** @type {any} */ (found);
    const member = db.prepare('SELECT 1 FROM membership WHERE workspace_id = ? AND user_id = ?').get(workspace.id, userId);
    if (member && !problem) return { workspace, joined: false };
    if (problem) throw new WorkspaceError('invalid', `${problem} Ask the club for a new one.`);
    if (row.single_use === 1) {
      const { changes } = db.prepare('UPDATE invite SET used_by = ? WHERE id = ? AND used_by IS NULL AND revoked_at IS NULL').run(userId, row.id);
      if (changes !== 1) throw new WorkspaceError('invalid', 'This invite link has already been used. Ask the club for a new one.');
    } else {
      db.prepare('UPDATE invite SET used_by = ? WHERE id = ?').run(userId, row.id);
    }
    db.prepare("INSERT INTO membership (workspace_id, user_id, role) VALUES (?, ?, 'member')").run(workspace.id, userId);
    return { workspace, joined: true };
  });
}

/**
 * Removes a member (owner or admin) or an admin (owner only). The owner
 * cannot be removed; you leave rather than remove yourself. Nothing is
 * revoked: claims are read live at every issuance, so the removed user's
 * next token (at the latest after one access token lifetime) lacks the club.
 * @param {Db} db @param {string} actor @param {string} workspaceId @param {string} userId
 */
export function removeMember(db, actor, workspaceId, userId) {
  const { id } = authorize(db, actor, workspaceId, 'member.remove', { forbidden: 'Only the owner and admins can remove people.' });
  if (userId === actor) throw new WorkspaceError('invalid', 'To remove yourself, leave the club.');
  const role = memberRole(db, id, userId);
  if (role === 'owner') throw new WorkspaceError('forbidden', 'Nobody can remove the owner.');
  if (role === 'admin' && !can(claimsOf(db, actor), id, 'admin.manage')) throw new WorkspaceError('forbidden', 'Only the owner can remove an admin.');
  db.prepare('DELETE FROM membership WHERE workspace_id = ? AND user_id = ?').run(id, userId);
}

/**
 * Promotes a member to admin or demotes an admin to member (owner only).
 * @param {Db} db @param {string} actor @param {string} workspaceId @param {string} userId @param {unknown} role
 */
export function setRole(db, actor, workspaceId, userId, role) {
  const { id } = authorize(db, actor, workspaceId, 'admin.manage', { forbidden: 'Only the owner can change roles.' });
  if (role !== 'admin' && role !== 'member') throw new WorkspaceError('invalid', 'A role is "admin" or "member".');
  if (memberRole(db, id, userId) === 'owner') throw new WorkspaceError('invalid', 'To give up ownership, transfer it to another member.');
  db.prepare('UPDATE membership SET role = ? WHERE workspace_id = ? AND user_id = ?').run(role, id, userId);
}

/** The one-owner swap: the old owner becomes an admin, in one step. */
function swapOwner(db, workspaceId, from, to) {
  atomically(db, () => {
    // Demote first: the partial unique index allows one owner at a time.
    db.prepare("UPDATE membership SET role = 'admin' WHERE workspace_id = ? AND user_id = ? AND role = 'owner'").run(workspaceId, from);
    db.prepare("UPDATE membership SET role = 'owner' WHERE workspace_id = ? AND user_id = ?").run(workspaceId, to);
  });
}

/**
 * Hands the club to another member (owner only); the owner becomes an admin.
 * The recipient must own fewer than 5 clubs, or two accounts could pass
 * clubs back and forth past the quota.
 * @param {Db} db @param {string} actor @param {string} workspaceId @param {string} userId
 */
export function transferOwnership(db, actor, workspaceId, userId) {
  const { id } = authorize(db, actor, workspaceId, 'owner.transfer', { forbidden: 'Only the owner can transfer ownership.' });
  if (userId === actor) throw new WorkspaceError('invalid', 'You already own this club.');
  memberRole(db, id, userId);
  atomically(db, () => {
    if (ownedClubs(db, userId) >= CLUB_QUOTA) {
      throw new WorkspaceError('quota-exceeded', `That member already owns ${CLUB_QUOTA} clubs, the most an account can own.`);
    }
    swapOwner(db, id, actor, userId);
  });
}

/**
 * The maintainer's transfer (admin.js), for a club whose owner cannot act.
 * No actor: the request was verified out of band. Exempt from the club
 * quota, so a stranded club can always be handed on.
 * @param {Db} db @param {string} workspaceId @param {string} userId
 * @returns {{ workspace: { id: string, name: string }, from: { id: string, name: string } | null, to: { id: string, name: string }, changed: boolean }}
 */
export function forceTransferOwnership(db, workspaceId, userId) {
  const workspace = db.prepare('SELECT id, kind, name FROM workspace WHERE id = ?').get(workspaceId);
  if (!workspace) throw new WorkspaceError('not-found', `There is no workspace ${workspaceId}.`);
  const target = db.prepare('SELECT u.id, u.name, m.role FROM membership m JOIN "user" u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.user_id = ?').get(workspaceId, userId);
  if (!target) throw new WorkspaceError('not-found', `User ${userId} is not a member of ${workspace.name} (${workspaceId}).`);
  if (workspace.kind !== 'club') throw new WorkspaceError('invalid', 'A personal workspace cannot change hands.');
  const owner = db.prepare("SELECT u.id, u.name FROM membership m JOIN \"user\" u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role = 'owner'").get(workspaceId);
  const ref = (r) => ({ id: String(r.id), name: String(r.name) });
  const changed = target.role !== 'owner';
  if (changed) swapOwner(db, workspaceId, owner ? String(owner.id) : '', userId);
  return { workspace: ref(workspace), from: owner && changed ? ref(owner) : null, to: ref(target), changed };
}

/**
 * Leaves a club (admins and members; the owner transfers first). The club
 * keeps its tracks (spec §6).
 * @param {Db} db @param {string} actor @param {string} workspaceId
 */
export function leaveClub(db, actor, workspaceId) {
  const { id } = authorize(db, actor, workspaceId, 'club.leave', { forbidden: 'The owner cannot leave. Transfer ownership to another member first.' });
  db.prepare('DELETE FROM membership WHERE workspace_id = ? AND user_id = ?').run(id, actor);
}

/** @param {Db} db @param {string} actor @param {string} workspaceId @param {unknown} name */
export function renameClub(db, actor, workspaceId, name) {
  const { id, role } = authorize(db, actor, workspaceId, 'club.manage', { forbidden: 'Only the owner can rename the club.' });
  const clean = clubNameOf(name);
  db.prepare('UPDATE workspace SET name = ? WHERE id = ?').run(clean, id);
  return { id, kind: 'club', name: clean, role };
}

/**
 * Deletes a club with its memberships and invites (owner only), and
 * records it in the deletions feed.
 * @param {Db} db @param {string} actor @param {string} workspaceId
 */
export function deleteClub(db, actor, workspaceId) {
  const { id } = authorize(db, actor, workspaceId, 'club.manage', { forbidden: 'Only the owner can delete the club.' });
  atomically(db, () => {
    db.prepare('DELETE FROM workspace WHERE id = ?').run(id);
    recordDeletion(db, 'workspace', id);
  });
}

/**
 * Deletes an account (spec §7): refused with `conflict` while the user owns
 * a club. Otherwise their personal workspace, then the user, whose
 * passkeys, recovery codes, sessions, memberships and OAuth tokens go with
 * them (foreign keys cascade), each recorded in the deletions feed.
 * @param {Db} db
 * @param {unknown} _auth the Better Auth instance; Better Auth's rows go by cascade, in the same transaction
 * @param {string} userId
 */
export async function deleteUser(db, _auth, userId) {
  const owned = db.prepare(`SELECT w.name FROM membership m JOIN workspace w ON w.id = m.workspace_id
    WHERE m.user_id = ? AND m.role = 'owner' AND w.kind = 'club' ORDER BY w.name COLLATE NOCASE`).all(userId).map((r) => String(r.name));
  if (owned.length) {
    throw new WorkspaceError('conflict', `You own ${owned.map((n) => `"${n}"`).join(', ')}. Transfer ownership or delete ${owned.length === 1 ? 'that club' : 'those clubs'} first.`);
  }
  atomically(db, () => {
    const personal = db.prepare("SELECT w.id FROM membership m JOIN workspace w ON w.id = m.workspace_id WHERE m.user_id = ? AND w.kind = 'personal'").all(userId);
    for (const { id } of personal) {
      db.prepare('DELETE FROM workspace WHERE id = ?').run(id);
      recordDeletion(db, 'workspace', String(id));
    }
    revokeUserTokens(db, userId);
    if (db.prepare('DELETE FROM "user" WHERE id = ?').run(userId).changes !== 1) throw new WorkspaceError('not-found', 'There is no such user.');
    recordDeletion(db, 'user', userId);
  });
}
