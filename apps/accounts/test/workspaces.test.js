// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Workspaces, memberships and invites through the functions (spec §4, §5):
// every row of the permission matrix as owner, admin and member, the
// one-owner rule, invites and quotas.
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '@tinylap/auth';
import {
  WorkspaceError,
  claimsOf,
  createClub,
  createInvite,
  createPersonalWorkspace,
  deleteClub,
  leaveClub,
  listInvites,
  listMembers,
  listMemberships,
  redeemInvite,
  removeMember,
  renameClub,
  revokeInvite,
  setRole,
  transferOwnership,
} from '../server/workspaces.js';
import { createTestUser, startAccounts } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
before(async () => {
  accounts = await startAccounts();
});
after(() => accounts.close());

let n = 0;
const user = async (name = `User ${(n += 1)}`) => (await createTestUser(accounts.auth, name)).id;

/** Joins `userId` to the club through a fresh invite made by its owner. */
function join(clubId, ownerId, userId) {
  const { link } = createInvite(accounts.db, ownerId, clubId, { singleUse: true });
  redeemInvite(accounts.db, userId, link.split('/').pop());
}

/** A club with an owner, an admin, a member and a spare member to act on. */
async function club() {
  const [owner, admin, member, spare, spareAdmin] = [await user(), await user(), await user(), await user(), await user()];
  const { id } = createClub(accounts.db, owner, `Club ${(n += 1)}`);
  for (const u of [admin, member, spare, spareAdmin]) join(id, owner, u);
  setRole(accounts.db, owner, id, admin, 'admin');
  setRole(accounts.db, owner, id, spareAdmin, 'admin');
  return { id, owner, admin, member, spare, spareAdmin };
}

const roleOf = (workspaceId, userId) =>
  accounts.db.prepare('SELECT role FROM membership WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId)?.role ?? null;

/** @param {() => unknown} fn @param {string} code @param {RegExp} [detail] */
function throwsCode(fn, code, detail) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof WorkspaceError, `a WorkspaceError, got ${error}`);
    assert.equal(error.code, code);
    if (detail) assert.match(error.message, detail);
    return true;
  });
}

// Each club-level action of §5, done by `actor` in a fresh club `c`.
const ACTS = {
  'create an invite': (c, actor) => createInvite(accounts.db, actor, c.id, { singleUse: true }),
  'list invites': (c, actor) => listInvites(accounts.db, actor, c.id),
  'revoke an invite': (c, actor) => {
    const { invite } = createInvite(accounts.db, c.owner, c.id, { singleUse: true });
    revokeInvite(accounts.db, actor, c.id, invite.id);
  },
  'remove a member': (c, actor) => removeMember(accounts.db, actor, c.id, c.spare),
  'promote a member to admin': (c, actor) => setRole(accounts.db, actor, c.id, c.spare, 'admin'),
  'demote an admin': (c, actor) => setRole(accounts.db, actor, c.id, c.spareAdmin, 'member'),
  'remove an admin': (c, actor) => removeMember(accounts.db, actor, c.id, c.spareAdmin),
  'transfer ownership': (c, actor) => transferOwnership(accounts.db, actor, c.id, c.spare),
  'rename the club': (c, actor) => renameClub(accounts.db, actor, c.id, 'Renamed'),
  'delete the club': (c, actor) => deleteClub(accounts.db, actor, c.id),
  'leave the club': (c, actor) => leaveClub(accounts.db, actor, c.id),
};

const MATRIX = {
  'create an invite': ['owner', 'admin'],
  'list invites': ['owner', 'admin'],
  'revoke an invite': ['owner', 'admin'],
  'remove a member': ['owner', 'admin'],
  'promote a member to admin': ['owner'],
  'demote an admin': ['owner'],
  'remove an admin': ['owner'],
  'transfer ownership': ['owner'],
  'rename the club': ['owner'],
  'delete the club': ['owner'],
  'leave the club': ['admin', 'member'],
};

