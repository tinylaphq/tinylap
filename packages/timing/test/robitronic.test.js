// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameReader, crc8, frames, parseFrame } from '../index.js';

/** "0D BD 84" → bytes. */
const hex = (s) => Uint8Array.from(s.split(' '), (x) => parseInt(x, 16));
const concat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
/** The frames a reader yields, without its checksum notes. */
const messages = (items) => items.filter((x) => x.type !== 'noise');

test('1a. crc8 gives the checksum byte of the four published frames', () => {
  for (const s of ['0D BD 84 1E 08 00 00 E7 36 00 00 55 F9', '0B 5C 83 9B 3A 00 00 14 D0 01 02', '03 B9 01', '03 B0 02']) {
    const bytes = hex(s);
    assert.equal(crc8(bytes), bytes[1], s);
  }
});

test('1b. the encoders build the two frames the research note generated, and the two commands', () => {
  assert.deepEqual(frames.heartbeat(0), hex('0B 58 83 00 00 00 00 14 D0 01 02'));
  assert.deepEqual(frames.passing(0x123456, 12345, 12, 200), hex('0D D9 84 56 34 12 00 39 30 00 00 0C C8'));
  assert.deepEqual(frames.start, hex('03 B9 01'));
  assert.deepEqual(frames.reset, hex('03 B0 02'));
});

test('2. the published passing, and the generated one', () => {
  assert.deepEqual(parseFrame(hex('0D BD 84 1E 08 00 00 E7 36 00 00 55 F9')),
    { type: 'passing', id: 0x081e, transponder: '81E', t: 14055, hits: 0x55, strength: 0xf9, checksumOk: true });
  assert.deepEqual(parseFrame(hex('0D D9 84 56 34 12 00 39 30 00 00 0C C8')),
    { type: 'passing', id: 0x123456, transponder: '123456', t: 12345, hits: 12, strength: 200, checksumOk: true });
});

test('3. the published heartbeat', () => {
  assert.deepEqual(parseFrame(hex('0B 5C 83 9B 3A 00 00 14 D0 01 02')), { type: 'heartbeat', t: 15003, tail: [0x14, 0xd0, 0x01, 0x02], checksumOk: true });
});

test('4. the fourth byte of a number shifts by 24', () => {
  // The public parsers' `<< 32` is `<< 0` in JavaScript: it reads t = 1 and the id 0x34567A. `<< 16` reads 65536.
  const m = parseFrame(frames.passing(0x12345678, 0x01000000, 1, 1));
  assert.equal(m.transponder, '12345678');
  assert.equal(m.t, 16777216);
});

test('5. the encoders round-trip through the reader', () => {
  const reader = createFrameReader();
  assert.deepEqual(reader.push(concat(frames.passing(0x0a1b2c, 2000, 9, 180), frames.heartbeat(2100))), [
    { type: 'passing', id: 0x0a1b2c, transponder: 'A1B2C', t: 2000, hits: 9, strength: 180, checksumOk: true },
    { type: 'heartbeat', t: 2100, tail: [0x14, 0xd0, 0x01, 0x02], checksumOk: true },
  ]);
});

test('6. split at every byte, or whole, the stream yields the same three frames', () => {
  const stream = concat(hex('FF FF 01'), frames.heartbeat(15003), [0x00], frames.passing(0x081e, 14055, 0x55, 0xf9), frames.passing(0x123456, 12345, 12, 200));
  const whole = createFrameReader().push(stream);
  assert.deepEqual(whole.map((x) => x.type), ['heartbeat', 'passing', 'passing']);
  for (let cut = 1; cut < stream.length; cut += 1) {
    const reader = createFrameReader();
    assert.deepEqual([...reader.push(stream.subarray(0, cut)), ...reader.push(stream.subarray(cut))], whole, `cut at ${cut}`);
  }
});

test('7. a frame cut in the middle, then a whole frame: the whole frame is read', () => {
  const reader = createFrameReader();
  const cut = frames.passing(0x123456, 12345, 12, 200).subarray(0, 6);
  assert.deepEqual(messages(reader.push(concat(cut, frames.heartbeat(500)))), [{ type: 'heartbeat', t: 500, tail: [0x14, 0xd0, 0x01, 0x02], checksumOk: true }]);
});

test('8. a frame with a wrong checksum is not yielded, a note is, and the next frame reads', () => {
  const reader = createFrameReader();
  const bad = frames.heartbeat(100);
  bad[1] ^= 0xff;
  const items = reader.push(concat(bad, frames.heartbeat(200)));
  assert.deepEqual(items.filter((x) => x.type === 'noise').map((x) => x.detail), ['checksum']);
  assert.deepEqual(messages(items).map((x) => x.t), [200]);
  assert.equal(reader.mismatches, 1);
});

test('9. a false sync at the start yields nothing, and the first real frame reads', () => {
  const reader = createFrameReader();
  const fake = hex('0D 00 84 11 11 11 11 11 11 11 11 11 11');
  assert.notEqual(crc8(fake), 0x00, 'the fake frame fails its checksum');
  assert.deepEqual(messages(reader.push(concat(fake, frames.heartbeat(300)))).map((x) => x.t), [300]);
});

test('10. past 256 bytes of junk, the next frame still reads', () => {
  const reader = createFrameReader();
  reader.push(new Uint8Array(300).fill(0x0d));
  assert.deepEqual(messages(reader.push(frames.heartbeat(400))).map((x) => x.t), [400]);
});

test('11. parseFrame on a length and type it does not know is null', () => {
  assert.equal(parseFrame(hex('05 00 99 00 00')), null);
});
