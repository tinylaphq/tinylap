// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge page in the browser (spec step three §4, E1–E6), with the
// simulated decoder (the server's TINYLAP_SIMULATE=tinylap,fast, a lap every 2 s).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { events, next } from '../server/sse.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

let app;
let browser;
let member;
let personal;

before(async () => {
  app = await startTiming({ limits: { pair: 100 } });
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

/**
 * Counts ports in the page: a port counts as opened when its open() is called
 * (a board that resets on open writes nothing before pairing), and as closed
 * once its readable's cancel ran. install.js puts the simulated port
 * (sim/serial-port.js) in place of navigator.serial by assigning requestPort,
 * which the setter below wraps; only that port makes these streams with a JS
 * sink or source.
 */
const COUNT = () => {
  Object.assign(window, { __opened: 0, __cancelled: 0, __cancelledAt: null, __writes: [] });
  const W = window.WritableStream;
  const R = window.ReadableStream;
  const serial = navigator.serial ?? new EventTarget();
  if (!navigator.serial) Object.defineProperty(navigator, 'serial', { configurable: true, value: serial });
  const counted = new WeakSet();
  let requestPort;
  Object.defineProperty(serial, 'requestPort', {
    configurable: true,
    get: () => requestPort,
    set: (real) => {
      requestPort = async (...args) => {
        const port = await real(...args);
        if (!counted.has(port)) {
          counted.add(port);
          const open = port.open.bind(port);
          port.open = (...options) => { window.__opened += 1; return open(...options); };
        }
        return port;
      };
    },
  });
  window.WritableStream = class extends W {
    constructor(sink, ...rest) {
      super(sink && { ...sink, write: (chunk, c) => {
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

/** The simulated decoder swallows the first pair command, so the bridge gets no answer (as bridge.test.js does). */
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
  simulating(t, 'tinylap,fast');
  await who.page.goto('/personal/bridge');
  await who.page.getByRole('button', { name: 'Connect decoder' }).first().click();
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
  simulating(t, 'tinylap,fast');
  await page.goto('/personal/bridge');
  const connect = page.getByRole('button', { name: 'Connect decoder' }).first();
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
  simulating(t, 'tinylap,fast');
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).first().waitFor();
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
  simulating(t, 'tinylap,fast');
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).first().waitFor();
  await page.evaluate(() => {
    const el = document.querySelector('tl-bridge');
    window.__el = el;
    // Removed as the bridge's start opens the port.
    const real = navigator.serial.requestPort;
    navigator.serial.requestPort = async (...args) => {
      const port = await real(...args);
      const open = port.open.bind(port);
      port.open = (...options) => {
        el.remove();
        window.__atRemoval = [...el.querySelectorAll('[data-bridge-state]:not([hidden])')].map((x) => x.getAttribute('data-bridge-state'));
        return open(...options);
      };
      return port;
    };
    /** @type {HTMLElement} */ (el.querySelector('[data-bridge-connect]')).click();
  });
  await page.waitForFunction(() => window.__cancelled === 1);
  // Shows that nothing is written, nor shown, after the removal.
  await page.waitForTimeout(500);
  const state = await page.evaluate(`({
    writes: window.__writes.length,
    cancelled: window.__cancelled,
    atRemoval: window.__atRemoval,
    now: (${shownIn})(window.__el),
  })`);
  assert.equal(state.writes, 0, 'no write at all');
  assert.equal(state.cancelled, 1, 'the port it opened is closed');
  assert.deepEqual(state.atRemoval, ['connecting']);
  assert.deepEqual(state.now, ['connecting'], 'nothing changed after the removal');
  assert.deepEqual(errors, []);
});

/** E4's checks after a move or a swap, from a failed pairing, then a fresh Connect and Pair. */
async function afterRestart(page, name) {
  await page.getByRole('button', { name: 'Connect decoder' }).first().waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, 'no alert');
  assert.equal(await page.locator('#bridge-name').evaluate((x) => x.readOnly), false, 'the name is editable');
  assert.equal(await page.locator('[data-bridge-pair] button[type="submit"]').evaluate((x) => x.disabled), false, 'Pair is enabled');
  await page.waitForFunction(() => window.__cancelled === window.__opened);
  const before = app.store.decoders(personal).length;
  const { opened } = await counts(page);
  const seen = apiRequests(page);
  await page.getByRole('button', { name: 'Connect decoder' }).first().click();
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
  await page.getByRole('button', { name: 'Connect decoder' }).first().waitFor();
  await page.evaluate(() => document.querySelector('main .container').append(document.querySelector('tl-bridge')));
  await page.getByRole('button', { name: 'Connect decoder' }).first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__picks), 1, 'one click, one picker');
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).first().isVisible(), true);
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
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).first().isVisible(), true);
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
  await page.getByRole('button', { name: 'Connect decoder' }).first().click();
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

test('E3c: a removal while the decoder-list GET is held opens nothing', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.addInitScript(COUNT);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/workspaces/*/decoders', async (route) => { if (route.request().method() === 'GET') await held; await route.continue(); });
  simulating(t, 'zround,fast');
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).first().waitFor();
  const listed = page.waitForRequest((r) => r.method() === 'GET' && /^\/workspaces\/[^/]+\/decoders$/.test(new URL(r.url()).pathname));
  await page.evaluate(() => {
    const el = document.querySelector('tl-bridge');
    window.__el = el;
    /** @type {HTMLElement} */ (el.querySelector('[data-bridge-connect]')).click();
  });
  await listed;
  await page.evaluate(() => window.__el.remove());
  release();
  // Past the serial open delay (1.5 s): a bridge started for the removed element would write its %C& by then.
  await page.waitForTimeout(2500);
  assert.equal((await counts(page)).opened, 0);
  assert.deepEqual(await page.evaluate(`(${shownIn})(window.__el)`), ['connecting'], 'as it was at the removal: connecting shows from the pick on');
  assert.deepEqual(errors, []);
});

