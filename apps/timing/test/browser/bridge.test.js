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
/** The server's log lines. */
const logged = [];

before(async () => {
  app = await startTiming({ log: (line) => logged.push(line) });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  personal = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** Turns the server's simulator on for this test only (decoders spec §5.4). */
const simulating = (t, value) => {
  app.simulate = value;
  t.after(() => { app.simulate = null; });
};

test('connect, pair and forward with the simulated decoder', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  simulating(t, 'tinylap,fast');
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  await page.getByLabel('Decoder name').fill('  Gate  ');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.locator('[data-bridge-preview] li').first().waitFor({ timeout: 20_000 });
  assert.equal(app.store.decoders(personal)[0].name, 'Gate');
  assert.ok(app.engine.snapshot(personal).crossings.length > 0);
  // The decoder's own lines reach the server's log: a pass line with each passing, and a stat line every 10 s.
  const kinds = () => new Set(logged.filter((line) => line.startsWith('{')).map((line) => JSON.parse(line)).filter((x) => x.type === 'decoder-log').map((x) => x.kind));
  for (const end = Date.now() + 20_000; !(kinds().has('pass') && kinds().has('stat'));) {
    assert.ok(Date.now() < end, `decoder-log kinds after 20 s: ${[...kinds()]}`);
    await page.waitForTimeout(100);
  }
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

test('without Web Serial or WebHID, the notice stays and no button is offered', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.addInitScript(() => { delete Navigator.prototype.serial; delete Navigator.prototype.hid; });
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
  simulating(t, 'tinylap,fast');
  await who.page.goto('/personal/bridge');
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

test('status lines on the bridge read as sentences, not in capitals', async (t) => {
  const { context, page } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/bridge');
  const styles = await page.locator('.status').evaluateAll((els) => els.map((el) => [el.className, getComputedStyle(el).textTransform]));
  assert.ok(styles.some(([name]) => name.includes('status-warning')));
  for (const [name, transform] of styles) assert.equal(transform, 'none', name);
});

const GONE = 'There is no such decoder: it was removed, or never paired.';
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('passings for a decoder removed on the server are dropped, and the ready panel says so', async (t) => {
  const { page } = await toPairing(t);
  await page.getByLabel('Decoder name').fill('Gone');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Gone', { exact: true }).first().waitFor();
  const gone = app.store.decoders(personal).find((d) => d.name === 'Gone');
  assert.equal((await app.api(member, 'DELETE', `/workspaces/${personal}/decoders/${gone.id}`)).status, 204);
  const refused = page.locator('[data-bridge-refused]');
  await refused.waitFor({ timeout: 20_000 });
  assert.match(await refused.innerText(), new RegExp(`^(1 passing was|\\d+ passings were) refused and (is|are) no longer waiting to send: ${escaped(GONE)}$`));
  await page.locator('[data-bridge-outbox]', { hasText: /^0$/ }).waitFor();
});

test('signed out while forwarding, passings wait here and the page says to sign in again', async (t) => {
  const { context, page } = await toPairing(t);
  await page.getByLabel('Decoder name').fill('Kept');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Kept', { exact: true }).first().waitFor();
  const cookies = await context.cookies();
  await context.clearCookies();
  const status = page.locator('[data-bridge-status]');
  await status.filter({ hasText: "Passings wait here. You're signed out. Sign in again to send them." }).waitFor({ timeout: 20_000 });
  assert.equal(await status.getByRole('link', { name: 'Sign in again' }).getAttribute('href'), '/auth/login?returnTo=%2Fpersonal%2Fbridge');
  assert.equal(await page.locator('[data-bridge-refused]').isVisible(), false, 'nothing was refused for good');
  await page.locator('[data-bridge-outbox]', { hasText: /^[1-9]\d*$/ }).waitFor({ timeout: 20_000 });
  const kept = app.store.decoders(personal).find((d) => d.name === 'Kept');
  const before = app.engine.snapshot(personal).crossings.length;
  await context.addCookies(cookies);
  await page.getByText('Forwarding from Kept', { exact: true }).first().waitFor({ timeout: 20_000 });
  assert.ok(app.engine.snapshot(personal).crossings.length > before, `the waiting passings of ${kept.id} went`);
});

test('earlier passings: the note counts this whole browser, and drops what the server refuses', async (t) => {
  const { context, page } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/bridge');
  await page.evaluate(async () => {
    const { openOutbox } = await import('/public/outbox.js');
    await (await openOutbox()).add({ decoder: crypto.randomUUID(), boot: 'b00tb00t', transponder: '0A', t: 1000 });
  });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/decoders/*/passings', async (route) => { await held; await route.continue(); });
  await page.reload();
  const note = page.locator('[data-bridge-earlier]');
  await note.filter({ hasText: '1 passing from earlier is waiting in this browser, from any club or personal space. Sending them now…' }).waitFor();
  release();
  await note.filter({ hasText: `1 passing from earlier was refused and is no longer waiting to send: ${GONE}` }).waitFor();
  assert.equal(await page.evaluate(async () => (await (await import('/public/outbox.js')).openOutbox()).count()), 0);
});

test('earlier passings, signed out: they wait, and the note says to sign in again', async (t) => {
  const { context, page } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/personal/bridge');
  const decoder = await (await app.api(member, 'POST', `/workspaces/${personal}/decoders`, { name: 'Later' })).json();
  await page.evaluate(async (id) => {
    const { openOutbox } = await import('/public/outbox.js');
    await (await openOutbox()).add({ decoder: id, boot: 'b00tb00t', transponder: '0A', t: 1000 });
  }, decoder.id);
  // Signed out between the page and its first send: the server answers as it does without a session.
  await page.route('**/decoders/*/passings', (route) => route.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ status: 401, detail: 'You are not signed in. Sign in to forward passings.' }) }));
  await page.reload();
  const note = page.locator('[data-bridge-earlier]');
  await note.filter({ hasText: "1 passing from earlier is waiting in this browser, from any club or personal space. You're signed out. Sign in again to send them." }).waitFor();
  assert.equal(await note.getByRole('link', { name: 'Sign in again' }).getAttribute('href'), '/auth/login?returnTo=%2Fpersonal%2Fbridge');
  assert.equal(await page.evaluate(async () => (await (await import('/public/outbox.js')).openOutbox()).count()), 1);
});

/**
 * Web Serial with simulated decoders: each pick is a new port (as a re-plug is), whose USB ids
 * come from window.__devices in turn. The first pair command is swallowed, so the decoder is
 * made but never reaches the cable, and window.__unplug() pulls the current port.
 */
const SERIAL = () => {
  const W = window.WritableStream;
  const R = window.ReadableStream;
  let dropped = false;
  window.WritableStream = class extends W {
    constructor(sink, ...rest) {
      super(sink && { ...sink, write: (chunk, c) => {
        if (!dropped && new TextDecoder().decode(chunk).startsWith('%TLPAIR')) { dropped = true; return undefined; }
        return sink.write(chunk, c);
      } }, ...rest);
    }
  };
  window.ReadableStream = class extends R {
    constructor(source, ...rest) {
      super(source && { ...source, start: (c) => { /** @type {any} */ (window).__unplug = () => c.close(); return source.start?.(c); } }, ...rest);
    }
  };
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: { requestPort: async () => {
      const { simulatedPort } = await import('/public/sim-port.js');
      const port = simulatedPort({ lapMs: 2000 });
      const info = /** @type {any} */ (window).__devices.shift();
      return { ...port, getInfo: () => info };
    } },
  });
};

/** Pairs once without an answer, unplugs, and connects the next device. */
async function replug(t, devices) {
  const { page } = await pageAs(browser, app, member).then((who) => { t.after(() => who.context.close()); return who; });
  await page.addInitScript(SERIAL);
  await page.addInitScript((list) => { /** @type {any} */ (window).__devices = list; }, devices);
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  await page.getByLabel('Decoder name').fill('First');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByRole('alert').filter({ hasText: /didn't answer/ }).waitFor({ timeout: 10_000 });
  await page.evaluate(() => /** @type {any} */ (window).__unplug());
  await page.getByRole('button', { name: 'Connect again' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  return page;
}

test('a decoder made for one device is forgotten when another device is connected', async (t) => {
  const before = app.store.decoders(personal).length;
  const page = await replug(t, [{ usbVendorId: 0x1a86, usbProductId: 0x7523 }, { usbVendorId: 0x10c4, usbProductId: 0xea60 }]);
  assert.equal(app.store.decoders(personal).length, before + 1);
  assert.equal(await page.getByLabel('Decoder name').isEditable(), true, 'the name is free again');
  await page.getByLabel('Decoder name').fill('Second');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Second', { exact: true }).first().waitFor();
  const made = app.store.decoders(personal).slice(before).map((d) => d.name).sort();
  assert.deepEqual(made, ['First', 'Second'], 'the new device gets its own decoder');
});

test('the same device plugged in again keeps the decoder made for it', async (t) => {
  const before = app.store.decoders(personal).length;
  const page = await replug(t, [{ usbVendorId: 0x1a86, usbProductId: 0x7523 }, { usbVendorId: 0x1a86, usbProductId: 0x7523 }]);
  assert.equal(await page.getByLabel('Decoder name').isEditable(), false, 'the name stays as it is');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from First', { exact: true }).first().waitFor();
  assert.equal(app.store.decoders(personal).length, before + 1, 'no second decoder');
});

test('passings for a club without access wait, say why, and never hold up this decoder', async (t) => {
  // A decoder in someone else's club, as a passing another member left in this browser would have.
  const yan = await app.signUp('Yan');
  const elsewhere = app.club(yan, 'Elsewhere');
  const { id: theirs } = await (await app.api(await app.login(yan), 'POST', `/workspaces/${elsewhere.id}/decoders`, { name: 'Theirs' })).json();
  // Its own member: the file's member has used up their pairings for the minute.
  const uma = await app.login(await app.signUp('Uma'));
  const own = (await (await app.api(uma, 'GET', '/auth/me')).json()).workspaces[0].id;
  const { context, page } = await pageAs(browser, app, uma);
  t.after(() => context.close());
  simulating(t, 'tinylap,fast');
  await page.goto('/personal/bridge');
  await page.evaluate(async (id) => {
    const { openOutbox } = await import('/public/outbox.js');
    await (await openOutbox()).add({ decoder: id, boot: 'b00tb00t', transponder: '0A', t: 1000 });
  }, theirs);
  await page.reload();
  const wait = "1 passing is for a decoder in a club you don't have access to, so it waits here.";
  const note = page.locator('[data-bridge-earlier]');
  await note.filter({ hasText: `1 passing from earlier is waiting in this browser, from any club or personal space. ${wait}` }).waitFor();
  assert.doesNotMatch(await note.innerText(), /sign in/i);

  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByLabel('Decoder name').fill('Mine');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Mine', { exact: true }).first().waitFor();
  const before = app.engine.snapshot(own).crossings.length;
  const panel = page.locator('[data-bridge-refused]');
  await panel.filter({ hasText: wait }).waitFor({ timeout: 20_000 });
  assert.doesNotMatch(await panel.innerText(), /sign in/i);
  await page.locator('[data-bridge-preview] li').nth(2).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  assert.ok(app.engine.snapshot(own).crossings.length > before, 'this decoder\'s passings went');
  // A lap every 2 s goes out at once; between two of them, only theirs is left.
  const left = () => page.evaluate(async () => (await (await import('/public/outbox.js')).openOutbox()).list().then((xs) => xs.map((x) => x.decoder)));
  let seen = await left();
  for (let i = 0; i < 50 && JSON.stringify(seen) !== JSON.stringify([theirs]); i += 1) {
    await page.waitForTimeout(100);
    seen = await left();
  }
  assert.deepEqual(seen, [theirs], 'theirs still waits, and only theirs');
  assert.equal(await page.locator('[data-bridge-status]').innerText(), 'Forwarding from Mine');
});
