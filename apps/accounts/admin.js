#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The maintainer's command line for accounts (spec §5). It works on the
// database file in TINYLAP_DB (default /data/accounts.sqlite, as the
// server), so on Fly run it on the machine with the volume:
//
//   node apps/accounts/admin.js transfer-ownership <workspaceId> <userId>
//
// Gives a club whose owner can no longer act (every passkey and recovery
// code lost) to one of its members, after the request has been verified out
// of band. The old owner, if there is one, becomes an admin. With the
// server's configuration in the environment, as on its machine, both
// members' token versions go up and the apps get a membership notice, as
// after a change made on the club page; elsewhere it says none was sent.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from './server/config.js';
import { createNotifier } from './server/notices.js';
import { bumpTokenVersions } from './server/token-version.js';
import { forceTransferOwnership, WorkspaceError } from './server/workspaces.js';

const USAGE = 'Usage: node apps/accounts/admin.js transfer-ownership <workspaceId> <userId>';

/** @param {string} message */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [command, workspaceId, userId, ...rest] = process.argv.slice(2);
if (command !== 'transfer-ownership' || !workspaceId || !userId || rest.length) fail(USAGE);

const path = process.env.TINYLAP_DB || '/data/accounts.sqlite';
// DatabaseSync would create an empty file; a typo must not look like "no such workspace".
if (!existsSync(path)) fail(`There is no database at ${path}. Set TINYLAP_DB.`);

/**
 * Tells the apps, as the server does after a membership change: the members'
 * token versions go up, then a notice goes to each client with a noticeUri.
 * @param {DatabaseSync} database @param {string[]} users
 */
function notice(database, users) {
  let clients;
  try {
    clients = readConfig(process.env).clients;
  } catch (error) {
    process.stdout.write(`No membership notice sent (${error instanceof Error ? error.message : error}). Apps see the change within 10 minutes.\n`);
    return;
  }
  const targets = clients.filter((c) => c.noticeUri);
  if (!targets.length) {
    process.stdout.write('No membership notice sent: no client has a noticeUri. Apps see the change within 10 minutes.\n');
    return;
  }
  createNotifier({ clients: targets, logger: { warn: (m) => process.stderr.write(`${m}\n`) } })(users, bumpTokenVersions(database, users));
  process.stdout.write(`Membership notice sent to ${targets.map((c) => new URL(/** @type {string} */ (c.noticeUri)).origin).join(', ')}.\n`);
}

const db = new DatabaseSync(path);
try {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const { workspace, from, to, changed } = forceTransferOwnership(db, workspaceId, userId);
  if (!changed) {
    process.stdout.write(`${to.name} (${to.id}) already owns ${workspace.name} (${workspace.id}). Nothing changed.\n`);
  } else {
    const before = from ? ` ${from.name} (${from.id}) is now an admin.` : ' It had no owner.';
    process.stdout.write(`Transferred ${workspace.name} (${workspace.id}) to ${to.name} (${to.id}).${before}\n`);
    notice(db, [to.id, ...(from ? [from.id] : [])]);
  }
} catch (error) {
  db.close();
  if (error instanceof WorkspaceError) fail(error.message);
  throw error;
}
db.close();