test('E4d: a move puts the choose form back as the server rendered it', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  const seen = async (name) => {
    const d = await (await app.api(member, 'POST', `/workspaces/${personal}/decoders`, { name })).json();
    await app.api(member, 'POST', `/decoders/${d.id}/passings`, { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1000 }] });
    return d;
  };
  const busy = await seen('Busy');
  const mine = await seen('Mine 4d');
  simulating(t, 'zround,fast');
  await page.goto('/personal/bridge');
  await page.evaluate(async ([w, id]) => (await (await import('/public/devices.js')).openDevices()).remember(w, 'serial:1027:24577', id), [personal, mine.id]);
  await page.reload();
  await page.getByRole('button', { name: 'Connect decoder' }).first().click();
  await page.getByRole('heading', { name: 'Is this Mine 4d?' }).waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(`#bridge-choose option[value="${busy.id}"]`).isDisabled(), true);
  assert.equal(await page.locator('#bridge-choose').inputValue(), mine.id);
  assert.equal(await page.locator(`#bridge-choose option[value="${mine.id}"]`).innerText(), 'Mine 4d (in use)');
  await page.evaluate(() => document.querySelector('main .container').append(document.querySelector('tl-bridge')));
  await page.getByRole('button', { name: 'Connect decoder' }).first().waitFor();
  const form = await page.evaluate(() => ({
    heading: document.querySelector('[data-bridge-choose-heading]').textContent,
    options: [...document.querySelectorAll('#bridge-choose option')].map((o) => [o.textContent, /** @type {HTMLOptionElement} */ (o).disabled, o.getAttribute('data-name')]),
    value: /** @type {HTMLSelectElement} */ (document.querySelector('#bridge-choose')).value,
  }));
  assert.equal(form.heading, 'Which decoder is this?');
  assert.ok(form.options.every(([text, disabled, name]) => !disabled && (name === null || text === name)));
  assert.equal(form.value, '');
  assert.deepEqual(errors, []);
});

test('E6c: a choose POST that lands after a move writes nothing: no remember, no assign', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  let release;
  let reached;
  const held = new Promise((resolve) => { release = resolve; });
  const posted = new Promise((resolve) => { reached = resolve; });
  await page.route('**/workspaces/*/decoders', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    reached();
    return held.then(() => route.continue());
  });
  simulating(t, 'zround,fast');
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).first().click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 30_000 });
  await page.getByLabel('Name for the new decoder').fill('Late plain');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await posted;
  await page.evaluate(() => document.querySelector('main .container').append(document.querySelector('tl-bridge')));
  const finished = page.waitForEvent('requestfinished', (r) => r.method() === 'POST');
  release();
  const request = await finished;
  assert.equal((await request.response()).status(), 201, 'the held POST made the decoder');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).first().isVisible(), true);
  assert.equal(await page.getByText('Forwarding from Late plain').count(), 0);
  const remembered = await page.evaluate(async (w) => (await (await import('/public/devices.js')).openDevices()).recall(w, 'serial:1027:24577'), personal);
  assert.equal(remembered, null);
  assert.deepEqual(errors, []);
});

test('E3e: a double click on Connect, and a click while the decoder-list GET is held, pick once and make one bridge; connecting shows meanwhile', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/workspaces/*/decoders', async (route) => { if (route.request().method() === 'GET') await held; await route.continue(); });
  simulating(t, 'zround,fast');
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).first().waitFor();
  await page.evaluate(() => {
    Object.assign(window, { __picks: 0, __opens: 0 });
    const real = navigator.serial.requestPort;
    navigator.serial.requestPort = async (...args) => {
      window.__picks += 1;
      const port = await real(...args);
      const open = port.open.bind(port);
      port.open = (...options) => { window.__opens += 1; return open(...options); };
      return port;
    };
  });
  const listed = page.waitForRequest((r) => r.method() === 'GET' && /^\/workspaces\/[^/]+\/decoders$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: 'Connect decoder' }).first().dblclick();
  await listed;
  assert.deepEqual(await page.evaluate(`(${shownIn})(document.querySelector('tl-bridge'))`), ['connecting'], 'connecting shows while the GET is held');
  await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('[data-bridge-connect="serial"]')).click());
  release();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 30_000 });
  // Shows that no second pick or open comes late.
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => [window.__picks, window.__opens]), [1, 1]);
  assert.deepEqual(errors, []);
});

// The decoder cards and Change Wi-Fi (connections spec §2, §4, §5), with the simulated TinyLap decoder: it answers
// %TLNET, %TLSCAN (25 networks) and %TLJOIN, and takes the password tinylap!.

/** A fresh member whose personal space has `names` as decoders; the simulated board is paired as the first one. */
async function cabledPage(t, { names = ['Finish line'], viewport, connect = true, init = [] } = {}) {
  const who = await app.login(await app.signUp(`Cable ${Math.random().toString(36).slice(2, 8)}`));
  const ws = (await (await app.api(who, 'GET', '/auth/me')).json()).workspaces[0].id;
  const decoders = [];
  for (const name of names) decoders.push(await (await app.api(who, 'POST', `/workspaces/${ws}/decoders`, { name })).json());
  const opened = await pageAs(browser, app, who, viewport ? { viewport } : {});
  t.after(() => opened.context.close());
  for (const script of init) await opened.page.addInitScript(script);
  const [board] = decoders;
  await opened.page.addInitScript((pairing) => localStorage.setItem('tinylap-sim-decoder', JSON.stringify(pairing)), { decoder: board.id, token: board.token });
  simulating(t, 'tinylap,fast');
  await opened.page.goto('/personal/bridge');
  // The simulated port, for its unplug() and send() (sim/serial-port.js).
  await opened.page.evaluate(() => {
    const real = navigator.serial.requestPort;
    navigator.serial.requestPort = async (...args) => { window.__port = await real(...args); return window.__port; };
  });
  const card = (d) => opened.page.locator(`[data-decoder="${d.id}"]`);
  const row = (d, which) => card(d).locator(`[data-row="${which}"]`);
  if (connect) {
    await card(board).getByRole('button', { name: 'Connect decoder' }).click();
    await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 20_000 });
  }
  return { ...opened, who, ws, decoders, board, card, row };
}

/** Opens Change Wi-Fi (or Set up Wi-Fi) on the cabled card and waits for the list. */
async function openWifi(page, card) {
  await card.locator('[data-bridge-wifi]').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-step="list"]:not([hidden])').waitFor();
  return dialog;
}

