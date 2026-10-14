// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Snapshots never change, so the store only inserts and reads. A repeated
// post of the same snapshot is a no-op, not an error. Log-in sessions
// (@tinylap/auth's SessionStore) and the deletions feed's cursor live here
// too.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS layouts (
  key        TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  shape_key  TEXT,
  track_id   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS layouts_shape ON layouts (shape_key);
CREATE TABLE IF NOT EXISTS bff_session (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  sealed_tokens TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  name          TEXT
);
CREATE INDEX IF NOT EXISTS bff_session_user ON bff_session (user_id);
CREATE TABLE IF NOT EXISTS feed_cursor (
  feed TEXT PRIMARY KEY,
  seq  INTEGER NOT NULL
);
`;

/**
 * @typedef {import('@tinylap/auth').SessionStore & {
 *   getName(id: string): string | null,
 *   setName(id: string, name: string): void,
 * }} PlannerSessions
 */

/**
 * @tinylap/auth's SessionStore on the bff_session table, plus the display
 * name cached per session. A refresh rewrites the row but keeps the name.
 * @param {DatabaseSync} db
 * @returns {PlannerSessions}
 */
function sessionStore(db) {
  const select = db.prepare('SELECT user_id, sealed_tokens, created_at, expires_at FROM bff_session WHERE id = ?');
  const upsert = db.prepare(`INSERT INTO bff_session (id, user_id, sealed_tokens, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, sealed_tokens = excluded.sealed_tokens,
      created_at = excluded.created_at, expires_at = excluded.expires_at`);
  const remove = db.prepare('DELETE FROM bff_session WHERE id = ?');
  const removeUser = db.prepare('DELETE FROM bff_session WHERE user_id = ?');
  const selectName = db.prepare('SELECT name FROM bff_session WHERE id = ?');
  const updateName = db.prepare('UPDATE bff_session SET name = ? WHERE id = ?');
  return {
    async get(id) {
      const row = select.get(id);
      return row
        ? { userId: String(row.user_id), sealedTokens: String(row.sealed_tokens), createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) }
        : null;
    },
    async set(id, { userId, sealedTokens, createdAt, expiresAt }) {
      upsert.run(id, userId, sealedTokens, createdAt, expiresAt);
    },
    async delete(id) {
      remove.run(id);
    },
    async deleteUser(userId) {
      removeUser.run(userId);
    },
    getName(id) {
      const row = selectName.get(id);
      return row?.name == null ? null : String(row.name);
    },
    setName(id, name) {
      updateName.run(name, id);
    },
  };
}

/** @param {string} path A file path, or ':memory:'. */
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const insert = db.prepare(
    'INSERT INTO layouts (key, json, shape_key, track_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
  );
  const select = db.prepare('SELECT json FROM layouts WHERE key = ?');
  const byShape = db.prepare(
    'SELECT key, track_id, created_at FROM layouts WHERE shape_key = ? ORDER BY created_at DESC, key LIMIT ?',
  );
  const sessions = sessionStore(db);
  const selectCursor = db.prepare('SELECT seq FROM feed_cursor WHERE feed = ?');
  const upsertCursor = db.prepare('INSERT INTO feed_cursor (feed, seq) VALUES (?, ?) ON CONFLICT (feed) DO UPDATE SET seq = excluded.seq');
  return {
    sessions,
    /** The highest deletions-feed seq processed so far; 0 before the first. */
    feedCursor() {
      const row = selectCursor.get('deletions');
      return row ? Number(row.seq) : 0;
    },
    /** @param {number} seq */
    setFeedCursor(seq) {
      upsertCursor.run('deletions', seq);
    },
    /**
     * Removes what the planner holds for a deleted workspace. Nothing yet:
     * the library tables (private snapshots, tracks, versions) come later.
     * @param {string} workspaceId
     */
    deleteWorkspaceData(workspaceId) {
      void workspaceId;
    },
    /** @param {{ key: string, json: string, shapeKey: string | null, trackId: string | null }} row @returns {boolean} created */
    put({ key, json, shapeKey, trackId }) {
      return insert.run(key, json, shapeKey, trackId, new Date().toISOString()).changes === 1;
    },
    /** @param {string} key @returns {string | null} */
    get(key) {
      const row = select.get(key);
      return row ? String(row.json) : null;
    },
    /** @param {string} shapeKey @param {number} [limit] */
    listByShape(shapeKey, limit = 100) {
      return byShape.all(shapeKey, limit).map((r) => ({
        key: String(r.key),
        trackId: String(r.track_id),
        createdAt: String(r.created_at),
      }));
    },
    close() {
      db.close();
    },
  };
}
