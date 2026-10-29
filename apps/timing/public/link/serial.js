// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A decoder on Web Serial (decoders spec §2.3): bytes in, bytes out. Its
// device name is the USB chip's ids, which Web Serial shows; it has no serial
// number, so two decoders on the same chip look alike (spec §3.2).

/** Rejected reads in a row before the transport ends as for a lost device (spec §3.2). */
export const MAX_FAILURES_IN_A_ROW = 20;

/** @param {any} port a SerialPort, or a look-alike */
export function serialTransport(port) {
  const { usbVendorId, usbProductId } = port.getInfo?.() ?? {};
  let reader = null;
  let writer = null;
  let cancelled = false;
  let closed = false;
  let failures = 0;
  /** Read errors by name. A plain object, changed in place, so a spread of the transport still sees it. @type {Record<string, number>} */
  const errors = {};
  return {
    device: `serial:${usbVendorId ?? ''}:${usbProductId ?? ''}`,
    port,
    errors,
    /** @param {{ baudRate: number }} options */
    async open({ baudRate }) {
      await port.open({ baudRate });
      writer = port.writable.getWriter();
      reader = port.readable.getReader();
    },
    /**
     * The bytes read, with a null after each non-fatal read error, where bytes were lost.
     * port.readable alone decides whether reading goes on: after a non-fatal error it is a new stream,
     * after a fatal one null. The error's name is only counted.
     * @returns {AsyncGenerator<Uint8Array | null>}
     */
    async *bytes() {
      try {
        while (!closed) {
          try {
            reader ??= port.readable?.getReader() ?? null;
          } catch {
            // A stream locked elsewhere: nothing to read, as for a lost port; the session says so.
            return;
          }
          if (!reader) return;
          try {
            for (;;) {
              const { value, done } = await reader.read();
              // Closed, or the stream ended without a close: either way, the end.
              if (done) return;
              failures = 0;
              yield value;
            }
          } catch (error) {
            const name = error?.name ?? 'Error';
            errors[name] = (errors[name] ?? 0) + 1;
            if (closed || !port.readable || ++failures > MAX_FAILURES_IN_A_ROW) return;
            yield null;
          } finally {
            try {
              reader.releaseLock();
            } catch {
              // close() released it.
            }
            reader = null;
          }
        }
      } finally {
        try {
          writer?.releaseLock();
        } catch {
          // Already released.
        }
      }
    },
    /** @param {Uint8Array} bytes */
    write: (bytes) => writer.write(bytes),
    /** Cancels the current reader once, however often it is called (E3b counts cancels). */
    async close() {
      // Before the cancel, so a close between two readers never takes a third.
      closed = true;
      if (reader && !cancelled) {
        cancelled = true;
        await reader.cancel().catch(() => {});
      }
      // A SerialPort won't close while a stream is locked.
      try {
        reader?.releaseLock();
      } catch {
        // Already released.
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
