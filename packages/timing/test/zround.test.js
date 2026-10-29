// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commands, createReader, parseLog, parseMessage, wifiError } from '../index.js';

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
  assert.deepEqual(parseMessage(body(commands.reset)), { type: 'reset' });
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

test('reset drops the pending text', () => {
  const reader = createReader();
  assert.deepEqual(reader.push('%L2A,1F'), []);
  reader.reset();
  assert.deepEqual(reader.push('00&%T2000&'), [{ type: 'clock', t: 0x2000 }]);
});

// Shared with the decoder firmware's tests, so the two protocol codes cannot drift.
const vectors = JSON.parse(readFileSync(new URL('./zround-vectors.json', import.meta.url), 'utf8'));

test('vectors: messages to the decoder', () => {
  for (const { body, message } of vectors.toDecoder) {
    const parsed = parseMessage(body);
    if (message.type === 'unknown') assert.equal(parsed.type, 'unknown', body);
    else assert.deepEqual(parsed, message, body);
  }
});

test('vectors: lines from the decoder', () => {
  for (const { call, line } of vectors.fromDecoder) {
    const [name, ...args] = Array.isArray(call) ? call : [call];
    if (name === 'transponder') continue;
    const command = commands[name];
    assert.equal(typeof command === 'function' ? command(...args) : command, line, name);
  }
});

test('vectors: streams', () => {
  for (const { chunks, messages } of vectors.streams) {
    const reader = createReader();
    assert.deepEqual(chunks.flatMap((chunk) => reader.push(chunk)), messages);
  }
});

test('vectors: log lines', () => {
  for (const { line, log } of vectors.logLines) {
    const body = line.slice(1, -1);
    const rest = body.slice('TLLOG '.length);
    if (log) {
      assert.deepEqual(parseMessage(body), { type: 'log', line: rest }, line);
      assert.deepEqual(parseLog(rest), log, line);
    } else {
      assert.equal(parseMessage(body).type, 'unknown', line);
      assert.equal(parseLog(rest), null, line);
    }
  }
});

test('vectors: Wi-Fi lengths', () => {
  for (const { ssid, password, reply } of vectors.wifi) {
    const m = parseMessage(`TLWIFI ${ssid} ${password}`);
    assert.equal(m.type, 'wifi');
    const error = wifiError(m.ssid, m.password);
    assert.equal(error ? commands.error(error) : commands.ok, reply, `${m.ssid} / ${m.password}`);
  }
});

test('log lines are ASCII only', () => {
  assert.equal(parseLog('boot fw=vé'), null);
  assert.equal(parseLog('stat up=1  heap=2'), null, 'two spaces');
  assert.equal(parseLog('stat up=1 '), null, 'a trailing space');
  assert.equal(parseLog(`stat ${Array.from({ length: 49 }, (_, i) => `k${i}=1`).join(' ')}`), null, '49 fields');
  assert.notEqual(parseLog(`stat ${Array.from({ length: 48 }, (_, i) => `k${i}=1`).join(' ')}`), null, '48 fields');
  assert.deepEqual(parseLog('stat up='), { kind: 'stat', fields: [['up', '']] });
});
