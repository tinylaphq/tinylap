// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Passings become crossings (spec §4–§6). The engine stores each passing
// once, computes its lap from the transponder's previous reference passing,
// puts it in the running session, and publishes what changed. Session state
// lives in memory as a cache over the stored crossings, so a restart only
// replays them.
import { randomUUID } from 'node:crypto';
import { MAX_LAP_MS, MIN_LAP_MS, applyCrossing, emptyState, isComplete, nextLap, standings } from '@tinylap/timing';

export const PRACTICE_IDLE_MS = 60 * 60_000;
/** Passings outside any session are deleted after this long. */
export const LOOSE_PASSING_MS = 24 * 60 * 60_000;
const LOOSE_SWEEP_MS = 10 * 60_000;
/** A new record shows this long from its arrival (records spec §4.3). */
export const RECORD_SHOW_MS = 30_000;
/** A record lap driven longer than this before it arrived falls silently. */
export const RECORD_FRESH_MS = 60_000;
/** Offsets older than this don't count for mapping decoder time (spec §6). */
const OFFSET_WINDOW_MS = 60_000;
/** How many drivers the idle board's "Fastest on this track" lists. */
const FASTEST = 10;
/** A Wi-Fi decoder that has been silent this long is offline (decoder Wi-Fi spec §6). */
export const OFFLINE_AFTER_MS = 25_000;
/** After this long without a batch a decoder counts as switched off, and its banner goes. */
export const EXPECTED_FOR_MS = 30 * 60_000;
const ACTIVE = new Set(['countdown', 'running', 'finishing']);

/** What members see of a crossing. */
export const memberCrossing = (c) => ({
  seq: c.seq, sessionId: c.sessionId, driverId: c.driverId, transponder: c.transponder,
  at: c.at, lapMs: c.lapMs, counts: c.counts, via: c.via, flag: c.flag,
});
/** What watchers see: no transponder codes, nothing of unassigned cars. */
export const watcherCrossing = (c) => (c.driverId === null ? null : {
  seq: c.seq, sessionId: c.sessionId, driverId: c.driverId, at: c.at, lapMs: c.lapMs, counts: c.counts, via: c.via,
});
/** A session as clients see it: everything but its workspace. */
export function publicSession(session) {
  const out = { ...session };
  delete out.workspaceId;
  return out;
}

/**
 * @param {{ store: ReturnType<typeof import('./store.js').openStore>, hub: ReturnType<typeof import('./live.js').createHub>,
 *   now?: () => number, minLap?: number, maxLap?: number, practiceIdle?: number }} options
 */
