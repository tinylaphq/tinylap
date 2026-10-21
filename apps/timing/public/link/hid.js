// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An EasyLap on WebHID (decoders spec §2.6, research §1.1): a CP2110
// HID-to-UART bridge. Open sets the UART to 38400 8N1 with feature report
// 0x50 and enables it with 0x41 [01]; input reports carry `reportId` data
// bytes; output report n carries n bytes; close disables the UART.

export const EASYLAP_FILTER = Object.freeze({ vendorId: 0x10c4, productId: 0x86b9 });
const UART_38400_8N1 = Uint8Array.of(0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0x03, 0x00);

/** @param {any} device an HIDDevice, or a look-alike @param {{ hid?: EventTarget }} [options] the source of `disconnect` events */
export function hidTransport(device, { hid = /** @type {any} */ (globalThis.navigator)?.hid } = {}) {
  /** @type {Uint8Array[]} */
  const queue = [];
  let wake = null;
  let ended = false;
  let closed = false;
  const end = () => {
    ended = true;
    wake?.();
  };
  /** @param {any} event */
  const onReport = (event) => {
    const n = Math.min(event.reportId, event.data.byteLength);
    queue.push(new Uint8Array(event.data.buffer, event.data.byteOffset, n).slice());
    wake?.();
  };
  /** @param {any} event */
  const onDisconnect = (event) => {
    if (event.device === device) end();
  };
  return {
    device: `hid:${device.vendorId}:${device.productId}`,
    async open() {
      if (!device.opened) await device.open();
      device.addEventListener('inputreport', onReport);
      hid?.addEventListener('disconnect', onDisconnect);
      await device.sendFeatureReport(0x50, UART_38400_8N1);
      await device.sendFeatureReport(0x41, Uint8Array.of(0x01));
    },
    async *bytes() {
      for (;;) {
        while (queue.length) yield queue.shift();
        if (ended) return;
        await new Promise((resolve) => { wake = resolve; });
        wake = null;
      }
    },
    /** One output report: its id is its length (not length + 1, pycp2110's bug). @param {Uint8Array} bytes */
    write: (bytes) => device.sendReport(bytes.length, bytes),
    async close() {
      if (closed) return;
      closed = true;
      end();
      device.removeEventListener('inputreport', onReport);
      hid?.removeEventListener('disconnect', onDisconnect);
      await device.sendFeatureReport(0x41, Uint8Array.of(0x00)).catch(() => {});
      await device.close().catch(() => {});
    },
  };
}
