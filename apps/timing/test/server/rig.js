// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { openStore } from '../../server/store.js';
import { createHub } from '../../server/live.js';
import { createEngine } from '../../server/engine.js';

export const W = 'ws-1';
export const BOOT = 'b00tb00t';
export const T0 = 1_000_000_000_000;

/** An engine on a fresh store with a clock the test moves. Decoder t and the clock move together. */
export function rig() {
  const store = openStore(':memory:');
  const hub = createHub({ now: () => clock.now });
  const clock = { now: T0 };
  const engine = createEngine({ store, hub, now: () => clock.now });
  const events = [];
  hub.subscribe(W, { lastEventId: null, watcher: false }, (e) => events.push(e));
  store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  store.addDriver(W, { id: 'ben', name: 'Ben', colour: '#2d9bff' });
  store.assignTransponder(W, '0A', 'ana', 0);
  store.assignTransponder(W, '0B', 'ben', 0);
  /** Posts one passing at decoder time `t`, received at T0 + t. */
  const pass = (t, transponder = '0A', boot = BOOT) => {
    clock.now = T0 + t;
    return engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot, passings: [{ transponder, t }] } });
  };
  return { store, hub, engine, clock, events, pass };
}
