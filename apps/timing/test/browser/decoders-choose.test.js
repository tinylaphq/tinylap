// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Choosing a plain ZRound decoder on the bridge page, and the choice this browser remembers (decoders spec §6.2, D1–D3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { postPassings } from './browser.js';
import { setup, app, fresh, UNPLUG, apiRequests, openZround, ZROUND_DEVICE, toChoose, remember, decoderNamed } from './decoders-helpers.js';

setup();

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

test('with nothing remembered, focus moves from the hidden Connect button to the choose heading', async (t) => {
  const { page, errors } = await fresh(t);
  await openZround(t, page);
  await toChoose(page);
  assert.deepEqual(await page.evaluate(() => [document.activeElement?.tagName, document.activeElement?.textContent]), ['H2', 'Which decoder is this?']);
  assert.deepEqual(errors, []);
});

test('a club with a decoder on Wi-Fi refreshes no page on connect: the server named every decoder it knew', async (t) => {
  const { page, errors, member, space } = await fresh(t);
  const wifi = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Wi-Fi' })).json();
  assert.equal((await postPassings(app, wifi, [{ transponder: '0A', t: 1000 }])).status, 200);
  assert.equal(app.store.choosableDecoders(space).length, 0, 'a decoder on Wi-Fi is not choosable');
  await openZround(t, page);
  const gets = [];
  page.on('request', (r) => { if (r.resourceType() === 'fetch' && new URL(r.url()).pathname === '/personal/bridge') gets.push(r.url()); });
  await toChoose(page);
  // Shows that no refresh comes late.
  await page.waitForTimeout(500);
  assert.deepEqual(gets, []);
  assert.deepEqual(errors, []);
});

test('a replaced bridge writes nothing while the next one connects, and no longer guards leaving', async (t) => {
  const { page, errors } = await fresh(t);
  await openZround(t, page);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  // The next connect's decoder list never answers, so it stays connecting for its 3 s cap.
  await page.route('**/workspaces/*/decoders', (route) => (route.request().method() === 'GET' ? new Promise(() => {}) : route.continue()));
  await page.evaluate(() => {
    /** @type {any} */ (window).__old = /** @type {any} */ (document.querySelector('tl-bridge')).run.bridge;
    /** @type {HTMLElement} */ (document.querySelector('[data-bridge-connect="serial"]')).click();
  });
  await page.locator('[data-bridge-state="connecting"]').waitFor();
  const seen = await page.evaluate(() => {
    const old = /** @type {any} */ (window).__old;
    old.dispatchEvent(new Event('online'));
    old.dispatchEvent(new Event('outbox'));
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    return { live: document.querySelector('[data-bridge-live]')?.textContent, guarded: leave.defaultPrevented };
  });
  assert.deepEqual(seen, { live: 'Talking to the decoder.', guarded: false });
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

test('D2c: a replaced bridge\'s late identity change forgets nothing the new connect remembered', async (t) => {
  const { page, errors, space } = await fresh(t);
  await page.addInitScript(UNPLUG);
  await openZround(t, page);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.evaluate(() => {
    /** @type {any} */ (window).__old = /** @type {any} */ (document.querySelector('tl-bridge')).run.bridge;
    /** @type {any} */ (window).__unplug();
  });
  await page.getByRole('button', { name: 'Connect again' }).waitFor();
  await toChoose(page, 'Is this Gate?');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.evaluate(() => /** @type {any} */ (window).__old.dispatchEvent(new Event('identity-changed')));
  // Shows that no forget lands late.
  await page.waitForTimeout(300);
  const remembered = await page.evaluate(async ([w, d]) => (await (await import('/public/devices.js')).openDevices()).recall(w, d), [space, ZROUND_DEVICE]);
  assert.equal(remembered, decoderNamed(space, 'Gate').id);
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
