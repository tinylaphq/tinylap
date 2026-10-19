// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge page in the browser (spec step three §4, E1–E6), with the
// simulated decoder (?simulate=fast, a lap every 2 s).
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

/**
 * Counts ports in the page: a port counts as opened on its first write (the
 * hello), and as closed once its readable's cancel ran. Only sim-port.js
 * makes these streams with a JS sink or source.
 */
const COUNT = () => {
  Object.assign(window, { __opened: 0, __cancelled: 0, __cancelledAt: null, __writes: [] });
  const W = window.WritableStream;
  const R = window.ReadableStream;
  window.WritableStream = class extends W {
    constructor(sink, ...rest) {
      let opened = false;
      super(sink && { ...sink, write: (chunk, c) => {
        if (!opened) { opened = true; window.__opened += 1; }
        window.__writes.push(performance.now());
        return sink.write(chunk, c);
      } }, ...rest);
    }
  };
  window.ReadableStream = class extends R {
    constructor(source, ...rest) {
      super(source && { ...source, cancel: (reason) => {
        window.__cancelled += 1;
        window.__cancelledAt = performance.now();
        return source.cancel?.(reason);
      } }, ...rest);
    }
  };
};

const counts = (page) => page.evaluate(() => ({ opened: window.__opened, cancelled: window.__cancelled }));

/** Opens the bridge with the simulated decoder, up to the pairing form. */
async function toPairing(t, { viewport, init = [] } = {}) {
  const who = await pageAs(browser, app, member, viewport ? { viewport } : {});
  t.after(() => who.context.close());
  for (const script of init) await who.page.addInitScript(script);
  await who.page.goto('/personal/bridge?simulate=fast');
  await who.page.getByRole('button', { name: 'Connect decoder' }).click();
  await who.page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  return who;
}

test('E5: a lap row comes from its template', async (t) => {
  const { page, errors } = await toPairing(t);
  assert.equal(await page.locator('template[data-bridge-row]').count(), 2);
  await page.getByLabel('Decoder name').fill('Gate');
  await page.getByRole('button', { name: 'Pair' }).click();
  const row = page.locator('[data-bridge-preview] li', { has: page.locator('.bridge-code + .num') }).first();
  await row.waitFor({ timeout: 20_000 });
  assert.match(await row.locator('.num').innerText(), /^\d+\.\d{3}$/);
  assert.deepEqual(errors, []);
});

test('E1a: tl-bridge starts the page, and Connect opens one port', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.addInitScript(COUNT);
  await page.goto('/personal/bridge?simulate=fast');
  const connect = page.getByRole('button', { name: 'Connect decoder' });
  await connect.waitFor();
  assert.equal(await page.evaluate(() => Boolean(customElements.get('tl-bridge'))), true);
  assert.equal((await counts(page)).opened, 0);
  await connect.click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  assert.equal((await counts(page)).opened, 1);
  assert.deepEqual(errors, []);
});

test('E1b: passings an earlier visit left go to the server once', async (t) => {
  const old = await (await app.api(member, 'POST', `/workspaces/${personal}/decoders`, { name: 'Old' })).json();
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/bridge');
  await page.evaluate(async (id) => {
    const { openOutbox } = await import('/public/outbox.js');
    await (await openOutbox()).add({ decoder: id, boot: 'b00tb00t', transponder: '0A', t: 1000 });
  }, old.id);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/decoders/*/passings', async (route) => { await held; await route.continue(); });
  const posts = [];
  page.on('response', (res) => {
    if (res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/passings')) posts.push([new URL(res.url()).pathname, res.status()]);
  });
  await page.reload();
  await page.locator('[data-bridge-earlier]', { hasText: '1 passing from earlier is waiting. Sending them now…' }).waitFor();
  const answered = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/passings'));
  release();
  await answered;
  await page.waitForTimeout(500);
  assert.deepEqual(posts, [[`/decoders/${old.id}/passings`, 200]]);
  assert.deepEqual(errors, []);
});