describe('the §5 matrix', () => {
  for (const [action, allowed] of Object.entries(MATRIX)) {
    for (const role of ['owner', 'admin', 'member']) {
      const ok = allowed.includes(role);
      test(`${role}: ${action} ${ok ? 'succeeds' : 'is forbidden'}`, async () => {
        const c = await club();
        const actor = c[role];
        if (ok) ACTS[action](c, actor);
        else throwsCode(() => ACTS[action](c, actor), 'forbidden');
      });
    }
  }

  test('the track rows hold for every role through claimsOf and can()', async () => {
    const c = await club();
    for (const role of ['owner', 'admin', 'member']) {
      const claims = claimsOf(accounts.db, c[role]);
      for (const action of /** @type {const} */ (['track.read', 'track.save', 'track.share', 'track.copy'])) assert.equal(can(claims, c.id, action), true, `${role} ${action}`);
      assert.equal(can(claims, c.id, 'track.delete'), role !== 'member', `${role} track.delete`);
    }
  });

  test('outsiders get not-found, whatever they try', async () => {
    const c = await club();
    const stranger = await user();
    for (const act of Object.values(ACTS)) throwsCode(() => act(c, stranger), 'not-found');
    throwsCode(() => listMembers(accounts.db, stranger, c.id), 'not-found');
  });

  test('an admin cannot remove or demote the owner', async () => {
    const c = await club();
    throwsCode(() => removeMember(accounts.db, c.admin, c.id, c.owner), 'forbidden');
    throwsCode(() => setRole(accounts.db, c.admin, c.id, c.owner, 'member'), 'forbidden');
    throwsCode(() => setRole(accounts.db, c.owner, c.id, c.owner, 'admin'), 'invalid', /transfer/i);
  });
});

describe('one owner', () => {
  test('transferring ownership makes the old owner an admin', async () => {
    const c = await club();
    transferOwnership(accounts.db, c.owner, c.id, c.member);
    assert.equal(roleOf(c.id, c.member), 'owner');
    assert.equal(roleOf(c.id, c.owner), 'admin');
    const owners = accounts.db.prepare("SELECT COUNT(*) AS n FROM membership WHERE workspace_id = ? AND role = 'owner'").get(c.id).n;
    assert.equal(owners, 1);
  });

  test('ownership goes only to a member, not to yourself', async () => {
    const c = await club();
    throwsCode(() => transferOwnership(accounts.db, c.owner, c.id, 'nobody'), 'not-found');
    throwsCode(() => transferOwnership(accounts.db, c.owner, c.id, c.owner), 'invalid');
  });

  test('the owner cannot leave without transferring first', async () => {
    const c = await club();
    throwsCode(() => leaveClub(accounts.db, c.owner, c.id), 'forbidden', /transfer/i);
    transferOwnership(accounts.db, c.owner, c.id, c.admin);
    leaveClub(accounts.db, c.owner, c.id);
    assert.equal(roleOf(c.id, c.owner), null);
  });

  test('deleting a club is owner-only and removes its memberships and invites', async () => {
    const c = await club();
    throwsCode(() => deleteClub(accounts.db, c.admin, c.id), 'forbidden');
    createInvite(accounts.db, c.owner, c.id, { singleUse: false });
    deleteClub(accounts.db, c.owner, c.id);
    assert.equal(accounts.db.prepare('SELECT COUNT(*) AS n FROM membership WHERE workspace_id = ?').get(c.id).n, 0);
    assert.equal(accounts.db.prepare('SELECT COUNT(*) AS n FROM invite WHERE workspace_id = ?').get(c.id).n, 0);
    assert.deepEqual(listMemberships(accounts.db, c.member), []);
  });

  test('a removed member loses the club; the removal is recorded nowhere else', async () => {
    const c = await club();
    removeMember(accounts.db, c.admin, c.id, c.member);
    assert.equal(roleOf(c.id, c.member), null);
    throwsCode(() => removeMember(accounts.db, c.admin, c.id, c.member), 'not-found');
    throwsCode(() => removeMember(accounts.db, c.admin, c.id, c.admin), 'invalid', /leave/i);
  });
});

