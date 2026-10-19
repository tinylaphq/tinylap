// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control's tl-countdown in the browser (spec step two §2.2, §7, C1–C9):
// one reload by GET at a phase change, and never a loop, a second reload,
// a reload without storage, a reload of a hidden page, nor a reload of the
// answer to a POST; and a clock moved in the page keeps its reload.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

// Server time runs with real time; a test only ever moves it forward.
const clock = { offset: 0, get now() { return Date.now() + this.offset; } };
let app;
let browser;
let member;
let personal;
let roster;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  await app.form(member, '/personal/drivers', { name: 'Ana' });
  personal = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  roster = app.store.drivers(personal).map((d) => d.id);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Runs the engine's ticker for this test, as server/main.js does. */
function ticking(t) {
  const ticker = setInterval(() => app.engine.tick(), 100);
  t.after(() => clearInterval(ticker));
}

/** Starts a race in the personal space, aborted when the test ends. */
function race(t, { countdownMs, durationMs = 60_000 }) {
  const { session } = app.engine.start(personal, { kind: 'race', roster, durationMs, countdownMs });
  t.after(() => { app.engine.abort(personal, session.id); });
  return session;
}

/** A race control page that counts its loads and its own requests (not prefetches). */
async function racePage(t) {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  const loads = [];
  page.on('load', () => { loads.push(clock.now); });
  const requests = [];
  page.on('request', (r) => {
    if (!/prefetch/i.test(r.headers()['sec-purpose'] ?? '')) requests.push([r.method(), new URL(r.url()).pathname]);
  });
  return { context, page, errors, loads, requests };
}

/** Waits until `fn()` is true, polling in Node. */
async function until(fn, what, ms = 10_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

test('C1: the countdown reaching zero reloads race control once, by GET', async (t) => {
  ticking(t);
  const session = race(t, { countdownMs: 2000 });
  const { page, errors, loads, requests } = await racePage(t);
  await page.goto('/personal/race');
  // A key left by an earlier race on this page.
  await page.evaluate(() => sessionStorage.setItem('tl-countdown reload /personal/race 1 running', '1'));
  await page.getByText('Starts in', { exact: true }).waitFor();
  const first = await page.locator('time[data-clock]').innerText();
  await page.waitForFunction((was) => document.querySelector('time[data-clock]')?.textContent !== was, first);
  await until(() => loads.length === 2, 'the reload');
  assert.ok(loads[1] >= session.opensAt, 'not before the boundary');
  await page.getByRole('heading', { name: 'Race, running' }).waitFor();
  await page.getByText('Remaining', { exact: true }).waitFor();
  await sleep(2000);
  assert.equal(loads.length, 2, 'exactly one reload');
  const pages = requests.filter(([, path]) => path === '/personal/race');
  assert.deepEqual(pages, [['GET', '/personal/race'], ['GET', '/personal/race']]);
  assert.equal(requests.some(([method]) => method !== 'GET'), false, 'no POST');
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), [`tl-countdown reload /personal/race ${session.opensAt} countdown`], 'the earlier race’s key is gone');
  assert.deepEqual(errors, []);
});

test('C2: a server that has not moved the session gets one reload, not a loop', async (t) => {
  // No ticker: the server is stalled. The page says countdown, with data-opens already past.
  race(t, { countdownMs: 0 });
  const { page, errors, loads } = await racePage(t);
  // A third request would be a loop: refuse it, so a broken guard fails here instead of reloading forever.
  let served = 0;
  await page.route('**/personal/race', async (route) => {
    served += 1;
    if (served > 2) return route.abort();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: (await res.text()).replace(/data-state="running"/, 'data-state="countdown"') });
  });
  await page.goto('/personal/race');
  await until(() => loads.length >= 2, 'the reload');
  await sleep(4000);
  assert.equal(served, 2, 'no second reload');
  assert.equal(loads.length, 2);
  assert.equal(await page.locator('time[data-clock]').getAttribute('data-state'), 'countdown');
  assert.deepEqual(errors, []);
});

test('C3: without sessionStorage it never reloads', async (t) => {
  ticking(t);
  const session = race(t, { countdownMs: 2000 });
  const { page, errors, loads } = await racePage(t);
  await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } }));
  await page.goto('/personal/race');
  assert.equal(await page.evaluate(() => { try { void sessionStorage.length; return false; } catch { return true; } }), true, 'storage really throws');
  await until(() => clock.now > session.opensAt + 3000, 'the boundary to pass');
  assert.equal(loads.length, 1);
  await page.getByText('Remaining', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
});

test('C4: a prefetched page reloads early on the device clock, and the next page still reloads at the boundary', async (t) => {
  ticking(t);
  const { page, errors, loads } = await racePage(t);
  const session = race(t, { countdownMs: 10_000 });
  await page.clock.setSystemTime(clock.now + 5000);
  // After the clock, which brings its own performance object: the first load only says it was prefetched.
  await page.addInitScript(() => {
    if (window.name === 'seen') return;
    window.name = 'seen';
    const entries = performance.getEntriesByType.bind(performance);
    performance.getEntriesByType = (type) => (type === 'navigation' ? [/** @type {any} */ ({ deliveryType: 'navigational-prefetch' })] : entries(type));
  });
  await page.goto('/personal/race');
  await until(() => loads.length === 2, 'the early reload');
  assert.ok(loads[1] < session.opensAt, `early, ${session.opensAt - loads[1]} ms before the boundary`);
  await until(() => loads.length === 3, 'the reload at the boundary');
  assert.ok(loads[2] >= session.opensAt, 'at the boundary');
  await page.getByRole('heading', { name: 'Race, running' }).waitFor();
  await sleep(2000);
  assert.equal(loads.length, 3, 'then none');
  assert.deepEqual(errors, []);
});