/** The dialog's steps as they show, in order, from now on. */
const recordSteps = (page) => page.evaluate(() => {
  window.__steps = [];
  const dialog = document.querySelector('#wifi-dialog');
  new MutationObserver(() => {
    const shown = dialog.querySelector('[data-step]:not([hidden])')?.getAttribute('data-step');
    if (shown && window.__steps.at(-1) !== shown) window.__steps.push(shown);
  }).observe(dialog, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
});

test('connecting marks the card connected and shows the board\'s network', async (t) => {
  const { page, errors, board, card, row } = await cabledPage(t);
  assert.equal(await card(board).locator('[data-slot="status"]').innerText(), 'Laps get through over the cable.');
  assert.equal(await row(board, 'cable').locator('[data-bridge-connect]').isVisible(), false, 'no Connect decoder on the cabled card');
  await row(board, 'wifi').locator('[data-slot="state"]', { hasText: 'Not set up' }).waitFor();
  assert.equal(await row(board, 'wifi').locator('.lamp').getAttribute('data-state'), 'off');
  assert.equal(await row(board, 'wifi').getByRole('button', { name: 'Set up Wi-Fi' }).isVisible(), true);
  // The board joins a network on its own (another laptop's dialog, say): its %TLNET paints the card.
  await page.evaluate(() => document.querySelector('tl-bridge').run.bridge.join('Clubhaus', 'tinylap!'));
  await row(board, 'wifi').locator('[data-slot="state"]', { hasText: 'Connected to “Clubhaus”' }).waitFor();
  assert.equal(await row(board, 'wifi').locator('[data-slot="detail"]').innerText(), 'Signal strong.');
  assert.deepEqual(await row(board, 'wifi').locator('.lamp').evaluate((x) => [x.dataset.state, x.dataset.signal]), ['ok', 'strong']);
  // Joined isn't heard: Wi-Fi counts for laps once the server hears it.
  assert.equal(await card(board).locator('[data-slot="status"]').innerText(), 'Laps get through over the cable.');
  // Heard over Wi-Fi: the stream brings the server's word, with no refresh of the page.
  await postPassings(app, board, [{ transponder: '0A', t: 1000 }]);
  await card(board).locator('[data-slot="status"]', { hasText: 'Laps get through over the cable and Wi-Fi.' }).waitFor({ timeout: 5000 });
  assert.equal(await row(board, 'wifi').getByRole('button', { name: 'Change Wi-Fi' }).isVisible(), true);
  assert.deepEqual(errors, []);
});

test('while a decoder is connected, another card\'s Connect decoder opens no second picker', async (t) => {
  const { page, errors, decoders, card } = await cabledPage(t, { names: ['A gate', 'B gate'] });
  await page.evaluate(() => {
    window.__picks = 0;
    const real = navigator.serial.requestPort;
    navigator.serial.requestPort = (...args) => { window.__picks += 1; return real(...args); };
  });
  const other = card(decoders[1]).getByRole('button', { name: 'Connect decoder' });
  assert.equal(await other.isDisabled(), true);
  await other.click({ force: true });
  await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector(`[data-decoder] [data-bridge-connect]:not([hidden])`)).click());
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__picks), 0);
  assert.equal(await card(decoders[1]).locator('[data-row="cable"] [data-slot="state"]').innerText(), 'Not connected');
  assert.deepEqual(errors, []);
});

test('change wifi lists 25 networks that scroll, strongest first, another network separate', async (t) => {
  const { page, errors, board, card } = await cabledPage(t);
  const dialog = await openWifi(page, card(board));
  assert.equal(await dialog.getAttribute('aria-labelledby'), 'wifi-title-list');
  const nets = dialog.locator('[data-slot="networks"] button.net');
  assert.equal(await nets.count(), 25);
  const names = await nets.locator('[data-slot="name"]').allInnerTexts();
  assert.equal(names[0], 'Clubhaus');
  assert.equal(names.at(-1), 'TinyLap-Testnetz-langer-Name-032');
  const signals = await nets.evaluateAll((xs) => xs.map((x) => x.getAttribute('data-signal')));
  assert.deepEqual([signals[0], signals.at(-1)], ['strong', 'weak']);
  assert.equal(signals.join(' ').replace(/(\w+)( \1)*/g, '$1'), 'strong fair weak', 'strongest first, weak ones at the bottom');
  assert.equal(await nets.nth(2).locator('[data-slot="note"]').innerText(), 'Open', 'Gäste is open');
  const list = dialog.locator('[data-slot="networks"]');
  assert.ok(await list.evaluate((x) => x.scrollHeight > x.clientHeight + 100), 'the list scrolls inside the dialog');
  const box = await dialog.boundingBox();
  assert.ok(box.y >= 0 && box.y + box.height <= 800, 'the dialog fits the viewport');
  const another = dialog.getByRole('button', { name: 'Another network' });
  assert.equal(await list.locator('[data-wifi-action="another"]').count(), 0, 'Another network is outside the list');
  assert.equal(await another.isVisible(), true);
  const at = await another.boundingBox();
  assert.ok(at.y + at.height <= 800, 'and in view');
  assert.equal(await page.evaluate(() => document.activeElement?.matches('button.net')), true, 'focus on the first network');
  assert.deepEqual(errors, []);
});

test('joining the right password ends joined', async (t) => {
  const { page, errors, board, card, row } = await cabledPage(t);
  const dialog = await openWifi(page, card(board));
  await dialog.getByRole('button', { name: /^Clubhaus/ }).click();
  await dialog.getByRole('heading', { name: 'Clubhaus' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'wifi-password');
  await page.locator('#wifi-password').fill('tinylap!');
  await dialog.getByRole('button', { name: 'Join network' }).click();
  await dialog.getByText('Joined “Clubhaus”', { exact: true }).waitFor();
  assert.equal(await dialog.locator('[data-result="joined"] .decoder-row-help').innerText(), 'Signal strong. Laps now also get through over Wi-Fi.');
  // The page outside a modal dialog is inert: the dialog speaks through its own live region, exposed while open.
  assert.equal(await page.locator('#wifi-dialog [data-wifi-live]').textContent(), 'Joined “Clubhaus”.');
  assert.match(await dialog.ariaSnapshot(), /- status: Joined “Clubhaus”\./);
  await dialog.getByRole('button', { name: 'Done' }).click();
  assert.equal(await page.locator('#wifi-dialog').evaluate((x) => x.open), false);
  assert.equal(await row(board, 'wifi').locator('[data-slot="state"]').innerText(), 'Connected to “Clubhaus”');
  assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-bridge-wifi]')), true, 'focus back on Change Wi-Fi');
  // The dialog's close event, a task after close(), clears the fields.
  await page.waitForFunction(() => document.querySelector('#wifi-password').value === '', null, { timeout: 2000 });
  assert.deepEqual(errors, []);
});

test('refused password returns with the password kept', async (t) => {
  const { page, errors, board, card } = await cabledPage(t);
  await page.evaluate(() => document.querySelector('tl-bridge').run.bridge.join('Clubhaus', 'tinylap!'));
  const dialog = await openWifi(page, card(board));
  assert.equal(await dialog.getByRole('button', { name: /^Clubhaus/ }).locator('[data-slot="note"]').innerText(), 'Current network');
  await dialog.getByRole('button', { name: /^Rennstrecke/ }).click();
  await page.locator('#wifi-password').fill('not-the-one');
  await dialog.getByRole('button', { name: 'Join network' }).click();
  const alert = dialog.getByRole('alert');
  await alert.waitFor();
  assert.equal(await alert.innerText(), '“Rennstrecke” refused the password. The decoder is back on “Clubhaus”.');
  assert.equal(await page.locator('#wifi-dialog [data-wifi-live]').textContent(), '', 'said once, by the alert');
  assert.equal(await page.locator('#wifi-password').inputValue(), 'not-the-one');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'wifi-password');
  assert.equal(await dialog.getAttribute('aria-labelledby'), 'wifi-title-password');
  assert.deepEqual(errors, []);
});

