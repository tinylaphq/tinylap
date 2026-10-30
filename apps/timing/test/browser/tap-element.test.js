// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// <tl-tap> in the browser (spec step three §4, T1–T9): its listener across a
// removal, a move and a swap; an answer across a move; the same text
// announced again; the server's error text; the tapped tile's colour; an
// error that cancels a pending fill; and the tile's flash.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

const clock = { now: Date.now() };
let app;
let browser;
let member;

before(async () => {
  app = await startTiming({ clock });
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
  for (const name of ['Ana', 'Ben']) await app.form(member, '/personal/drivers', { name });
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  app.engine.start(me.workspaces[0].id, { kind: 'practice' });
});
after(async () => {
  await browser?.close();
  await app?.close();
});

const TOO_MANY = { status: 429, contentType: 'application/json', body: '{"error":"Try again in 5 seconds."}' };
/** The console reports a 429 answer as an error; nothing else may be one. */
const besides429 = (errors) => errors.filter((e) => !/status of 429/.test(e));

/** A tap page as `member`, counting its POSTs. */
async function tapPage(t, { install = false } = {}) {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  if (install) await page.clock.install();
  await page.goto('/personal/tap');
  if (install) {
    // Frames and timers run only when the test says. The margin is one a slow machine can't outrun:
    // pausing at a time already past throws.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  }
  const counts = { posts: 0 };
  page.on('request', (r) => { if (r.method() === 'POST') counts.posts += 1; });
  return { page, errors, counts };
}

const tile = (page, name) => page.locator('tl-tap .tap-tile', { hasText: name });

test('T1: a removed tl-tap sends nothing', async (t) => {
  clock.now += 1000;
  const { page, errors, counts } = await tapPage(t);
  await page.evaluate(() => {
    const el = document.querySelector('tl-tap');
    el.remove();
    el.querySelector('form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  assert.equal(counts.posts, 0);
  assert.deepEqual(errors, []);
});

test('T2: a move leaves one listener', async (t) => {
  clock.now += 1000;
  const { page, errors, counts } = await tapPage(t);
  await page.evaluate(() => document.querySelector('main').append(document.querySelector('tl-tap')));
  await tile(page, 'Ana').click();
  await page.locator('#tap-result').filter({ hasText: /Ana: / }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(counts.posts, 1);
  assert.deepEqual(errors, []);
});

test('T3: a swapped-in clone taps, into its own bar', async (t) => {
  clock.now += 1000;
  const { page, errors, counts } = await tapPage(t);
  const old = await page.evaluateHandle(() => {
    const el = document.querySelector('tl-tap');
    el.replaceWith(el.cloneNode(true));
    return el;
  });
  await tile(page, 'Ana').click();
  await page.locator('tl-tap #tap-result').filter({ hasText: /Ana: / }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(counts.posts, 1);
  assert.match(await old.evaluate((el) => el.querySelector('#tap-result').textContent), /Tap a driver/);
  assert.deepEqual(errors, []);
});

test('T4: an answer that lands after a move still shows', async (t) => {
  clock.now += 1000;
  const { page, errors } = await tapPage(t);
  let handled;
  let release;
  const held = new Promise((resolve) => { handled = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  await page.route('**/personal/tap', async (route) => {
    const response = await route.fetch();
    handled();
    await released;
    await route.fulfill({ response });
  });
  await tile(page, 'Ana').click();
  await held;
  await page.evaluate(() => document.querySelector('main').append(document.querySelector('tl-tap')));
  release();
  await page.locator('#tap-result').filter({ hasText: /Ana: / }).waitFor();
  assert.deepEqual(errors, []);
});

test('T5: the same text twice is announced again', async (t) => {
  const personal = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  const [ana] = app.store.drivers(personal);
  const { page, errors } = await tapPage(t);
  await app.form(member, '/personal/tap', { driver: ana.id });
  await page.evaluate(() => {
    window.__lengths = [];
    const result = document.querySelector('#tap-result');
    new MutationObserver(() => window.__lengths.push(result.childNodes.length)).observe(result, { childList: true });
  });
  for (const n of [2, 4]) {
    const answer = page.waitForResponse((r) => r.request().method() === 'POST');
    await tile(page, 'Ana').click();
    await answer;
    await page.waitForFunction((count) => window.__lengths.length >= count, n);
  }
  assert.match(await page.locator('#tap-result').innerText(), /Too fast, tap again\./);
  const lengths = await page.evaluate(() => window.__lengths);
  const first = lengths.findIndex((l) => l > 0);
  const next = lengths.findIndex((l, i) => i > first && l > 0);
  assert.ok(first >= 0 && next > first, JSON.stringify(lengths));
  assert.ok(lengths.slice(first + 1, next).includes(0), `emptied between the fills: ${JSON.stringify(lengths)}`);
  assert.deepEqual(errors, []);
});

test('T6: the server\'s error text, with no colour and no result', async (t) => {
  clock.now += 1000;
  const { page, errors } = await tapPage(t);
  await page.route('**/personal/tap', (r) => r.fulfill(TOO_MANY));
  await tile(page, 'Ana').click();
  await page.getByRole('alert').filter({ hasText: 'Try again in 5 seconds.' }).waitFor();
  const bar = page.locator('.tap-bar');
  assert.equal(await bar.getAttribute('data-state'), 'error');
  assert.equal(await bar.evaluate((el) => el.style.getPropertyValue('--driver')), '');
  assert.equal(await page.locator('#tap-result').evaluate((el) => el.childNodes.length), 0);
  assert.deepEqual(besides429(errors), []);
});

test('T7: the bar takes the tapped tile\'s colour', async (t) => {
  clock.now += 1000;
  const { page, errors } = await tapPage(t);
  await tile(page, 'Ben').click();
  await page.locator('#tap-result').filter({ hasText: /Ben: / }).waitFor();
  const colour = (name) => tile(page, name).evaluate((el) => el.style.getPropertyValue('--driver'));
  const bar = await page.locator('.tap-bar').evaluate((el) => el.style.getPropertyValue('--driver'));
  assert.equal(bar, await colour('Ben'));
  assert.notEqual(bar, await colour('Ana'));
  assert.deepEqual(errors, []);
});

test('T8: an error cancels a pending fill', async (t) => {
  clock.now += 1000;
  const { page, errors } = await tapPage(t, { install: true });
  let n = 0;
  await page.route('**/personal/tap', (r) => {
    n += 1;
    return r.fulfill(n === 1 ? { status: 200, contentType: 'application/json', body: '{"stored":true,"lapMs":null,"text":"Ana: started"}' } : TOO_MANY);
  });
  await tile(page, 'Ana').click();
  await page.locator('.tap-bar[data-state="started"]').waitFor();
  await tile(page, 'Ana').click();
  await page.getByRole('alert').waitFor();
  await page.clock.runFor(100);
  assert.equal(await page.locator('#tap-result').evaluate((el) => el.childNodes.length), 0);
  assert.equal(await page.locator('.tap-bar').getAttribute('data-state'), 'error');
  assert.deepEqual(besides429(errors), []);
});

test('T9: the tapped tile flashes for 150 ms, restarted by each tap', async (t) => {
  clock.now += 1000;
  const { page, errors } = await tapPage(t, { install: true });
  const tapped = (name) => tile(page, name).evaluate((el) => el.classList.contains('is-tapped'));
  await tile(page, 'Ben').click();
  assert.equal(await tapped('Ben'), true);
  assert.equal(await tapped('Ana'), false);
  await page.clock.runFor(149);
  assert.equal(await tapped('Ben'), true, 'at 149 ms');
  await page.clock.runFor(2);
  assert.equal(await tapped('Ben'), false, 'at 151 ms');
  await tile(page, 'Ben').click();
  await page.clock.runFor(100);
  await tile(page, 'Ben').click();
  await page.clock.runFor(140);
  assert.equal(await tapped('Ben'), true, '140 ms after the second tap');
  assert.deepEqual(errors, []);
});
