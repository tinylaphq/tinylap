// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { frames } from '@tinylap/timing';
import { EASYLAP_FILTER, hidTransport } from '../public/link/hid.js';
import { robitronicProtocol } from '../public/link/robitronic.js';
import { serialTransport } from '../public/link/serial.js';
import { zroundProtocol } from '../public/link/zround.js';
import { fakeHidDevice } from '../public/sim/hid-device.js';

const enc = (s) => new TextEncoder().encode(s);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const waitFor = async (condition, deadlineMs = 2000) => {
  for (const start = Date.now(); !condition(); await wait(5)) {
    if (Date.now() - start > deadlineMs) throw new Error('Timed out waiting for the condition.');
  }
};
const silentModel = { transport: 'hid', info: { vendorId: 0x10c4, productId: 0x86b9, productName: 'EasyLap USB' }, start: () => [], tick: () => [], write: () => [] };

test('the HID transport configures the CP2110, then enables its UART, in that order', async () => {
  const hid = new EventTarget();
  const device = fakeHidDevice(silentModel, { hid });
  const transport = hidTransport(device, { hid });
  assert.equal(transport.device, 'hid:4292:34489');
  assert.deepEqual(EASYLAP_FILTER, { vendorId: 0x10c4, productId: 0x86b9 });
  await transport.open({ baudRate: 38400 });
  assert.deepEqual(device.log, [[0x50, 0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0x03, 0x00], [0x41, 0x01]]);
  await transport.write(frames.start);
  assert.deepEqual(device.writes, [[0x03, 0xb9, 0x01]], 'sendReport(3, …)');
  await transport.close();
  assert.deepEqual(device.log.at(-1), [0x41, 0x00]);
});

test('the HID transport reads the first reportId bytes, padded or not, and ends on its own disconnect only', async () => {
  const hid = new EventTarget();
  const device = fakeHidDevice(silentModel, { hid });
  const transport = hidTransport(device, { hid });
  await transport.open({ baudRate: 38400 });
  const read = (async () => { const got = []; for await (const b of transport.bytes()) got.push(...b); return got; })();
  device.send(Uint8Array.of(1, 2, 3)); // exact
  device.send(Uint8Array.of(4, 5)); // padded to 63
  hid.dispatchEvent(Object.assign(new Event('disconnect'), { device: {} }));
  await wait(10);
  device.send(Uint8Array.of(6)); // still read after another device's disconnect
  await wait(10);
  device.unplug();
  assert.deepEqual(await read, [1, 2, 3, 4, 5, 6]);
});

test('the HID transport throws when the device can\'t be opened', async () => {
  const transport = hidTransport(fakeHidDevice(silentModel, { failOpen: true }), { hid: new EventTarget() });
  await assert.rejects(transport.open({ baudRate: 38400 }), (e) => e.name === 'NotAllowedError');
});

/** A port that records its baud rate and counts reader cancels. Like a real SerialPort, close() rejects while a stream is locked, and open() while it is open. */
function recordingPort() {
  let controller;
  let isOpen = false;
  const rig = { opened: [], cancels: 0, readerCancels: 0, controller: () => controller, closes: 0 };
  let readable;
  let writable;
  const fresh = () => {
    readable = new ReadableStream({ start(c) { controller = c; }, cancel() { rig.cancels++; } });
    writable = new WritableStream({ write() {} });
  };
  fresh();
  rig.port = {
    get readable() {
      if (!isOpen) return null;
      return {
        get locked() { return readable.locked; },
        getReader() {
          const reader = readable.getReader();
          const cancel = reader.cancel.bind(reader);
          reader.cancel = (reason) => { rig.readerCancels++; return cancel(reason); };
          return reader;
        },
      };
    },
    get writable() { return isOpen ? writable : null; },
    open: async (options) => {
      if (isOpen) throw new DOMException('already open', 'InvalidStateError');
      rig.opened.push(options);
      isOpen = true;
    },
    close: async () => {
      if (readable.locked || writable.locked) throw new TypeError('a stream is locked');
      isOpen = false;
      rig.closes++;
      fresh();
    },
    isOpen: () => isOpen,
    getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
  };
  return rig;
}

test('the serial transport opens at the protocol\'s baud rate and names the USB chip', async () => {
  const { port, opened } = recordingPort();
  const transport = serialTransport(port);
  assert.equal(transport.device, 'serial:6790:29987');
  await transport.open({ baudRate: zroundProtocol().baudRate });
  assert.deepEqual(opened, [{ baudRate: 19200 }]);
  await transport.close();
  await transport.close();
});

