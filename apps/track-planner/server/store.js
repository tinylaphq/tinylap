// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Snapshots never change, so the store only inserts and reads. A repeated
// post of the same snapshot is a no-op, not an error. Log-in sessions
// (@tinylap/auth's SessionStore), the deletions feed's cursor and the private
// library (identity spec §4) live here too.
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
CREATE TABLE IF NOT EXISTS private_layouts (
  key          TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  json         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (key, workspace_id)
);
CREATE INDEX IF NOT EXISTS private_layouts_workspace ON private_layouts (workspace_id);
CREATE TABLE IF NOT EXISTS library_track (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  name            TEXT NOT NULL,
  current_key     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  updated_by_name TEXT
);
CREATE INDEX IF NOT EXISTS library_track_workspace ON library_track (workspace_id);
CREATE TABLE IF NOT EXISTS library_version (
  track_id      TEXT NOT NULL,
  key           TEXT NOT NULL,
  saved_at      TEXT NOT NULL,
  saved_by      TEXT NOT NULL,
  saved_by_name TEXT,
  UNIQUE (track_id, key)
);
`;

/** A track keeps this many versions, newest first (spec §4). */
export const VERSIONS_KEPT = 50;

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

/**
 * @typedef {{ id: string, name: string | null }} Saver A NULL name is a deleted user.
 * @typedef {{ id: string, workspaceId: string, name: string, currentKey: string, createdAt: string, updatedAt: string, updatedBy: Saver }} Track
 * @typedef {{ key: string, savedAt: string, savedBy: Saver }} Version
 * @typedef {{ id: string, workspaceId: string, name: string, key: string, json: string, userId: string, userName: string | null }} NewTrack
 */

/** @returns {Track} */
const trackOf = (r) => ({
  id: String(r.id),
  workspaceId: String(r.workspace_id),
  name: String(r.name),
  currentKey: String(r.current_key),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  updatedBy: { id: String(r.updated_by), name: r.updated_by_name == null ? null : String(r.updated_by_name) },
});

/** @returns {Version} */
const versionOf = (r) => ({
  key: String(r.key),
  savedAt: String(r.saved_at),
  savedBy: { id: String(r.saved_by), name: r.saved_by_name == null ? null : String(r.saved_by_name) },
});

/**
 * Tracks, their versions, and the private snapshots the versions point at.
 * A version's snapshot is the private row (key, track's workspace); a row
 * no version of that workspace refers to any more is removed.
 * @param {DatabaseSync} db
 */
function libraryStore(db) {
  const putPrivate = db.prepare('INSERT INTO private_layouts (key, workspace_id, json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING');
  const selectPrivate = db.prepare('SELECT json FROM private_layouts WHERE key = ? AND workspace_id = ?');
  const selectTrack = db.prepare('SELECT * FROM library_track WHERE id = ?');
  const tracksOf = db.prepare('SELECT * FROM library_track WHERE workspace_id = ? ORDER BY updated_at DESC, id');
  const countTracks = db.prepare('SELECT COUNT(*) AS n FROM library_track WHERE workspace_id = ?');
  const insertTrack = db.prepare(`INSERT INTO library_track (id, workspace_id, name, current_key, created_at, updated_at, updated_by, updated_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const touchTrack = db.prepare('UPDATE library_track SET current_key = ?, updated_at = ?, updated_by = ?, updated_by_name = ? WHERE id = ?');
  const renameTrack = db.prepare('UPDATE library_track SET name = ?, updated_at = ?, updated_by = ?, updated_by_name = ? WHERE id = ?');
  const removeTrack = db.prepare('DELETE FROM library_track WHERE id = ?');
  const setCurrent = db.prepare('UPDATE library_track SET current_key = ? WHERE id = ?');
  // Saving a key the history already has moves it to the top: the rowid
  // orders versions, and a re-inserted row gets the highest one.
  const removeVersion = db.prepare('DELETE FROM library_version WHERE track_id = ? AND key = ?');
  const removeVersions = db.prepare('DELETE FROM library_version WHERE track_id = ?');
  const insertVersion = db.prepare('INSERT INTO library_version (track_id, key, saved_at, saved_by, saved_by_name) VALUES (?, ?, ?, ?, ?)');
  const versionsOf = db.prepare('SELECT * FROM library_version WHERE track_id = ? ORDER BY rowid DESC');
  const prune = db.prepare(`DELETE FROM library_version WHERE track_id = ? AND rowid NOT IN
    (SELECT rowid FROM library_version WHERE track_id = ? ORDER BY rowid DESC LIMIT ${VERSIONS_KEPT})`);
  const unreferenced = db.prepare(`DELETE FROM private_layouts WHERE workspace_id = ? AND key NOT IN
    (SELECT v.key FROM library_version v JOIN library_track t ON t.id = v.track_id WHERE t.workspace_id = ?)`);
  const dropWorkspace = [
    db.prepare('DELETE FROM library_version WHERE track_id IN (SELECT id FROM library_track WHERE workspace_id = ?)'),
    db.prepare('DELETE FROM library_track WHERE workspace_id = ?'),
    db.prepare('DELETE FROM private_layouts WHERE workspace_id = ?'),
  ];
  const forgetSaver = [
    db.prepare('UPDATE library_track SET updated_by_name = NULL WHERE updated_by = ?'),
    db.prepare('UPDATE library_version SET saved_by_name = NULL WHERE saved_by = ?'),
  ];

  /** @template T @param {() => T} fn @returns {T} */
  const atomically = (fn) => {
    db.exec('SAVEPOINT library');
    try {
      const result = fn();
      db.exec('RELEASE library');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO library');
      db.exec('RELEASE library');
      throw error;
    }
  };
  const now = () => new Date().toISOString();
  const track = (/** @type {string} */ id) => {
    const row = selectTrack.get(id);
    return row ? trackOf(row) : null;
  };
  const latest = (/** @type {string} */ trackId) => versionsOf.get(trackId);

  return {
    /** @param {string} key @param {string} workspaceId @returns {string | null} */
    getPrivate(key, workspaceId) {
      const row = selectPrivate.get(key, workspaceId);
      return row ? String(row.json) : null;
    },
    getTrack: track,
    /** @param {string} workspaceId @returns {Track[]} */
    listTracks(workspaceId) {
      return tracksOf.all(workspaceId).map(trackOf);
    },
    /** @param {string} workspaceId */
    countTracks(workspaceId) {
      return Number(countTracks.get(workspaceId)?.n ?? 0);
    },
    /** A new track with one version. @param {NewTrack} t @returns {{ track: Track, version: Version }} */
    createTrack({ id, workspaceId, name, key, json, userId, userName }) {
      const at = now();
      return atomically(() => {
        putPrivate.run(key, workspaceId, json, at);
        insertTrack.run(id, workspaceId, name, key, at, at, userId, userName);
        insertVersion.run(id, key, at, userId, userName);
        return { track: /** @type {Track} */ (track(id)), version: versionOf(latest(id)) };
      });
    },
    /**
     * Saves `key` as the track's newest version. Keeps the 50 newest.
     * @param {string} trackId @param {{ key: string, json: string, userId: string, userName: string | null }} v
     * @returns {{ track: Track, version: Version }}
     */
    addVersion(trackId, { key, json, userId, userName }) {
      const at = now();
      return atomically(() => {
        const { workspaceId } = /** @type {Track} */ (track(trackId));
        putPrivate.run(key, workspaceId, json, at);
        removeVersion.run(trackId, key);
        insertVersion.run(trackId, key, at, userId, userName);
        touchTrack.run(key, at, userId, userName, trackId);
        prune.run(trackId, trackId);
        unreferenced.run(workspaceId, workspaceId);
        return { track: /** @type {Track} */ (track(trackId)), version: versionOf(latest(trackId)) };
      });
    },
    /** @param {string} trackId @param {string} name @param {string} userId @param {string | null} userName */
    renameTrack(trackId, name, userId, userName) {
      renameTrack.run(name, now(), userId, userName, trackId);
      return /** @type {Track} */ (track(trackId));
    },
    /** @param {string} trackId @returns {Version[]} newest first */
    listVersions(trackId) {
      return versionsOf.all(trackId).map(versionOf);
    },
    /** @param {string} trackId */
    deleteTrack(trackId) {
      atomically(() => {
        const found = track(trackId);
        if (!found) return;
        removeVersions.run(trackId);
        removeTrack.run(trackId);
        unreferenced.run(found.workspaceId, found.workspaceId);
      });
    },
    /**
     * Removes one version. The current key moves to the newest left; the
     * last version takes the track with it.
     * @param {string} trackId @param {string} key @returns {boolean} whether there was one
     */
    deleteVersion(trackId, key) {
      return atomically(() => {
        const found = track(trackId);
        if (!found || removeVersion.run(trackId, key).changes !== 1) return false;
        const newest = latest(trackId);
        if (!newest) removeTrack.run(trackId);
        else if (found.currentKey === key) setCurrent.run(String(newest.key), trackId);
        unreferenced.run(found.workspaceId, found.workspaceId);
        return true;
      });
    },
    /** @param {string} workspaceId */
    deleteWorkspaceData(workspaceId) {
      atomically(() => {
        for (const statement of dropWorkspace) statement.run(workspaceId);
      });
    },
    /** A deleted user's saves keep the bare id; the name goes (shown as "former member"). @param {string} userId */
    forgetUser(userId) {
      atomically(() => {
        for (const statement of forgetSaver) statement.run(userId);
      });
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
  const library = libraryStore(db);
  const selectCursor = db.prepare('SELECT seq FROM feed_cursor WHERE feed = ?');
  const upsertCursor = db.prepare('INSERT INTO feed_cursor (feed, seq) VALUES (?, ?) ON CONFLICT (feed) DO UPDATE SET seq = excluded.seq');
  return {
    sessions,
    ...library,
    /** The highest deletions-feed seq processed so far; 0 before the first. */
    feedCursor() {
      const row = selectCursor.get('deletions');
      return row ? Number(row.seq) : 0;
    },
    /** @param {number} seq */
    setFeedCursor(seq) {
      upsertCursor.run('deletions', seq);
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
