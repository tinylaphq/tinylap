// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What the decoders browser tests share (decoders spec §6.2): each file that uses it gets its own app and browser.
import { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

export let app;
export let browser;

/** Starts this file's app and browser before its tests, and closes both after. */
export function setup() {
  before(async () => {
    app = await startTiming();
    browser = await openBrowser();
  });
  after(async () => {
    await browser?.close();
    await app?.close();
  });
}

/** A member of their own, so each test starts with an empty personal space. */
export async function fresh(t, options = {}) {
  const member = await app.login(await app.signUp('Ana'));
  const space = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  const who = await pageAs(browser, app, member, options);
  t.after(() => who.context.close());
  return { ...who, member, space };
}

/** Turns the server's simulator on for this test only (decoders spec §5.4). */
export const simulating = (t, value) => {
  app.simulate = value;
  t.after(() => { app.simulate = null; });
};

/** navigator.hid with one device to pick, built in the page from the fake HID device and the EasyLap model. */
export const HID = (options) => {
  const hid = new EventTarget();
  /** @type {any} */ (window).__picks = 0;
  Object.defineProperty(navigator, 'hid', {
    configurable: true,
    value: Object.assign(hid, {
      requestDevice: async () => {
        /** @type {any} */ (window).__picks += 1;
        if (options.none) return [];
        const { fakeHidDevice } = await import('/public/sim/hid-device.js');
        const { easylapModel } = await import('/public/sim/models/easylap.js');
        const device = fakeHidDevice(easylapModel({ lapMs: 2000, corrupt: Boolean(options.corrupt) }), { hid, failOpen: Boolean(options.failOpen) });
        /** @type {any} */ (window).__device = device;
        return [device];
      },
    }),
  });
};

/** navigator.serial whose picks are silent ports, counted in window.__picks. */
export const SILENT_SERIAL = () => {
  /** @type {any} */ (window).__picks = 0;
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: { requestPort: async () => {
      /** @type {any} */ (window).__picks += 1;
      return { readable: new ReadableStream(), writable: new WritableStream(), open: async () => {}, close: async () => {}, getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }) };
    } },
  });
};

/** Captures the newest readable's controller, so window.__unplug() pulls the cable (as bridge.test.js:229-235). */
export const UNPLUG = () => {
  const R = window.ReadableStream;
  window.ReadableStream = class extends R {
    constructor(source, ...rest) {
      super(source && { ...source, start: (c) => { /** @type {any} */ (window).__unplug = () => c.close(); return source.start?.(c); } }, ...rest);
    }
  };
};

/** Requests to the decoder and workspace APIs, from now on. */
export function apiRequests(page) {
  const seen = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (/^\/(decoders|workspaces)\//.test(pathname)) seen.push(`${r.method()} ${pathname}`);
  });
  return seen;
}

/** The bridge page with the server's simulated plain decoder (setting zround,fast). */
export async function openZround(t, page) {
  simulating(t, 'zround,fast');
  await page.goto('/personal/bridge');
}
/** The simulated plain decoder's device key: its FTDI chip. */
export const ZROUND_DEVICE = 'serial:1027:24577';

/** Connects the simulated plain decoder and waits for the choose form. */
export async function toChoose(page, heading = 'Which decoder is this?') {
  await page.getByRole('button', { name: /^Connect (decoder|again)$/ }).first().click();
  await page.getByRole('heading', { name: heading }).waitFor({ timeout: 30_000 });
}

/** Seeds this browser's remembered choice through its module. */
export const remember = (page, space, decoder) => page.evaluate(async ([w, d, id]) => {
  const { openDevices } = await import('/public/devices.js');
  await (await openDevices()).remember(w, d, id);
}, [space, ZROUND_DEVICE, decoder]);

export const decoderNamed = (space, name) => app.store.decoders(space).find((d) => d.name === name);

/** Makes "Busy" and "Mine", both seen just now over the cable, and remembers "Mine" for the simulated device. */
export async function busyAndMine(t, page, member, space) {
  const make = async (name) => {
    const d = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name })).json();
    assert.equal((await app.api(member, 'POST', `/decoders/${d.id}/passings`, { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1000 }] })).status, 200);
    return d;
  };
  const busy = await make('Busy');
  const mine = await make('Mine');
  await openZround(t, page);
  await remember(page, space, mine.id);
  await page.reload();
  return { busy, mine };
}

/** Opens the bridge with the simulated EasyLap, keeping each picked device in window.__devices. */
export async function openEasylap(page) {
  await page.goto('/personal/bridge');
  await page.evaluate(() => {
    const hid = /** @type {any} */ (navigator).hid;
    const pick = hid.requestDevice;
    /** @type {any} */ (window).__devices = [];
    hid.requestDevice = async (...options) => {
      const picked = await pick(...options);
      /** @type {any} */ (window).__devices.push(...picked);
      return picked;
    };
  });
}
