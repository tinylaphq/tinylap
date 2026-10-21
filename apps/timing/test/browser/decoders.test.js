// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Plain ZRound decoders and EasyLaps on the bridge page (decoders spec §6.2, D1–D14).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** A member of their own, so each test starts with an empty personal space. */
async function fresh(t, options = {}) {
  const member = await app.login(await app.signUp('Ana'));
  const space = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  const who = await pageAs(browser, app, member, options);
  t.after(() => who.context.close());
  return { ...who, member, space };
}

/** Turns the server's simulator on for this test only (decoders spec §5.4). */
const simulating = (t, value) => {
  app.simulate = value;
  t.after(() => { app.simulate = null; });
};

/** navigator.hid with one device to pick, built in the page from the fake HID device and the EasyLap model. */
const HID = (options) => {
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
const SILENT_SERIAL = () => {
  /** @type {any} */ (window).__picks = 0;
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: { requestPort: async () => {
      /** @type {any} */ (window).__picks += 1;
      return { readable: new ReadableStream(), writable: new WritableStream(), open: async () => {}, close: async () => {}, getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }) };
    } },
  });
};

test('with WebHID only, just Connect EasyLap is offered, and the note says USB decoders can\'t be reached', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(() => { delete Navigator.prototype.serial; });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), false);
  assert.equal(await page.getByText("This browser can't reach USB decoders, only an EasyLap.").isVisible(), true);
  assert.equal(await page.getByText("This browser can't reach an EasyLap, only other USB decoders.").isVisible(), false);
  assert.deepEqual(errors, []);
});

test('D7: a device that says nothing is listening, not an error, and Try another device opens one picker', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(SILENT_SERIAL);
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByText('Connected, but nothing has come from this device yet.').waitFor({ timeout: 20_000 });
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: 'Try another device' }).click();
  await page.waitForFunction(() => /** @type {any} */ (window).__picks === 2);
  assert.deepEqual(errors, []);
});

test('D8: with the setting easylap,fast, Connect decoder is a closed picker, both buttons show, and with it off nothing loads', async (t) => {
  const { page, errors } = await fresh(t);
  simulating(t, 'easylap,fast');
  await page.addInitScript(() => { delete Navigator.prototype.serial; delete Navigator.prototype.hid; });
  await page.goto('/personal/bridge');
  assert.equal(await page.getByText("This browser can't reach USB decoders, only an EasyLap.").isVisible(), false);
  assert.equal(await page.getByText("This browser can't reach an EasyLap, only other USB decoders.").isVisible(), false);
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), true);
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  app.simulate = null;
  const loads = [];
  page.on('request', (r) => { if (r.url().includes('/sim/install.js')) loads.push(r.url()); });
  await page.goto('/personal/bridge?simulate=easylap');
  assert.deepEqual(loads, [], 'with the setting off, nothing of the simulator loads, whatever the URL says');
  assert.deepEqual(errors, []);
});

test('D11: a closed HID picker is no error, and Connect stays', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(HID, { none: true });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.waitForFunction(() => /** @type {any} */ (window).__picks === 1);
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Connect EasyLap' }).isVisible(), true);
  assert.deepEqual(errors, []);
});

test('D12: an EasyLap that can\'t be opened shows the error as an alert, and Connect stays', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(HID, { failOpen: true });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('alert').filter({ hasText: /denied/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect EasyLap' }).isVisible(), true);
});

test('D13: an EasyLap whose frames all fail the checksum says its data can\'t be read', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(HID, { corrupt: true });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByText("Data is coming, but it can't be read. Report this device.").waitFor({ timeout: 20_000 });
  assert.equal(await page.getByText('Connected, but nothing has come from this device yet.').isVisible(), false);
});