test('another network by name', async (t) => {
  const { page, errors, board, card, row } = await cabledPage(t);
  const dialog = await openWifi(page, card(board));
  await dialog.getByRole('button', { name: 'Another network' }).click();
  await dialog.getByRole('heading', { name: 'Another network' }).waitFor();
  await dialog.getByLabel('Network name').fill('Nowhere');
  await page.locator('#wifi-another-password').fill('whatever1');
  await dialog.getByRole('button', { name: 'Join network' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Can\'t find “Nowhere” from here.' }).waitFor();
  // Back where the name can be corrected, with the name and password as they were, focus on the name.
  assert.equal(await dialog.getAttribute('aria-labelledby'), 'wifi-title-another');
  assert.equal(await dialog.locator('[data-step="another"]').isVisible(), true);
  assert.equal(await dialog.getByLabel('Network name').inputValue(), 'Nowhere');
  assert.equal(await page.locator('#wifi-another-password').inputValue(), 'whatever1');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'wifi-another-name');
  assert.equal(await page.locator('#wifi-dialog [data-wifi-live]').textContent(), '', 'said once, by the alert');
  await dialog.getByLabel('Network name').fill('Rennstrecke');
  await page.locator('#wifi-another-password').fill('tinylap!');
  await dialog.getByRole('button', { name: 'Join network' }).click();
  await dialog.getByText('Joined “Rennstrecke”', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Done' }).click();
  assert.equal(await row(board, 'wifi').locator('[data-slot="state"]').innerText(), 'Connected to “Rennstrecke”');
  assert.deepEqual(errors, []);
});

test('a locked network refuses an empty password, without a try', async (t) => {
  const { page, errors, board, card } = await cabledPage(t, { init: [COUNT] });
  const dialog = await openWifi(page, card(board));
  await dialog.getByRole('button', { name: /^Clubhaus/ }).click();
  await dialog.getByRole('heading', { name: 'Clubhaus' }).waitFor();
  await recordSteps(page);
  const writes = await page.evaluate(() => window.__writes.length);
  await dialog.getByRole('button', { name: 'Join network' }).click();
  const field = page.locator('#wifi-password');
  assert.equal(await field.evaluate((el) => el.validationMessage), 'Enter the password of “Clubhaus”.');
  assert.deepEqual(await page.evaluate(() => window.__steps), [], 'still the password step');
  assert.equal(await page.evaluate(() => window.__writes.length), writes, 'nothing sent to the decoder');
  await field.fill('tinylap!');
  await dialog.getByRole('button', { name: 'Join network' }).click();
  await dialog.getByText('Joined “Clubhaus”', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
});

test('open network skips the password', async (t) => {
  const { page, errors, board, card } = await cabledPage(t);
  const dialog = await openWifi(page, card(board));
  await recordSteps(page);
  await dialog.getByRole('button', { name: /^Gäste/ }).click();
  await dialog.getByText('Joined “Gäste”', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__steps), ['joining', 'result']);
  assert.deepEqual(errors, []);
});

test('card swap keeps the dialog and the cable rows', async (t) => {
  const { page, errors, board, decoders, card, row } = await cabledPage(t, { names: ['A gate', 'B gate'] });
  const other = decoders[1];
  const dialog = await openWifi(page, card(board));
  // B gate reports over Wi-Fi meanwhile: the stream sends the cards the server renders now. The page fetches no copy of itself.
  const copies = [];
  page.on('request', (r) => { if (r.resourceType() === 'fetch' && new URL(r.url()).pathname === '/personal/bridge') copies.push(r.url()); });
  assert.equal(await row(other, 'wifi').locator('[data-slot="state"]').innerText(), '');
  const before = await page.evaluate(() => document.querySelector('#bridge-decoders'));
  await postPassings(app, other, [{ transponder: '0A', t: 1000 }]);
  await row(other, 'wifi').locator('[data-slot="state"]', { hasText: /^Reporting$/ }).waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate((old) => document.querySelector('#bridge-decoders') !== old, before), true, 'swapped');
  assert.deepEqual(copies, [], 'no refresh');
  assert.match(await row(other, 'wifi').locator('time[data-when]').innerText(), /^\d\d:\d\d$/, 'its time in the browser\'s zone');
  assert.equal(await page.locator('#wifi-dialog').evaluate((x) => x.open), true, 'the dialog stays open');
  assert.equal(await dialog.locator('button.net').count(), 25);
  assert.equal(await row(board, 'cable').locator('[data-slot="state"]').innerText(), 'Connected');
  assert.equal(await row(board, 'wifi').locator('[data-slot="state"]').innerText(), 'Not set up');
  assert.equal(await card(other).getByRole('button', { name: 'Connect decoder' }).isDisabled(), true);
  assert.deepEqual(errors, []);
});