test('Risk 1: a double close cancels the reader once', async () => {
  const rig = recordingPort();
  const transport = serialTransport(rig.port);
  await transport.open({ baudRate: 19200 });
  await Promise.all([transport.close(), transport.close()]);
  await transport.close();
  assert.deepEqual([rig.readerCancels, rig.cancels], [1, 1]);
});

test('Risk 1: a close while bytes() is being iterated cancels the reader once', async () => {
  const rig = recordingPort();
  const transport = serialTransport(rig.port);
  await transport.open({ baudRate: 19200 });
  const read = (async () => { const got = []; for await (const b of transport.bytes()) got.push(...b); return got; })();
  rig.controller().enqueue(Uint8Array.of(7));
  await waitFor(() => rig.port.readable.locked);
  await Promise.all([transport.close(), transport.close()]);
  assert.deepEqual(await read, [7]);
  await transport.close();
  assert.deepEqual([rig.readerCancels, rig.cancels], [1, 1]);
  assert.equal(rig.port.isOpen(), false);
});

test('Risk 3: open then close, without ever reading, leaves the port closed and re-openable', async () => {
  const rig = recordingPort();
  const transport = serialTransport(rig.port);
  await transport.open({ baudRate: 19200 });
  await transport.close();
  assert.equal(rig.port.isOpen(), false);
  assert.equal(rig.closes, 1);
  await rig.port.open({ baudRate: 19200 });
  assert.equal(rig.port.isOpen(), true);
});

test('Review focus 1: a serial read that rejects ends the bytes, not in an unhandled rejection', async () => {
  const rig = recordingPort();
  const transport = serialTransport(rig.port);
  await transport.open({ baudRate: 19200 });
  const read = (async () => { for await (const chunk of transport.bytes()) assert.fail(String(chunk)); return 'ended'; })();
  rig.controller().error(new Error('device lost'));
  assert.equal(await read, 'ended');
  await transport.close();
  assert.equal(rig.port.isOpen(), false);
});

test('the ZRound reader maps every message to a session event, alive first', () => {
  const zround = zroundProtocol();
  assert.deepEqual(zround.push(enc('%A&%T1F4&%L0A,3E8&%TLID dec_1 b00tb00t&%TLOK&%TLERR no&%I&%Q&')), [
    { type: 'alive' },
    { type: 'alive' }, { type: 'clock', t: 500 },
    { type: 'alive' }, { type: 'passing', transponder: '0A', t: 1000 },
    { type: 'identity', decoder: 'dec_1', boot: 'b00tb00t' },
    { type: 'ok' },
    { type: 'error', text: 'no' },
    { type: 'reset' },
    { type: 'noise', detail: 'Q' },
  ]);
});

test('Review focus 2: bytes that aren\'t UTF-8, or a % with no real message, never make a ZRound decoder alive', () => {
  const chunked = zroundProtocol();
  const split = [...chunked.push(Uint8Array.of(0xff, 0xfe, 0x25, 0xc3)), ...chunked.push(Uint8Array.of(0xa9, 0x26))];
  assert.deepEqual(split, [{ type: 'noise', detail: '\u00e9' }], '%é& with the é split across chunks');
  assert.deepEqual(zroundProtocol().push(Uint8Array.of(0x25, 0xff, 0x26)), [{ type: 'noise', detail: '\ufffd' }], '%\\xff&');
  assert.deepEqual(zroundProtocol().push(enc('%%x&')), [{ type: 'noise', detail: 'x' }], '%%x&');
});

test('the Robitronic reader yields alive only for a good frame, and counts the bad ones', () => {
  const robitronic = robitronicProtocol();
  const bad = frames.heartbeat(10);
  bad[1] ^= 0xff;
  const warn = console.warn;
  const said = [];
  console.warn = (m) => said.push(m);
  try {
    assert.deepEqual(robitronic.push(bad), [{ type: 'noise', detail: 'checksum' }]);
    robitronic.push(bad);
  } finally {
    console.warn = warn;
  }
  assert.equal(said.length, 1, 'warned once');
  assert.match(said[0], /0B [0-9A-F]{2} 83/);
  assert.equal(robitronic.mismatches, 2);
  assert.deepEqual(robitronic.push(Uint8Array.from([...frames.heartbeat(20), ...frames.passing(0x123456, 12345, 12, 200)])), [
    { type: 'alive' }, { type: 'clock', t: 20 },
    { type: 'alive' }, { type: 'passing', transponder: '123456', t: 12345, hits: 12, strength: 200 },
  ]);
});