test('C5: hovering the Race tab on race control fetches nothing ahead, so the reload at the boundary is one fresh page', async (t) => {
  ticking(t);
  const session = race(t, { countdownMs: 6000 });
  const { page, errors } = await racePage(t);
  // How each document arrived: Chrome may serve location.reload() from the prefetch cache. A stale
  // page can reload before its load event, so documents are counted, not loads.
  const docs = [];
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => console.log(`tl-doc ${/** @type {any} */ (performance.getEntriesByType('navigation')[0]).deliveryType || 'network'}`)));
  page.on('console', (m) => { if (m.text().startsWith('tl-doc ')) docs.push([m.text().slice(7), clock.now]); });
  await page.goto('/personal/race');
  const ahead = [];
  page.on('request', (r) => { if (/prefetch/i.test(r.headers()['sec-purpose'] ?? '')) ahead.push(new URL(r.url()).pathname); });
  // The tab for the page itself (aria-current="page") is left out of the speculation rules.
  await page.getByRole('link', { name: 'Race' }).hover();
  await sleep(1500);
  assert.deepEqual(ahead.filter((p) => p === '/personal/race'), [], 'the page itself is never fetched ahead');
  await until(() => clock.now > session.opensAt + 3000, 'the boundary to pass');
  await page.getByRole('heading', { name: 'Race, running' }).waitFor();
  const later = docs.slice(1);
  assert.deepEqual(later.map(([how]) => how), ['network'], `exactly one fresh page: ${JSON.stringify(later)}`);
  assert.ok(later[0][1] >= session.opensAt, 'after the boundary');
  await sleep(2000);
  assert.equal(docs.length, 1 + later.length, 'then none');
  assert.deepEqual(errors, []);
});

test('C6: the answer to a POST never reloads', async (t) => {
  ticking(t);
  const { page, errors, loads, requests } = await racePage(t);
  await page.goto('/personal/race');
  await page.getByRole('button', { name: 'Start' }).waitFor();
  const started = await app.form(member, '/personal/sessions', [['kind', 'race'], ['roster', roster[0]], ['duration', '1'], ['countdown', '2']]);
  assert.equal(started.status, 303);
  const session = app.store.activeSession(personal);
  t.after(() => { app.engine.abort(personal, session.id); });
  const answer = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start' }).click();
  assert.equal((await answer).status(), 409);
  await page.getByText('A qualifying or race is already running here.').waitFor();
  assert.equal(await page.locator('tl-countdown').count(), 1);
  assert.equal(await page.locator('tl-countdown[reload-on-phase]').count(), 0);
  const seen = [loads.length, requests.length];
  await until(() => clock.now > session.opensAt + 2000, 'the boundary to pass');
  assert.deepEqual([loads.length, requests.length], seen, 'no reload, no request');
  assert.deepEqual(errors.filter((e) => !/status of 409/.test(e)), [], 'nothing but the 409 itself');
});

test('C7: time running out reloads race control once, which then says finishing the last lap', async (t) => {
  // No ticker: this test moves the server and the page clock together.
  const session = race(t, { countdownMs: 0 });
  const { page, errors, loads } = await racePage(t);
  await page.clock.install({ time: clock.now });
  await page.goto('/personal/race');
  await page.getByRole('heading', { name: 'Race, running' }).waitFor();
  while (clock.now <= session.closesAt + 1000) {
    clock.offset += 10_000;
    app.engine.tick();
    try {
      await page.clock.runFor(10_000);
    } catch {
      // The reload may land inside the step.
    }
  }
  await until(() => loads.length === 2, 'the reload');
  await page.getByRole('heading', { name: /Race, finishing the last lap/ }).waitFor();
  assert.equal(await page.locator('time[data-clock]').innerText(), '0:00');
  await page.clock.runFor(10_000);
  assert.equal(loads.length, 2, 'exactly one reload');
  assert.equal(await page.locator('time[data-clock]').innerText(), '0:00');
  assert.deepEqual(errors, []);
});

test('C8: a hidden page waits, and reloads once it shows', async (t) => {
  ticking(t);
  const session = race(t, { countdownMs: 2000 });
  const { page, errors, loads } = await racePage(t);
  await page.goto('/personal/race');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await until(() => clock.now > session.opensAt + 3000, 'the boundary to pass');
  assert.equal(loads.length, 1, 'no reload while hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await until(() => loads.length >= 2, 'the reload once visible');
  await page.getByRole('heading', { name: 'Race, running' }).waitFor();
  await sleep(2000);
  assert.equal(loads.length, 2, 'exactly one');
  assert.deepEqual(errors, []);
});

test('C9: a clock moved after it has decided still reloads', async (t) => {
  const session = race(t, { countdownMs: 10_000 });
  const { page, errors } = await racePage(t);
  const docs = [];
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => console.log('tl-doc')));
  page.on('console', (m) => { if (m.text() === 'tl-doc') docs.push(clock.now); });
  await page.clock.install({ time: clock.now });
  await page.goto('/personal/race');
  await page.getByText('Starts in', { exact: true }).waitFor();
  // Just past the boundary on the page's clock: the reload is scheduled for a second later.
  await page.clock.runFor(session.opensAt + 300 - clock.now);
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).length), 1, 'decided');
  await page.evaluate(() => { const el = document.querySelector('tl-countdown'); const parent = el?.parentElement; el?.remove(); if (el) parent?.append(el); });
  try {
    await page.clock.runFor(3000);
  } catch {
    // The reload may land inside the step.
  }
  await until(() => docs.length === 2, 'the reload');
  assert.deepEqual(errors, []);
});
