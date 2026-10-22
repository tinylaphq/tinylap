// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// EasyLaps over WebHID, devices that only listen, and disconnects on the bridge page (decoders spec §6.2, D6–D8, D11–D13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, app, fresh, simulating, HID, SILENT_SERIAL, UNPLUG, openEasylap } from './decoders-helpers.js';

setup();

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
  await page.locator('[data-bridge-unreadable]', { hasText: "Data is coming, but it can't be read. Report this device." }).waitFor({ timeout: 20_000 });
  assert.equal(await page.getByText('Connected, but nothing has come from this device yet.').isVisible(), false);
  await page.locator('[data-bridge-live]', { hasText: "Data is coming, but it can't be read. Report this device." }).waitFor({ state: 'attached', timeout: 10_000 });
});

test('D6a: an EasyLap (setting easylap,fast) is chosen and forwards, with its 24-bit codes as hex', async (t) => {
  const { page, errors } = await fresh(t);
  simulating(t, 'easylap,fast');
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('[data-bridge-kind]').innerText(), "An EasyLap can't keep a pairing. This browser remembers which decoder it is for your personal space.");
  await page.getByLabel('Name for the new decoder').fill('Lap box');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Lap box', { exact: true }).first().waitFor();
  const code = page.locator('[data-bridge-preview] li .bridge-code').first();
  await code.waitFor({ timeout: 30_000 });
  assert.match(await code.innerText(), /^A1B2[CDE]$/);
  assert.deepEqual(errors, []);
});

test('D6b: the CP2110 is configured, then enabled, and a removal disables its UART', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(HID, {});
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  assert.deepEqual(await page.evaluate(() => /** @type {any} */ (window).__device.log.slice(0, 2)), [[0x50, 0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0x03, 0x00], [0x41, 0x01]]);
  await page.evaluate(() => document.querySelector('tl-bridge').remove());
  await page.waitForFunction(() => JSON.stringify(/** @type {any} */ (window).__device.log.at(-1)) === '[65,0]');
});

test('an EasyLap unplugged while forwarding says so, with what a replug costs', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(HID, {});
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  await page.getByLabel('Name for the new decoder').fill('Lap box');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Lap box', { exact: true }).first().waitFor();
  await page.evaluate(() => /** @type {any} */ (window).__device.unplug());
  await page.locator('p.status-warning', { hasText: 'Decoder disconnected.' }).waitFor();
  assert.equal(await page.getByText("Crossings while it is unplugged are lost, and each car's lap starts over when you connect again.").isVisible(), true);
});

test('two tabs on one EasyLap: the second refuses before opening it, and connects once the first lets go', async (t) => {
  const { page: first, context, errors } = await fresh(t);
  simulating(t, 'easylap,fast');
  const second = await context.newPage();
  const taken = 'This decoder is connected in another tab.';
  await openEasylap(first);
  await openEasylap(second);
  await first.getByRole('button', { name: 'Connect EasyLap' }).click();
  await first.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });

  await second.getByRole('button', { name: 'Connect EasyLap' }).click();
  await second.locator('p.status-warning', { hasText: taken }).waitFor();
  await second.locator('[data-bridge-live]', { hasText: taken }).waitFor({ state: 'attached' });
  assert.equal(await second.getByRole('button', { name: 'Connect EasyLap' }).isVisible(), true);
  // Shows that the refused tab never opens the device, nor turns its UART off.
  await second.waitForTimeout(300);
  assert.deepEqual(await second.evaluate(() => /** @type {any} */ (window).__devices.map((d) => ({ opened: d.opened, log: d.log }))), [{ opened: false, log: [] }]);
  assert.equal(await first.getByRole('heading', { name: 'Which decoder is this?' }).isVisible(), true);

  // An unplug in the first tab lets go of it.
  await first.evaluate(() => /** @type {any} */ (window).__devices[0].unplug());
  await first.locator('p.status-warning', { hasText: 'Decoder disconnected.' }).waitFor();
  await second.getByRole('button', { name: 'Connect EasyLap' }).click();
  await second.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  assert.equal(await second.locator('p.status-warning', { hasText: taken }).isVisible(), false);

  // Now the first tab is refused, until the second navigates away.
  await first.getByRole('button', { name: 'Connect again' }).click();
  await first.locator('p.status-warning', { hasText: taken }).waitFor();
  await second.goto('/personal');
  await first.getByRole('button', { name: 'Connect EasyLap' }).click();
  await first.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  assert.deepEqual(errors, []);
});

test('the same tab connects its EasyLap again: the lock it held is free once its bridge closes', async (t) => {
  const { page, errors } = await fresh(t);
  simulating(t, 'easylap,fast');
  await openEasylap(page);
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('[data-bridge-connect="hid"]')).click());
  await page.waitForFunction(() => /** @type {any} */ (window).__devices.length === 2 && /** @type {any} */ (window).__devices[1].opened);
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('[data-bridge-taken]').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('an EasyLap that sends only corrupt frames ends in listening with the unreadable note, never the choose form', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(HID, { corrupt: true });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.locator('[data-bridge-unreadable]', { hasText: "Data is coming, but it can't be read. Report this device." }).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('[data-bridge-state="listening"]').isVisible(), true);
  // The note shows only when the element sees mismatches > 0 (bridge.js unreadable()).
  await page.waitForTimeout(3000);
  assert.equal(await page.getByRole('heading', { name: 'Which decoder is this?' }).isVisible(), false);
  assert.equal(await page.locator('[data-bridge-unreadable]').isVisible(), true);
  assert.deepEqual(errors, []);
});

test('Try another device after an EasyLap picks over HID once more, and no third time', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(HID, { corrupt: true });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.locator('[data-bridge-unreadable]').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Try another device' }).click();
  await page.waitForFunction(() => /** @type {any} */ (window).__picks === 2, null, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => /** @type {any} */ (window).__picks), 2);
  assert.deepEqual(errors, []);
});

test('a TinyLap decoder that disconnects keeps the gap note hidden', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(UNPLUG);
  simulating(t, 'tinylap,fast');
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor({ timeout: 20_000 });
  await page.getByLabel('Decoder name').fill('Gate');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.evaluate(() => /** @type {any} */ (window).__unplug());
  await page.locator('p.status-warning', { hasText: 'Decoder disconnected.' }).waitFor();
  assert.equal(await page.locator('[data-bridge-gap]').isVisible(), false);
});

test('a plain ZRound decoder that disconnects while still undecided shows no gap note', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(() => {
    /** @type {any} */ (window).__picks = 0;
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => {
      /** @type {any} */ (window).__picks += 1;
      const readable = new ReadableStream({ start: (c) => { /** @type {any} */ (window).__unplug = () => c.close(); } });
      return { readable, writable: new WritableStream(), open: async () => {}, close: async () => {}, getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }) };
    } } });
  });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByText('Connected, but nothing has come from this device yet.').waitFor({ timeout: 20_000 });
  await page.evaluate(() => /** @type {any} */ (window).__unplug());
  await page.locator('p.status-warning', { hasText: 'Decoder disconnected.' }).waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('[data-bridge-gap]').isVisible(), false);
});

