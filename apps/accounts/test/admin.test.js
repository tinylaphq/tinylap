// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// admin.js, the maintainer's command line (spec §5), against a temporary
// database file.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createClub, createInvite, createPersonalWorkspace, redeemInvite } from '../server/workspaces.js';
import { createTestUser, startAccounts } from './helpers.js';

const ADMIN = fileURLToPath(new URL('../admin.js', import.meta.url));

let dir;
let dbPath;
let ids;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tinylap-admin-'));
  dbPath = join(dir, 'accounts.sqlite');
  const accounts = await startAccounts({ env: { TINYLAP_DB: dbPath } });
  const owner = (await createTestUser(accounts.auth, 'Lost Owner')).id;
  const member = (await createTestUser(accounts.auth, 'Next Owner')).id;
  const stranger = (await createTestUser(accounts.auth, 'Stranger')).id;
  const personal = createPersonalWorkspace(accounts.db, stranger, 'Stranger');
  const club = createClub(accounts.db, owner, 'Orphaned Club');
  const { link } = createInvite(accounts.db, owner, club.id, { singleUse: true });
  redeemInvite(accounts.db, member, link.split('/').pop());
  ids = { owner, member, stranger, club: club.id, personal };
  await accounts.close();
});
after(() => rm(dir, { recursive: true, force: true }));

/** @returns {Promise<{ code: number, stdout: string, stderr: string }>} */
function run(args, env = { TINYLAP_DB: dbPath }) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--disable-warning=ExperimentalWarning', ADMIN, ...args], { env: { PATH: process.env.PATH, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

const roles = () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return Object.fromEntries(db.prepare('SELECT user_id, role FROM membership WHERE workspace_id = ?').all(ids.club).map((r) => [r.user_id, r.role]));
  } finally {
    db.close();
  }
};

test('an unknown workspace exits 1 with a message', async () => {
  const { code, stderr, stdout } = await run(['transfer-ownership', 'no-such-club', ids.member]);
  assert.equal(code, 1);
  assert.match(stderr, /no workspace no-such-club/i);
  assert.equal(stdout, '');
});

test('a user who is not a member exits 1 with a message', async () => {
  const { code, stderr } = await run(['transfer-ownership', ids.club, ids.stranger]);
  assert.equal(code, 1);
  assert.match(stderr, /not a member/i);
  assert.equal(roles()[ids.owner], 'owner', 'nothing changed');
});

test('a personal workspace has nobody to transfer to', async () => {
  const { code, stderr } = await run(['transfer-ownership', ids.personal, ids.member]);
  assert.equal(code, 1);
  assert.match(stderr, /not a member|personal/i);
});

test('usage errors and a missing database exit 1', async () => {
  assert.equal((await run([])).code, 1);
  assert.match((await run(['frobnicate'])).stderr, /usage/i);
  assert.equal((await run(['transfer-ownership', ids.club])).code, 1);
  const missing = await run(['transfer-ownership', ids.club, ids.member], { TINYLAP_DB: join(dir, 'nope.sqlite') });
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /no database/i);
});

test('transfer-ownership makes the member the owner and the old owner an admin, and says so', async () => {
  const { code, stdout, stderr } = await run(['transfer-ownership', ids.club, ids.member]);
  assert.equal(stderr, '');
  assert.equal(code, 0);
  assert.match(stdout, /Orphaned Club/);
  assert.match(stdout, /Next Owner/);
  assert.match(stdout, /Lost Owner/);
  assert.deepEqual(roles(), { [ids.owner]: 'admin', [ids.member]: 'owner' });
});

test('without the server configuration it says no notice went out', async () => {
  // The club now belongs to Next Owner: hand it back.
  const { code, stdout, stderr } = await run(['transfer-ownership', ids.club, ids.owner]);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /No membership notice sent/);
});

test('with the server configuration it raises both token versions and sends the notice', async () => {
  const { createServer } = await import('node:http');
  const bodies = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      bodies.push({ auth: req.headers.authorization, ...JSON.parse(body) });
      res.writeHead(204).end();
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  try {
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    const noticeUri = `http://127.0.0.1:${port}/notices/membership`;
    const env = {
      TINYLAP_DB: dbPath,
      TINYLAP_DEV: '1',
      TINYLAP_ISSUER: 'http://localhost:4100',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      TINYLAP_CLIENTS: JSON.stringify([{ clientId: 'timing', clientSecret: 's', redirectUris: ['http://127.0.0.1:9/auth/callback'], resource: 'http://127.0.0.1:9', noticeUri, noticeToken: 'notice-t' }]),
    };
    const { code, stdout, stderr } = await run(['transfer-ownership', ids.club, ids.member], env);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /Membership notice sent to http:\/\/127\.0\.0\.1/);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].auth, 'Bearer notice-t');
    assert.deepEqual([...bodies[0].users].sort(), [ids.member, ids.owner].sort());
    assert.ok(bodies[0].versions[ids.member] >= 1 && bodies[0].versions[ids.owner] >= 1, JSON.stringify(bodies[0].versions));
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(() => done(undefined)));
  }
});
