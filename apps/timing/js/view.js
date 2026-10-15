// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's model, fed by the live stream (spec §7). Pure, so it is
// tested in Node. Clocks run on server time: the snapshot and every session
// event carry the server's `now`, and `skew` is how far the device is off.

const KEEP = 30;

export const createView = () => ({
  skew: 0, session: null, standings: [], crossings: [], drivers: new Map(), bests: new Map(),
  track: null, direction: 'ccw', unknown: [], results: null,
});

const byId = (drivers) => new Map(drivers.map((d) => [d.id, d]));
const bestsOf = (bests) => new Map(bests.map((b) => [b.driverId, b.bestMs]));

/** Applies one live event. Returns the view. */
export function applyEvent(view, type, data, clientNow = Date.now()) {
  switch (type) {
    case 'snapshot':
      Object.assign(view, {
        skew: data.now - clientNow, session: data.session, standings: data.standings, crossings: data.crossings,
        drivers: byId(data.drivers), bests: bestsOf(data.bests), track: data.track, direction: data.direction,
        unknown: data.unknown ?? [], results: null,
      });
      break;
    case 'session': {
      // `now` is stamped at publish and replayed after a reconnect: only a snapshot sets the skew.
      const session = { ...data };
      delete session.now;
      if (view.session?.id !== session.id) {
        view.standings = [];
        view.crossings = [];
      }
      view.session = session;
      break;
    }
    case 'crossing': {
      if (data.sessionId !== view.session?.id) break;
      view.crossings = [data, ...view.crossings].slice(0, KEEP);
      const best = view.bests.get(data.driverId);
      if (data.counts && data.via !== 'tap' && data.driverId && data.lapMs !== null && (best === undefined || data.lapMs < best)) {
        view.bests.set(data.driverId, data.lapMs);
      }
      break;
    }
    case 'standings':
      if (data.sessionId === view.session?.id) view.standings = data.standings;
      break;
    case 'results':
      view.results = data;
      if (data.sessionId === view.session?.id) view.standings = data.standings;
      break;
    case 'drivers':
      view.drivers = byId(data);
      break;
    case 'track':
      view.track = data.track;
      view.direction = data.direction;
      view.bests = bestsOf(data.bests);
      break;
    case 'setup':
      view.unknown = data.unknown;
      break;
    default:
      break;
  }
  return view;
}

export const serverNow = (view, clientNow = Date.now()) => clientNow + view.skew;

/** What the session clock shows at server time `now`. */
export function clockOf(session, now) {
  if (!session) return null;
  if (session.state === 'countdown') return { label: 'Starts in', ms: session.opensAt - now };
  if (session.kind === 'practice') return { label: 'Practice', ms: now - session.opensAt };
  if (session.state === 'running') return { label: 'Remaining', ms: Math.max(0, session.closesAt - now) };
  if (session.state === 'finishing') return { label: 'Last lap', ms: 0 };
  return { label: session.state === 'aborted' ? 'Aborted' : 'Finished', ms: 0 };
}

/** A driver's name; laps of a deleted driver stay theirs. */
export const driverName = (view, id) => view.drivers.get(id)?.name ?? (id ? 'former driver' : 'unknown car');