test('no change wifi without the cable', async (t) => {
  const { page, errors, board, decoders, card, row } = await cabledPage(t, { names: ['A gate', 'B gate'], connect: false });
  await card(board).getByRole('button', { name: 'Connect decoder' }).waitFor();
  assert.equal(await page.locator('[data-bridge-wifi]').evaluateAll((xs) => xs.every((x) => x.hidden)), true, 'hidden on every card');
  assert.equal(await row(board, 'wifi').locator('[data-slot="detail"]').innerText(), 'Connect the cable to see its Wi-Fi.');
  await card(board).getByRole('button', { name: 'Connect decoder' }).click();
  await row(board, 'wifi').getByRole('button', { name: 'Set up Wi-Fi' }).waitFor();
  assert.equal(await row(decoders[1], 'wifi').locator('[data-bridge-wifi]').isVisible(), false, 'only on the cabled card');
  // Unplugged: the card is the server's again.
  await page.evaluate(() => window.__port.unplug());
  await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^(Not connected|Connected on another laptop)$/ }).waitFor();
  assert.equal(await row(board, 'wifi').locator('[data-bridge-wifi]').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('show toggles the password', async (t) => {
  const { page, errors, board, card } = await cabledPage(t);
  const dialog = await openWifi(page, card(board));
  await dialog.getByRole('button', { name: /^Clubhaus/ }).click();
  const field = page.locator('#wifi-password');
  await field.fill('secret12');
  const show = dialog.getByRole('button', { name: 'Show password' });
  assert.equal(await show.textContent(), 'Show');
  await show.click();
  const hide = dialog.getByRole('button', { name: 'Hide password' });
  assert.equal(await hide.textContent(), 'Hide');
  assert.equal(await field.getAttribute('type'), 'text');
  assert.equal(await hide.getAttribute('aria-pressed'), null);
  await hide.click();
  assert.equal(await field.getAttribute('type'), 'password');
  assert.equal(await dialog.getByRole('button', { name: 'Show password' }).textContent(), 'Show');
  assert.equal(await field.inputValue(), 'secret12');
  assert.deepEqual(errors, []);
});

/** The simulated board never hears these commands, so the test answers for it through the port. @param {string[]} prefixes */
const dropping = (prefixes) => [(list) => {
  const Original = window.WritableStream;
  window.WritableStream = class extends Original {
    constructor(sink, ...rest) {
      super(sink && { ...sink, write: (chunk, c) => {
        if (list.some((p) => new TextDecoder().decode(chunk).startsWith(p))) return undefined;
        return sink.write(chunk, c);
      } }, ...rest);
    }
  };
}, prefixes];

test('a scan that finds nothing says so; one the decoder refuses says it couldn\'t look', async (t) => {
  const [script, prefixes] = dropping(['%TLSCAN']);
  const { page, errors, board, card } = await cabledPage(t, { init: [{ content: `(${script})(${JSON.stringify(prefixes)})` }] });
  const answer = (line) => page.evaluate((l) => window.__port.send(new TextEncoder().encode(l)), line);
  await card(board).locator('[data-bridge-wifi]').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-step="looking"]:not([hidden])').waitFor();
  await answer('%TLSCANEND 0&');
  await dialog.locator('[data-step="list"]:not([hidden])').waitFor();
  const empty = dialog.locator('[data-scan="empty"]');
  assert.equal(await empty.innerText(), 'No networks near the decoder. Look again, or enter another network.');
  assert.equal(await dialog.locator('[data-scan="failed"]').isVisible(), false);
  assert.equal(await dialog.locator('[data-slot="networks"]').isVisible(), false, 'no blank box');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Look again');
  await dialog.getByRole('button', { name: 'Look again' }).click();
  await dialog.locator('[data-step="looking"]:not([hidden])').waitFor();
  await answer('%TLERR scan&');
  const failed = dialog.getByRole('alert');
  await failed.waitFor();
  assert.equal(await failed.innerText(), "The decoder couldn't look for networks. Look again.");
  assert.equal(await empty.isVisible(), false);
  assert.equal(await page.locator('#wifi-dialog [data-wifi-live]').textContent(), '', 'said once, by the alert');
  assert.equal(await dialog.getByRole('button', { name: 'Another network' }).isVisible(), true);
  assert.deepEqual(errors, []);
});

test('the decoder on the cable comes first, and goes back to its place when unplugged', async (t) => {
  const { page, errors, decoders, row, who, ws } = await cabledPage(t, { names: ['Zebra gate', 'Alpha gate'] });
  const order = () => page.locator('#bridge-decoders [data-decoder] [data-slot="name"]').allTextContents();
  assert.deepEqual(await order(), ['Zebra gate', 'Alpha gate']);
  // The page holds the decoder's cable stream: the server counts it on a cable, and its cards leave this tab's own cable to it.
  const servedCable = () => page.evaluate((id) => document.querySelector('tl-bridge').served.get(id)?.querySelector('[data-row="cable"] [data-slot="state"]')?.textContent, decoders[0].id);
  const onCable = () => app.engine.connectionsOf(ws).find((d) => d.id === decoders[0].id).cable.state;
  // A batch over the cable is what "Last heard" counts.
  const heard = () => app.store.decoders(ws).find((d) => d.id === decoders[0].id)?.lastSeenAt;
  for (const end = Date.now() + 20_000; onCable() !== 'other' || !heard();) {
    assert.ok(Date.now() < end, 'the server hears the cable');
    await page.waitForTimeout(50);
  }
  assert.equal(await servedCable(), 'Not connected');
  await page.evaluate(() => window.__port.unplug());
  const cable = row(decoders[0], 'cable');
  // At once, in the server's words.
  await cable.locator('[data-slot="state"]', { hasText: /^Not connected$/ }).waitFor({ timeout: 2000 });
  for (const end = Date.now() + 2000; onCable() !== 'none';) {
    assert.ok(Date.now() < end, 'the stream ended with the port');
    await page.waitForTimeout(50);
  }
  assert.deepEqual(await order(), ['Alpha gate', 'Zebra gate']);
  // The board header says it isn't reporting.
  const board = await (await app.api(who, 'GET', '/personal/board', undefined, { accept: 'text/html' })).text();
  assert.match(board, /Zebra gate: not reporting/);
  assert.equal(await cable.locator('[data-slot="state"]').innerText(), 'Not connected');
  assert.equal(await cable.locator('.lamp').getAttribute('data-state'), 'off');
  assert.equal(await cable.locator('[data-slot="detail"]').innerText(), 'Plug the decoder in by USB, then connect it.');
  assert.match(await cable.getByRole('button', { name: 'Connect decoder' }).getAttribute('class'), /btn-primary/);
  assert.match(await page.locator(`[data-decoder="${decoders[0].id}"] [data-slot="status"]`).innerText(), /^If it's on, its laps wait on it\. Connect the cable to see why\.\n+Last heard \d\d:\d\d\.$/);
  assert.deepEqual(errors, []);
});

test('an unplug while the server fails posts: the card stays Not connected once the laps go again', async (t) => {
  const { page, errors, decoders, row, ws } = await cabledPage(t, { names: ['Zebra gate'] });
  const servedCable = () => page.evaluate((id) => document.querySelector('tl-bridge').served.get(id)?.querySelector('[data-row="cable"] [data-slot="state"]')?.textContent, decoders[0].id);
  // The server fails every post of passings (a fetch that answers 503 in the page).
  await page.evaluate(() => {
    const real = window.fetch;
    window.__failed = 0;
    window.__failing = true;
    window.fetch = (url, options) => {
      if (!window.__failing || !String(url).endsWith('/passings')) return real(url, options);
      window.__failed += 1;
      return Promise.resolve(new Response('{"title":"Unavailable","status":503}', { status: 503, headers: { 'content-type': 'application/problem+json' } }));
    };
  });
  // Something waits in the outbox: a refused batch.
  await page.waitForFunction(() => window.__failed > 0, null, { timeout: 20_000 });
  await page.evaluate(() => window.__port.unplug());
  const cable = row(decoders[0], 'cable');
  await cable.locator('[data-slot="state"]', { hasText: /^Not connected$/ }).waitFor({ timeout: 5000 });
  // The server is back: the waiting laps go, and say nothing of a cable.
  const sent = page.waitForResponse((res) => res.url().endsWith(`/decoders/${decoders[0].id}/passings`) && res.status() === 200, { timeout: 20_000 });
  await page.evaluate(() => { window.__failing = false; });
  await sent;
  await page.waitForTimeout(500);
  assert.equal(app.engine.connectionsOf(ws)[0].cable.state, 'none');
  assert.equal(await servedCable(), 'Not connected');
  assert.equal(await cable.locator('[data-slot="state"]').innerText(), 'Not connected');
  assert.deepEqual(errors, []);
});

test('a bridge taken off the page ends its cable stream', async (t) => {
  const { page, errors, who, ws } = await cabledPage(t, { names: ['Zebra gate'] });
  const onCable = () => app.engine.connectionsOf(ws)[0].cable.state;
  for (const end = Date.now() + 5000; onCable() !== 'other';) {
    assert.ok(Date.now() < end, 'on the cable');
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => document.querySelector('tl-bridge').remove());
  for (const end = Date.now() + 2000; onCable() !== 'none';) {
    assert.ok(Date.now() < end, 'the stream ended with the element');
    await page.waitForTimeout(50);
  }
  const body = await (await app.api(who, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  assert.doesNotMatch(body, /Connected on another laptop/);
  assert.deepEqual(errors, []);
});

test('pulling the cable closes the dialog, with focus on the card\'s name', async (t) => {
  const { page, errors, board, card } = await cabledPage(t);
  await openWifi(page, card(board));
  await page.evaluate(() => window.__port.unplug());
  await page.locator('#wifi-dialog:not([open])').waitFor({ state: 'attached' });
  // Focus moves in the dialog's close event, a task after close().
  await page.waitForFunction(() => document.activeElement !== document.body);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-slot')), 'name');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-decoder]')?.getAttribute('data-decoder')), board.id);
  assert.deepEqual(errors, []);
});

