// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Passings become crossings (spec §4–§6). The engine stores each passing
// once, computes its lap from the transponder's previous reference passing,
// puts it in the running session, and publishes what changed. Session state lives in memory as a cache over the stored
// crossings, so a restart only replays them.
import { randomUUID } from 'node:crypto';
import { MAX_LAP_MS, MIN_LAP_MS, applyCrossing, emptyState, isComplete, nextLap, standings } from '@tinylap/timing';

export const PRACTICE_IDLE_MS = 60 * 60_000;
/** Offsets older than this don't count for mapping decoder time (spec §6). */
const OFFSET_WINDOW_MS = 60_000;
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
    states.delete(session.id);
    publishSession(ended);
    if (session.kind !== 'practice') hub.publish(session.workspaceId, 'results', { sessionId: session.id, session: publicSession(ended), standings: standingsOf(ended) });
    return ended;
  }
  /** Records every passing's receive offset first, so a late batch maps by its newest passing. */
  function noteOffsets(decoder, boot, passings, receivedAt) {
    const key = `${decoder} ${boot}`;
    const list = (offsets.get(key) ?? []).filter((o) => o.receivedAt >= receivedAt - OFFSET_WINDOW_MS);
    for (const p of passings) list.push({ receivedAt, offset: receivedAt - p.t });
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
    hub.publish(workspaceId, 'crossing', memberCrossing(row), watcherCrossing(row));
    if (counts) publishStandings(session);
    if (session.state === 'finishing' && isComplete(rulesOf(session), stateOf(session), now(), maxLap)) endSession(session, now());
    return row;
  }

  /** A passing with no session running makes no crossing; members are told (spec §3.2). */
  function noteIdle(workspaceId, idle) {
    idles.set(workspaceId, idle);
    hub.publish(workspaceId, 'idle', idle, null);
  }

  /** Stores a batch (spec §5). Repeating it is safe. */
  function ingest({ workspaceId, decoder, via, batch }) {
    const receivedAt = now();
    const sorted = [...batch.passings].sort((a, b) => a.t - b.t);
    noteOffsets(decoder, batch.boot, sorted, receivedAt);
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
      hub.publish(workspaceId, 'idle', null, null);
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
    publishStandings(session);
  }

  function assign(workspaceId, code, driverId) {
    store.transaction(() => {
      store.assignTransponder(workspaceId, code, driverId, now());
      if (driverId !== null) for (const id of store.assignCrossings(workspaceId, code, driverId)) rebuild(id);
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
    const track = ws.trackId ? store.track(workspaceId, ws.trackId) : null;
    const recent = session ? store.recentCrossings(session.id, 30) : [];
    const ended = session ? null : store.lastEnded(workspaceId);
    return {
      now: now(),
      track: track && { id: track.id, name: track.name },
      direction: ws.direction,
      session: session && publicSession(session),
      standings: session ? standingsOf(session) : [],
      crossings: watcher ? recent.map(watcherCrossing).filter(Boolean) : recent.map(memberCrossing),
      drivers: store.drivers(workspaceId),
      bests: track ? store.personalBests(workspaceId, track.id, ws.direction) : [],
      lastResults: ended && { session: publicSession(ended), standings: standingsOf(ended) },
      ...(watcher ? {} : { unknown: unknownOf(workspaceId), idle: idles.get(workspaceId) ?? null }),
    };
  }

  function sessionDetail(workspaceId, sessionId) {
    const session = store.session(sessionId);
    if (!session || session.workspaceId !== workspaceId) return null;
    return { session: publicSession(session), standings: standingsOf(session), crossings: store.crossings(sessionId).map(memberCrossing) };
  }

  return { ingest, tap, start, end, abort, tick, assign, publishUnknown, endPractice, snapshot, sessionDetail };
}
