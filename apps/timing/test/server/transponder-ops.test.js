// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../../server/operations.js';
import { W, rig } from './rig.js';

/** The rig with a request as the routes hand the operations one. */
function setup() {
  const r = rig();
  const request = { store: r.store, engine: r.engine, hub: r.hub, workspaceId: W, now: () => r.clock.now };
  return { ...r, request };
}
const labelOf = (store, code) => store.transponders(W).find((t) => t.code === code)?.label;

test('a label is trimmed, cleared when empty and limited to 24 characters', () => {
  const { request, store } = setup();
  assert.deepEqual(ops.labelTransponder(request, { code: '0A', label: '  red car  ' }).value, { code: '0A', label: 'red car' });
  assert.equal(labelOf(store, '0A'), 'red car');
  assert.deepEqual(ops.labelTransponder(request, { code: '0A', label: '   ' }).value, { code: '0A', label: null });
  assert.equal(labelOf(store, '0A'), null);
  assert.equal(ops.labelTransponder(request, { code: '0A', label: 'x'.repeat(24) }).value.label.length, 24);
  const { error } = ops.labelTransponder(request, { code: '0A', label: 'x'.repeat(25) });
  assert.equal(error.field, 'label');
  assert.equal(error.message, 'A label has at most 24 characters.');
});

test('removing a transponder keeps past crossings with the driver and leaves no label', () => {
  const { request, store, pass, startPractice } = setup();
  const practice = startPractice();
  pass(1000);
  pass(9000);
  ops.labelTransponder(request, { code: '0A', label: 'red' });
  assert.deepEqual(ops.removeTransponder(request, { code: '0A' }).value, { code: '0A' });
  assert.equal(store.transponders(W).find((t) => t.code === '0A').driverId, null);
  assert.equal(labelOf(store, '0A'), null);
  assert.deepEqual(store.crossings(practice.id).map((c) => c.driverId), ['ana', 'ana']);
  ops.labelTransponder(request, { code: '0A', label: 'again' });
  ops.removeTransponder(request, { code: '0A' });
  assert.equal(labelOf(store, '0A'), null);
});

test('forgetting a transponder mid-session drops it from unknown until it passes again', () => {
  const { request, engine, pass, startPractice } = setup();
  startPractice();
  pass(1000, '0C');
  assert.deepEqual(engine.snapshot(W).unknown, ['0C']);
  assert.deepEqual(ops.forgetTransponder(request, { code: '0C' }).value, { code: '0C' });
  assert.deepEqual(engine.snapshot(W).unknown, []);
  pass(2000, '0C');
  assert.deepEqual(engine.snapshot(W).unknown, ['0C']);
});

test('assigning to a new driver creates exactly one driver and takes the label', () => {
  const { request, store, pass, startPractice } = setup();
  startPractice();
  pass(1000, '0C');
  const before = store.drivers(W).length;
  const { value } = ops.assignTransponderTo(request, { code: '0C', newDriverName: ' Cy ', label: 'blue' });
  assert.equal(store.drivers(W).length, before + 1);
  assert.equal(value.driverId, store.drivers(W).find((d) => d.name === 'Cy').id);
  assert.equal(labelOf(store, '0C'), 'blue');
});

test('assigning needs exactly one of a driver or a new name, and the driver must exist', () => {
  const { request, store } = setup();
  const before = store.drivers(W).length;
  assert.equal(ops.assignTransponderTo(request, { code: '0C', newDriverName: '  ' }).error.field, 'name');
  assert.equal(ops.assignTransponderTo(request, { code: '0C', newDriverName: '  ' }).error.message, 'Name the new driver.');
  assert.ok(ops.assignTransponderTo(request, { code: '0C' }).error);
  assert.ok(ops.assignTransponderTo(request, { code: '0C', driverId: 'ana', newDriverName: 'Cy' }).error);
  const gone = ops.assignTransponderTo(request, { code: '0C', driverId: 'nobody' }).error;
  assert.equal(gone.field, 'driver');
  assert.equal(gone.message, 'That driver is gone.');
  assert.equal(store.drivers(W).length, before);
  assert.equal(ops.assignTransponderTo(request, { code: '0C', driverId: 'ben', label: 'b' }).value.driverId, 'ben');
  assert.equal(labelOf(store, '0C'), 'b');
});

test('idle, the unknown list holds the last hour only', () => {
  const { engine, clock, pass, startPractice } = setup();
  const practice = startPractice();
  pass(1000, '0C');
  engine.end(W, practice.id);
  clock.now += 59 * 60_000;
  assert.deepEqual(engine.snapshot(W).unknown, ['0C']);
  clock.now += 2 * 60_000;
  assert.deepEqual(engine.snapshot(W).unknown, []);
});
