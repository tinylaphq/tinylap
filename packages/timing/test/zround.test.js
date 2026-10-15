// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, createReader, parseMessage } from '../index.js';

test('ZRound messages', () => {
  assert.deepEqual(parseMessage('C'), { type: 'startup' });
  assert.deepEqual(parseMessage('A'), { type: 'ack' });
  assert.deepEqual(parseMessage('I'), { type: 'reset' });
  assert.deepEqual(parseMessage('F'), { type: 'stop' });
  assert.deepEqual(parseMessage('T1F4'), { type: 'clock', t: 500 });
  assert.deepEqual(parseMessage('L0A0003E8'), { type: 'lap', transponder: '0A', t: 1000 });
  assert.deepEqual(parseMessage('L4a1f,3E8'), { type: 'lap', transponder: '4A1F', t: 1000 });
  assert.deepEqual(parseMessage('Lzz,1'), { type: 'unknown', raw: 'Lzz,1' });
  assert.deepEqual(parseMessage('L0A'), { type: 'unknown', raw: 'L0A' });
});

test('TinyLap extension messages', () => {
  assert.deepEqual(parseMessage('TLHELLO'), { type: 'hello-request' });
  assert.deepEqual(parseMessage('TLID - b00tb00t'), { type: 'hello', decoder: null, boot: 'b00tb00t' });
  assert.deepEqual(parseMessage('TLID dec_1 b00tb00t'), { type: 'hello', decoder: 'dec_1', boot: 'b00tb00t' });
  assert.deepEqual(parseMessage('TLID dec_1 x'), { type: 'unknown', raw: 'TLID dec_1 x' });
  assert.deepEqual(parseMessage('TLOK'), { type: 'ok' });
  assert.deepEqual(parseMessage('TLERR no flash'), { type: 'error', text: 'no flash' });
  const token = 'a'.repeat(43);
  assert.deepEqual(parseMessage(`TLPAIR dec_1 ${token}`), { type: 'pair', decoder: 'dec_1', token });
  assert.deepEqual(parseMessage('TLPAIR dec_1 short'), { type: 'unknown', raw: 'TLPAIR dec_1 short' });
});

test('commands round-trip, Wi-Fi credentials included', () => {
  const body = (line) => line.slice(1, -1);
  assert.deepEqual(parseMessage(body(commands.lap('4A1F', 1000))), { type: 'lap', transponder: '4A1F', t: 1000 });
  assert.deepEqual(parseMessage(body(commands.clock(500))), { type: 'clock', t: 500 });
  assert.deepEqual(parseMessage(body(commands.id(null, 'b00tb00t'))), { type: 'hello', decoder: null, boot: 'b00tb00t' });
  assert.deepEqual(parseMessage(body(commands.wifi('Office 5G & Co', 'p%ss wörd'))), { type: 'wifi', ssid: 'Office 5G & Co', password: 'p%ss wörd' });
  // "%" and "&" are removed, so two spaces remain.
  assert.equal(commands.error('50% & more'), '%TLERR 50  more&');
});

test('the reader splits a stream at any chunk boundary and drops noise', () => {
  const reader = createReader();
  assert.deepEqual(reader.push('boot noise %L0A00'), []);
  assert.deepEqual(reader.push('03E8&%T1F4&%A'), [{ type: 'lap', transponder: '0A', t: 1000 }, { type: 'clock', t: 500 }]);
  assert.deepEqual(reader.push('&'), [{ type: 'ack' }]);
});

test('the reader does not grow without an end', () => {
  const reader = createReader();
  reader.push(`%${'x'.repeat(5000)}`);
  assert.deepEqual(reader.push('%A&'), [{ type: 'ack' }]);
});

test('line noise that a batch would refuse is unknown, not a lap or clock', () => {
  const noise = 'L0123456789ABCDEF01,FFFFFFFFFFFFFFFFFFFF';
  assert.deepEqual(parseMessage(noise), { type: 'unknown', raw: noise });
  assert.deepEqual(parseMessage('L0A,FFFFFFFFFFFFFF'), { type: 'unknown', raw: 'L0A,FFFFFFFFFFFFFF' });
  assert.deepEqual(parseMessage('TFFFFFFFFFFFFFF'), { type: 'unknown', raw: 'TFFFFFFFFFFFFFF' });
  assert.deepEqual(parseMessage('L0123456789ABCDEF,1F'), { type: 'lap', transponder: '0123456789ABCDEF', t: 31 });
});

test('a cut-off message resyncs at the last % before the &', () => {
  const reader = createReader();
  assert.deepEqual(reader.push('%L01,2%A&'), [{ type: 'ack' }]);
  assert.deepEqual(reader.push('%L01,2%TLID dec bootid12&'), [{ type: 'hello', decoder: 'dec', boot: 'bootid12' }]);
});
