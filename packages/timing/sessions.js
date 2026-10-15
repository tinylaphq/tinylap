// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The rules of practice, qualifying and races (spec §6), over crossings whose
// times the server has already mapped to its own clock. Lap times come from
// the decoder; only the window edges use server time.

import { MAX_LAP_MS } from './laps.js';

/** @import { Crossing, DriverState, SessionRules, SessionState, Standing } from './types.js' */

export const SESSION_KINDS = /** @type {const} */ (['practice', 'qualifying', 'race']);

/** @returns {SessionState} */
export const emptyState = () => ({ drivers: {} });

/** @returns {DriverState} */
const fresh = () => ({ started: false, startAt: null, laps: 0, totalMs: 0, bestMs: null, bestAt: null, lastAt: null, finished: false });

/** @param {DriverState} d @param {number} ms @param {number} at */
function addLap(d, ms, at) {
  d.laps += 1;
  d.totalMs += ms;
  if (d.bestMs === null || ms < d.bestMs) {
    d.bestMs = ms;
    d.bestAt = at;
  }
}

/**
 * Applies one crossing to a session's state. Returns whether it counts as a
 * lap of this session.
 * @param {SessionRules} rules @param {SessionState} state @param {Crossing} crossing
 */
export function applyCrossing(rules, state, { driverId, at, lapMs }) {
  if (driverId === null) return false;
  if (rules.roster && !rules.roster.includes(driverId)) return false;
  const d = (state.drivers[driverId] ??= fresh());
  d.lastAt = at;
  if (rules.kind === 'practice') {
    if (lapMs === null) return false;
    addLap(d, lapMs, at);
    return true;
  }
  if (rules.opensAt === null || rules.closesAt === null) return false;
  if (rules.kind === 'qualifying') {
    if (lapMs === null) return false;
    const began = at - lapMs;
    if (began < rules.opensAt || began >= rules.closesAt) return false;
    addLap(d, lapMs, at);
    return true;
  }
  if (!d.started) {
    if (at < rules.opensAt) return false;
    d.started = true;
    d.startAt = at;
    return false;
  }
  if (d.finished || lapMs === null) return false;
  addLap(d, lapMs, at);
  if (at >= rules.closesAt) d.finished = true;
  return true;
}

const INF = Number.POSITIVE_INFINITY;
/** @param {Standing} a @param {Standing} b */
const byBest = (a, b) => (a.bestMs ?? INF) - (b.bestMs ?? INF) || (a.bestAt ?? INF) - (b.bestAt ?? INF) || a.driverId.localeCompare(b.driverId);
/** @param {Standing} a @param {Standing} b */
const byRace = (a, b) => b.laps - a.laps || (a.elapsedMs ?? INF) - (b.elapsedMs ?? INF) || a.driverId.localeCompare(b.driverId);

/** The standings, positions from 1. @param {SessionRules} rules @param {SessionState} state @returns {Standing[]} */
export function standings(rules, state) {
  const ids = rules.roster ?? Object.keys(state.drivers);
  /** @type {Standing[]} */
  const rows = [];
  for (const driverId of ids) {
    const d = state.drivers[driverId] ?? fresh();
    if (rules.kind === 'practice' && d.laps === 0) continue;
    const elapsedMs = rules.kind === 'race' && d.startAt !== null && rules.opensAt !== null ? d.startAt - rules.opensAt + d.totalMs : null;
    rows.push({ driverId, position: 0, laps: d.laps, bestMs: d.bestMs, bestAt: d.bestAt, totalMs: d.totalMs, elapsedMs, finished: d.finished });
  }
  rows.sort(rules.kind === 'race' ? byRace : byBest);
  rows.forEach((row, i) => {
    row.position = i + 1;
  });
  return rows;
}

/**
 * Whether a qualifying or race past its close is over: every roster driver
 * finished (race) or crossed after the close (qualifying), or a whole
 * `maxLap` has passed since the close. Practice never completes.
 * @param {SessionRules} rules @param {SessionState} state @param {number} now @param {number} [maxLap]
 */
export function isComplete(rules, state, now, maxLap = MAX_LAP_MS) {
  if (rules.kind === 'practice' || rules.closesAt === null) return false;
  if (now >= rules.closesAt + maxLap) return true;
  const closesAt = rules.closesAt;
  const roster = rules.roster ?? [];
  if (rules.kind === 'race') return roster.every((id) => state.drivers[id]?.finished === true);
  return roster.every((id) => (state.drivers[id]?.lastAt ?? -INF) >= closesAt);
}
