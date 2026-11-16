// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readStart, startDefaults } from '../../server/start-form.js';
import { W, rig } from './rig.js';

const formOf = (pairs) => new URLSearchParams(pairs);
const fieldsOf = (errors) => errors.map((e) => e.field);

test('with no earlier session, every kind starts from its own defaults, Practice checked', () => {
  const { store } = rig();
  assert.deepEqual(startDefaults({ store, workspaceId: W }), {
    kind: 'practice',
    practice: { earlier: false },
    qualifying: { drivers: 'everyone', roster: ['ana', 'ben'], minutes: '5', earlier: false },
    race: { drivers: 'everyone', roster: ['ana', 'ben'], minutes: '5', countdown: '10', earlier: false },
  });
});

test('each kind’s defaults come from the last session of that kind', () => {
  const { engine, store, clock } = rig();
  const start = (options) => {
    clock.now += 1000;
    return engine.start(W, { replace: true, ...options }).session;
  };
  start({ kind: 'qualifying', roster: ['ben'], durationMs: 3 * 60_000 });
  start({ kind: 'race', durationMs: 8 * 60_000, countdownMs: 7000 });
  start({ kind: 'qualifying', roster: ['ana', 'ben'], durationMs: 2 * 60_000 });
  const defaults = startDefaults({ store, workspaceId: W });
  assert.equal(defaults.kind, 'qualifying', 'the last session’s kind');
  assert.deepEqual(defaults.qualifying, { drivers: 'chosen', roster: ['ana', 'ben'], minutes: '2', earlier: true });
  assert.deepEqual(defaults.race, { drivers: 'everyone', roster: ['ana', 'ben'], minutes: '8', countdown: '7', earlier: true });
  assert.deepEqual(defaults.practice, { earlier: false });

  start({ kind: 'race', roster: ['ana', 'ben'], durationMs: 90_000, countdownMs: 0 });
  store.deleteDriver(W, 'ben');
  const later = startDefaults({ store, workspaceId: W });
  assert.equal(later.kind, 'race');
  assert.deepEqual(later.race, { drivers: 'chosen', roster: ['ana'], minutes: '2', countdown: '0', earlier: true }, 'only drivers still here');
});

test('the server reads only the sent kind’s fields', () => {
  const { store } = rig();
  const request = { store, workspaceId: W };
  const sent = readStart(request, formOf([
    ['kind', 'race'], ['race-drivers', 'chosen'], ['race-roster', 'ana'], ['race-minutes', '3'], ['race-countdown', '4'],
    // Another kind's fields, even broken ones, are never read.
    ['qualifying-drivers', 'nobody'], ['qualifying-roster', 'ghost'], ['qualifying-minutes', '999'], ['roster', 'ben'], ['duration', 'x'],
  ]));
  assert.deepEqual(sent.errors, []);
  assert.deepEqual(sent.args, { kind: 'race', roster: ['ana'], durationSeconds: 180, countdownSeconds: '4' });
  assert.deepEqual(sent.values, { kind: 'race', race: { drivers: 'chosen', roster: ['ana'], minutes: '3', countdown: '4' } });
  assert.deepEqual(sent.fields, [['kind', 'race'], ['race-drivers', 'chosen'], ['race-roster', 'ana'], ['race-minutes', '3'], ['race-countdown', '4']]);

  const everyone = readStart(request, formOf([['kind', 'qualifying'], ['qualifying-drivers', 'everyone'], ['qualifying-roster', 'ana'], ['qualifying-minutes', ''], ['race-countdown', '99']]));
  assert.deepEqual(everyone.errors, []);
  assert.deepEqual(everyone.args, { kind: 'qualifying', roster: undefined, durationSeconds: undefined, countdownSeconds: undefined }, 'Everyone ignores the ticked boxes');

  const practice = readStart(request, formOf([['kind', 'practice'], ['race-minutes', 'x']]));
  assert.deepEqual([practice.errors, practice.args], [[], { kind: 'practice' }]);
});

test('every field’s error at once, at its own field, in the form’s order, the input kept', () => {
  const { store } = rig();
  const request = { store, workspaceId: W };
  const sent = readStart(request, formOf([['kind', 'race'], ['race-countdown', '31'], ['race-minutes', '61'], ['race-drivers', 'chosen']]));
  assert.deepEqual(fieldsOf(sent.errors), ['race-roster', 'race-minutes', 'race-countdown']);
  assert.deepEqual(sent.errors.map((e) => [e.status, e.message]), [
    [422, 'Pick 1 to 20 drivers.'], [422, 'A session lasts 1 to 60 minutes.'], [422, 'The countdown is 0 to 30 seconds.'],
  ]);
  assert.deepEqual(sent.values.race, { drivers: 'chosen', roster: [], minutes: '61', countdown: '31' });

  assert.deepEqual(fieldsOf(readStart(request, formOf([['kind', 'qualifying'], ['qualifying-drivers', 'some']])).errors), ['qualifying-drivers']);
  assert.deepEqual(fieldsOf(readStart(request, formOf([['kind', 'qualifying'], ['qualifying-drivers', 'chosen'], ['qualifying-roster', 'ghost']])).errors), ['qualifying-roster']);
  assert.deepEqual(fieldsOf(readStart(request, formOf([['kind', 'lap']])).errors), ['kind']);
  assert.deepEqual(fieldsOf(readStart(request, formOf([])).errors), ['kind']);
});
