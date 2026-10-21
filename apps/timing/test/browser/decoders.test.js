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
  await page.locator('[data-bridge-unreadable]', { hasText: "Data is coming, but it can't be read. Report this device." }).waitFor({ timeout: 20_000 });
  assert.equal(await page.getByText('Connected, but nothing has come from this device yet.').isVisible(), false);
  await page.locator('[data-bridge-live]', { hasText: "Data is coming, but it can't be read. Report this device." }).waitFor({ state: 'attached', timeout: 10_000 });
});

/** Captures the newest readable's controller, so window.__unplug() pulls the cable (as bridge.test.js:229-235). */
const UNPLUG = () => {
  const R = window.ReadableStream;
  window.ReadableStream = class extends R {
    constructor(source, ...rest) {
      super(source && { ...source, start: (c) => { /** @type {any} */ (window).__unplug = () => c.close(); return source.start?.(c); } }, ...rest);
    }
  };
};

/** Requests to the decoder and workspace APIs, from now on. */
function apiRequests(page) {
  const seen = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (/^\/(decoders|workspaces)\//.test(pathname)) seen.push(`${r.method()} ${pathname}`);
  });
  return seen;
}

/** The bridge page with the server's simulated plain decoder (setting zround,fast). */
async function openZround(t, page) {
  simulating(t, 'zround,fast');
  await page.goto('/personal/bridge');
}
/** The simulated plain decoder's device key: its FTDI chip. */
const ZROUND_DEVICE = 'serial:1027:24577';

/** Connects the simulated plain decoder and waits for the choose form. */
async function toChoose(page, heading = 'Which decoder is this?') {
  await page.getByRole('button', { name: /^Connect (decoder|again)$/ }).first().click();
  await page.getByRole('heading', { name: heading }).waitFor({ timeout: 30_000 });
}

/** Seeds this browser's remembered choice through its module. */
const remember = (page, space, decoder) => page.evaluate(async ([w, d, id]) => {
  const { openDevices } = await import('/public/devices.js');
  await (await openDevices()).remember(w, d, id);
}, [space, ZROUND_DEVICE, decoder]);

const decoderNamed = (space, name) => app.store.decoders(space).find((d) => d.name === name);

test('D1: a plain ZRound decoder is chosen as a new decoder and forwards; the browser keeps only { decoder }', async (t) => {
  const { page, errors, space } = await fresh(t);
  await openZround(t, page);
  await toChoose(page);
  assert.equal(await page.locator('[data-bridge-kind]').innerText(), "This decoder speaks plain ZRound, so it can't keep a pairing. This browser remembers which decoder it is for your personal space.");
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.locator('[data-bridge-preview] li').first().waitFor({ timeout: 30_000 });
  assert.deepEqual(app.store.decoders(space).map((d) => d.name), ['Gate']);
  assert.ok(app.engine.snapshot(space).crossings.length > 0);
  const records = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('tinylap-bridge-devices');
    open.onsuccess = () => { const all = open.result.transaction('devices').objectStore('devices').getAll(); all.onsuccess = () => resolve(all.result); all.onerror = () => reject(all.error); };
    open.onerror = () => reject(open.error);
  }));
  assert.deepEqual(records, [{ decoder: decoderNamed(space, 'Gate').id }]);
  // The real store keeps each club's choice apart, and forget removes the entry.
  const store = await page.evaluate(async ([w, device]) => {
    const devices = await (await import('/public/devices.js')).openDevices();
    await devices.remember('w1', device, 'one');
    const separate = { w1: await devices.recall('w1', device), w2: await devices.recall('w2', device), mine: await devices.recall(w, device) };
    await devices.forget('w1', device);
    return { ...separate, forgotten: await devices.recall('w1', device), mineAfter: await devices.recall(w, device) };
  }, [space, ZROUND_DEVICE]);
  assert.deepEqual(store, { w1: 'one', w2: null, mine: decoderNamed(space, 'Gate').id, forgotten: null, mineAfter: decoderNamed(space, 'Gate').id });
  assert.deepEqual(errors, []);
});

test('D1b: a store that fails every call blocks neither the connect nor the choice', async (t) => {
  const { page, errors, space } = await fresh(t);
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.addInitScript(() => {
    const real = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function transaction(names, ...rest) {
      if (names === 'devices') throw new DOMException('broken', 'UnknownError');
      return real.call(this, names, ...rest);
    };
  });
  await openZround(t, page);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  assert.deepEqual(app.store.decoders(space).map((d) => d.name), ['Gate']);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(warnings.filter((w) => /remember/i.test(w)).length, 1, 'logged once');
  assert.deepEqual(errors, []);
});

