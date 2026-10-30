// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup's cards save in place (tl-frame) and copy their tokens (tl-copy),
// as the custom elements spec, step one, §5 lists the cases. Each test counts
// the POSTs it caused, since a write must never go out twice.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

// A planner on a port nothing listens on: every track link is "unavailable", 502.
const PLANNER = 'http://127.0.0.1:9';
let app;
let browser;
let owner;

before(async () => {
  app = await startTiming({ plannerUrl: PLANNER });
  browser = await openBrowser();
  owner = await app.login(await app.signUp('Ana'));
  await app.form(owner, '/personal/drivers', { name: 'Ana' });
  // A transponder row: pair a decoder, read its token off the page once, cross the line.
  const paired = await app.form(owner, '/personal/decoders', { name: 'Gate' });
  const cookie = paired.headers.getSetCookie().find((c) => c.startsWith('__Host-tl-paired=')).split(';')[0];
  const page = await (await app.api(owner, 'GET', paired.headers.get('location'), undefined, { accept: 'text/html', cookie: `${owner.jar.header()}; ${cookie}` })).text();
  const token = /<code class="token">([A-Za-z0-9_-]{43})<\/code>/.exec(page)[1];
  const id = /<code class="token token-id">([^<]+)<\/code>/.exec(page)[1];
  assert.equal((await postPassings(app, { id, token }, [{ transponder: '0A', t: 1000 }])).status, 200);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** Setup as `who`, counting POSTs and page loads from here on. */
async function openSetup(t, who = owner) {
  const opened = await pageAs(browser, app, who);
  t.after(() => opened.context.close());
  await opened.page.goto('/personal/setup');
  const posts = [];
  let loads = 0;
  opened.page.on('request', (r) => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname); });
  opened.page.on('load', () => { loads += 1; });
  return { ...opened, posts, loads: () => loads };
}

const activeId = (page) => page.evaluate(() => document.activeElement?.id ?? '');
const saved = (page, text) => page.locator('#frame-status').filter({ hasText: text }).waitFor({ state: 'attached' });

test('adding a driver saves in place: same scroll, focus back in the empty field, the transponders card knows the driver', async (t) => {
  const { page, errors, posts, loads } = await openSetup(t);
  await page.locator('#add-driver-name').scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => scrollY);
  await page.locator('#add-driver-name').fill('Cy');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await saved(page, 'Drivers saved');
  assert.equal(await page.evaluate(() => scrollY), scrollY);
  assert.equal(await activeId(page), 'add-driver-name');
  assert.equal(await page.locator('#add-driver-name').inputValue(), '');
  assert.ok(await page.locator('#transponder-0A option', { hasText: 'Cy' }).count(), 'the transponders card was refreshed');
  assert.deepEqual(posts, ['/personal/drivers']);
  assert.equal(loads(), 0);
  assert.deepEqual(errors, []);
});

test('a bad rename swaps in the error: summary, marked field, the input kept, focus on it, the URL unchanged', async (t) => {
  const { page, errors, posts, loads } = await openSetup(t);
  const field = page.locator('input[id^="rename-"]').first();
  const id = await field.getAttribute('id');
  const url = page.url();
  await field.fill('   ');
  await field.locator('xpath=ancestor::form').getByRole('button', { name: 'Save' }).click();
  await page.locator('#page-status [role="alert"]').waitFor();
  assert.equal(page.url(), url);
  assert.equal(await activeId(page), id);
  assert.equal(await page.locator(`#${id}`).getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator(`#${id}`).inputValue(), '   ');
  assert.equal(posts.length, 1);
  assert.equal(loads(), 0);
  // Chrome logs every 4xx response; the 422 is the expected answer here.
  assert.deepEqual(errors.filter((e) => !/status of 422/.test(e)), []);
});

test('a planner outage (502) swaps in its message, with the link kept', async (t) => {
  const { page, posts, loads } = await openSetup(t);
  const link = `${PLANNER}/layouts/${'A'.repeat(22)}`;
  await page.locator('#track-link').fill(link);
  await page.getByRole('button', { name: 'Use this track' }).click();
  await page.locator('#page-status [role="alert"]').filter({ hasText: 'planner' }).waitFor();
  assert.equal(await page.locator('#track-link').inputValue(), link);
  assert.equal(await activeId(page), 'track-link');
  assert.equal(posts.length, 1);
  assert.equal(loads(), 0);
});

test('an unsaved choice in the transponders card survives a driver swap', async (t) => {
  const { page } = await openSetup(t);
  await page.locator('#transponder-0A').selectOption({ label: 'Ana' });
  await page.locator('#add-driver-name').fill('Dee');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await saved(page, 'Drivers saved');
  assert.equal(await page.locator('#transponder-0A option:checked').innerText(), 'Ana');
});

test('pairing loads the page; a later swap keeps the one-time token; Copy copies it', async (t) => {
  const { page, context, posts, loads } = await openSetup(t);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#pair-name').fill('Finish');
  // The token shows before the load event fires; wait for the load itself.
  const loaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Pair over Wi-Fi only' }).click();
  await loaded;
  await page.locator('code.token').first().waitFor();
  assert.equal(loads(), 1, 'pairing is a normal page load');
  const token = await page.locator('code.token').first().innerText();
  await page.locator('#add-driver-name').fill('Eve');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await saved(page, 'Drivers saved');
  assert.equal(await page.locator('code.token').first().innerText(), token, 'the token is still on screen');
  const copy = page.locator('tl-copy', { has: page.locator('code.token:not(.token-id)') });
  await copy.getByRole('button', { name: 'Copy' }).click();
  await copy.getByRole('status').filter({ hasText: 'Copied' }).waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), token);
  assert.deepEqual(posts, ['/personal/decoders', '/personal/drivers']);
});

