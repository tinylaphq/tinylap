// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The simulator at the platform boundary (decoders spec §5.4). The layout loads it, before the page's
// own scripts, only while the server's TINYLAP_SIMULATE is set; the server doesn't even serve it
// otherwise. It stands in for Web Serial's and WebHID's pickers: the configured model's transport
// returns a fresh simulated device when the member clicks Connect, and the other transport acts as a
// closed picker. tl-bridge calls the real APIs, unaware of it. A picked serial port stays permitted
// (getPorts) while it is plugged in: its unplug() takes it out of the list. Its replug() plugs the device
// back in as Chrome shows it: a new port with the same USB ids, permitted, and navigator.serial's connect
// event with that port as its target. plugIn() does the same without the event.
import { simulatedDevice, simulation } from './models.js';

/** @param {any} nav the page's navigator, or a stand-in @param {string | null | undefined} value `<model>[,fast]` */
export function install(nav, value) {
  const sim = simulation(value);
  if (!sim) return;
  const serial = nav.serial ?? new EventTarget();
  const hid = nav.hid ?? new EventTarget();
  /** @type {Set<any>} */
  const permitted = new Set();
  /** A fresh simulated port, permitted, that can be unplugged and plugged back in. */
  const grant = () => {
    const port = simulatedDevice(sim);
    const unplug = port.unplug;
    Object.assign(port, {
      unplug() {
        permitted.delete(port);
        unplug();
      },
      plugIn: () => grant(),
      replug() {
        const next = grant();
        const event = new Event('connect');
        // Chrome fires it at the port, from where it bubbles to navigator.serial.
        Object.defineProperty(event, 'target', { value: next });
        serial.dispatchEvent(event);
        return next;
      },
    });
    permitted.add(port);
    return port;
  };
  Object.assign(serial, {
    requestPort: async () => {
      if (sim.transport !== 'serial') throw new DOMException('No port selected by the user.', 'NotFoundError');
      return grant();
    },
    getPorts: async () => [...permitted],
  });
  Object.assign(hid, {
    requestDevice: async () => (sim.transport === 'hid' ? [simulatedDevice(sim, { hid })] : []),
    getDevices: async () => [],
  });
  Object.defineProperty(nav, 'serial', { configurable: true, value: serial });
  Object.defineProperty(nav, 'hid', { configurable: true, value: hid });
}

const script = typeof document === 'undefined' ? null : document.querySelector('script[data-model][src$="/sim/install.js"]');
if (script) install(navigator, /** @type {HTMLElement} */ (script).dataset.model);
