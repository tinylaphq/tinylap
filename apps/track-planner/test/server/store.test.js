// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The library's version history orders by an explicit `seq` column (an
// INTEGER PRIMARY KEY), never by SQLite's implicit rowid, which VACUUM may
// renumber in a table without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, VERSIONS_KEPT } from '../../server/store.js';

const json = (n) => JSON.stringify({ n });
const key = (n) => String(n).padStart(22, 'A');

test('library_version has an INTEGER PRIMARY KEY seq, and history and pruning follow it', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tinylap-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'planner.sqlite');
  const store = openStore(file);
  const saver = { userId: 'u', userName: 'U' };
  store.createTrack({ id: 't', workspaceId: 'w', name: 'T', key: key(0), json: json(0), ...saver });
  for (let n = 1; n <= VERSIONS_KEPT + 2; n++) store.addVersion('t', { key: key(n), json: json(n), ...saver });
  store.addVersion('t', { key: key(10), json: json(10), ...saver }); // saved again: to the top
  const keys = store.listVersions('t').map((v) => v.key);
  assert.equal(keys.length, VERSIONS_KEPT);
  assert.equal(keys[0], key(10));
  assert.equal(keys[1], key(VERSIONS_KEPT + 2));
  assert.ok(!keys.includes(key(0)) && !keys.includes(key(1)) && !keys.includes(key(2)), 'the oldest dropped off');
  store.close();

  const db = new DatabaseSync(file, { readOnly: true });
  t.after(() => db.close());
  const seq = db.prepare('PRAGMA table_info(library_version)').all().find((c) => c.name === 'seq');
  assert.ok(seq, 'a seq column');
  assert.equal(seq.type, 'INTEGER');
  assert.equal(seq.pk, 1);
  const bySeq = db.prepare("SELECT key FROM library_version WHERE track_id = 't' ORDER BY seq DESC").all().map((r) => r.key);
  assert.deepEqual(bySeq, keys, 'the history is in seq order');
});
