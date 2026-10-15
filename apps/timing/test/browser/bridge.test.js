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
