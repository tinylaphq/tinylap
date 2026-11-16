// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A club night on one track for the results tests: an earlier practice that
// sets the record, a practice that beats it, a race with a lapped car, a
// qualifying and a practice that beats nothing. Every session ends on its own.

const DRIVERS = { Ana: '11', 'Ben Okafor': '12', 'Cyrille Featherstonehaugh': '13', Dara: '14', Jo: '15', 'Mia Schulz': '16' };

/**
 * @param {any} app startTiming's app, its clock `{ now }` settable
 * @param {{ now: number }} clock
 * @param {any} who a login of the club's member
 * @param {{ ws: string, base: string, useTrack: (store: any, ws: string, name: string, direction: string) => string }} club
 *   the club's id and its pages' base path, and the helper that puts it on a track
 * @returns {Promise<{ ids: Record<string, string>, sessions: Record<string, string> }>}
 */
export async function clubNight(app, clock, who, { ws, base, useTrack }) {
  useTrack(app.store, ws, 'Kitchen Ring', 'cw');
  for (const name of Object.keys(DRIVERS)) await app.form(who, `${base}/drivers`, { name });
  const drivers = app.store.drivers(ws);
  /** @type {Record<string, string>} */
  const ids = {};
  for (const [name, code] of Object.entries(DRIVERS)) {
    ids[name] = drivers.find((d) => d.name === name).id;
    app.engine.assign(ws, code, ids[name]);
  }
  const passAt = (at, transponder) => {
    clock.now = at;
    app.engine.ingest({ workspaceId: ws, decoder: `d-${ws}`, via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder, t: at }] } });
  };
  /** Drives each driver's laps (ms) from `from`, each first crossing 200 ms after the one before; returns the last crossing's time. */
  const drive = (from, laps) => {
    const passings = [];
    Object.entries(laps).forEach(([name, ms], i) => {
      let at = from + 300 + i * 200;
      passings.push([at, DRIVERS[name]]);
      for (const lap of ms) passings.push([(at += lap), DRIVERS[name]]);
    });
    passings.sort((a, b) => a[0] - b[0]);
    for (const [at, code] of passings) passAt(at, code);
    return passings.at(-1)[0];
  };
  /** @type {Record<string, string>} */
  const sessions = {};
  const practice = (name, laps) => {
    const { session } = app.engine.start(ws, { kind: 'practice' });
    const last = drive(clock.now, laps);
    clock.now = last + 1000;
    app.engine.end(ws, session.id);
    sessions[name] = session.id;
    clock.now += 600_000;
  };
  const timed = (name, kind, durationMs, laps) => {
    const { session } = app.engine.start(ws, { kind, roster: Object.keys(laps).map((n) => ids[n]), durationMs, countdownMs: 0 });
    const last = drive(clock.now, laps);
    clock.now = last + 1000;
    app.engine.tick();
    sessions[name] = session.id;
    clock.now += 600_000;
  };

  practice('earlier', { Ana: [7400, 7104, 7300], 'Ben Okafor': [7600, 7250], Dara: [7210, 7400], Jo: [7444, 7600], 'Mia Schulz': [7700, 7650] });
  practice('record', {
    Ana: [7070, 7107, 7144, 7181, 7218, 7095, 7132, 7150, 7160],
    'Ben Okafor': [7203, 7240, 7277, 7154, 7191, 7228, 7265, 7300],
    'Cyrille Featherstonehaugh': [7316, 7353, 7230, 7267, 7304, 7341, 7218, 7400, 7380],
    Dara: [7429, 7306, 7343, 7380, 7417, 7294, 7331],
    Jo: [7452, 7489, 7526, 7403, 7440, 7477, 7514, 7600],
    'Mia Schulz': [7725, 7762, 7639, 7676, 7713, 7750],
  });
  timed('race', 'race', 50_000, {
    Ana: [7100, 7107, 7144, 7181, 7218, 7095, 7132],
    'Ben Okafor': [7203, 7240, 7277, 7154, 7191, 7228, 7265],
    'Cyrille Featherstonehaugh': [7316, 7353, 7230, 7267, 7304, 7341, 7218],
    Dara: [7429, 7306, 7343, 7380, 7417, 7294, 7331],
    Jo: [7452, 7489, 7526, 7403, 7440, 7477, 7514],
    'Mia Schulz': [8525, 8562, 8439, 8476, 8513, 8550],
  });
  timed('qualifying', 'qualifying', 30_000, {
    Ana: [7290, 7160, 7210, 7230, 7250],
    'Ben Okafor': [7203, 7244, 7277, 7300, 7310],
    'Cyrille Featherstonehaugh': [7316, 7353, 7230, 7267, 7304],
    Dara: [7429, 7306, 7343, 7380, 7417],
    Jo: [7452, 7489, 7526, 7403, 7440],
  });
  practice('plain', { Ana: [7300, 7250, 7280], 'Ben Okafor': [7350, 7330], Jo: [7500, 7420] });
  return { ids, sessions };
}
