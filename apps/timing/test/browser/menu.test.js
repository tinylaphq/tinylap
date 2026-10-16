// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shared account menu (@tinylap/design: html/account.js and tl-menu) in
// the timing navbar: a <details> disclosure that closes on Escape, a press or
// focus outside, an in-page item and leaving the page, and works without JS.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { accountMenu } from '@tinylap/design/html/account.js';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;
let member;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  member = await app.login(await app.signUp('Ana'));
});
after(async () => {
  await browser?.close();
  await app?.close();
});

async function board(t, options) {
  const opened = await pageAs(browser, app, member, options);
  t.after(() => opened.context.close());
  await opened.page.goto('/personal/board');
  return opened;
}

const summary = (page) => page.locator('.nav-account summary');
const isOpen = (page) => page.locator('.nav-account details').evaluate((d) => /** @type {HTMLDetailsElement} */ (d).open);
const focusIsSummary = (page) => page.evaluate(() => document.activeElement?.matches('.nav-account summary') ?? false);

test('Escape closes it and returns to the summary: from the summary, from the panel, and with focus on the page', async (t) => {
  const { page, errors } = await board(t);
  await summary(page).focus();
  await page.keyboard.press('Enter');
  assert.equal(await isOpen(page), true);
  await page.keyboard.press('Escape');
  assert.equal(await isOpen(page), false);
  assert.equal(await focusIsSummary(page), true);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.nav-account-menu'))), true, 'focus in the panel');
  await page.keyboard.press('Escape');
  assert.equal(await isOpen(page), false);
  assert.equal(await focusIsSummary(page), true);

  // A mouse open where the click leaves focus on the page (as Safari does).
  await summary(page).click();
  await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
  await page.keyboard.press('Escape');
  assert.equal(await isOpen(page), false);
  assert.equal(await focusIsSummary(page), true);
  assert.deepEqual(errors, []);
});

test('a press outside closes it, also on an element that stops the event', async (t) => {
  const { page } = await board(t);
  await summary(page).click();
  await page.locator('main h1, main .board-title').first().click();
  assert.equal(await isOpen(page), false);
  await page.evaluate(() => {
    const grabby = document.createElement('div');
    grabby.id = 'grabby';
    grabby.style.cssText = 'position:fixed;left:0;bottom:0;width:40px;height:40px';
    grabby.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(grabby);
  });
  await summary(page).click();
  await page.locator('#grabby').click();
  assert.equal(await isOpen(page), false);
});

test('a click on a link or on Sign out is never swallowed', async (t) => {
  // Its own session: signing out ends it for good.
  const who = await app.login(await app.signUp('Ben'));
  const opened = await pageAs(browser, app, who);
  t.after(() => opened.context.close());
  const { page } = opened;
  await page.goto('/personal/race');
  await summary(page).click();
  await page.locator('.nav-account-menu').getByRole('link', { name: 'Personal' }).click();
  await page.waitForURL('**/personal/board');
  await summary(page).click();
  const signOut = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/auth/logout');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signOut;
});

test('Tab past the last item closes it; an in-page button closes it first', async (t) => {
  const { page } = await board(t);
  await summary(page).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Sign out' }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await isOpen(page), false);

  await page.evaluate(() => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = 'Library';
    item.addEventListener('click', () => { /** @type {any} */ (window).openWhenClicked = document.querySelector('.nav-account details')?.hasAttribute('open'); });
    document.querySelector('.nav-account-menu')?.prepend(item);
  });
  await summary(page).click();
  await page.locator('.nav-account-menu').getByRole('button', { name: 'Library' }).click();
  assert.equal(await isOpen(page), false);
  assert.equal(await page.evaluate(() => /** @type {any} */ (window).openWhenClicked), false, 'closed before the app’s handler ran');
});

test('leaving the page closes it, so Back never shows it open', async (t) => {
  const { page } = await board(t);
  await summary(page).click();
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  assert.equal(await isOpen(page), false);
});

test('two menus on one page: opening one closes the other', async (t) => {
  const { page } = await board(t);
  const menu = accountMenu({ name: 'Ana', accountUrl: '/' });
  await page.route('**/fixture-menus', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><link rel="stylesheet" href="/pkg/palace-ui/palace.css"><link rel="stylesheet" href="/pkg/design/design.css"><script type="module" src="/pkg/design/elements/menu.js"></script><nav class="navbar"><div id="one">${menu}</div><div id="two">${menu}</div></nav>`,
  }));
  await page.goto('/fixture-menus');
  await page.locator('#one summary').click();
  await page.locator('#two summary').click();
  assert.deepEqual(await page.locator('details').evaluateAll((all) => all.map((d) => /** @type {HTMLDetailsElement} */ (d).open)), [false, true]);
});

test('without JavaScript the menu still opens, closes, and signs out', async (t) => {
  const { page } = await board(t, { javaScriptEnabled: false });
  await summary(page).click();
  assert.equal(await page.getByRole('button', { name: 'Sign out' }).isVisible(), true);
  await summary(page).click();
  assert.equal(await page.getByRole('button', { name: 'Sign out' }).isVisible(), false);
});

test('a long name truncates, and big mode hides the menu', async (t) => {
  const long = await app.login(await app.signUp('A'.repeat(40)));
  const opened = await pageAs(browser, app, long, { viewport: { width: 390, height: 844 } });
  t.after(() => opened.context.close());
  await opened.page.goto('/personal/board');
  assert.ok(await opened.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll at 390px');
  await opened.page.goto('/personal/board?big');
  assert.equal(await opened.page.locator('.nav-account').isVisible(), false);
});

test('an Escape meant for a dialog stays with the dialog; the menu’s own Escape reaches no page handler', async (t) => {
  const { page } = await board(t);
  await page.evaluate(() => {
    /** @type {any} */ (window).escapes = 0;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') /** @type {any} */ (window).escapes += 1; });
  });
  await summary(page).click();
  await page.keyboard.press('Escape');
  assert.equal(await isOpen(page), false);
  assert.equal(await page.evaluate(() => /** @type {any} */ (window).escapes), 0, 'stopped at the menu');

  // A mouse open that leaves focus on the page (as Safari does), then a script opens a dialog.
  await summary(page).click();
  await page.evaluate(() => {
    /** @type {HTMLElement} */ (document.activeElement)?.blur();
    const dialog = document.createElement('dialog');
    dialog.id = 'fixture-dialog';
    dialog.innerHTML = '<p>A dialog</p>';
    document.body.append(dialog);
    dialog.showModal();
  });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#fixture-dialog').evaluate((d) => /** @type {HTMLDialogElement} */ (d).open), false, 'the dialog closed');
  assert.equal(await focusIsSummary(page), false);
});

test('moved while open, it still closes on a press outside', async (t) => {
  const { page } = await board(t);
  await summary(page).click();
  await page.evaluate(() => { const menu = document.querySelector('tl-menu'); menu?.parentElement?.append(menu); });
  assert.equal(await isOpen(page), true);
  await page.locator('main h1, main .board-title').first().click();
  assert.equal(await isOpen(page), false);
});

test('hidden while open, it closes and leaves the page’s Escape alone', async (t) => {
  const { page } = await board(t);
  await page.evaluate(() => {
    /** @type {any} */ (window).escapes = 0;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') /** @type {any} */ (window).escapes += 1; });
  });
  await summary(page).click();
  await page.evaluate(() => { /** @type {HTMLElement} */ (document.querySelector('tl-menu')).hidden = true; /** @type {HTMLElement} */ (document.activeElement)?.blur(); });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => /** @type {any} */ (window).escapes), 1);
  assert.equal(await isOpen(page), false);
});
