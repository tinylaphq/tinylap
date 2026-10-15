// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { can, ACTIONS, ROLES } from '../index.js';

const MATRIX = {
  'track.read':     ['owner', 'admin', 'member'],
  'track.save':     ['owner', 'admin', 'member'],
  'track.share':    ['owner', 'admin', 'member'],
  'track.copy':     ['owner', 'admin', 'member'],
  'track.delete':   ['owner', 'admin'],
  'invite.manage':  ['owner', 'admin'],
  'member.remove':  ['owner', 'admin'],
  'admin.manage':   ['owner'],
  'owner.transfer': ['owner'],
  'club.manage':    ['owner'],
  'club.leave':     ['admin', 'member'],
  'timing.run':     ['owner', 'admin', 'member'],
  'timing.setup':   ['owner', 'admin', 'member'],
  'timing.delete':  ['owner', 'admin'],
};

const claims = (role) => ({ sub: 'u', iss: 'i', aud: 'a', exp: 0, workspaces: [{ id: 'w1', role }] });

test('the matrix is exactly the spec', () => {
  assert.deepEqual([...ACTIONS].sort(), Object.keys(MATRIX).sort());
  for (const [action, allowed] of Object.entries(MATRIX)) {
    for (const role of ROLES) assert.equal(can(claims(role), 'w1', action), allowed.includes(role), `${role} ${action}`);
  }
});

test('no membership, no permission', () => {
  for (const action of ACTIONS) assert.equal(can(claims('owner'), 'w2', action), false);
  assert.equal(can({ ...claims('owner'), workspaces: undefined }, 'w1', 'track.read'), false);
});

test('an unknown action or role is refused, never thrown', () => {
  assert.equal(can(claims('owner'), 'w1', 'track.burn'), false);
  assert.equal(can(claims('superuser'), 'w1', 'track.read'), false);
});
