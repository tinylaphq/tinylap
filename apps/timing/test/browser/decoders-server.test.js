// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A plain ZRound decoder against the server's decoder list, a replug and noise (decoders spec §6.2, D4, D5, D9, D10, D14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, app, fresh, UNPLUG, apiRequests, openZround, toChoose, busyAndMine } from './decoders-helpers.js';

setup();

// D4 covers a decoder removed before Connect only: one removed after the connect's decoder list can't be seen on
// that connect, and its passings 404 and are dropped, as for any removed decoder (decoders spec §3.2, §3.3).
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

test('D5: a decoder seen in the last 2 minutes is in use, by the server\'s clock; the remembered one says so but stays enabled', async (t) => {
  const { page, member, space } = await fresh(t);
  await page.addInitScript(() => { const real = Date.now; Date.now = () => real() + 600_000; });
  const idle = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Idle' })).json();
  const { busy, mine } = await busyAndMine(t, page, member, space);
  // The Date header has whole seconds, so "just seen" would pass even with a zero window: pin 30 s and 3 min instead.
  await page.route('**/workspaces/*/decoders', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    const now = Date.parse(res.headers().date);
    for (const d of body.decoders) {
      if (d.id === busy.id) d.lastSeenAt = now - 30_000;
      if (d.id === idle.id) d.lastSeenAt = now - 180_000;
    }
    const headers = res.headers();
    delete headers['content-length'];
    return route.fulfill({ status: res.status(), headers, body: JSON.stringify(body) });
  });
  await toChoose(page, 'Is this Mine?');
  const option = (id) => page.locator(`#bridge-choose option[value="${id}"]`);
  assert.equal(await option(idle.id).innerText(), 'Idle');
  assert.equal(await option(idle.id).isDisabled(), false);
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

test('"Use this decoder" clicked twice makes one decoder', async (t) => {
  const { page, space } = await fresh(t);
  await openZround(t, page);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Once');
  await page.getByRole('button', { name: 'Use this decoder' }).dblclick();
  await page.getByText('Forwarding from Once', { exact: true }).first().waitFor();
  assert.deepEqual(app.store.decoders(space).map((d) => d.name), ['Once']);
});
