// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;
let member;
let personal;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  personal = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('connect, pair and forward with the simulated decoder', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/bridge?simulate=fast');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  await page.getByLabel('Decoder name').fill('  Gate  ');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.locator('[data-bridge-preview] li').first().waitFor({ timeout: 20_000 });
  assert.equal(app.store.decoders(personal)[0].name, 'Gate');
  assert.ok(app.engine.snapshot(personal).crossings.length > 0);
  assert.deepEqual(errors, []);
});

test('without JavaScript, the page says what the bridge needs', async (t) => {
  const { context, page } = await pageAs(browser, app, member, { javaScriptEnabled: false });
  t.after(() => context.close());
  await page.goto('/personal/bridge');
  await page.getByText(/needs Chrome or Edge/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), false);
  assert.equal(await page.getByRole('link', { name: 'Pair over Wi-Fi only' }).isVisible(), true);
});

test('without Web Serial, the notice stays and no button is offered', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.addInitScript(() => { delete Navigator.prototype.serial; });
  await page.goto('/personal/bridge');
  await page.getByText(/needs Chrome or Edge/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

/** Opens the bridge with the simulated decoder, up to the pairing form. */
async function toPairing(t, { viewport, init } = {}) {
  const who = await pageAs(browser, app, member, viewport ? { viewport } : {});
  t.after(() => who.context.close());
  if (init) await who.page.addInitScript(init);
  await who.page.goto('/personal/bridge?simulate=fast');
  await who.page.getByRole('button', { name: 'Connect decoder' }).click();
  await who.page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  return who;
}

test('the ready panel: name, aligned preview with headings, one live region', async (t) => {
  const { page, errors } = await toPairing(t);
  await page.getByLabel('Decoder name').fill('Gate');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.locator('[data-bridge-preview] li').first().waitFor({ timeout: 20_000 });
  const edges = await page.evaluate(() => {
    const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.right]; };
    return { strip: box('.bridge-state'), preview: box('.bridge-preview') };
  });
  assert.ok(Math.abs(edges.strip[0] - edges.preview[0]) < 0.5 && Math.abs(edges.strip[1] - edges.preview[1]) < 0.5, JSON.stringify(edges));
  await page.getByText('Transponder', { exact: true }).waitFor();
  await page.getByText('Lap', { exact: true }).waitFor();
  assert.ok((await page.locator('[data-bridge-preview] li', { hasText: 'first pass' }).count()) > 0);
  assert.equal(await page.locator('[data-bridge-preview] li', { hasText: '—' }).count(), 0);
  const live = page.locator('#bridge > [role="status"]');
  assert.equal(await live.count(), 1);
  assert.equal(await page.locator('#bridge section [role="status"]').count(), 0);
  assert.match(await live.textContent(), /Forwarding from Gate/);
  assert.deepEqual(errors, []);
});

test('a failed write to the cable keeps the decoder: pairing again reuses it', async (t) => {
  const before = app.store.decoders(personal).length;
  // The simulated decoder swallows the first pair command, so the bridge gets no answer.
  const { page } = await toPairing(t, {
    init: () => {
      const Original = window.WritableStream;
      let dropped = false;
      window.WritableStream = class extends Original {
        constructor(sink, ...rest) {
          super(sink && { ...sink, write: (chunk, c) => {
            if (!dropped && new TextDecoder().decode(chunk).startsWith('%TLPAIR')) { dropped = true; return undefined; }
            return sink.write(chunk, c);
          } }, ...rest);
        }
      };
    },
  });
  await page.getByLabel('Decoder name').fill('Pit');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByRole('alert').filter({ hasText: /didn't answer/ }).waitFor({ timeout: 10_000 });
  assert.equal(await page.getByLabel('Decoder name').isEditable(), false);
  assert.equal(app.store.decoders(personal).length, before + 1);
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Pit', { exact: true }).first().waitFor();
  assert.equal(app.store.decoders(personal).length, before + 1);
});

test('a bad name shows the server error as an alert and a blank name is refused before posting', async (t) => {
  const before = app.store.decoders(personal).length;
  const { page } = await toPairing(t);
  await page.getByLabel('Decoder name').fill('   ');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByRole('alert').filter({ hasText: 'A decoder name is 1 to 60 characters.' }).waitFor();
  await page.getByLabel('Decoder name').fill('Gate\u0001');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByRole('alert').filter({ hasText: /1 to 60 characters|control/ }).waitFor();
  assert.equal(await page.getByLabel('Decoder name').isEditable(), true);
  assert.equal(app.store.decoders(personal).length, before);
});