test('a decoder that never answers %TLNET& reads neutral, without Change Wi-Fi', async (t) => {
  const [script, prefixes] = dropping(['%TLNET']);
  const { errors, board, row } = await cabledPage(t, { init: [{ content: `(${script})(${JSON.stringify(prefixes)})` }] });
  await row(board, 'wifi').locator('[data-slot="detail"]', { hasText: "This decoder doesn't report its Wi-Fi." }).waitFor({ timeout: 10_000 });
  assert.equal(await row(board, 'wifi').locator('.lamp').getAttribute('data-state'), 'unknown');
  assert.equal(await row(board, 'wifi').locator('[data-bridge-wifi]').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('a join the decoder couldn\'t keep says so on the password step', async (t) => {
  const [script, prefixes] = dropping(['%TLJOIN']);
  const { page, errors, board, card, row } = await cabledPage(t, { init: [{ content: `(${script})(${JSON.stringify(prefixes)})` }] });
  const send = (line) => page.evaluate((l) => window.__port.send(new TextEncoder().encode(l)), line);
  // On "Gäste" before the try: it joined the new network, so it isn't back on the old one.
  await send('%TLNET connected R8Okc3Rl -60 none&');
  await row(board, 'wifi').locator('[data-slot="state"]', { hasText: 'Connected to “Gäste”' }).waitFor();
  const dialog = await openWifi(page, card(board));
  await dialog.getByRole('button', { name: /^Clubhaus/ }).click();
  await page.locator('#wifi-password').fill('tinylap!');
  await dialog.getByRole('button', { name: 'Join network' }).click();
  await dialog.locator('[data-step="joining"]:not([hidden])').waitFor();
  await send('%TLNET connected Q2x1YmhhdXM -48 none&%TLERR store&');
  const alert = dialog.getByRole('alert');
  await alert.waitFor({ timeout: 5000 });
  assert.equal(await alert.innerText(), 'The decoder joined “Clubhaus” but couldn\'t keep the settings. Try again.');
  assert.equal(await page.locator('#wifi-password').inputValue(), 'tinylap!');
  assert.deepEqual(errors, []);
});

// The cable has one place, its card (issue #81): after an unplug it says what a replug does, and the port this tab
// last had is opened again without the picker, on its own when it comes back, or by the card's Connect decoder.
// The simulator's replug() is Chrome's: a new port with the same USB ids, the connect event's target.

/** Counts the picker's openings from now on. */
const countPicks = (page) => page.evaluate(() => {
  window.__picks = 0;
  const real = navigator.serial.requestPort;
  navigator.serial.requestPort = (...args) => { window.__picks += 1; return real(...args); };
});

/** Unplugs the simulated board and waits for its card to say Not connected, in the server's words. */
async function unplugged(page, row, board) {
  await page.evaluate(() => window.__port.unplug());
  await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^Not connected$/ }).waitFor({ timeout: 8000 });
}

/** Plugs the board back in (a new port, with the connect event), as window.__port. */
const replug = (page) => page.evaluate(() => { window.__port = window.__port.replug(); });

test('an unplug is said on the card only, and the port reconnects on its own when it comes back', async (t) => {
  const { page, errors, board, row, card } = await cabledPage(t);
  await countPicks(page);
  await unplugged(page, row, board);
  const cable = row(board, 'cable');
  // This chip hasn't come back without the picker in this browser yet: no promise it will.
  await page.waitForTimeout(300);
  assert.equal(await cable.locator('[data-cable-note="back"]').isVisible(), false);
  assert.equal(await cable.locator('[data-slot="detail"]').innerText(), 'Plug the decoder in by USB, then connect it.');
  assert.equal(await cable.locator('[data-cable-note="gap"]').isVisible(), false, 'a TinyLap decoder has Wi-Fi');
  assert.equal(await page.locator('[data-bridge-live]').textContent(), 'Decoder disconnected.', 'said once, by the page\'s status region');
  assert.equal(await page.locator('.status', { hasText: 'Decoder disconnected.' }).count(), 0, 'no box of its own');
  assert.equal(await page.getByRole('button', { name: 'Connect again' }).count(), 0);
  // Focus on the card's Connect decoder, which the reconnect hides.
  await card(board).getByRole('button', { name: 'Connect decoder' }).focus();
  // Plugged back in: no click, no picker.
  await replug(page);
  await cable.locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.__picks), 0);
  assert.equal(await page.evaluate(() => window.__port.opens), 1, 'the port that came back');
  await page.waitForFunction(() => document.activeElement !== document.body);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-slot')), 'name', 'focus on the card\'s name');
  // A new port of the chip came back after an unplug and opened without the picker: this browser remembers the chip.
  assert.equal(await page.evaluate(() => localStorage.getItem('tinylap-bridge-reconnects')), JSON.stringify([await page.evaluate(() => {
    const { usbVendorId, usbProductId } = window.__port.getInfo();
    return `serial:${usbVendorId}:${usbProductId}`;
  })]));
  // It came back once: from now on its card says it will.
  await unplugged(page, row, board);
  await cable.getByText('It reconnects when you plug it back in.').waitFor();
  assert.equal(await cable.locator('[data-slot="detail"]').isVisible(), false, 'instead of "plug it in, then connect it"');
  await replug(page);
  await cable.locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 10_000 });
  assert.equal(await cable.locator('[data-cable-note="back"]').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('the card\'s Connect decoder opens the port this tab had without the picker, and the picker when it is gone', async (t) => {
  const { page, errors, board, card, row } = await cabledPage(t);
  await countPicks(page);
  await unplugged(page, row, board);
  // Back, but its connect event was missed: the button finds it among the permitted ports.
  await page.evaluate(() => { window.__port = window.__port.plugIn(); });
  await card(board).getByRole('button', { name: 'Connect decoder' }).click();
  await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.__picks), 0);
  // Unplugged and not back: the picker.
  await unplugged(page, row, board);
  await card(board).getByRole('button', { name: 'Connect decoder' }).click();
  await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.__picks), 1);
  assert.deepEqual(errors, []);
});