describe('memberships', () => {
  test('listMemberships names the personal workspace first, then the clubs', async () => {
    const u = await user('Lewis');
    const personal = createPersonalWorkspace(accounts.db, u, 'Lewis');
    const b = createClub(accounts.db, u, 'Beta Racing');
    const a = createClub(accounts.db, u, 'Alpha Racing');
    assert.deepEqual(listMemberships(accounts.db, u), [
      { id: personal, kind: 'personal', name: 'Lewis', role: 'owner' },
      { id: a.id, kind: 'club', name: 'Alpha Racing', role: 'owner' },
      { id: b.id, kind: 'club', name: 'Beta Racing', role: 'owner' },
    ]);
    assert.deepEqual(claimsOf(accounts.db, u).workspaces.map((w) => w.role), ['owner', 'owner', 'owner']);
  });

  test('club names are trimmed, 1 to 60 characters, no control characters', async () => {
    const u = await user();
    assert.equal(createClub(accounts.db, u, '  Slot   Cars  ').name, 'Slot Cars');
    throwsCode(() => createClub(accounts.db, u, '   '), 'invalid');
    throwsCode(() => createClub(accounts.db, u, 'x'.repeat(61)), 'invalid');
    throwsCode(() => createClub(accounts.db, u, 'a\u0007b'), 'invalid');
    throwsCode(() => createClub(accounts.db, u, 42), 'invalid');
  });

  test('listMembers gives names and roles to every member', async () => {
    const c = await club();
    const members = listMembers(accounts.db, c.member, c.id);
    assert.equal(members.length, 5);
    assert.deepEqual(members[0], { id: c.owner, name: accounts.db.prepare('SELECT name FROM "user" WHERE id = ?').get(c.owner).name, role: 'owner' });
    assert.deepEqual(members.map((m) => m.role), ['owner', 'admin', 'admin', 'member', 'member']);
  });
});