export function createEngine({ store, hub, now = Date.now, minLap = MIN_LAP_MS, maxLap = MAX_LAP_MS, practiceIdle = PRACTICE_IDLE_MS }) {
  /** `${decoder} ${boot}` → recent receive offsets. */
  const offsets = new Map();
  /** Session id → state, for open sessions. */
  const states = new Map();
  /** Workspace id → the latest passing that fell outside any session. */
  const idles = new Map();
  /** Workspace id → the record that fell live, when it arrived, and its track and direction. */
  const recordNews = new Map();
  /** Workspace id → the last ended session's id and standings, so an idle board doesn't replay it on every render. */
  const endedStandings = new Map();
  let lastSweep = -Infinity;

  const rulesOf = (s) => ({ kind: s.kind, roster: s.roster, opensAt: s.opensAt, closesAt: s.closesAt });
  function replay(session) {
    const state = emptyState();
    const rules = rulesOf(session);
    for (const c of store.crossings(session.id)) applyCrossing(rules, state, c);
    return state;
  }
  function stateOf(session) {
    let state = states.get(session.id);
    if (!state) {
      state = replay(session);
      states.set(session.id, state);
    }
    return state;
  }
  const standingsOf = (session) => standings(rulesOf(session), ACTIVE.has(session.state) ? stateOf(session) : replay(session));
  /** The standings of a workspace's last ended session, replayed once and then kept. */
  function lastStandingsOf(ended) {
    const cached = endedStandings.get(ended.workspaceId);
    if (cached?.sessionId === ended.id) return cached.rows;
    const rows = standingsOf(ended);
    endedStandings.set(ended.workspaceId, { sessionId: ended.id, rows });
    return rows;
  }
  const unknownOf = (workspaceId) => store.transponders(workspaceId).filter((t) => t.driverId === null).map((t) => t.code);
  const publishUnknown = (workspaceId) => hub.publish(workspaceId, 'setup', { unknown: unknownOf(workspaceId) }, null);

  const publishSession = (session) => hub.publish(session.workspaceId, 'session', { ...publicSession(session), now: now() });
  const publishStandings = (session) => hub.publish(session.workspaceId, 'standings', { sessionId: session.id, standings: standingsOf(session) });

  function createSession(workspaceId, fields) {
    const ws = store.ensureWorkspace(workspaceId);
    const session = { id: randomUUID(), workspaceId, trackId: ws.trackId, direction: ws.direction, createdAt: now(), endedAt: null, roster: null, durationMs: null, ...fields };
    store.addSession(session);
    publishSession(session);
    return session;
  }
  function endSession(session, endedAt, state = 'done') {
    store.updateSession(session.id, { state, endedAt });
    const ended = { ...session, state, endedAt };
    // Its in-memory state is its final table: no replay of its laps.
    const rows = standings(rulesOf(ended), stateOf(session));
    endedStandings.set(session.workspaceId, { sessionId: session.id, rows });
    states.delete(session.id);
    publishSession(ended);
    if (session.kind !== 'practice') hub.publish(session.workspaceId, 'results', { sessionId: session.id, session: publicSession(ended), standings: rows });
    return ended;
  }
  /** Records every passing's receive offset, and the batch's own `now` when it has one, first, so a late batch maps by its newest passing. */
  function noteOffsets(decoder, boot, passings, receivedAt, now) {
    const key = `${decoder} ${boot}`;
    const list = (offsets.get(key) ?? []).filter((o) => o.receivedAt >= receivedAt - OFFSET_WINDOW_MS);
    for (const p of passings) list.push({ receivedAt, offset: receivedAt - p.t });
    if (now !== undefined) list.push({ receivedAt, offset: receivedAt - now });
    offsets.set(key, list);
  }
  /** Server time of decoder time `t`: the smallest offset seen in the last minute. */
  function mapped(decoder, boot, t) {
    let best = Infinity;
    for (const o of offsets.get(`${decoder} ${boot}`)) best = Math.min(best, o.offset);
    return t + best;
  }

  function cross(workspaceId, session, passing, { at, driverId, via }) {
    const reference = store.lastReference(passing.decoder, passing.transponder);
    const step = nextLap(reference, { boot: passing.boot, t: passing.t }, { minLap, maxLap });
    const lapMs = step.kind === 'lap' ? step.ms : null;
    const counts = applyCrossing(rulesOf(session), stateOf(session), { driverId, at, lapMs });
    const row = {
      workspaceId, sessionId: session.id, ...passing, driverId, at, lapMs, counts, via,
      ref: step.kind === 'start' || step.kind === 'lap',
      flag: step.kind === 'backwards' || step.kind === 'double' ? step.kind : null,
    };
    row.seq = store.addCrossing(row);
    if (counts && via !== 'tap' && driverId !== null && lapMs !== null && session.trackId !== null) noteLap(session, row);
    hub.publish(workspaceId, 'crossing', memberCrossing(row), watcherCrossing(row));
    if (counts) publishStandings(session);
    if (session.state === 'finishing' && isComplete(rulesOf(session), stateOf(session), now(), maxLap)) endSession(session, now());
    return row;
  }

  /** A qualifying lap updates its driver's best and, if faster than the record when it was driven, the record (records spec §4). */
  function noteLap({ workspaceId, trackId, direction }, { seq, driverId, lapMs, at, sessionId }) {
    store.offerPersonalBest(workspaceId, trackId, direction, { driverId, lapMs, at, seq });
    const before = store.recordAt(workspaceId, trackId, direction, at);
    if (before && lapMs >= before.lapMs) return;
    const latest = store.currentRecord(workspaceId, trackId, direction);
    if (latest && at < latest.at) {
      store.rebuildRecords(workspaceId, trackId, direction);
      return;
    }
    store.addRecord({ workspaceId, trackId, direction, seq, driverId, lapMs, at, sessionId });
    if (!before || now() - at >= RECORD_FRESH_MS) return;
    const recordNew = { seq, driverId, lapMs, at, beat: { driverId: before.driverId, lapMs: before.lapMs, at: before.at } };
    recordNews.set(workspaceId, { recordNew, since: now(), trackId, direction });
    hub.publish(workspaceId, 'record', { recordNew });
  }
  /** Ends the live record state, and tells every board. */
  function clearRecord(workspaceId) {
    if (!recordNews.delete(workspaceId)) return;
    hub.publish(workspaceId, 'record', { recordNew: null });
  }
  /** The live record while it shows. */
  function recordNewOf(workspaceId, t = now()) {
    const shown = recordNews.get(workspaceId);
    return shown && t - shown.since < RECORD_SHOW_MS ? shown.recordNew : null;
  }

  /** A passing with no session running makes no crossing; members are told (spec §3.2). */
  function noteIdle(workspaceId, idle) {
    idles.set(workspaceId, idle);
    hub.publish(workspaceId, 'idle', { idle }, null);
  }

  /** Decoders that report over Wi-Fi and have not said they are going quiet, by id. */
  const expected = new Map();
  /** Each workspace's offline list and header as last published, to publish only changes. */
  const offlineShown = new Map();
  /**
   * What each decoder's batches say since the server started: the last over Wi-Fi (and whether it said quiet), the last
   * over a cable, and whether the bridge said that cable closed since.
   */
  const heard = new Map();

  function offlineOf(workspaceId, t = now()) {
    const list = [];
    for (const [id, e] of expected) {
      const decoder = store.decoder(id);
      if (e.workspaceId === workspaceId && decoder?.workspaceId === workspaceId && t - e.lastAt >= OFFLINE_AFTER_MS && t - e.lastAt < EXPECTED_FOR_MS) {
        list.push({ id, name: decoder.name });
      }
    }
    return list;
  }

  /** A decoder's connections as the Bridge page and the bridge see them (connections spec §3). */
  function connectionsOf(workspaceId, t = now()) {
    const offline = new Set(offlineOf(workspaceId, t).map((d) => d.id));
    return store.decoders(workspaceId).map((d) => {
      const h = heard.get(d.id);
      const netAt = h?.netAt ?? null;
      const state = netAt !== null && t - netAt < OFFLINE_AFTER_MS ? 'reporting' : h?.quiet ? 'idle' : offline.has(d.id) ? 'offline' : 'unknown';
      return {
        ...d,
        cable: { state: onCable(h, t) ? 'other' : 'none' },
        wifi: { state, at: netAt },
      };
    });
  }

  /** Whether a bridge's cable is on the decoder: a batch over one within 25 s, and that cable not closed since. */
  const onCable = (h, t) => h?.cableAt != null && !h.cableClosed && t - h.cableAt < OFFLINE_AFTER_MS;

  /** One state per decoder heard in the last 30 minutes, for the board's header (connections spec §6). */
  function headerOf(workspaceId, t = now()) {
    const offline = new Set(offlineOf(workspaceId, t).map((d) => d.id));
    const list = [];
    for (const [id, h] of heard) {
      const decoder = store.decoder(id);
      if (h.workspaceId !== workspaceId || decoder?.workspaceId !== workspaceId) continue;
      const last = Math.max(h.netAt ?? 0, h.cableAt ?? 0);
      if (t - last >= EXPECTED_FOR_MS) continue;
      const live = (h.netAt !== null && t - h.netAt < OFFLINE_AFTER_MS) || onCable(h, t);
      const state = live ? 'reporting' : h.quiet ? 'idle' : offline.has(id) || (h.lastVia === 'serial' && h.cableLogs) ? 'offline' : null;
      if (state) list.push({ id, name: decoder.name, state });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  }

  /** Stores a batch (spec §5). Repeating it is safe. */
  function ingest({ workspaceId, decoder, via, batch }) {
    const receivedAt = now();
    const h = heard.get(decoder) ?? { workspaceId, netAt: null, quiet: false, cableAt: null, cableClosed: false, lastVia: null, cableLogs: false };
    h.workspaceId = workspaceId;
    if (via === 'net') {
      h.netAt = receivedAt;
      h.quiet = batch.quiet === true;
    } else if (via === 'serial') {
      h.cableAt = receivedAt;
      h.cableClosed = false;
      // A TinyLap decoder's cable batches carry its log lines; a plain ZRound decoder's carry passings only.
      h.cableLogs = batch.logs?.length > 0;
    }
    if (via === 'net' || via === 'serial') h.lastVia = via;
    heard.set(decoder, h);
    if (batch.quiet) expected.delete(decoder);
    else if (via === 'net' || expected.has(decoder)) expected.set(decoder, { workspaceId, lastAt: receivedAt });
    const sorted = [...batch.passings].sort((a, b) => a.t - b.t);
    noteOffsets(decoder, batch.boot, sorted, receivedAt, batch.now);
    return store.transaction(() => {
      let stored = 0;
      let seen = false;
      for (const p of sorted) {
        const passing = { decoder, boot: batch.boot, transponder: p.transponder, t: p.t };
        if (!store.insertPassing({ ...passing, receivedAt, via, workspaceId })) continue;
        stored += 1;
        const { driverId, created } = store.seeTransponder(workspaceId, p.transponder, receivedAt);
        seen ||= created;
        const at = mapped(decoder, batch.boot, p.t);
        const session = store.runningSession(workspaceId);
        if (session) cross(workspaceId, session, passing, { at, driverId, via });
        else noteIdle(workspaceId, { transponder: p.transponder, driverId, at });
      }
      store.touchDecoder(decoder, receivedAt);
      if (seen) publishUnknown(workspaceId);
      return { stored, duplicates: sorted.length - stored, through: store.through(decoder, batch.boot) };
    });
  }

  /**
   * The bridge says its cable to the decoder closed (unplugged, or the tab let go of it): the cable is gone now, not
   * 25 s after its last batch (connections spec §3, §6). Boards hear it at once.
   */
  function cableClosed(workspaceId, decoder) {
    const h = heard.get(decoder);
    if (!h || h.workspaceId !== workspaceId || h.cableClosed) return;
    h.cableClosed = true;
    publishDecoders(workspaceId, now());
  }

  /** Publishes a workspace's offline list and header when they changed since last published. */
  function publishDecoders(workspaceId, t) {
    const offline = offlineOf(workspaceId, t);
    const key = JSON.stringify({ offline, header: headerOf(workspaceId, t) });
    if (key === (offlineShown.get(workspaceId) ?? '{"offline":[],"header":[]}')) return;
    offlineShown.set(workspaceId, key);
    hub.publish(workspaceId, 'decoders', { offline, decoders: headerOf(workspaceId, t) });
  }

  /** A passing by hand (spec §4): a virtual decoder per workspace, a boot per session, server time. */
  function tap(workspaceId, driverId) {
    const t = now();
    return store.transaction(() => {
      const session = store.runningSession(workspaceId);
      if (!session) return { error: 'no-session' };
      const passing = { decoder: `tap:${workspaceId}`, boot: session.id, transponder: driverId, t };
      if (!store.insertPassing({ ...passing, receivedAt: t, via: 'tap', workspaceId })) return null;
      return cross(workspaceId, session, passing, { at: t, driverId, via: 'tap' });
    });
  }

  function setState(session, state) {
    store.updateSession(session.id, { state });
    const next = { ...session, state };
    publishSession(next);
    return next;
  }

  /** The time a practice ends at: its last passing, or now without one. */
  const practiceEnd = (session) => store.lastCrossingAt(session.id) ?? now();

  /** Starts a session (spec §3.1); one at a time per workspace, and `replace` ends the running one first. */
  function start(workspaceId, { kind, roster, durationMs, countdownMs = 0, replace = false }) {
    return store.transaction(() => {
      const running = store.runningSession(workspaceId);
      if (running && !replace) return { error: 'conflict', running };
      const t = now();
      if (running) {
        if (running.kind === 'practice') endSession(running, practiceEnd(running));
        else endSession(running, t, 'aborted');
      }
      idles.delete(workspaceId);
      hub.publish(workspaceId, 'idle', { idle: null }, null);
      if (kind === 'practice') return { session: createSession(workspaceId, { kind, state: 'running', opensAt: t, closesAt: null }) };
      const opensAt = kind === 'race' ? t + countdownMs : t;
      const state = kind === 'race' && countdownMs > 0 ? 'countdown' : 'running';
      return { session: createSession(workspaceId, { kind, roster, durationMs, state, opensAt, closesAt: opensAt + durationMs }) };
    });
  }

  /** A member ends a running practice (spec §3.3). */
  function end(workspaceId, sessionId) {
    const session = store.session(sessionId);
    if (!session || session.workspaceId !== workspaceId || session.kind !== 'practice' || session.state !== 'running') return null;
    return endSession(session, practiceEnd(session));
  }

  function abort(workspaceId, sessionId) {
    const session = store.session(sessionId);
    if (!session || session.workspaceId !== workspaceId || session.kind === 'practice' || !ACTIVE.has(session.state)) return null;
    return endSession(session, now(), 'aborted');
  }

  /** Moves sessions along their states as time passes. */
  function tick() {
    const t = now();
    if (t - lastSweep >= LOOSE_SWEEP_MS) {
      lastSweep = t;
      // The first sweep looks a day back from the cutoff, not at every passing ever kept.
      store.deleteLoosePassings(t - LOOSE_PASSING_MS, t - 2 * LOOSE_PASSING_MS);
    }
    for (const [id, e] of expected) {
      // An unpaired decoder is no longer expected.
      if (t - e.lastAt >= EXPECTED_FOR_MS || store.decoder(id)?.workspaceId !== e.workspaceId) expected.delete(id);
    }
    for (const [id, h] of heard) {
      if (store.decoder(id)?.workspaceId !== h.workspaceId) heard.delete(id);
    }
    for (const workspaceId of new Set([...offlineShown.keys(), ...[...expected.values()].map((e) => e.workspaceId), ...[...heard.values()].map((h) => h.workspaceId)])) {
      publishDecoders(workspaceId, t);
    }
    for (const workspaceId of recordNews.keys()) {
      if (!recordNewOf(workspaceId, t)) clearRecord(workspaceId);
    }
    for (let session of store.activeAll()) {
      if (session.kind === 'practice') {
        const last = store.lastCrossingAt(session.id) ?? session.opensAt;
        if (t - last >= practiceIdle) endSession(session, last);
        continue;
      }
      if (session.state === 'countdown' && t >= session.opensAt) session = setState(session, 'running');
      if (session.state === 'running' && t >= session.closesAt) session = setState(session, 'finishing');
      if (session.state === 'finishing' && isComplete(rulesOf(session), stateOf(session), t, maxLap)) endSession(session, t);
    }
  }

  /** Recounts a session's crossings from scratch, after drivers changed. */
  function rebuild(sessionId) {
    const session = store.session(sessionId);
    const rules = rulesOf(session);
    const state = emptyState();
    for (const c of store.crossings(sessionId)) {
      const counts = applyCrossing(rules, state, c);
      if (counts !== c.counts) store.setCrossingCounts(c.seq, counts);
    }
    if (ACTIVE.has(session.state)) states.set(sessionId, state);
    else states.delete(sessionId);
    if (endedStandings.get(session.workspaceId)?.sessionId === sessionId) endedStandings.delete(session.workspaceId);
    publishStandings(session);
  }

  function assign(workspaceId, code, driverId) {
    store.transaction(() => {
      store.assignTransponder(workspaceId, code, driverId, now());
      if (driverId === null) return;
      const tracks = new Map();
      for (const id of store.assignCrossings(workspaceId, code, driverId)) {
        rebuild(id);
        const { trackId, direction } = store.session(id);
        // A deleted track's laps stay in its sessions but set no records (named tracks spec §3.5).
        if (trackId !== null && store.track(workspaceId, trackId)) tracks.set(`${trackId} ${direction}`, { trackId, direction });
      }
      for (const { trackId, direction } of tracks.values()) store.rebuildRecords(workspaceId, trackId, direction);
    });
    publishUnknown(workspaceId);
  }

  /** A new track or direction ends a running practice (spec §3.1). */
  function endPractice(workspaceId) {
    const running = store.runningSession(workspaceId);
    if (running?.kind === 'practice') endSession(running, practiceEnd(running));
  }

  function snapshot(workspaceId, { watcher = false } = {}) {
    const ws = store.ensureWorkspace(workspaceId);
    const session = store.runningSession(workspaceId);
    // A club always has a current track (named tracks spec §3.1).
    const track = store.track(workspaceId, ws.trackId);
    const recent = session ? store.recentCrossings(session.id, 30) : [];
    const ended = session ? null : store.lastEnded(workspaceId);
    const rows = session ? standingsOf(session) : [];
    const endedRows = ended ? lastStandingsOf(ended) : [];
    // The record and the one it beat, for the idle board's record (named tracks spec §4).
    const [record, beaten] = store.recordHistory(workspaceId, track.id, ws.direction, { limit: 2 });
    // A race keeps its track when the workspace's changes: its record shows only under its own header.
    const shown = recordNews.get(workspaceId);
    const recordNew = shown?.trackId === ws.trackId && shown?.direction === ws.direction ? recordNewOf(workspaceId) : null;
    return {
      now: now(),
      track: { id: track.id, name: track.name },
      direction: ws.direction,
      session: session && publicSession(session),
      standings: rows,
      crossings: watcher ? recent.map(watcherCrossing).filter(Boolean) : recent.map(memberCrossing),
      drivers: store.drivers(workspaceId),
      bests: store.personalBests(workspaceId, track.id, ws.direction, [...rows, ...endedRows].map((r) => r.driverId)),
      record: record ? { driverId: record.driverId, lapMs: record.lapMs, at: record.at, beat: beaten ? { driverId: beaten.driverId, lapMs: beaten.lapMs, at: beaten.at } : null } : null,
      // Each driver's best here, for the board when nobody is racing; through personal_best_fastest, ten rows at most.
      fastest: session ? [] : store.fastest(workspaceId, track.id, ws.direction, FASTEST),
      recordNew,
      offline: offlineOf(workspaceId),
      decoders: headerOf(workspaceId),
      lastResults: ended && { session: publicSession(ended), standings: endedRows },
      ...(watcher ? {} : { unknown: unknownOf(workspaceId), idle: idleOf(workspaceId), driven: session !== null || store.driven(workspaceId) }),
    };
  }

  /** The latest passing that fell outside any session, for members. */
  const idleOf = (workspaceId) => idles.get(workspaceId) ?? null;

  /** How many drivers a running session has counted a lap for, from its state in memory. */
  const driverCount = (session) => Object.values(stateOf(session).drivers).filter((d) => d.laps > 0).length;

  /** The personal bests on the workspace's track and direction of the drivers its board shows. */
  function bestsOf(workspaceId) {
    const ws = store.ensureWorkspace(workspaceId);
    if (!ws.trackId) return [];
    const session = store.runningSession(workspaceId);
    const ended = session ? null : store.lastEnded(workspaceId);
    const rows = session ? standingsOf(session) : ended ? lastStandingsOf(ended) : [];
    return store.personalBests(workspaceId, ws.trackId, ws.direction, rows.map((r) => r.driverId));
  }

  function sessionDetail(workspaceId, sessionId) {
    const session = store.session(sessionId);
    if (!session || session.workspaceId !== workspaceId) return null;
    return { session: publicSession(session), standings: standingsOf(session), crossings: store.crossings(sessionId).map(memberCrossing) };
  }

  return { ingest, cableClosed, tap, start, end, abort, tick, assign, publishUnknown, endPractice, snapshot, connectionsOf, headerOf, idleOf, driverCount, bestsOf, sessionDetail };
}