test('two decoders on the same chip: a reconnect opens the one that came back, never the one already there', async (t) => {
  const { page, errors, board, row } = await cabledPage(t);
  // A second board of the same chip, permitted and plugged in (another tab's, say), never opened here.
  await page.evaluate(async () => {
    const mine = window.__port;
    window.__other = await navigator.serial.requestPort();
    window.__port = mine;
  });
  await unplugged(page, row, board);
  await page.waitForTimeout(200);
  // A connect event for the one that was there already (Chrome re-enumerating it): left alone.
  await page.evaluate(() => {
    const event = new Event('connect');
    Object.defineProperty(event, 'target', { value: window.__other });
    navigator.serial.dispatchEvent(event);
  });
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => window.__other.opens), 0, 'the other decoder\'s port stays closed');
  assert.equal(await row(board, 'cable').locator('[data-slot="state"]').innerText(), 'Not connected');
  // This one comes back: the one new port of the chip.
  await replug(page);
  await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 10_000 });
  assert.equal(await page.evaluate(() => [window.__port.opens, window.__other.opens].join()), '1,0');
  assert.deepEqual(errors, []);
});

test('a port another tab holds is never opened by the reconnect', async (t) => {
  const { page, errors, board, row } = await cabledPage(t);
  await countPicks(page);
  await unplugged(page, row, board);
  // Another tab has it now: opening it fails, as Web Serial refuses a port that is open elsewhere.
  await page.evaluate(() => {
    const real = window.__port.plugIn;
    window.__port.plugIn = () => {
      const next = real();
      next.open = async () => { throw new DOMException('The port is already open.', 'InvalidStateError'); };
      return next;
    };
    const event = new Event('connect');
    const next = window.__port.plugIn();
    Object.defineProperty(event, 'target', { value: next });
    navigator.serial.dispatchEvent(event);
  });
  await page.waitForTimeout(1500);
  assert.equal(await row(board, 'cable').locator('[data-slot="state"]').innerText(), 'Not connected');
  assert.equal(await page.evaluate(() => window.__picks), 0, 'no picker without a click');
  assert.equal(await page.locator('[data-bridge-error]').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('a removed tl-bridge stops listening for ports', async (t) => {
  const { page, errors, board, row } = await cabledPage(t);
  await unplugged(page, row, board);
  await page.evaluate(() => document.querySelector('tl-bridge').remove());
  await replug(page);
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.__port.opens), 0);
  assert.deepEqual(errors, []);
});

/** A member's personal space with a plain ZRound decoder, Gate, connected on a Bridge page whose laps never reach the server. */
async function plainOnCable(t, name) {
  const who = await app.login(await app.signUp(`${name} ${Math.random().toString(36).slice(2, 8)}`));
  const ws = (await (await app.api(who, 'GET', '/auth/me')).json()).workspaces[0].id;
  const gate = await (await app.api(who, 'POST', `/workspaces/${ws}/decoders`, { name: 'Gate' })).json();
  const { page, errors, context } = await pageAs(browser, app, who);
  t.after(() => context.close().catch(() => {}));
  // No lap reaches the server: every post of passings waits, as a slow network would hold it.
  await page.addInitScript(() => {
    const real = window.fetch;
    window.fetch = (url, options) => (String(url).endsWith('/passings') ? new Promise(() => {}) : real(url, options));
  });
  simulating(t, 'zround,fast');
  await page.goto('/personal/bridge');
  await page.evaluate(() => {
    const real = navigator.serial.requestPort;
    navigator.serial.requestPort = async (...args) => { window.__port = await real(...args); return window.__port; };
  });
  const cable = page.locator(`[data-decoder="${gate.id}"] [data-row="cable"]`);
  await cable.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  await page.locator('#bridge-choose').selectOption(gate.id);
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await cable.locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 10_000 });
  const onCable = () => app.engine.connectionsOf(ws).find((d) => d.id === gate.id).cable.state;
  /** Waits up to `ms` for the server's cable state to be `state`. @param {string} state @param {number} ms @param {string} why */
  const until = async (state, ms, why) => {
    for (const end = Date.now() + ms; onCable() !== state;) {
      assert.ok(Date.now() < end, why);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  return { who, ws, gate, page, errors, context, cable, onCable, until };
}

test('connected, another Bridge page and the board say so live; unplugged, both change at once; plugged back in, again', async (t) => {
  const { who, page, errors, cable, until } = await plainOnCable(t, 'Plain');
  await until('other', 2000, 'on the cable once it is chosen, before any lap');
  // Another laptop's Bridge page, and the board, both already open.
  const elsewhere = await pageAs(browser, app, who);
  t.after(() => elsewhere.context.close());
  await elsewhere.page.goto('/personal/bridge');
  const theirs = elsewhere.page.locator('[data-decoder] [data-row="cable"] [data-slot="state"]');
  await theirs.filter({ hasText: /^Connected on another laptop$/ }).waitFor({ timeout: 5000 });
  const board = await elsewhere.context.newPage();
  await board.goto('/personal/board');
  await board.locator('.board-decoder', { hasText: 'Gate: reporting' }).waitFor({ timeout: 5000 });
  // Unplugged: no waiting on a window or a lap.
  const unplugged = Date.now();
  await page.evaluate(() => window.__port.unplug());
  await until('none', 2000, 'the stream ended with the port');
  await theirs.filter({ hasText: /^Not connected$/ }).waitFor({ timeout: 2000 });
  await board.locator('.board-decoder', { hasText: 'Gate: not reporting' }).waitFor({ timeout: 2000 });
  assert.ok(Date.now() - unplugged < 4000, `changed within ${Date.now() - unplugged} ms`);
  // Straight back in: it reconnects on its own and asks which decoder it is.
  await page.evaluate(() => { window.__port = window.__port.replug(); });
  await page.getByRole('heading', { name: 'Is this Gate?' }).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await cable.locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 10_000 });
  await until('other', 2000, 'on the cable again');
  await theirs.filter({ hasText: /^Connected on another laptop$/ }).waitFor({ timeout: 2000 });
  await board.locator('.board-decoder', { hasText: 'Gate: reporting' }).waitFor({ timeout: 2000 });
  assert.deepEqual(errors, []);
  assert.deepEqual(elsewhere.errors, []);
});

