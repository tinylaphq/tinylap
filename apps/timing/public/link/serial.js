// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A decoder on Web Serial (decoders spec §2.3): bytes in, bytes out. Its
// device name is the USB chip's ids, which Web Serial shows; it has no serial
// number, so two decoders on the same chip look alike (spec §3.2).

/** @param {any} port a SerialPort, or a look-alike */
export function serialTransport(port) {
  const { usbVendorId, usbProductId } = port.getInfo?.() ?? {};
  let reader = null;
  let writer = null;
  let cancelled = false;
  return {
    device: `serial:${usbVendorId ?? ''}:${usbProductId ?? ''}`,
    port,
    /** @param {{ baudRate: number }} options */
    async open({ baudRate }) {
      await port.open({ baudRate });
      writer = port.writable.getWriter();
      reader = port.readable.getReader();
    },
    async *bytes() {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          yield value;
        }
      } catch {
        // The port went away; the session says so.
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Already released.
        }
        try {
          writer?.releaseLock();
        } catch {
          // Already released.
        }
      }
    },
    /** @param {Uint8Array} bytes */
    write: (bytes) => writer.write(bytes),
    /** Cancels the reader once, however often it is called (E3b counts cancels). */
    async close() {
      if (reader && !cancelled) {
        cancelled = true;
        await reader.cancel().catch(() => {});
      }
      try {
        writer?.releaseLock();
      } catch {
        // Already released.
      }
      await port.close().catch(() => {});
    },
  };
}
