// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A SerialPort look-alike with a device model at the other end (decoders
// spec §5.3). Its streams have a JS sink and source, as sim-port.js's always
// had, so the browser tests' stream-counting init scripts keep working.

/** @param {any} model @param {{ tickMs?: number }} [options] */
export function fakeSerialPort(model, { tickMs = 100 } = {}) {
  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let controller;
  let timer = null;
  let openedAt = performance.now();
  const clock = () => Math.round(performance.now() - openedAt);
  /** @param {Uint8Array[]} chunks */
  const send = (chunks) => {
    for (const chunk of chunks) {
      try {
        controller.enqueue(chunk);
      } catch {
        // Unplugged or cancelled: the bytes go nowhere, as on a real cable.
      }
    }
  };
  return {
    readable: new ReadableStream({ start(c) { controller = c; }, cancel() { clearInterval(timer); } }),
    writable: new WritableStream({ write(chunk) { send(model.write(chunk, clock())); } }),
    async open() {
      openedAt = performance.now();
      send(model.start(0));
      timer = setInterval(() => send(model.tick(clock())), tickMs);
    },
    async close() {
      clearInterval(timer);
    },
    getInfo: () => model.info,
    /** Bytes from the device's side, for tests. @param {Uint8Array} bytes */
    send: (bytes) => send([bytes]),
    unplug() {
      clearInterval(timer);
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    },
  };
}
