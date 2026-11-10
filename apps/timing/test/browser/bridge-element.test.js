// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge page in the browser (spec step three §4, E1–E6), with the
// simulated decoder (the server's TINYLAP_SIMULATE=tinylap,fast, a lap every 2 s).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
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
  return { ...opened, decoders, board, card, row };
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
  await postPassings(app, board, [{ transponder: '0A', t: 1000 }]);
  await page.evaluate(() => document.querySelector('tl-bridge').refresh(document.querySelector('tl-bridge').run));
  assert.equal(await card(board).locator('[data-slot="status"]').innerText(), 'Laps get through over the cable and Wi-Fi.');
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
  assert.equal(await page.locator('#wifi-password').inputValue(), '', 'no password left in the page');
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
  await dialog.getByRole('button', { name: 'Back to the list' }).click();
  await dialog.getByRole('button', { name: 'Another network' }).click();
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
  // B gate reports over Wi-Fi meanwhile: only a fresh copy of the page knows.
  await postPassings(app, other, [{ transponder: '0A', t: 1000 }]);
  assert.equal(await row(other, 'wifi').locator('[data-slot="state"]').innerText(), '');
  const before = await page.evaluate(() => document.querySelector('#bridge-decoders'));
  await page.evaluate(() => document.querySelector('tl-bridge').refresh(document.querySelector('tl-bridge').run));
  assert.equal(await page.evaluate((old) => document.querySelector('#bridge-decoders') !== old, before), true, 'swapped');
  assert.equal(await row(other, 'wifi').locator('[data-slot="state"]').innerText(), 'Reporting');
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
  const { page, errors, decoders, row } = await cabledPage(t, { names: ['Zebra gate', 'Alpha gate'] });
  const order = () => page.locator('#bridge-decoders [data-decoder] [data-slot="name"]').allTextContents();
  assert.deepEqual(await order(), ['Zebra gate', 'Alpha gate']);
  // The bridge posts what comes over the cable, so the server's copy says the cable is on another laptop.
  const refresh = () => page.evaluate(() => document.querySelector('tl-bridge').refresh(document.querySelector('tl-bridge').run));
  const servedCable = () => page.evaluate((id) => document.querySelector('tl-bridge').served.get(id)?.querySelector('[data-row="cable"] [data-slot="state"]')?.textContent, decoders[0].id);
  for (const end = Date.now() + 20_000; await servedCable() !== 'Connected on another laptop';) {
    assert.ok(Date.now() < end, 'the server hears the cable');
    await refresh();
  }
  await page.evaluate(() => window.__port.unplug());
  const cable = row(decoders[0], 'cable');
  // At once, not once the server forgets the cable 25 s later.
  await cable.locator('[data-slot="state"]', { hasText: /^Not connected$/ }).waitFor({ timeout: 5000 });
  assert.deepEqual(await order(), ['Alpha gate', 'Zebra gate']);
  // A copy fetched since still says another laptop (it heard this one): the page never claims the cable it lost.
  await refresh();
  assert.equal(await cable.locator('[data-slot="state"]').innerText(), 'Not connected');
  assert.equal(await cable.locator('.lamp').getAttribute('data-state'), 'off');
  assert.equal(await cable.locator('[data-slot="detail"]').innerText(), 'Plug the decoder in by USB, then connect it.');
  assert.match(await cable.getByRole('button', { name: 'Connect decoder' }).getAttribute('class'), /btn-primary/);
  assert.match(await page.locator(`[data-decoder="${decoders[0].id}"] [data-slot="status"]`).innerText(), /^If it's on, its laps wait on it\. Connect the cable to see why\.\n+Last heard \d\d:\d\d\.$/);
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
