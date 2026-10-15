// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One SQLite file holds Better Auth's tables and TinyLap's own (spec §4).
// Better Auth's are created by its programmatic migrations; TinyLap's are
// created idempotently here. Timestamps are ISO 8601 text, as in the planner.
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'club')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS membership (
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS membership_user ON membership (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS membership_one_owner ON membership (workspace_id) WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS invite (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role = 'member'),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  single_use INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  used_by TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS invite_workspace ON invite (workspace_id);
CREATE TABLE IF NOT EXISTS recovery_code (
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  lookup_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  used_at TEXT,
  UNIQUE (lookup_id)
);
CREATE INDEX IF NOT EXISTS recovery_code_user ON recovery_code (user_id);
CREATE TABLE IF NOT EXISTS deletion (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'workspace')),
  id TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
`;

/**
 * Opens the database, brings Better Auth's tables up to date for `options`
 * (its options without `database`, from authOptions), then TinyLap's.
 * @param {string} path a file, or ':memory:'
 * @param {Record<string, any>} options
 */
export async function openDb(path, options) {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL'); // a no-op for ':memory:'
    db.exec('PRAGMA foreign_keys = ON');
    const { runMigrations } = await getMigrations({ ...options, database: db });
    await runMigrations();
    db.exec(SCHEMA);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