describe('invites', () => {
  const tokenOf = (link) => link.split('/').pop();

  test('a link is shown once: only its hash is stored', async () => {
    const c = await club();
    const { link, invite } = createInvite(accounts.db, c.admin, c.id, { singleUse: true });
    assert.match(link, /^\/invite\/[A-Za-z0-9_-]{43}$/);
    const row = accounts.db.prepare('SELECT * FROM invite WHERE id = ?').get(invite.id);
    assert.notEqual(row.token_hash, tokenOf(link));
    assert.match(String(row.token_hash), /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(listInvites(accounts.db, c.owner, c.id)).includes(tokenOf(link)), false);
    assert.equal(invite.singleUse, true);
    const days = (Date.parse(invite.expiresAt) - Date.now()) / 86400e3;
    assert.ok(days > 6.99 && days <= 7, 'expires in 7 days by default');
  });

  test('redeeming joins as a member', async () => {
    const c = await club();
    const u = await user();
    const { link } = createInvite(accounts.db, c.owner, c.id, { singleUse: true });
    const result = redeemInvite(accounts.db, u, tokenOf(link));
    assert.equal(result.joined, true);
    assert.equal(result.workspace.id, c.id);
    assert.equal(roleOf(c.id, u), 'member');
  });

  test('an expired invite is invalid, and says so', async () => {
    const c = await club();
    const { link, invite } = createInvite(accounts.db, c.owner, c.id, { singleUse: false, ttlDays: 1 });
    accounts.db.prepare('UPDATE invite SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), invite.id);
    throwsCode(() => redeemInvite(accounts.db, 'x', tokenOf(link)), 'invalid', /expired/);
    const u = await user();
    throwsCode(() => redeemInvite(accounts.db, u, tokenOf(link)), 'invalid', /expired/);
  });

  test('a single-use invite works once', async () => {
    const c = await club();
    const [a, b] = [await user(), await user()];
    const { link } = createInvite(accounts.db, c.owner, c.id, { singleUse: true });
    redeemInvite(accounts.db, a, tokenOf(link));
    throwsCode(() => redeemInvite(accounts.db, b, tokenOf(link)), 'invalid', /used/);
    assert.equal(roleOf(c.id, b), null);
  });

  test('a multi-use invite works for several people', async () => {
    const c = await club();
    const [a, b] = [await user(), await user()];
    const { link } = createInvite(accounts.db, c.owner, c.id, { singleUse: false });
    redeemInvite(accounts.db, a, tokenOf(link));
    redeemInvite(accounts.db, b, tokenOf(link));
    assert.equal(roleOf(c.id, b), 'member');
  });

  test('a revoked invite is invalid', async () => {
    const c = await club();
    const { link, invite } = createInvite(accounts.db, c.owner, c.id, { singleUse: false });
    revokeInvite(accounts.db, c.admin, c.id, invite.id);
    const u = await user();
    throwsCode(() => redeemInvite(accounts.db, u, tokenOf(link)), 'invalid', /revoked/);
    assert.deepEqual(listInvites(accounts.db, c.owner, c.id).map((i) => i.id).includes(invite.id), false);
    throwsCode(() => revokeInvite(accounts.db, c.admin, c.id, 'nope'), 'not-found');
  });

  test('an unknown token is invalid', async () => {
    throwsCode(() => redeemInvite(accounts.db, 'x', 'A'.repeat(43)), 'invalid');
    throwsCode(() => redeemInvite(accounts.db, 'x', 42), 'invalid');
  });

  test('redeeming while already a member is a no-op, and spends nothing', async () => {
    const c = await club();
    const { link } = createInvite(accounts.db, c.owner, c.id, { singleUse: true });
    const result = redeemInvite(accounts.db, c.admin, tokenOf(link));
    assert.equal(result.joined, false);
    assert.equal(roleOf(c.id, c.admin), 'admin', 'the role is kept');
    const u = await user();
    assert.equal(redeemInvite(accounts.db, u, tokenOf(link)).joined, true, 'the invite is still unused');
  });

  test('ttlDays must be a whole number of days from 1 to 30', async () => {
    const c = await club();
    for (const ttlDays of [0, 31, 1.5, '7']) throwsCode(() => createInvite(accounts.db, c.owner, c.id, { singleUse: true, ttlDays }), 'invalid');
  });

  test('a personal workspace cannot get invites or other members', async () => {
    const u = await user();
    const other = await user();
    const personal = createPersonalWorkspace(accounts.db, u, 'Solo');
    throwsCode(() => createInvite(accounts.db, u, personal, { singleUse: true }), 'invalid');
    throwsCode(() => setRole(accounts.db, u, personal, other, 'admin'), 'invalid');
    throwsCode(() => transferOwnership(accounts.db, u, personal, other), 'invalid');
    throwsCode(() => leaveClub(accounts.db, u, personal), 'invalid');
    throwsCode(() => deleteClub(accounts.db, u, personal), 'invalid');
    throwsCode(() => renameClub(accounts.db, u, personal, 'X'), 'invalid');
    // Even a hand-made invite row for it cannot add anyone.
    const { link } = createInvite(accounts.db, u, createClub(accounts.db, u, 'Real club').id, { singleUse: true });
    accounts.db.prepare('UPDATE invite SET workspace_id = ? WHERE token_hash IS NOT NULL AND workspace_id != ? AND created_by = ?').run(personal, personal, u);
    throwsCode(() => redeemInvite(accounts.db, other, tokenOf(link)), 'invalid');
    assert.equal(roleOf(personal, other), null);
  });
});

describe('quotas', () => {
  test('a sixth club is quota-exceeded', async () => {
    const u = await user();
    createPersonalWorkspace(accounts.db, u, 'Mine');
    for (let i = 0; i < 5; i += 1) createClub(accounts.db, u, `Club ${i}`);
    throwsCode(() => createClub(accounts.db, u, 'Club 6'), 'quota-exceeded', /5/);
  });

  test('a 21st active invite is quota-exceeded; revoked ones do not count', async () => {
    const c = await club();
    const first = createInvite(accounts.db, c.owner, c.id, { singleUse: true });
    for (let i = 1; i < 20; i += 1) createInvite(accounts.db, c.owner, c.id, { singleUse: true });
    throwsCode(() => createInvite(accounts.db, c.owner, c.id, { singleUse: true }), 'quota-exceeded', /20/);
    revokeInvite(accounts.db, c.owner, c.id, first.invite.id);
    createInvite(accounts.db, c.owner, c.id, { singleUse: true });
  });
});