test('reopening a port that was never unplugged makes no promise of a reconnect', async (t) => {
  const { page, errors, board, card, row } = await cabledPage(t);
  // The bridge lets go of the port without an unplug (another device replaced it, say), and Connect decoder reopens it.
  await page.evaluate(async () => {
    const tl = document.querySelector('tl-bridge');
    const old = tl.run.bridge;
    tl.run.bridge = null;
    await old.close();
    tl.paint(tl.run);
  });
  await card(board).getByRole('button', { name: 'Connect decoder' }).click();
  await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.__port.opens), 2, 'the same port, without the picker');
  assert.equal(await page.evaluate(() => localStorage.getItem('tinylap-bridge-reconnects')), null);
  // So an unplug now still says to connect it.
  await unplugged(page, row, board);
  await page.waitForTimeout(300);
  assert.equal(await row(board, 'cable').locator('[data-cable-note="back"]').isVisible(), false);
  assert.deepEqual(errors, []);
});

// The engine's tests show the cable has no time limit; here the page shows it uses no timer for it.
test('a plain ZRound decoder with no laps stays on the cable in a hidden tab; closing the tab ends it', async (t) => {
  const { who, ws, page, errors, until } = await plainOnCable(t, 'Quiet');
  await until('other', 2000, 'on the cable');
  // The tab goes to the background. Nothing on the page counts time for the cable, so nothing there can be throttled.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(3000);
  assert.equal(app.engine.connectionsOf(ws)[0].cable.state, 'other');
  const other = await (await app.api(who, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  assert.match(other, /Connected on another laptop/);
  assert.deepEqual(app.engine.headerOf(ws).map((d) => d.state), ['reporting']);
  assert.deepEqual(errors, []);
  await page.close();
  await until('none', 2000, 'the stream ended with the tab');
});

test('a cable stream the server refuses (a restart) is opened again, and the decoder is on the cable again', async (t) => {
  const { page, errors, board, card, row, ws } = await cabledPage(t, { connect: false });
  let refused = 0;
  let asked = 0;
  await page.route((url) => url.pathname.endsWith(`/decoders/${board.id}/cable`), (route) => {
    asked += 1;
    if (refused > 0) return route.continue();
    refused += 1;
    return route.fulfill({ status: 503, contentType: 'text/html', body: '<p>Restarting</p>' });
  });
  await card(board).getByRole('button', { name: 'Connect decoder' }).click();
  await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 20_000 });
  for (const end = Date.now() + 5000; app.engine.connectionsOf(ws)[0].cable.state !== 'other';) {
    assert.ok(Date.now() < end, 'the hold comes back');
    await page.waitForTimeout(50);
  }
  assert.equal(refused, 1);
  assert.equal(asked, 2, 'one more try, after a pause');
  assert.deepEqual(errors.filter((e) => !/503|Service Unavailable|EventSource/i.test(e)), []);
});

test('this tab\'s own card never reads Connected on another laptop after an unplug, even with its old stream still counted', async (t) => {
  const { page, errors, board, row, who, ws } = await cabledPage(t);
  const onCable = () => app.engine.connectionsOf(ws)[0].cable.state;
  for (const end = Date.now() + 5000; onCable() !== 'other';) {
    assert.ok(Date.now() < end, 'on the cable');
    await page.waitForTimeout(50);
  }
  // A connection of this page the server hasn't seen close yet (a dead one, or a close still on its way).
  const pageId = await page.locator('#bridge').getAttribute('data-page');
  const stale = events(await app.api(who, 'GET', `/personal/decoders/${board.id}/cable?page=${pageId}`, undefined, { accept: 'text/event-stream' }), { raw: true });
  await next(stale, 'bridge');
  t.after(() => stale.return());
  const cable = row(board, 'cable').locator('[data-slot="state"]');
  // What the card says, every 20 ms, from just before the unplug.
  await page.evaluate((id) => {
    window.__said = new Set();
    window.__watch = setInterval(() => window.__said.add(document.querySelector(`[data-decoder="${id}"] [data-row="cable"] [data-slot="state"]`)?.textContent), 20);
  }, board.id);
  await page.evaluate(() => window.__port.unplug());
  await cable.filter({ hasText: /^Not connected$/ }).waitFor({ timeout: 2000 });
  await page.waitForTimeout(1500);
  assert.equal(onCable(), 'other', 'the stale connection still holds it');
  const said = await page.evaluate(() => { clearInterval(window.__watch); return [...window.__said]; });
  assert.ok(!said.includes('Connected on another laptop'), JSON.stringify(said));
  assert.equal(await cable.innerText(), 'Not connected');
  assert.deepEqual(errors, []);
});

// After a reload this tab has no port it last had; Chrome may still permit ports for the page.

/** A page that has just been reloaded, `granted` ports permitted (the simulator forgets them on a load), the picker counted. */
async function reloadedWith(t, granted) {
  const made = await cabledPage(t, { connect: false });
  await made.page.reload();
  await made.page.evaluate(async (n) => { for (let i = 0; i < n; i += 1) await navigator.serial.requestPort(); }, granted);
  await countPicks(made.page);
  return made;
}

test('after a reload, Connect decoder opens the one permitted port without the picker', async (t) => {
  const { page, errors, board, card, row } = await reloadedWith(t, 1);
  await card(board).getByRole('button', { name: 'Connect decoder' }).click();
  await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 20_000 });
  assert.equal(await page.evaluate(() => window.__picks), 0);
  assert.deepEqual(errors, []);
});

test('after a reload, with two permitted ports, Connect decoder opens the picker', async (t) => {
  const { page, errors, board, card, row } = await reloadedWith(t, 2);
  await card(board).getByRole('button', { name: 'Connect decoder' }).click();
  await row(board, 'cable').locator('[data-slot="state"]', { hasText: /^Connected$/ }).waitFor({ timeout: 20_000 });
  assert.equal(await page.evaluate(() => window.__picks), 1);
  assert.deepEqual(errors, []);
});

test('after a reload, a connect event opens nothing: the reconnect needs the port this tab had', async (t) => {
  const { page, errors, board, row } = await reloadedWith(t, 1);
  await page.evaluate(() => {
    const event = new Event('connect');
    Object.defineProperty(event, 'target', { value: window.__port ?? null });
    navigator.serial.dispatchEvent(event);
  });
  await page.evaluate(async () => {
    const [port] = await navigator.serial.getPorts();
    const event = new Event('connect');
    Object.defineProperty(event, 'target', { value: port });
    navigator.serial.dispatchEvent(event);
  });
  await page.waitForTimeout(1500);
  assert.equal(await row(board, 'cable').locator('[data-slot="state"]').innerText(), 'Not connected');
  assert.equal(await page.evaluate(async () => (await navigator.serial.getPorts())[0].opens), 0);
  assert.equal(await page.evaluate(() => window.__picks), 0);
  assert.deepEqual(errors, []);
});
