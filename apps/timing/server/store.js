// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// SQLite (spec §3, Data). Every row belongs to a workspace, so the deletions
// feed removes a deleted one completely. Passings are stored once per key
// (spec §4); crossings are what the engine made of them, and can be rebuilt.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bff_session (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, sealed_tokens TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, name TEXT
);
CREATE INDEX IF NOT EXISTS bff_session_user ON bff_session (user_id);
CREATE TABLE IF NOT EXISTS feed_cursor (feed TEXT PRIMARY KEY, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY, track_id TEXT, direction TEXT NOT NULL DEFAULT 'ccw', watch_token TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS track (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, shape TEXT NOT NULL, name TEXT NOT NULL,
  snapshot_key TEXT NOT NULL, layout TEXT NOT NULL, PRIMARY KEY (workspace_id, id)
);
CREATE TABLE IF NOT EXISTS driver (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, colour TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS driver_workspace ON driver (workspace_id);
CREATE TABLE IF NOT EXISTS transponder (
  workspace_id TEXT NOT NULL, code TEXT NOT NULL, driver_id TEXT, first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, code)
);
CREATE TABLE IF NOT EXISTS decoder (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS decoder_workspace ON decoder (workspace_id);
CREATE TABLE IF NOT EXISTS passing (
  decoder_id TEXT NOT NULL, boot TEXT NOT NULL, transponder TEXT NOT NULL, t INTEGER NOT NULL,
  received_at INTEGER NOT NULL, via TEXT NOT NULL, workspace_id TEXT NOT NULL,
  PRIMARY KEY (decoder_id, boot, transponder, t)
);
CREATE INDEX IF NOT EXISTS passing_workspace ON passing (workspace_id);
CREATE INDEX IF NOT EXISTS passing_net ON passing (workspace_id, via, decoder_id);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, track_id TEXT, direction TEXT NOT NULL,
  roster TEXT, state TEXT NOT NULL, created_at INTEGER NOT NULL, opens_at INTEGER, closes_at INTEGER,
  ended_at INTEGER, duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS session_workspace ON session (workspace_id, state);
CREATE TABLE IF NOT EXISTS crossing (
  seq INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
  decoder_id TEXT NOT NULL, boot TEXT NOT NULL, transponder TEXT NOT NULL, t INTEGER NOT NULL,
  driver_id TEXT, at INTEGER NOT NULL, lap_ms INTEGER, counts INTEGER NOT NULL, ref INTEGER NOT NULL,
  via TEXT NOT NULL, flag TEXT
);
CREATE INDEX IF NOT EXISTS crossing_session ON crossing (session_id, seq);
CREATE INDEX IF NOT EXISTS crossing_reference ON crossing (decoder_id, transponder, ref, seq);
CREATE INDEX IF NOT EXISTS crossing_transponder ON crossing (workspace_id, transponder, driver_id);
`;

const ACTIVE = "('countdown', 'running', 'finishing')";

/**
 * @typedef {import('@tinylap/auth').SessionStore & {
 *   getName(id: string): string | null,
 *   setName(id: string, name: string): void,
 * }} TimingSessions
 */

/** @param {DatabaseSync} db @returns {TimingSessions} */
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

const num = (v) => (v === null || v === undefined ? null : Number(v));
const str = (v) => (v === null || v === undefined ? null : String(v));

const workspaceOf = (r) => ({ id: String(r.id), trackId: str(r.track_id), direction: String(r.direction), watchToken: str(r.watch_token) });
const sessionOf = (r) => ({
  id: String(r.id), workspaceId: String(r.workspace_id), kind: String(r.kind), trackId: str(r.track_id), direction: String(r.direction),
  roster: r.roster === null ? null : JSON.parse(String(r.roster)), state: String(r.state), createdAt: Number(r.created_at),
  opensAt: num(r.opens_at), closesAt: num(r.closes_at), endedAt: num(r.ended_at), durationMs: num(r.duration_ms),
});
const crossingOf = (r) => ({
  seq: Number(r.seq), sessionId: String(r.session_id), decoder: String(r.decoder_id), boot: String(r.boot), transponder: String(r.transponder),
  t: Number(r.t), driverId: str(r.driver_id), at: Number(r.at), lapMs: num(r.lap_ms), counts: r.counts === 1, ref: r.ref === 1,
  via: String(r.via), flag: str(r.flag),
});

/** @param {string} path A file path, or ':memory:'. */
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const q = (sql) => db.prepare(sql);

  const s = {
    selectWorkspace: q('SELECT * FROM workspace WHERE id = ?'),
    insertWorkspace: q('INSERT INTO workspace (id) VALUES (?) ON CONFLICT DO NOTHING'),
    setTrackOf: q('UPDATE workspace SET track_id = ?, direction = ? WHERE id = ?'),
    upsertTrack: q(`INSERT INTO track (workspace_id, id, shape, name, snapshot_key, layout) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, id) DO UPDATE SET shape = excluded.shape, name = excluded.name,
        snapshot_key = excluded.snapshot_key, layout = excluded.layout`),
    selectTrack: q('SELECT id, shape, name, snapshot_key FROM track WHERE workspace_id = ? AND id = ?'),
    setWatch: q('UPDATE workspace SET watch_token = ? WHERE id = ?'),
    byWatch: q('SELECT id FROM workspace WHERE watch_token = ?'),
    drivers: q('SELECT id, name, colour FROM driver WHERE workspace_id = ? ORDER BY name COLLATE NOCASE, id'),
    driver: q('SELECT id, name, colour FROM driver WHERE workspace_id = ? AND id = ?'),
    addDriver: q('INSERT INTO driver (id, workspace_id, name, colour) VALUES (?, ?, ?, ?)'),
    updateDriver: q('UPDATE driver SET name = ?, colour = ? WHERE workspace_id = ? AND id = ?'),
    deleteDriver: q('DELETE FROM driver WHERE workspace_id = ? AND id = ?'),
    unassignDriver: q('UPDATE transponder SET driver_id = NULL WHERE workspace_id = ? AND driver_id = ?'),
    transponders: q('SELECT code, driver_id, first_seen_at FROM transponder WHERE workspace_id = ? ORDER BY code'),
    seeTransponder: q('INSERT INTO transponder (workspace_id, code, first_seen_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'),
    transponder: q('SELECT code, driver_id FROM transponder WHERE workspace_id = ? AND code = ?'),
    assignTransponder: q(`INSERT INTO transponder (workspace_id, code, driver_id, first_seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (workspace_id, code) DO UPDATE SET driver_id = excluded.driver_id`),
    decoders: q('SELECT id, name, created_at, last_seen_at FROM decoder WHERE workspace_id = ? ORDER BY created_at, id'),
    netDecoders: q("SELECT DISTINCT decoder_id FROM passing WHERE workspace_id = ? AND via = 'net'"),
    decoder: q('SELECT id, workspace_id, name FROM decoder WHERE id = ?'),
    decoderByHash: q('SELECT id, workspace_id FROM decoder WHERE token_hash = ?'),
    addDecoder: q('INSERT INTO decoder (id, workspace_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    deleteDecoder: q('DELETE FROM decoder WHERE workspace_id = ? AND id = ?'),
    touchDecoder: q('UPDATE decoder SET last_seen_at = ? WHERE id = ?'),
    insertPassing: q(`INSERT INTO passing (decoder_id, boot, transponder, t, received_at, via, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`),
    through: q('SELECT MAX(t) AS t FROM passing WHERE decoder_id = ? AND boot = ?'),
    lastReference: q('SELECT boot, t FROM crossing WHERE decoder_id = ? AND transponder = ? AND ref = 1 ORDER BY seq DESC LIMIT 1'),
    addCrossing: q(`INSERT INTO crossing (workspace_id, session_id, decoder_id, boot, transponder, t, driver_id, at, lap_ms, counts, ref, via, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    crossings: q('SELECT * FROM crossing WHERE session_id = ? ORDER BY seq'),
    recentCrossings: q('SELECT * FROM crossing WHERE session_id = ? ORDER BY seq DESC LIMIT ?'),
    setCounts: q('UPDATE crossing SET counts = ? WHERE seq = ?'),
    // Results freeze at done (spec §6): crossings of ended qualifying and races keep their driver.
    unassignedSessions: q(`SELECT DISTINCT session_id FROM crossing WHERE workspace_id = ? AND transponder = ? AND driver_id IS NULL AND via != 'tap' AND session_id IN (SELECT id FROM session WHERE kind = 'practice' OR state IN ${ACTIVE})`),
    assignCrossings: q(`UPDATE crossing SET driver_id = ? WHERE workspace_id = ? AND transponder = ? AND driver_id IS NULL AND via != 'tap' AND session_id IN (SELECT id FROM session WHERE kind = 'practice' OR state IN ${ACTIVE})`),
    lastCrossingAt: q('SELECT MAX(at) AS at FROM crossing WHERE session_id = ?'),
    addSession: q(`INSERT INTO session (id, workspace_id, kind, track_id, direction, roster, state, created_at, opens_at, closes_at, ended_at, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    session: q('SELECT * FROM session WHERE id = ?'),
    updateSession: q('UPDATE session SET state = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?'),
    activeSession: q(`SELECT * FROM session WHERE workspace_id = ? AND kind != 'practice' AND state IN ${ACTIVE} ORDER BY created_at DESC LIMIT 1`),
    openPractice: q("SELECT * FROM session WHERE workspace_id = ? AND kind = 'practice' AND state = 'running' ORDER BY created_at DESC LIMIT 1"),
    lastNonPractice: q("SELECT * FROM session WHERE workspace_id = ? AND kind != 'practice' ORDER BY created_at DESC, rowid DESC LIMIT 1"),
    activeAll: q(`SELECT * FROM session WHERE kind != 'practice' AND state IN ${ACTIVE} ORDER BY created_at`),
    listSessions: q('SELECT * FROM session WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'),
    // SQLite: with one MIN(), the bare column `at` comes from the row holding the minimum.
    personalBests: q(`SELECT c.driver_id, MIN(c.lap_ms) AS best_ms, c.at FROM crossing c JOIN session s ON s.id = c.session_id
      WHERE c.workspace_id = ? AND s.track_id = ? AND s.direction = ? AND c.counts = 1 AND c.via != 'tap' AND c.driver_id IS NOT NULL
      GROUP BY c.driver_id ORDER BY best_ms`),
    selectCursor: q('SELECT seq FROM feed_cursor WHERE feed = ?'),
    upsertCursor: q('INSERT INTO feed_cursor (feed, seq) VALUES (?, ?) ON CONFLICT (feed) DO UPDATE SET seq = excluded.seq'),
  };
  const purge = ['workspace WHERE id', 'track WHERE workspace_id', 'driver WHERE workspace_id', 'transponder WHERE workspace_id',
    'decoder WHERE workspace_id', 'passing WHERE workspace_id', 'session WHERE workspace_id', 'crossing WHERE workspace_id']
    .map((t) => q(`DELETE FROM ${t} = ?`));

  let depth = 0;
  /** @template T @param {() => T} fn @returns {T} */
  function transaction(fn) {
    const name = `t${depth++}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw error;
    } finally {
      depth -= 1;
    }
  }

  const workspace = (id) => {
    const row = s.selectWorkspace.get(id);
    return row ? workspaceOf(row) : null;
  };
  const session = (id) => {
    const row = s.session.get(id);
    return row ? sessionOf(row) : null;
  };

  return {
    sessions: sessionStore(db),
    transaction,
    feedCursor() {
      const row = s.selectCursor.get('deletions');
      return row ? Number(row.seq) : 0;
    },
    setFeedCursor(seq) {
      s.upsertCursor.run('deletions', seq);
    },
    deleteWorkspaceData(workspaceId) {
      transaction(() => {
        for (const statement of purge) statement.run(workspaceId);
      });
    },
    // Timing keeps no user names: drivers are records, not accounts.
    forgetUser() {},

    workspace,
    ensureWorkspace(id) {
      s.insertWorkspace.run(id);
      return workspace(id);
    },
    setTrack(workspaceId, { id, shape, name, snapshotKey, layout }, direction) {
      transaction(() => {
        s.insertWorkspace.run(workspaceId);
        s.upsertTrack.run(workspaceId, id, shape, name, snapshotKey, layout);
        s.setTrackOf.run(id, direction, workspaceId);
      });
    },
    track(workspaceId, trackId) {
      const r = s.selectTrack.get(workspaceId, trackId);
      return r ? { id: String(r.id), shape: String(r.shape), name: String(r.name), snapshotKey: String(r.snapshot_key) } : null;
    },
    setWatchToken(workspaceId, token) {
      s.insertWorkspace.run(workspaceId);
      s.setWatch.run(token, workspaceId);
    },
    workspaceByWatchToken(token) {
      return str(s.byWatch.get(token)?.id);
    },

    drivers: (ws) => s.drivers.all(ws).map((r) => ({ id: String(r.id), name: String(r.name), colour: String(r.colour) })),
    driver(ws, id) {
      const r = s.driver.get(ws, id);
      return r ? { id: String(r.id), name: String(r.name), colour: String(r.colour) } : null;
    },
    addDriver(ws, { id, name, colour }) {
      s.addDriver.run(id, ws, name, colour);
    },
    updateDriver: (ws, id, { name, colour }) => s.updateDriver.run(name, colour, ws, id).changes === 1,
    deleteDriver(ws, id) {
      return transaction(() => {
        s.unassignDriver.run(ws, id);
        return s.deleteDriver.run(ws, id).changes === 1;
      });
    },

    transponders: (ws) => s.transponders.all(ws).map((r) => ({ code: String(r.code), driverId: str(r.driver_id), firstSeenAt: Number(r.first_seen_at) })),
    seeTransponder(ws, code, at) {
      const created = s.seeTransponder.run(ws, code, at).changes === 1;
      const r = s.transponder.get(ws, code);
      return { code: String(r.code), driverId: str(r.driver_id), created };
    },
    assignTransponder(ws, code, driverId, at) {
      s.assignTransponder.run(ws, code, driverId, at);
    },

    decoders: (ws) => s.decoders.all(ws).map((r) => ({ id: String(r.id), name: String(r.name), createdAt: Number(r.created_at), lastSeenAt: num(r.last_seen_at) })),
    /** The decoders a plain ZRound decoder or an EasyLap may be chosen as: none that sends over Wi-Fi (decoders spec §3.2, I7). */
    choosableDecoders(ws) {
      const net = new Set(s.netDecoders.all(ws).map((r) => String(r.decoder_id)));
      return s.decoders.all(ws).filter((r) => !net.has(String(r.id))).map((r) => ({ id: String(r.id), name: String(r.name), createdAt: Number(r.created_at), lastSeenAt: num(r.last_seen_at) }));
    },
    decoder(id) {
      const r = s.decoder.get(id);
      return r ? { id: String(r.id), workspaceId: String(r.workspace_id), name: String(r.name) } : null;
    },
    decoderByTokenHash(hash) {
      const r = s.decoderByHash.get(hash);
      return r ? { id: String(r.id), workspaceId: String(r.workspace_id) } : null;
    },
    addDecoder(ws, { id, name, tokenHash, createdAt }) {
      s.addDecoder.run(id, ws, name, tokenHash, createdAt);
    },
    deleteDecoder: (ws, id) => s.deleteDecoder.run(ws, id).changes === 1,
    touchDecoder(id, at) {
      s.touchDecoder.run(at, id);
    },

    insertPassing: ({ decoder, boot, transponder, t, receivedAt, via, workspaceId }) =>
      s.insertPassing.run(decoder, boot, transponder, t, receivedAt, via, workspaceId).changes === 1,
    through: (decoder, boot) => num(s.through.get(decoder, boot)?.t),
    lastReference(decoder, transponder) {
      const r = s.lastReference.get(decoder, transponder);
      return r ? { boot: String(r.boot), t: Number(r.t) } : null;
    },
    addCrossing(c) {
      const result = s.addCrossing.run(c.workspaceId, c.sessionId, c.decoder, c.boot, c.transponder, c.t, c.driverId, c.at, c.lapMs, c.counts ? 1 : 0, c.ref ? 1 : 0, c.via, c.flag ?? null);
      return Number(result.lastInsertRowid);
    },
    crossings: (sessionId) => s.crossings.all(sessionId).map(crossingOf),
    recentCrossings: (sessionId, limit) => s.recentCrossings.all(sessionId, limit).map(crossingOf),
    setCrossingCounts(seq, counts) {
      s.setCounts.run(counts ? 1 : 0, seq);
    },
    assignCrossings(ws, code, driverId) {
      return transaction(() => {
        const ids = s.unassignedSessions.all(ws, code).map((r) => String(r.session_id));
        s.assignCrossings.run(driverId, ws, code);
        return ids;
      });
    },
    lastCrossingAt: (sessionId) => num(s.lastCrossingAt.get(sessionId)?.at),

    addSession(x) {
      s.addSession.run(x.id, x.workspaceId, x.kind, x.trackId, x.direction, x.roster === null ? null : JSON.stringify(x.roster), x.state, x.createdAt, x.opensAt, x.closesAt, x.endedAt, x.durationMs);
    },
    session,
    updateSession(id, { state, endedAt = null }) {
      s.updateSession.run(state, endedAt, id);
    },
    activeSession(ws) {
      const r = s.activeSession.get(ws);
      return r ? sessionOf(r) : null;
    },
    openPractice(ws) {
      const r = s.openPractice.get(ws);
      return r ? sessionOf(r) : null;
    },
    /** The latest qualifying or race, if it has ended (done or aborted); null while one is open. */
    lastEnded(ws) {
      const r = s.lastNonPractice.get(ws);
      const session = r ? sessionOf(r) : null;
      return session && (session.state === 'done' || session.state === 'aborted') ? session : null;
    },
    activeAll: () => s.activeAll.all().map(sessionOf),
    listSessions: (ws, limit) => s.listSessions.all(ws, limit).map(sessionOf),

    personalBests: (ws, trackId, direction) => s.personalBests.all(ws, trackId, direction).map((r) => ({ driverId: String(r.driver_id), bestMs: Number(r.best_ms), at: Number(r.at) })),

    close() {
      db.close();
    },
  };
}
