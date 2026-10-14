// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The deletions feed (spec §7). Every deleted user and workspace appends a
// row; `seq` only grows (AUTOINCREMENT never reuses a value), so a consumer
// keeps the highest seq it processed and asks for what came after it.

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {'user' | 'workspace'} kind
 * @param {string} id
 * @returns {number} the new row's seq
 */
export function recordDeletion(db, kind, id) {
  const { lastInsertRowid } = db.prepare('INSERT INTO deletion (kind, id, deleted_at) VALUES (?, ?, ?)').run(kind, id, new Date().toISOString());
  return Number(lastInsertRowid);
}

/**
 * Up to `limit` deletions after `afterSeq`, oldest first. `next` is the seq
 * to ask after next time: the last one returned, or `afterSeq` if none.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} afterSeq
 * @param {number} [limit]
 * @returns {{ deletions: { seq: number, kind: string, id: string, deletedAt: string }[], next: number }}
 */
export function readDeletions(db, afterSeq, limit = 1000) {
  const deletions = db.prepare('SELECT seq, kind, id, deleted_at FROM deletion WHERE seq > ? ORDER BY seq LIMIT ?').all(afterSeq, limit)
    .map((r) => ({ seq: Number(r.seq), kind: String(r.kind), id: String(r.id), deletedAt: String(r.deleted_at) }));
  return { deletions, next: deletions.length ? deletions.at(-1).seq : afterSeq };
}
