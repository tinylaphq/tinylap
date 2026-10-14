// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Snapshots never change, so the store only inserts and reads. A repeated
// post of the same snapshot is a no-op, not an error.
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
`;

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
  return {
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
