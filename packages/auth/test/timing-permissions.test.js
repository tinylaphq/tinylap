// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, can } from '../index.js';

const as = (role) => ({ workspaces: [{ id: 'w1', role }] });

test('every member may run timing and change its setup', () => {
  for (const role of ['owner', 'admin', 'member']) {
    assert.equal(can(as(role), 'w1', 'timing.run'), true, role);
    assert.equal(can(as(role), 'w1', 'timing.setup'), true, role);
  }
});

test('only owners and admins may delete drivers and decoders', () => {
  assert.equal(can(as('owner'), 'w1', 'timing.delete'), true);
  assert.equal(can(as('admin'), 'w1', 'timing.delete'), true);
  assert.equal(can(as('member'), 'w1', 'timing.delete'), false);
});

test('the timing actions are listed and need membership', () => {
  for (const action of ['timing.run', 'timing.setup', 'timing.delete']) assert.ok(ACTIONS.includes(action), action);
  assert.equal(can(as('owner'), 'w2', 'timing.run'), false);
});
