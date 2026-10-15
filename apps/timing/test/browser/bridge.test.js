// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge end to end with the simulated port: connect, pair, forward;
// the passings reach the server and the board while the bridge keeps going.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;
let member;
let office;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  const owner = await app.signUp('Ana');
  office = app.club(owner, 'Office');
  member = await app.login(owner);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('connect, pair and forward through the bridge', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/?simulate=fast#bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  await page.getByLabel('Decoder name').fill('Gate');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText(/^Forwarding from decoder /).waitFor();
  const [gate] = app.store.decoders(office.id);
  assert.equal(gate.name, 'Gate');

  // A reload would end the bridge; a hash change keeps it.
  await page.evaluate(() => { location.hash = '#board'; });
  await page.getByRole('status').filter({ hasText: /Unknown cars?: / }).waitFor({ timeout: 20_000 });
  assert.notEqual(app.store.decoders(office.id)[0].lastSeenAt, null, 'every batch counts as the decoder being seen');
  const ws = app.engine.snapshot(office.id);
  assert.ok(ws.crossings.length > 0);
  assert.ok(ws.crossings.every((c) => c.via === 'serial'));
  assert.deepEqual(errors, []);
});

test('passings an earlier tab left in the outbox go out when the bridge screen opens', async (t) => {
  const gate = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name: 'Pit' })).json();
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/?simulate=fast#board');
  // What a reloaded tab finds: one passing of this workspace's decoder, one of a decoder the server refuses.
  await page.evaluate(([decoder]) => new Promise((resolve, reject) => {
    const open = indexedDB.open('tinylap-timing', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('outbox', { keyPath: ['decoder', 'boot', 'transponder', 't'] });
    open.onsuccess = () => {
      const tx = open.result.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').put({ decoder, boot: 'reloadb00t', transponder: '77', t: 4000 });
      tx.objectStore('outbox').put({ decoder: 'dec_gone', boot: 'reloadb00t', transponder: '78', t: 4000 });
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), [gate.id]);
  await page.evaluate(() => { location.hash = '#bridge'; });
  await page.getByRole('status').filter({ hasText: /^1 passing from earlier is waiting\. They couldn't be sent: / }).waitFor();
  assert.ok(app.engine.snapshot(office.id).crossings.some((c) => c.transponder === '77' && c.via === 'serial'));
  // Once a decoder is connected, the refused group still says why it waits, though the bridge is online.
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByLabel('Decoder name').fill('Second');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText(/^Forwarding from decoder /).waitFor();
  await page.getByRole('alert').filter({ hasText: /^Some passings were refused: / }).waitFor();
  assert.deepEqual(errors.filter((e) => !/40[134]/.test(e)), []);
});
