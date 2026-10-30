// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// SQLite (spec §3, Data). Every row belongs to a workspace, so the deletions
// feed removes a deleted one completely. Passings are stored once per key
// (spec §4); crossings are what the engine made of them, and can be rebuilt.
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bff_session (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, sealed_tokens TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, name TEXT
);
CREATE INDEX IF NOT EXISTS bff_session_user ON bff_session (user_id);
CREATE TABLE IF NOT EXISTS feed_cursor (feed TEXT PRIMARY KEY, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY, track_id TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'ccw', watch_token TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS track (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, archived_at INTEGER,
  PRIMARY KEY (workspace_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS track_name ON track (workspace_id, name_key) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS track_layout (
  workspace_id TEXT NOT NULL, track_id TEXT NOT NULL, attached_at INTEGER NOT NULL, attached_by_user TEXT, attached_by_name TEXT,
  planner_id TEXT NOT NULL, shape TEXT NOT NULL, snapshot_key TEXT NOT NULL, layout TEXT NOT NULL,
  PRIMARY KEY (workspace_id, track_id, attached_at)
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
CREATE INDEX IF NOT EXISTS crossing_session_at ON crossing (session_id, at);
CREATE INDEX IF NOT EXISTS crossing_reference ON crossing (decoder_id, transponder, ref, seq);
CREATE INDEX IF NOT EXISTS passing_received ON passing (received_at);
CREATE INDEX IF NOT EXISTS crossing_passing ON crossing (decoder_id, boot, transponder, t);
CREATE INDEX IF NOT EXISTS crossing_transponder ON crossing (workspace_id, transponder, driver_id);
CREATE INDEX IF NOT EXISTS session_track ON session (workspace_id, track_id, direction);
CREATE INDEX IF NOT EXISTS session_created ON session (workspace_id, created_at, id);
CREATE TABLE IF NOT EXISTS track_record (
  workspace_id TEXT NOT NULL, track_id TEXT NOT NULL, direction TEXT NOT NULL, crossing_seq INTEGER PRIMARY KEY,
  driver_id TEXT NOT NULL, lap_ms INTEGER NOT NULL, at INTEGER NOT NULL, session_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS track_record_at ON track_record (workspace_id, track_id, direction, at);
CREATE TABLE IF NOT EXISTS personal_best (
  workspace_id TEXT NOT NULL, track_id TEXT NOT NULL, direction TEXT NOT NULL, driver_id TEXT NOT NULL,
  lap_ms INTEGER NOT NULL, at INTEGER NOT NULL, crossing_seq INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, track_id, direction, driver_id)
);
CREATE INDEX IF NOT EXISTS personal_best_fastest ON personal_best (workspace_id, track_id, direction, lap_ms, at, crossing_seq);
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
const layoutOf = (r) => ({
  attachedAt: Number(r.attached_at), plannerId: String(r.planner_id), shape: String(r.shape), snapshotKey: String(r.snapshot_key),
  // A member whose name was unknown still attached it; both null is a forgotten one (named tracks spec §3.4).
  layout: String(r.layout), by: str(r.attached_by_name), byMember: r.attached_by_user !== null && r.attached_by_user !== undefined,
});
// A track row joined with its newest layout entry (columns prefixed l_), or none.
const trackOf = (r) => ({
  id: String(r.id), name: String(r.name), archivedAt: num(r.archived_at),
  layout: r.l_attached_at === null ? null : layoutOf({
    attached_at: r.l_attached_at, planner_id: r.l_planner_id, shape: r.l_shape, snapshot_key: r.l_snapshot_key, layout: r.l_layout, attached_by_name: r.l_attached_by_name, attached_by_user: r.l_attached_by_user,
  }),
});
/** What makes two track names the same, in any script: SQLite's NOCASE folds ASCII only. @param {string} name */
export const nameKey = (name) => name.normalize('NFKC').toLowerCase();
const TRACK_WITH_LAYOUT = `SELECT t.id, t.name, t.archived_at, l.attached_at AS l_attached_at, l.planner_id AS l_planner_id, l.shape AS l_shape,
    l.snapshot_key AS l_snapshot_key, l.layout AS l_layout, l.attached_by_name AS l_attached_by_name, l.attached_by_user AS l_attached_by_user
  FROM track t LEFT JOIN track_layout l ON l.workspace_id = t.workspace_id AND l.track_id = t.id
    AND l.attached_at = (SELECT MAX(attached_at) FROM track_layout WHERE workspace_id = t.workspace_id AND track_id = t.id)`;
/** The board's reads of a track and a club's tracks, each with its newest layout (planned in the store tests). */
export const TRACK_SQL = {
  track: `${TRACK_WITH_LAYOUT} WHERE t.workspace_id = ? AND t.id = ?`,
  tracks: `${TRACK_WITH_LAYOUT} WHERE t.workspace_id = ? AND (t.archived_at IS NOT NULL) = ? ORDER BY t.name_key, t.id`,
};
// What the idle board reads up to four times a second per screen (named tracks spec §4): through an index
// that starts with the club, the fastest in its order and with a limit, never a scan of a club's laps.
export const IDLE_SQL = {
  fastest: 'SELECT driver_id, lap_ms, at, crossing_seq FROM personal_best WHERE workspace_id = ? AND track_id = ? AND direction = ? ORDER BY lap_ms, at, crossing_seq LIMIT ?',
  driven: 'SELECT 1 FROM crossing WHERE workspace_id = ? LIMIT 1',
};
/** SQLite's code for a broken UNIQUE constraint: a track name already in use. */
const UNIQUE = 2067;
const nameInUse = (error) => error?.errcode === UNIQUE;

const bestOf = (r) => ({ driverId: String(r.driver_id), bestMs: Number(r.lap_ms), at: Number(r.at), seq: Number(r.crossing_seq) });
const recordOf = (r) => ({ driverId: String(r.driver_id), lapMs: Number(r.lap_ms), at: Number(r.at), sessionId: String(r.session_id), seq: Number(r.crossing_seq) });
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
    insertWorkspace: q('INSERT INTO workspace (id, track_id) VALUES (?, ?)'),
    setTrackOf: q('UPDATE workspace SET track_id = ?, direction = ? WHERE id = ?'),
    selectTrack: q(TRACK_SQL.track),
    selectTracks: q(TRACK_SQL.tracks),
    addTrack: q('INSERT INTO track (workspace_id, id, name, name_key) VALUES (?, ?, ?, ?)'),
    renameTrack: q('UPDATE track SET name = ?, name_key = ? WHERE workspace_id = ? AND id = ?'),
    setArchived: q('UPDATE track SET archived_at = ? WHERE workspace_id = ? AND id = ?'),
    deleteTrack: q('DELETE FROM track WHERE workspace_id = ? AND id = ?'),
    deleteTrackLayouts: q('DELETE FROM track_layout WHERE workspace_id = ? AND track_id = ?'),
    deleteTrackRecords: q('DELETE FROM track_record WHERE workspace_id = ? AND track_id = ?'),
    deleteTrackBests: q('DELETE FROM personal_best WHERE workspace_id = ? AND track_id = ?'),
    layouts: q('SELECT * FROM track_layout WHERE workspace_id = ? AND track_id = ? ORDER BY attached_at DESC'),
    layoutAt: q('SELECT * FROM track_layout WHERE workspace_id = ? AND track_id = ? AND attached_at <= ? ORDER BY attached_at DESC LIMIT 1'),
    addLayout: q(`INSERT INTO track_layout (workspace_id, track_id, attached_at, planner_id, shape, snapshot_key, layout, attached_by_user, attached_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    forgetLayoutsBy: q('UPDATE track_layout SET attached_by_user = NULL, attached_by_name = NULL WHERE attached_by_user = ?'),
    sessionCount: q('SELECT COUNT(*) AS n FROM session WHERE workspace_id = ? AND track_id = ?'),
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
    deleteLoosePassings: q(`DELETE FROM passing WHERE received_at >= ? AND received_at < ? AND NOT EXISTS (SELECT 1 FROM crossing c
      WHERE c.decoder_id = passing.decoder_id AND c.boot = passing.boot AND c.transponder = passing.transponder AND c.t = passing.t)`),
    countPassings: q('SELECT COUNT(*) AS n FROM passing WHERE workspace_id = ?'),
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
    runningSession: q(`SELECT * FROM session WHERE workspace_id = ? AND state IN ${ACTIVE} ORDER BY created_at DESC LIMIT 1`),
    lastSession: q('SELECT * FROM session WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'),
    activeAll: q(`SELECT * FROM session WHERE state IN ${ACTIVE} ORDER BY created_at`),
    listSessions: q('SELECT * FROM session WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'),
    listSessionsBefore: q('SELECT * FROM session WHERE workspace_id = ? AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?'),
    // A session's counted laps only, through crossing_session: never a club's whole history.
    sessionDrivers: q('SELECT COUNT(DISTINCT driver_id) AS n FROM crossing WHERE session_id = ? AND counts = 1 AND driver_id IS NOT NULL'),
    sessionBest: q('SELECT seq, driver_id, lap_ms FROM crossing WHERE session_id = ? AND counts = 1 AND driver_id IS NOT NULL AND lap_ms IS NOT NULL ORDER BY lap_ms, seq LIMIT 1'),
    // Records and personal bests (records spec §4, §6): projections of the qualifying laps, written with each lap.
    personalBests: q(`SELECT driver_id, lap_ms, at, crossing_seq FROM personal_best
      WHERE workspace_id = ? AND track_id = ? AND direction = ? AND driver_id IN (SELECT value FROM json_each(?)) ORDER BY lap_ms, at, crossing_seq`),
    fastest: q(IDLE_SQL.fastest),
    driven: q(IDLE_SQL.driven),
    offerPersonalBest: q(`INSERT INTO personal_best (workspace_id, track_id, direction, driver_id, lap_ms, at, crossing_seq) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET lap_ms = excluded.lap_ms, at = excluded.at, crossing_seq = excluded.crossing_seq
      WHERE (excluded.lap_ms, excluded.at, excluded.crossing_seq) < (lap_ms, at, crossing_seq)`),
    recordHistory: q('SELECT * FROM track_record WHERE workspace_id = ? AND track_id = ? AND direction = ? ORDER BY at DESC, crossing_seq DESC LIMIT ?'),
    recordAt: q('SELECT * FROM track_record WHERE workspace_id = ? AND track_id = ? AND direction = ? AND at <= ? ORDER BY at DESC, crossing_seq DESC LIMIT 1'),
    addRecord: q('INSERT INTO track_record (workspace_id, track_id, direction, crossing_seq, driver_id, lap_ms, at, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    deleteRecords: q('DELETE FROM track_record WHERE workspace_id = ? AND track_id = ? AND direction = ?'),
    deleteBests: q('DELETE FROM personal_best WHERE workspace_id = ? AND track_id = ? AND direction = ?'),
    qualifyingLaps: q(`SELECT c.seq, c.driver_id, c.lap_ms, c.at, c.session_id FROM session s JOIN crossing c ON c.session_id = s.id
      WHERE s.workspace_id = ? AND s.track_id = ? AND s.direction = ? AND c.counts = 1 AND c.via != 'tap' AND c.driver_id IS NOT NULL AND c.lap_ms IS NOT NULL
      ORDER BY c.at, c.seq`),
    trackDirections: q('SELECT DISTINCT workspace_id, track_id, direction FROM session WHERE track_id IS NOT NULL'),
    selectCursor: q('SELECT seq FROM feed_cursor WHERE feed = ?'),
    upsertCursor: q('INSERT INTO feed_cursor (feed, seq) VALUES (?, ?) ON CONFLICT (feed) DO UPDATE SET seq = excluded.seq'),
  };
  const purge = ['workspace WHERE id', 'track WHERE workspace_id', 'track_layout WHERE workspace_id', 'driver WHERE workspace_id', 'transponder WHERE workspace_id',
    'decoder WHERE workspace_id', 'passing WHERE workspace_id', 'session WHERE workspace_id', 'crossing WHERE workspace_id',
    'track_record WHERE workspace_id', 'personal_best WHERE workspace_id']
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

  /** Rewrites a track and direction's records and personal bests from its qualifying laps. A deleted track keeps none. */
  function rebuildRecords(ws, trackId, direction) {
    if (!s.selectTrack.get(ws, trackId)) return;
    transaction(() => {
      s.deleteRecords.run(ws, trackId, direction);
      s.deleteBests.run(ws, trackId, direction);
      let record = Infinity;
      const best = new Map();
      for (const r of s.qualifyingLaps.all(ws, trackId, direction)) {
        const lap = { seq: Number(r.seq), driverId: String(r.driver_id), lapMs: Number(r.lap_ms), at: Number(r.at) };
        if (lap.lapMs < record) {
          record = lap.lapMs;
          s.addRecord.run(ws, trackId, direction, lap.seq, lap.driverId, lap.lapMs, lap.at, String(r.session_id));
        }
        if (lap.lapMs < (best.get(lap.driverId)?.lapMs ?? Infinity)) best.set(lap.driverId, lap);
      }
      for (const b of best.values()) s.offerPersonalBest.run(ws, trackId, direction, b.driverId, b.lapMs, b.at, b.seq);
    });
  }
  // Records and bests are filled from the existing laps once; the marker commits with the fill, so a fill cut short runs again.
  if (!s.selectCursor.get('records-filled')) {
    transaction(() => {
      for (const r of s.trackDirections.all()) rebuildRecords(String(r.workspace_id), String(r.track_id), String(r.direction));
      s.upsertCursor.run('records-filled', 1);
    });
  }

  const workspace = (id) => {
    const row = s.selectWorkspace.get(id);
    return row ? workspaceOf(row) : null;
  };
  /** A club is created on first use with its one track, "Track", current and counter-clockwise (named tracks spec §3.2). */
  function ensureWorkspace(id) {
    const found = workspace(id);
    if (found) return found;
    transaction(() => {
      const trackId = randomUUID();
      s.insertWorkspace.run(id, trackId);
      s.addTrack.run(id, trackId, 'Track', nameKey('Track'));
    });
    return workspace(id);
  }
  const track = (ws, id) => {
    const row = s.selectTrack.get(ws, id);
    return row ? trackOf(row) : null;
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
    // The only user names timing keeps are on layout entries (named tracks spec §3.4): they keep their date, not who.
    forgetUser(userId) {
      // A scan of track_layout, not an index: it is keyed by user across clubs, runs once per account deletion, and the column order skips the layout blobs.
      s.forgetLayoutsBy.run(userId);
    },

    workspace,
    ensureWorkspace,
    setWatchToken(workspaceId, token) {
      ensureWorkspace(workspaceId);
      s.setWatch.run(token, workspaceId);
    },
    track,
    /** A club's active or archived tracks, by name, each with its newest layout. */
    tracks: (ws, { archived }) => s.selectTracks.all(ws, archived ? 1 : 0).map(trackOf),
    addTrack(ws, { id, name }) {
      try {
        s.addTrack.run(ws, id, name, nameKey(name));
        return 'added';
      } catch (error) {
        if (nameInUse(error)) return 'name-in-use';
        throw error;
      }
    },
    renameTrack(ws, id, name) {
      try {
        return s.renameTrack.run(name, nameKey(name), ws, id).changes === 1 ? 'renamed' : 'missing';
      } catch (error) {
        if (nameInUse(error)) return 'name-in-use';
        throw error;
      }
    },
    /** Archives a track at `at`, or restores it with null. The current track stays active; a restored one needs its name free. */
    setArchived(ws, id, at) {
      if (!s.selectTrack.get(ws, id)) return 'missing';
      if (at !== null && workspace(ws)?.trackId === id) return 'current';
      try {
        s.setArchived.run(at, ws, id);
        return 'done';
      } catch (error) {
        if (nameInUse(error)) return 'name-in-use';
        throw error;
      }
    },
    /** Deletes an archived track with its layouts, records and bests; its sessions stay and find no track. */
    deleteTrack(ws, id) {
      return transaction(() => {
        const found = track(ws, id);
        if (!found) return 'missing';
        if (found.archivedAt === null) return 'not-archived';
        s.deleteTrackLayouts.run(ws, id);
        s.deleteTrackRecords.run(ws, id);
        s.deleteTrackBests.run(ws, id);
        s.deleteTrack.run(ws, id);
        return 'deleted';
      });
    },
    setCurrentTrack(ws, id, direction) {
      const found = track(ws, id);
      if (!found) return 'missing';
      if (found.archivedAt !== null) return 'archived';
      s.setTrackOf.run(id, direction, ws);
      return 'done';
    },
    /**
     * Adds a layout entry, unless the newest one is this snapshot of the same planner track. Entries are keyed by time,
     * so one attached within the same millisecond as the newest goes a millisecond after it.
     */
    attachLayout(ws, trackId, { plannerId, shape, snapshotKey, layout }, { userId, name, at }) {
      return transaction(() => {
        const newest = s.layoutAt.get(ws, trackId, Number.MAX_SAFE_INTEGER);
        if (newest && String(newest.planner_id) === plannerId && String(newest.snapshot_key) === snapshotKey) return 'same';
        const attachedAt = newest ? Math.max(at, Number(newest.attached_at) + 1) : at;
        s.addLayout.run(ws, trackId, attachedAt, plannerId, shape, snapshotKey, layout, userId, name);
        return 'added';
      });
    },
    /** A track's layouts, newest first. */
    layouts: (ws, trackId) => s.layouts.all(ws, trackId).map(layoutOf),
    /** The layout a lap at `at` was driven on: the newest entry attached up to then. */
    layoutAt(ws, trackId, at) {
      const r = s.layoutAt.get(ws, trackId, at);
      return r ? layoutOf(r) : null;
    },
    sessionCount: (ws, trackId) => Number(s.sessionCount.get(ws, trackId)?.n ?? 0),
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
    /**
     * Deletes passings received before `before` that no crossing was made from; returns how many. Each call judges only what
     * the last one did not (a watermark in feed_cursor); the first starts at `since`, not at the oldest passing.
     * @param {number} before @param {number} since
     */
    deleteLoosePassings: (before, since) => transaction(() => {
      const from = Number(s.selectCursor.get('loose-passings')?.seq ?? since);
      const deleted = Number(s.deleteLoosePassings.run(from, before).changes);
      if (before > from) s.upsertCursor.run('loose-passings', before);
      return deleted;
    }),
    countPassings: (workspaceId) => num(s.countPassings.get(workspaceId)?.n),
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
    /** The one session in countdown, running or finishing, of any kind. */
    runningSession(ws) {
      const r = s.runningSession.get(ws);
      return r ? sessionOf(r) : null;
    },
    /** The latest session of any kind, if it has ended (done or aborted); null while one is open. */
    lastEnded(ws) {
      const r = s.lastSession.get(ws);
      const session = r ? sessionOf(r) : null;
      return session && (session.state === 'done' || session.state === 'aborted') ? session : null;
    },
    activeAll: () => s.activeAll.all().map(sessionOf),
    /** Sessions newest first; `before`, the last row of a page, pages on to older ones. @param {string} ws @param {number} limit @param {{ createdAt: number, id: string } | null} [before] */
    listSessions: (ws, limit, before = null) => (before === null ? s.listSessions.all(ws, limit) : s.listSessionsBefore.all(ws, before.createdAt, before.id, limit)).map(sessionOf),
    /** How many drivers a session counted, and its best lap. */
    sessionSummary(sessionId) {
      const best = s.sessionBest.get(sessionId);
      return {
        drivers: Number(s.sessionDrivers.get(sessionId)?.n ?? 0),
        best: best ? { seq: Number(best.seq), driverId: String(best.driver_id), lapMs: Number(best.lap_ms) } : null,
      };
    },

    /** The personal bests on a track and direction of the drivers asked for, fastest first. */
    personalBests: (ws, trackId, direction, driverIds) => s.personalBests.all(ws, trackId, direction, JSON.stringify(driverIds))
      .map(bestOf),
    /** Each driver's best on a track and direction, fastest first, the first `limit`. */
    fastest: (ws, trackId, direction, limit) => s.fastest.all(ws, trackId, direction, limit)
      .map(bestOf),
    /** Whether a club has ever had a crossing. */
    driven: (ws) => s.driven.get(ws) !== undefined,
    /** Keeps the faster lap as the driver's best, the earlier one on a tie. */
    offerPersonalBest(ws, trackId, direction, { driverId, lapMs, at, seq }) {
      s.offerPersonalBest.run(ws, trackId, direction, driverId, lapMs, at, seq);
    },
    /** The laps that set a record on a track and direction, newest first. */
    recordHistory: (ws, trackId, direction, { limit = -1 } = {}) => s.recordHistory.all(ws, trackId, direction, limit).map(recordOf),
    currentRecord(ws, trackId, direction) {
      const r = s.recordHistory.get(ws, trackId, direction, 1);
      return r ? recordOf(r) : null;
    },
    /** The record as it stood when a lap at `at` was driven: the newest row up to `at`. */
    recordAt(ws, trackId, direction, at) {
      const r = s.recordAt.get(ws, trackId, direction, at);
      return r ? recordOf(r) : null;
    },
    addRecord({ workspaceId, trackId, direction, seq, driverId, lapMs, at, sessionId }) {
      s.addRecord.run(workspaceId, trackId, direction, seq, driverId, lapMs, at, sessionId);
    },
    rebuildRecords,

    close() {
      db.close();
    },
  };
}