test('D2: a remembered decoder is confirmed, not forwarded silently', async (t) => {
  const { page, errors, space } = await fresh(t);
  await page.addInitScript(UNPLUG);
  await openZround(t, page);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.evaluate(() => /** @type {any} */ (window).__unplug());
  await page.getByRole('button', { name: 'Connect again' }).waitFor();
  const seen = apiRequests(page);
  await toChoose(page, 'Is this Gate?');
  const gate = decoderNamed(space, 'Gate');
  assert.equal(await page.locator('#bridge-choose').inputValue(), gate.id);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Use this decoder');
  await page.waitForTimeout(500);
  assert.deepEqual(seen.filter((r) => r.endsWith('/passings')), [], 'nothing is posted before the click');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  assert.deepEqual(seen.filter((r) => r.startsWith('POST /workspaces/')), []);
  assert.deepEqual(errors, []);
});

test('D2b: when the page can\'t be refreshed for a decoder made since it loaded, the form still opens, with nothing preselected', async (t) => {
  const { page, errors, member, space } = await fresh(t);
  await openZround(t, page);
  const late = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Late' })).json();
  await remember(page, space, late.id);
  await page.route('**/personal/bridge', (route) => (route.request().resourceType() === 'fetch' ? route.abort() : route.continue()));
  const refreshed = page.waitForRequest((r) => r.resourceType() === 'fetch' && new URL(r.url()).pathname === '/personal/bridge');
  await toChoose(page);
  await refreshed;
  assert.equal(await page.locator('#bridge-choose').inputValue(), '');
  assert.equal(await page.locator(`#bridge-choose option[value="${late.id}"]`).count(), 0);
  const remembered = await page.evaluate(async ([w, d]) => (await (await import('/public/devices.js')).openDevices()).recall(w, d), [space, ZROUND_DEVICE]);
  assert.equal(remembered, late.id, 'still remembered: the server has it');
  assert.deepEqual(errors.filter((e) => !/net::ERR_FAILED/.test(e)), []);
});

test('D3: a remembered decoder removed on the server is not offered, and gets no passing', async (t) => {
  const { page, member, space } = await fresh(t);
  await page.addInitScript(UNPLUG);
  await openZround(t, page);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  const gate = decoderNamed(space, 'Gate');
  await page.locator('[data-bridge-outbox]', { hasText: /^0$/ }).waitFor({ timeout: 30_000 });
  assert.equal((await app.api(member, 'DELETE', `/workspaces/${space}/decoders/${gate.id}`)).status, 204);
  await page.evaluate(() => /** @type {any} */ (window).__unplug());
  const seen = apiRequests(page);
  await toChoose(page);
  assert.equal(await page.locator(`#bridge-choose option[value="${gate.id}"]`).count(), 0);
  await page.waitForTimeout(500);
  assert.deepEqual(seen.filter((r) => r === `POST /decoders/${gate.id}/passings`), []);
});

// D4 covers a decoder removed before Connect only (see the note at the top of this task).
test('D4: an existing decoder can be chosen without making one; one removed before Connect is not offered', async (t) => {
  const { page, member, space } = await fresh(t);
  const old = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Old' })).json();
  const gone = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Gone' })).json();
  await openZround(t, page);
  await app.api(member, 'DELETE', `/workspaces/${space}/decoders/${gone.id}`);
  const seen = apiRequests(page);
  await toChoose(page);
  assert.equal(await page.locator(`#bridge-choose option[value="${gone.id}"]`).count(), 0, 'its option goes');
  await page.locator('#bridge-choose').selectOption(old.id);
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Old', { exact: true }).first().waitFor();
  assert.deepEqual(seen.filter((r) => r.startsWith('POST /workspaces/')), []);
});

