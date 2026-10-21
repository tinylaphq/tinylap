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

/** The simulated decoder swallows the first pair command, so the bridge gets no answer (as bridge.test.js:99-108). */
const DROP_FIRST_PAIR = () => {
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

/** A synthetic, cancelable beforeunload on the window: was it prevented? */
const blocksLeaving = (page) => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; });

/** The state sections shown inside `el`. */
const shownIn = (el) => [...el.querySelectorAll('[data-bridge-state]:not([hidden])')].map((x) => x.getAttribute('data-bridge-state'));

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
  await page.locator('[data-bridge-earlier]', { hasText: '1 passing from earlier is waiting in this browser, from any club or personal space. Sending them now…' }).waitFor();
  const answered = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/passings'));
  release();
  await answered;
  await page.waitForTimeout(500);
  assert.deepEqual(posts, [[`/decoders/${old.id}/passings`, 200]]);
  assert.deepEqual(errors, []);
});

/** The beforeunload listeners on window, as DevTools sees them. */
async function beforeunloadListeners(context, page) {
  const cdp = await context.newCDPSession(page);
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  await cdp.detach();
  return listeners.filter((l) => l.type === 'beforeunload').length;
}

test('E2: a removal closes the port, stops the retries and never blocks leaving', async (t) => {
  const { context, page, errors } = await toPairing(t, { init: [COUNT] });
  await page.getByLabel('Decoder name').fill('Gate');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  assert.equal(await blocksLeaving(page), true, 'forwarding blocks leaving');
  await page.route('**/decoders/*/passings', (route) => route.abort());
  await page.locator('[data-bridge-status]', { hasText: /^Offline: passings wait here/ }).waitFor({ timeout: 20_000 });
  assert.equal(await beforeunloadListeners(context, page), 1);
  const el = await page.evaluateHandle(() => document.querySelector('tl-bridge'));
  await el.evaluate((x) => x.remove());
  // From the removal on: before it, the bridge may still retry, as it should.
  const seen = apiRequests(page);
  assert.equal(await beforeunloadListeners(context, page), 0, 'window no longer holds the element');
  await page.waitForTimeout(6000);
  const { opened, cancelled } = await counts(page);
  assert.equal(opened, 1);
  assert.equal(cancelled, opened, 'every port is closed');
  assert.deepEqual(seen.filter((r) => r.endsWith('/passings')), [], 'no retry and no late flush');
  assert.equal(await blocksLeaving(page), false, 'a removed bridge never blocks leaving');
  await el.evaluate((x) => /** @type {HTMLElement} */ (x.querySelector('[data-bridge-connect]')).click());
  await el.evaluate((x) => x.querySelector('[data-bridge-pair]').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  await page.waitForTimeout(500);
  assert.equal((await counts(page)).opened, opened, 'a detached Connect opens nothing');
  assert.deepEqual(seen, [], 'and a detached Pair posts nothing');
  // The aborted passings report as net::ERR_FAILED; nothing else may fail.
  assert.deepEqual(errors.filter((e) => !/net::ERR_FAILED/.test(e)), []);
});

test('E3a: a removal right after the click opens nothing', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.addInitScript(COUNT);
  await page.goto('/personal/bridge?simulate=fast');
  await page.getByRole('button', { name: 'Connect decoder' }).waitFor();
  const seen = apiRequests(page);
  await page.evaluate(() => {
    const el = document.querySelector('tl-bridge');
    window.__el = el;
    /** @type {HTMLElement} */ (el.querySelector('[data-bridge-connect]')).click();
    el.remove();
  });
  await page.waitForTimeout(1000);
  assert.equal((await counts(page)).opened, 0);
  assert.deepEqual(await page.evaluate(`(${shownIn})(window.__el)`), ['connect']);
  assert.deepEqual(seen, []);
  assert.deepEqual(errors, []);
});

test('E3b: a removal during the start writes nothing and closes the port it opened', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.addInitScript(COUNT);
  await page.goto('/personal/bridge?simulate=fast');
  await page.getByRole('button', { name: 'Connect decoder' }).waitFor();
  await page.evaluate(() => {
    const el = document.querySelector('tl-bridge');
    window.__el = el;
    const connecting = el.querySelector('[data-bridge-state="connecting"]');
    const watch = new MutationObserver(() => {
      if (connecting.hidden) return;
      watch.disconnect();
      el.remove();
      window.__atRemoval = [...el.querySelectorAll('[data-bridge-state]:not([hidden])')].map((x) => x.getAttribute('data-bridge-state'));
    });
    watch.observe(connecting, { attributes: true, attributeFilter: ['hidden'] });
    /** @type {HTMLElement} */ (el.querySelector('[data-bridge-connect]')).click();
  });
  await page.waitForTimeout(1000);
  const state = await page.evaluate(`({
    opened: window.__opened,
    cancelled: window.__cancelled,
    atRemoval: window.__atRemoval,
    now: (${shownIn})(window.__el),
  })`);
  assert.equal(state.opened, 0, 'no write at all: nothing is written after close');
  assert.equal(state.cancelled, 1, 'the port it opened is closed');
  assert.deepEqual(state.atRemoval, ['connecting']);
  assert.deepEqual(state.now, ['connecting'], 'nothing changed after the removal');
  assert.deepEqual(errors, []);
});

