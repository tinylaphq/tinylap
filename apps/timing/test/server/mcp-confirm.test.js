// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// MCP confirmations (timing MCP spec §6): a sealed token bound to the member,
// the space, the tool, its arguments and the state it described, for two minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal } from '@tinylap/auth';
import { canonical, check, CONFIRM_TTL_MS, issue } from '../../server/mcp/confirm.js';

const keys = [{ id: 'k2', key: randomBytes(32) }, { id: 'k1', key: randomBytes(32) }];
const T0 = 1_800_000_000_000;
const binding = { sub: 'u1', workspace: 'w1', tool: 'delete_driver', args: { driver: 'd1' }, state: 'd1' };

test('the same call, in time and with the state unchanged, is ok', () => {
  const token = issue(keys, binding, T0);
  assert.equal(check(keys, token, binding, T0 + CONFIRM_TTL_MS), 'ok');
  // Arguments in another order are the same arguments.
  const two = { ...binding, args: { a: 1, b: [1, { y: 2, x: 1 }] } };
  assert.equal(check(keys, issue(keys, two, T0), { ...two, args: { b: [1, { x: 1, y: 2 }], a: 1 } }, T0), 'ok');
});

test('after two minutes, or with the state changed, it asks again', () => {
  const token = issue(keys, binding, T0);
  assert.equal(check(keys, token, binding, T0 + CONFIRM_TTL_MS + 1), 'stale');
  assert.equal(check(keys, token, { ...binding, state: 'other' }, T0), 'stale');
});

test('another member, space, tool or arguments: invalid', () => {
  const token = issue(keys, binding, T0);
  for (const other of [{ sub: 'u2' }, { workspace: 'w2' }, { tool: 'unpair_decoder' }, { args: { driver: 'd2' } }]) {
    assert.equal(check(keys, token, { ...binding, ...other }, T0), 'invalid', JSON.stringify(other));
  }
});

test('a forged, mangled or foreign token is invalid', () => {
  assert.equal(check(keys, 'k2.AAAA.BBBB', binding, T0), 'invalid');
  assert.equal(check(keys, 'not a token', binding, T0), 'invalid');
  const token = issue(keys, binding, T0);
  assert.equal(check([{ id: 'k2', key: randomBytes(32) }], token, binding, T0), 'invalid', 'another key');
  // A value sealed for another purpose with the same keys never opens as a confirmation.
  const elsewhere = seal(keys, JSON.stringify({ ...binding, exp: T0 + 1000 }), 'login');
  assert.equal(check(keys, elsewhere, binding, T0), 'invalid');
});

test('canonical JSON sorts keys and drops undefined members', () => {
  assert.equal(canonical({ b: 1, a: [true, null, { d: undefined, c: 'x' }] }), '{"a":[true,null,{"c":"x"}],"b":1}');
});