/** Makes "Busy" and "Mine", both seen just now over the cable, and remembers "Mine" for the simulated device. */
async function busyAndMine(t, page, member, space) {
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

test('D5: a decoder seen in the last 2 minutes is in use, by the server\'s clock; the remembered one says so but stays enabled', async (t) => {
  const { page, member, space } = await fresh(t);
  await page.addInitScript(() => { const real = Date.now; Date.now = () => real() + 600_000; });
  const { busy, mine } = await busyAndMine(t, page, member, space);
  await toChoose(page, 'Is this Mine?');
  const option = (id) => page.locator(`#bridge-choose option[value="${id}"]`);
  assert.equal(await option(busy.id).innerText(), 'Busy (in use)');
  assert.equal(await option(busy.id).isDisabled(), true);
  assert.equal(await option(mine.id).innerText(), 'Mine (in use)');
  assert.equal(await option(mine.id).isDisabled(), false);
  assert.equal(await page.locator('#bridge-choose').inputValue(), mine.id);
});

test('D14: when the connect GET fails, the options stay as rendered, the remembered one is preselected, and the choice still works', async (t) => {
  const { page, member, space } = await fresh(t);
  const { busy, mine } = await busyAndMine(t, page, member, space);
  await page.route('**/workspaces/*/decoders', (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{"status":503,"detail":"Down."}' }) : route.continue()));
  const seen = apiRequests(page);
  await toChoose(page, 'Is this Mine?');
  const option = (id) => page.locator(`#bridge-choose option[value="${id}"]`);
  assert.equal(await option(busy.id).innerText(), 'Busy');
  assert.equal(await option(busy.id).isDisabled(), false);
  assert.equal(await page.locator('#bridge-choose').inputValue(), mine.id);
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Mine', { exact: true }).first().waitFor();
  assert.deepEqual(seen.filter((r) => r.startsWith('POST /workspaces/')), []);
});

test('D14b: a connect GET that never answers is given up after 3 s, as a failed one', async (t) => {
  const { page, member, space } = await fresh(t);
  const { mine } = await busyAndMine(t, page, member, space);
  await page.route('**/workspaces/*/decoders', (route) => (route.request().method() === 'GET' ? new Promise(() => {}) : route.continue()));
  await toChoose(page, 'Is this Mine?');
  assert.equal(await page.locator('#bridge-choose').inputValue(), mine.id);
  // A TinyLap decoder still reaches its pairing form: the 3 s cap, the 1.5 s open delay and its handshake.
  app.simulate = 'tinylap,fast';
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor({ timeout: 10_000 });
});

test('D9: a replug says what it costs, and the passings after it carry a new boot', async (t) => {
  const { page, space } = await fresh(t);
  await page.addInitScript(UNPLUG);
  const boots = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/passings')) boots.push(JSON.parse(r.postData() ?? '{}').boot);
  });
  await openZround(t, page);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.locator('[data-bridge-preview] li').first().waitFor({ timeout: 30_000 });
  const starts = () => app.engine.snapshot(space).crossings.filter((c) => c.lapMs === null).length;
  const startsBefore = starts();
  await page.evaluate(() => /** @type {any} */ (window).__unplug());
  await page.getByText("Crossings while it is unplugged are lost, and each car's lap starts over when you connect again.").waitFor();
  const before = new Set(boots);
  await toChoose(page, 'Is this Gate?');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-bridge-preview] li').length > n, await page.locator('[data-bridge-preview] li').count(), { timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  while (!(boots.some((b) => !before.has(b)) && starts() > startsBefore) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
  assert.ok(boots.some((b) => !before.has(b)), 'a new boot after the replug');
  assert.ok(starts() > startsBefore, 'each car starts over');
});

test('D10: noise (double reads and garbage) makes no page error, and laps still show', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => {
      const { fakeSerialPort } = await import('/public/sim/serial-port.js');
      const { zroundModel } = await import('/public/sim/models/zround.js');
      return fakeSerialPort(zroundModel({ lapMs: 2000, noise: { double: 0.5, garbage: 0.5 } }));
    } } });
  });
  await page.goto('/personal/bridge');
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Noisy');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.locator('[data-bridge-preview] li', { has: page.locator('.bridge-code + .num') }).first().waitFor({ timeout: 40_000 });
  assert.deepEqual(errors, []);
});

test('Review focus 3: "Use this decoder" clicked twice makes one decoder', async (t) => {
  const { page, space } = await fresh(t);
  await openZround(t, page);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Once');
  await page.getByRole('button', { name: 'Use this decoder' }).dblclick();
  await page.getByText('Forwarding from Once', { exact: true }).first().waitFor();
  assert.deepEqual(app.store.decoders(space).map((d) => d.name), ['Once']);
});
