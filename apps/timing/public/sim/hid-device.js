// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An HIDDevice look-alike: a CP2110 in front of a device model (decoders spec
// §5.3, research §1.1). Nothing flows before feature report 0x50 with the
// EasyLap's UART config and 0x41 [01]; 0x41 [00] stops it. Output reports
// must carry their length as the report id. Bytes go out in input reports of
// 1 to 63 bytes, split and merged at random (seeded), their data alternately
// exact and padded to 63, as a real CP2110's may be.

const UART_CONFIG = [0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0x03, 0x00].join();
/** @param {number} seed */
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
/** @param {BufferSource} data */
const bytesOf = (data) => (ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data)).slice();

/** @param {any} model @param {{ hid?: EventTarget | null, tickMs?: number, seed?: number, failOpen?: boolean }} [options] */
export function fakeHidDevice(model, { hid = null, tickMs = 100, seed = 1, failOpen = false } = {}) {
  const random = seeded(seed);
  const device = /** @type {any} */ (new EventTarget());
  let configured = false;
  let enabled = false;
  let timer = null;
  let openedAt = 0;
  let padded = false;
  const clock = () => Math.round(performance.now() - openedAt);
  /** @param {Uint8Array} chunk */
  const report = (chunk) => {
    const data = new Uint8Array(padded ? 63 : chunk.length);
    data.set(chunk);
    padded = !padded;
    device.dispatchEvent(Object.assign(new Event('inputreport'), { device, reportId: chunk.length, data: new DataView(data.buffer) }));
  };
  /** @param {Uint8Array[]} chunks */
  const emit = (chunks) => {
    if (!enabled) return;
    const all = Uint8Array.from(chunks.flatMap((c) => [...c]));
    for (let at = 0; at < all.length;) {
      const n = Math.min(all.length - at, 1 + Math.floor(random() * 63));
      report(all.subarray(at, at + n));
      at += n;
    }
  };
  const stop = () => {
    enabled = false;
    clearInterval(timer);
  };
  return Object.assign(device, {
    vendorId: model.info.vendorId,
    productId: model.info.productId,
    productName: model.info.productName,
    opened: false,
    /** Feature reports, as [id, ...bytes]. */
    log: [],
    /** Output reports' bytes. */
    writes: [],
    async open() {
      if (failOpen) throw new DOMException('Permission to open the device was denied.', 'NotAllowedError');
      device.opened = true;
    },
    async close() {
      stop();
      device.opened = false;
    },
    /** @param {number} id @param {BufferSource} data */
    async sendFeatureReport(id, data) {
      const bytes = bytesOf(data);
      device.log.push([id, ...bytes]);
      if (id === 0x50) configured = [...bytes].join() === UART_CONFIG;
      if (id === 0x41 && bytes[0] === 0) stop();
      if (id === 0x41 && bytes[0] === 1 && configured && !enabled) {
        enabled = true;
        openedAt = performance.now();
        emit(model.start(0));
        timer = setInterval(() => emit(model.tick(clock())), tickMs);
      }
    },
    /** @param {number} n @param {BufferSource} data */
    async sendReport(n, data) {
      const bytes = bytesOf(data);
      if (!enabled) throw new DOMException('The UART is off.', 'InvalidStateError');
      if (n !== bytes.length) throw new DOMException('The report id must be the number of bytes.', 'DataError');
      device.writes.push([...bytes]);
      emit(model.write(bytes, clock()));
    },
    /** Bytes from the device's side, for tests. @param {Uint8Array} bytes */
    send: (bytes) => emit([bytes]),
    unplug() {
      stop();
      hid?.dispatchEvent(Object.assign(new Event('disconnect'), { device }));
    },
  });
}