/** E4's checks after a move or a swap, from a failed pairing, then a fresh Connect and Pair. */
async function afterRestart(page, name) {
  await page.getByRole('button', { name: 'Connect decoder' }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, 'no alert');
  assert.equal(await page.locator('#bridge-name').evaluate((x) => x.readOnly), false, 'the name is editable');
  assert.equal(await page.locator('[data-bridge-pair] button[type="submit"]').evaluate((x) => x.disabled), false, 'Pair is enabled');
  await page.waitForFunction(() => window.__cancelled === window.__opened);
  const before = app.store.decoders(personal).length;
  const { opened } = await counts(page);
  const seen = apiRequests(page);
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  assert.equal((await counts(page)).opened, opened + 1, 'one click, one port');
  await page.getByLabel('Decoder name').fill(name);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await page.getByText(`Forwarding from ${name}`, { exact: true }).first().waitFor();
  assert.deepEqual(seen.filter((r) => r.startsWith('POST /workspaces/')), [`POST /workspaces/${personal}/decoders`]);
  assert.equal(app.store.decoders(personal).length, before + 1);
}

/** E4c's Web Serial: requestPort counts its calls, and each picker is closed without a choice. */
const SERIAL = () => {
  window.__picks = 0;
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: { requestPort: async () => { window.__picks += 1; throw new DOMException('closed', 'NotFoundError'); } },
  });
};

/** E4's start: a pairing whose pair command the decoder swallowed. */
async function failedPairing(t, name) {
  const who = await toPairing(t, { init: [COUNT, DROP_FIRST_PAIR] });
  await who.page.getByLabel('Decoder name').fill(name);
  await who.page.getByRole('button', { name: 'Pair', exact: true }).click();
  await who.page.getByRole('alert').filter({ hasText: /didn't answer/ }).waitFor({ timeout: 10_000 });
  return who;
}

test('E4: a move or a swap starts once, fresh, from a failed pairing', async (t) => {
  const moved = await failedPairing(t, 'Pit');
  await moved.page.evaluate(() => document.querySelector('main .container').append(document.querySelector('tl-bridge')));
  await afterRestart(moved.page, 'Pit2');
  assert.deepEqual(moved.errors, []);

  const swapped = await failedPairing(t, 'Pit3');
  await swapped.page.evaluate(() => { const el = document.querySelector('tl-bridge'); el.replaceWith(el.cloneNode(true)); });
  await afterRestart(swapped.page, 'Pit4');
  assert.deepEqual(swapped.errors, []);
});

test('E4c: after a move, one click opens one picker, and closing it is no error', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.addInitScript(SERIAL);
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).waitFor();
  await page.evaluate(() => document.querySelector('main .container').append(document.querySelector('tl-bridge')));
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__picks), 1, 'one click, one picker');
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), true);
  assert.deepEqual(errors, []);
});

test('E6: a pairing answer that lands after a move writes nothing', async (t) => {
  const { page, errors } = await toPairing(t, { init: [COUNT] });
  let release;
  let reached;
  const held = new Promise((resolve) => { release = resolve; });
  const posted = new Promise((resolve) => { reached = resolve; });
  await page.route('**/workspaces/*/decoders', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    reached();
    return held.then(() => route.continue());
  });
  const before = app.store.decoders(personal).length;
  await page.getByLabel('Decoder name').fill('Late');
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await posted;
  await page.evaluate(() => document.querySelector('main .container').append(document.querySelector('tl-bridge')));
  const finished = page.waitForEvent('requestfinished', (r) => r.method() === 'POST');
  release();
  await finished;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), true);
  assert.equal(await page.getByLabel('Decoder name').isEditable(), true);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(app.store.decoders(personal).length, before + 1);
  assert.deepEqual(errors, []);
});

test('E7: after a move, the old pairing\'s answer leaves the new pairing\'s button disabled', async (t) => {
  const { page, errors } = await toPairing(t, { init: [COUNT] });
  // Each POST is held until the test releases it, in the order they came.
  const releases = [];
  await page.route('**/workspaces/*/decoders', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return new Promise((resolve) => { releases.push(resolve); }).then(() => route.continue());
  });
  const posted = async (n) => { while (releases.length < n) await new Promise((done) => setTimeout(done, 20)); };
  await page.getByLabel('Decoder name').fill('Old run');
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await posted(1);
  await page.evaluate(() => document.querySelector('main .container').append(document.querySelector('tl-bridge')));
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  await page.getByLabel('Decoder name').fill('New run');
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await posted(2);
  const pair = page.locator('[data-bridge-pair] button[type="submit"]');
  assert.equal(await pair.evaluate((x) => x.disabled), true, 'disabled while the new pairing runs');
  const finished = page.waitForEvent('requestfinished', (r) => r.method() === 'POST');
  releases[0]();
  await finished;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await pair.evaluate((x) => x.disabled), true, 'the old answer leaves it disabled');
  releases[1]();
  await page.getByText('Forwarding from New run', { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
});
