// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A personal best beats an earlier best (personal best marks spec): a driver's
// first time on a track sets none, on the board, a result or the history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardLive } from '../../server/views/board.js';
import { T0, W, rig } from './rig.js';
import { startTiming, useTrack } from './helpers.js';

/** The standings row of `name` in the board's markup. */
const rowOf = (html, name) => html.split('<tr').slice(1).find((row) => row.includes(`title="${name}"`));

test('the board: no PB on a first time on the track; beating an earlier best is one', () => {
  const r = rig();
  useTrack(r.store, W, 'Office', 'cw', 'trk');
  r.store.addDriver(W, { id: 'cy', name: 'Cy', colour: '#2dff9b' });
  r.store.assignTransponder(W, '0C', 'cy', 0);
  const board = () => String(boardLive({ space: { base: '/clubs/x' } }, r.engine.snapshot(W, { moments: true })));
  r.clock.now = T0;
  r.engine.start(W, { kind: 'practice' });
  r.pass(1000, '0A');
  r.pass(9000, '0A');
  r.pass(1200, '0B');
  r.pass(8200, '0B');
  assert.doesNotMatch(board(), /mark-pb/, 'everyone is here for the first time');
  r.clock.now = T0 + 100_000;
  r.engine.start(W, { kind: 'practice', replace: true });
  // Ben's 7.000 stays the record. Ben's 7.500 is the fastest lap (FL); Ana's 7.900 beats her 8.000; Cy's 7.800 is Cy's first.
  r.pass(101_000, '0A');
  r.pass(108_900, '0A');
  r.pass(101_200, '0B');
  r.pass(108_700, '0B');
  r.pass(101_400, '0C');
  r.pass(109_200, '0C');
  const html = board();
  assert.match(rowOf(html, 'Ana'), /7\.900<\/td>\s*<td class="mark-cell"><abbr class="mark mark-pb"/);
  assert.match(rowOf(html, 'Ben'), /mark-fl/);
  assert.match(rowOf(html, 'Cy'), /7\.800<\/td>\s*<td class="mark-cell"><\/td>/);
});

test('the history: a session\'s best is a PB only when it beat an earlier one', async (t) => {
  const clock = { now: Date.UTC(2026, 10, 19, 18, 0) };
  const app = await startTiming({ clock });
  t.after(() => app.close());
  const who = await app.login(await app.signUp('Sam'));
  const ws = (await (await app.api(who, 'GET', '/auth/me')).json()).workspaces[0].id;
  useTrack(app.store, ws, 'Ring', 'cw');
  const codes = { Bo: '11', Cy: '12', Dee: '13' };
  for (const name of Object.keys(codes)) await app.form(who, '/personal/drivers', { name });
  for (const d of app.store.drivers(ws)) app.engine.assign(ws, codes[d.name], d.id);
  /** A practice of each driver's laps (ms), the first crossing starting them. */
  const practice = (laps) => {
    const { session } = app.engine.start(ws, { kind: 'practice' });
    const from = clock.now;
    const passings = Object.entries(laps).flatMap(([name, ms], i) => [[from + 1000 + i * 100, codes[name]], [from + 1000 + i * 100 + ms, codes[name]]]);
    for (const [at, transponder] of passings.sort((a, b) => a[0] - b[0])) {
      clock.now = at;
      app.engine.ingest({ workspaceId: ws, decoder: 'd', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder, t: at }] } });
    }
    app.engine.end(ws, session.id);
    clock.now += 600_000;
  };
  practice({ Bo: 7000, Cy: 7700 });
  practice({ Cy: 7600 });
  practice({ Dee: 7650 });
  const body = await (await app.api(who, 'GET', '/personal/sessions')).text();
  const rows = [...body.matchAll(/<tr class="history-row[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.equal(rows.length, 3);
  assert.match(rows[0], /title="Dee"[\s\S]*7\.650<\/td>\s*<td class="mark-cell"><\/td>/, 'Dee\'s first time beat nothing');
  assert.match(rows[1], /title="Cy"[\s\S]*7\.600<\/td>\s*<td class="mark-cell"><abbr class="mark mark-pb"/, 'Cy beat his 7.700');
  assert.match(rows[2], /mark-tr/);
});

test('assigning the transponder on the track now makes the line say whose car it is', () => {
  const r = rig();
  r.store.addDriver(W, { id: 'cy', name: 'Cy', colour: '#2dff9b' });
  r.clock.now = T0 + 1000;
  r.pass(1000, '0C');
  assert.equal(r.engine.idleOf(W)?.driverId, null);
  r.engine.assign(W, '0C', 'cy');
  assert.equal(r.engine.idleOf(W)?.driverId, 'cy');
  assert.deepEqual(r.events.filter((e) => e.type === 'idle').at(-1)?.data?.idle?.driverId, 'cy');
});