test('a watchers link made in place copies too: tl-copy works after a swap', async (t) => {
  const { page, context, loads } = await openSetup(t);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Make a watchers link' }).click();
  await saved(page, 'Watchers link saved');
  assert.equal(loads(), 0);
  const copy = page.locator('#watchers tl-copy');
  await copy.getByRole('button', { name: 'Copy' }).click();
  await copy.getByRole('status').filter({ hasText: 'Copied' }).waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#watch-link').inputValue());
});

test('submits while one is in flight are dropped, in the same frame and in another', async (t) => {
  const { page, posts, loads } = await openSetup(t);
  await page.locator('#add-driver-name').fill('Fay');
  await page.evaluate(() => {
    const add = /** @type {HTMLFormElement} */ (document.querySelector('#add-driver-name').closest('form'));
    const assign = /** @type {HTMLFormElement} */ (document.querySelector('#transponder-0A').closest('form'));
    add.requestSubmit();
    add.requestSubmit();
    assign.requestSubmit();
  });
  await page.waitForLoadState('networkidle');
  assert.deepEqual(posts, ['/personal/drivers']);
  assert.equal(loads(), 0);
  await saved(page, 'Drivers saved');
});

test('while a save is in flight every card’s buttons are disabled, and a submit anyway says it is still saving', async (t) => {
  const { page, posts } = await openSetup(t);
  let release;
  const held = new Promise((done) => { release = done; });
  await page.route('**/personal/drivers', async (route) => { await held; await route.continue(); });
  await page.locator('#add-driver-name').fill('Ivy');
  await page.getByRole('button', { name: 'Add driver' }).click();
  assert.equal(await page.getByRole('button', { name: 'Add driver' }).isDisabled(), true);
  assert.equal(await page.locator('#drivers').getAttribute('aria-busy'), 'true');
  const assign = page.locator('#transponder-0A').locator('xpath=ancestor::form');
  assert.equal(await assign.getByRole('button', { name: 'Assign' }).isDisabled(), true, 'another card shows it can’t save yet');
  assert.equal(await page.getByRole('button', { name: 'Use this track' }).isDisabled(), true);
  await assign.evaluate((form) => /** @type {HTMLFormElement} */ (form).requestSubmit());
  await saved(page, 'Still saving. Try again in a moment.');
  release();
  await saved(page, 'Drivers saved');
  assert.equal(await assign.getByRole('button', { name: 'Assign' }).isDisabled(), false, 'and every button comes back');
  assert.equal(await page.getByRole('button', { name: 'Use this track' }).isDisabled(), false);
  assert.deepEqual(posts, ['/personal/drivers']);
});

for (const [what, reply] of [
  ['a response that is not a page', { status: 200, contentType: 'text/plain', body: 'ok' }],
  ['a page without the frame', { status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>Other</title><p>Something else' }],
]) {
  test(`${what} loads the form’s page and never posts again`, async (t) => {
    const { page, posts, loads } = await openSetup(t);
    await page.route('**/personal/drivers', (route) => (route.request().method() === 'POST' ? route.fulfill(reply) : route.continue()));
    await page.locator('#add-driver-name').fill('Jo');
    const loaded = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Add driver' }).click();
    await loaded;
    assert.equal(new URL(page.url()).pathname, '/personal/setup');
    assert.equal(loads(), 1);
    assert.deepEqual(posts, ['/personal/drivers']);
  });
}

test('a save after pairing drops ?paired from the URL and keeps the section', async (t) => {
  const { page } = await openSetup(t);
  await page.locator('#pair-name').fill('Lap line');
  await page.getByRole('button', { name: 'Pair over Wi-Fi only' }).click();
  await page.locator('code.token').first().waitFor();
  assert.match(page.url(), /\?paired=.+#decoders$/);
  await page.locator('#add-driver-name').fill('Kim');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await saved(page, 'Drivers saved');
  const url = new URL(page.url());
  assert.equal(url.pathname + url.search + url.hash, '/personal/setup#decoders');
});

test('a page shown again from the back/forward cache drops a lock left by a load that never finished', async (t) => {
  const { page } = await openSetup(t);
  // The fallback's page load, stopped: the request stays held, as when the user presses Stop.
  await page.route('**/personal/drivers', () => {});
  await page.locator('#add-driver-name').fill('Lou');
  await page.getByRole('button', { name: 'Add driver' }).click();
  assert.equal(await page.locator('#drivers').getAttribute('aria-busy'), 'true');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  assert.equal(await page.locator('#drivers').getAttribute('aria-busy'), null);
  assert.equal(await page.getByRole('button', { name: 'Add driver' }).isDisabled(), false);
});

test('a failed request loads the form’s page and never posts again', async (t) => {
  const { page, posts, loads } = await openSetup(t);
  await page.route('**/personal/drivers', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
  await page.locator('#add-driver-name').fill('Gus');
  const loaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await loaded;
  assert.equal(new URL(page.url()).pathname, '/personal/setup');
  assert.equal(loads(), 1);
  assert.deepEqual(posts, ['/personal/drivers']);
});

test('an expired session ends on sign-in, by a page load', async (t) => {
  const who = await app.login(await app.signUp('Ben'));
  const { page, context, posts } = await openSetup(t, who);
  await context.clearCookies();
  await page.locator('#add-driver-name').fill('Hal');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await page.waitForURL((url) => url.origin === new URL(app.suite.issuer).origin);
  assert.deepEqual(posts, ['/personal/drivers']);
});
