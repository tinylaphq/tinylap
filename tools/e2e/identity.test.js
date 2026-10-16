// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The identity story end to end (spec §5, §6, §7), in Google Chrome through
// playwright-core: a real accounts (dev mode, in-memory, on
// http://localhost so passkeys work) and the planner (on 127.0.0.1, its
// database in a temporary file this test also reads), wired together as in
// production. Alice and Bob each get their own browser profile with their
// own CDP virtual authenticator. Access tokens live 5 seconds
// (TINYLAP_ACCESS_TTL), so a removal shows within one token lifetime; the
// deletions feed is polled by the test instead of hourly.
// Run with `pnpm test:e2e` (not part of `pnpm check`).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { authenticatorOptions, launchOptions } from '../../apps/accounts/playwright.config.js';
import { startPlanner } from '../../apps/track-planner/test/server/helpers.js';
import { openStore } from '../../apps/track-planner/server/store.js';
import { startFeed } from '../../apps/track-planner/server/feed.js';

const TTL = 5;

/** @type {import('playwright-core').Browser} */
let browser;
/** @type {Awaited<ReturnType<typeof startPlanner>>} */
let planner;
/** @type {ReturnType<typeof startFeed>} */
let feed;
/** @type {DatabaseSync} */
let plannerDb;
const dir = mkdtempSync(join(tmpdir(), 'tinylap-e2e-'));
/** @type {string[]} */
const feedLog = [];

before(async () => {
  const file = join(dir, 'planner.sqlite');
  planner = await startPlanner({ hostname: 'localhost', store: openStore(file), env: { TINYLAP_ACCESS_TTL: String(TTL) } });
  // The feed holds a deletion back for one token lifetime plus 60 s; its
  // clock runs that far ahead, so a poll right after a deletion processes it.
  feed = startFeed({
    issuer: planner.suite.issuer, token: 'feed-test', store: planner.store, poll: false,
    accessTtlSeconds: TTL, now: () => Date.now() + (TTL + 61) * 1000,
    logger: { warn: (m) => void feedLog.push(m), info: (m) => void feedLog.push(m) },
  });
  plannerDb = new DatabaseSync(file, { readOnly: true });
  browser = await chromium.launch(launchOptions);
});

after(async () => {
  feed?.stop();
  await browser?.close();
  plannerDb?.close();
  await planner?.close();
  rmSync(dir, { recursive: true, force: true });
});

const accountsDb = () => planner.suite.accounts.db;
const userId = (/** @type {string} */ name) => String(accountsDb().prepare('SELECT id FROM "user" WHERE name = ?').get(name)?.id);
const plannerSessions = (/** @type {string} */ id) => Number(plannerDb.prepare('SELECT COUNT(*) AS c FROM bff_session WHERE user_id = ?').get(id)?.c);
const accountsSessions = (/** @type {string} */ id) => Number(accountsDb().prepare('SELECT COUNT(*) AS c FROM session WHERE userId = ?').get(id)?.c);

/**
 * A person on their own device: a fresh profile on the planner's origin,
 * an empty platform authenticator, and every script error collected.
 * @param {import('node:test').TestContext} t @param {import('playwright-core').BrowserContextOptions} [options]
 */
async function device(t, options = {}) {
  const context = await browser.newContext({ baseURL: planner.base, viewport: { width: 1280, height: 800 }, ...options });
  /** @type {string[]} */
  const errors = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'no script errors or CSP violations on the pages');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/status of 40[134]/.test(message.text())) errors.push(message.text());
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions });
  return { context, page };
}

/** The sign-up page the browser is on: a passkey, then the codes, saved. @param {import('playwright-core').Page} page @param {string} name */
async function signUpHere(page, name) {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await page.locator('#code-list li').nth(9).waitFor();
  await page.getByLabel("I've saved them").check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** The layout on the canvas, as the session store keeps it. @param {import('playwright-core').Page} page */
const canvasLayout = (page) => page.evaluate(() => sessionStorage.getItem('circuit30.layout'));
const pieceCount = async (/** @type {import('playwright-core').Page} */ page) => JSON.parse((await canvasLayout(page)) ?? '{"pieces":[]}').pieces.length;

/** @param {import('playwright-core').Page} page */
async function openLibrary(page) {
  await page.locator('#account summary').click();
  await page.locator('#account').getByRole('button', { name: 'Library' }).click();
  const dialog = page.locator('#library-dialog');
  await dialog.locator('.library-ws').first().waitFor();
  return dialog;
}

/** @param {import('playwright-core').Page} page */
async function closeLibrary(page) {
  const dialog = page.locator('#library-dialog');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/** @param {import('playwright-core').Page} page */
const libraryJson = (page) => page.evaluate(() => fetch('/library', { headers: { accept: 'application/json' } }).then(async (r) => ({
  status: r.status,
  body: /^application\/(problem\+)?json/.test(r.headers.get('content-type') ?? '') ? await r.json() : await r.text(),
})));

test('Alice and Bob: sign up, library, a club, sharing, removal, logout, deletion', async (t) => {
  const alice = await device(t, { permissions: ['clipboard-read', 'clipboard-write'] });
  const bob = await device(t);
  const a = alice.page;
  const b = bob.page;

  // 1. Alice puts a layout on the canvas, logs in from the planner, signs up
  //    there with a passkey, and is back on the canvas with it unchanged.
  await a.goto('/');
  await a.locator('#btn-presets').click();
  await a.locator('#presets-list button[data-preset-id]').first().click();
  await a.waitForFunction(() => JSON.parse(sessionStorage.getItem('circuit30.layout') ?? '{"pieces":[]}').pieces.length > 0);
  const drawn = await canvasLayout(a);
  await a.locator('#account .nav-sign-in').click();
  await a.waitForURL(`${planner.suite.issuer}/sign-in?**`);
  await a.getByRole('link', { name: 'Create an account' }).click();
  await signUpHere(a, 'Alice');
  await a.waitForURL(`${planner.base}/`);
  await a.locator('#account summary').waitFor();
  assert.equal(await a.locator('#account .nav-account-name').textContent(), 'Alice');
  assert.equal(await canvasLayout(a), drawn, 'the canvas survived the round trip unchanged');

  // 2. A closed layout saved to her library, then a second version of it.
  const pieces = await pieceCount(a);
  await a.locator('#btn-save').click();
  await a.locator('#save-dialog').waitFor();
  await a.getByLabel('Name').fill('Monza');
  await a.locator('#save-name').press('Enter');
  await a.getByText('Saved Monza to your library.').waitFor();
  // An edit that leaves the track as it is: the room it has to fit in.
  await a.locator('#btn-room').click();
  await a.locator('#room-w').fill('6');
  await a.locator('#room-h').fill('4.5');
  await a.locator('#room-dialog').getByRole('button', { name: 'Set' }).click();
  await a.waitForFunction(() => JSON.parse(sessionStorage.getItem('circuit30.layout') ?? '{}').room);
  assert.equal(await pieceCount(a), pieces);
  await a.locator('#btn-save').click();
  await a.getByText('Saved a new version of Monza.').waitFor();
  let library = await openLibrary(a);
  const monza = library.locator('.library-track', { hasText: 'Monza' });
  await monza.getByRole('button', { name: 'History' }).click();
  await monza.locator('.library-version').nth(1).waitFor();
  assert.equal(await monza.locator('.library-version').count(), 2, 'two versions');
  await closeLibrary(a);

  // 3. A club, and an invite link for it.
  await a.goto(`${planner.suite.issuer}/clubs`);
  await a.getByLabel('Club name').fill('Night Racers');
  await a.getByRole('button', { name: 'Create club' }).click();
  await a.waitForURL(/\/clubs\/[A-Za-z0-9_-]+$/);
  const clubId = /** @type {string} */ (new URL(a.url()).pathname.split('/').pop());
  await a.getByRole('button', { name: 'Create invite link' }).click();
  await a.locator('#new-invite').waitFor();
  const invite = (await a.locator('#invite-link').textContent()) ?? '';
  assert.match(invite, /\/invite\/[A-Za-z0-9_-]{43}$/);

  // 4. Bob, on his own device, opens the invite, signs up and joins; then
  //    logs in to the planner without a second passkey prompt.
  await b.goto(invite);
  await b.getByRole('link', { name: 'Create an account' }).click();
  await signUpHere(b, 'Bob');
  await b.waitForURL(/\/invite\//);
  await b.getByRole('button', { name: 'Join Night Racers' }).click();
  await b.waitForURL(new RegExp(`/clubs/${clubId}$`));
  await b.locator('#members li', { hasText: 'Bob' }).getByText('Member').waitFor();
  await b.goto('/');
  await b.locator('#account .nav-sign-in').click();
  await b.locator('#account summary').waitFor();
  assert.equal(await b.locator('#account .nav-account-name').textContent(), 'Bob');

  // 5. Alice copies Monza to the club. Bob sees it there, without Delete,
  //    and the server refuses his delete too.
  await a.goto('/');
  library = await openLibrary(a);
  const mine = library.locator('section.library-ws').first().locator('.library-track', { hasText: 'Monza' });
  await mine.getByRole('button', { name: 'Copy to…' }).click();
  await mine.getByLabel('Copy to').selectOption(clubId);
  await mine.getByRole('button', { name: 'Copy', exact: true }).click();
  await a.getByText('Copied Monza to Night Racers.').waitFor();
  const clubSection = (/** @type {import('playwright-core').Page} */ page) => page.locator('#library-dialog section.library-ws[aria-label="Night Racers"]');
  await clubSection(a).locator('.library-track', { hasText: 'Monza' }).waitFor();
  await closeLibrary(a);

  await b.reload();
  await openLibrary(b);
  const bobsCopy = clubSection(b).locator('.library-track', { hasText: 'Monza' });
  await bobsCopy.waitFor();
  assert.equal(await bobsCopy.getByRole('button', { name: 'Delete' }).count(), 0, 'a member cannot delete');
  const clubTrackId = /** @type {string} */ (await bobsCopy.getAttribute('data-track-id'));
  const refused = await b.evaluate((id) => fetch(`/library/tracks/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { accept: 'application/json' } }).then((r) => r.status), clubTrackId);
  assert.equal(refused, 403, 'the server refuses a member deleting a club track');
  await closeLibrary(b);
  assert.ok((await libraryJson(b)).body.workspaces.find((w) => w.id === clubId).tracks.some((x) => x.id === clubTrackId), 'still there');

  // 6. Alice opens the club's copy and shares it. The public link works for
  //    someone who is not logged in anywhere.
  await openLibrary(a);
  await clubSection(a).locator('.library-track', { hasText: 'Monza' }).getByRole('button', { name: 'Open', exact: true }).click();
  await a.getByText('Opened Monza.').waitFor();
  await a.locator('#btn-share').click();
  await a.locator('#share-dialog').getByRole('button', { name: 'Publish and copy link' }).click();
  const shared = a.getByText(/^(Link copied|Share link): http/);
  await shared.waitFor();
  const link = /** @type {string} */ ((await shared.textContent())?.replace(/^(Link copied|Share link): /, ''));
  const stranger = await device(t);
  const key = link.split('/').pop();
  assert.equal((await stranger.page.goto(link))?.status(), 200, 'the public page');
  await stranger.page.locator(`a[href="/?layout=${key}"]`).first().click();
  await stranger.page.locator('#account .nav-sign-in').waitFor();
  await stranger.page.waitForFunction((n) => JSON.parse(sessionStorage.getItem('circuit30.layout') ?? '{"pieces":[]}').pieces.length === n, pieces);
  await stranger.context.close();

  // 7. Alice removes Bob from the club. Nothing is revoked (spec §3): his
  //    access token keeps listing the club until it expires, and the next
  //    refresh reads his memberships again and drops it, within one token
  //    lifetime. He stays logged in throughout: never a 401.
  //    The BFF refreshes a token with less than 60 s left, so with a 5 s
  //    TTL each of Bob's requests refreshes: the one just before the
  //    removal gives the newest token the club can be listed with.
  await a.goto(`${planner.suite.issuer}/clubs/${clubId}`);
  const refreshedAt = Date.now();
  const fresh = await libraryJson(b);
  assert.equal(fresh.status, 200);
  assert.ok(fresh.body.workspaces.some((w) => w.id === clubId), 'the refreshed token still has the club');
  await a.locator('#members li', { hasText: 'Bob' }).getByRole('button', { name: 'Remove' }).click();
  await a.locator('#confirm').getByRole('button', { name: 'Remove' }).click();
  await a.locator('#members li', { hasText: 'Bob' }).waitFor({ state: 'detached' });
  const removedAt = Date.now();
  let listedAfterRemoval = 0;
  for (;;) {
    const askedAt = Date.now();
    const { status, body } = await libraryJson(b);
    assert.equal(status, 200, `the library answers ${status}: Bob stays logged in`);
    if (!body.workspaces.some((w) => w.id === clubId)) break;
    assert.ok(askedAt - refreshedAt < TTL * 1000 + 1000, `the club is still listed ${askedAt - refreshedAt} ms after the token was issued`);
    listedAfterRemoval += 1;
    assert.ok(Date.now() - removedAt < (TTL + 5) * 1000, `the club still listed ${Date.now() - removedAt} ms after the removal`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const droppedAfter = Date.now() - removedAt;
  assert.ok(droppedAfter < (TTL + 5) * 1000, `the club dropped ${droppedAfter} ms after the removal`);
  t.diagnostic(`step 7: club listed ${listedAfterRemoval} times after the removal; dropped ${droppedAfter} ms after it`);
  await b.reload();
  await b.locator('#account summary').waitFor();
  assert.equal(await b.locator('#account .nav-account-name').textContent(), 'Bob', 'still logged in, no new login');
  await openLibrary(b);
  assert.equal(await clubSection(b).count(), 0, 'the dialog has no club section');
  await closeLibrary(b);

  // 8. Bob signs out. "Sign in" asks for a passkey again: no silent login.
  await b.locator('#account summary').click();
  await b.locator('#account').getByRole('button', { name: 'Sign out' }).click();
  await b.waitForURL(`${planner.base}/`);
  await b.locator('#account .nav-sign-in').waitFor();
  assert.equal(accountsSessions(userId('Bob')), 0, 'the accounts session ended too');
  await b.locator('#account .nav-sign-in').click();
  await b.waitForURL(`${planner.suite.issuer}/sign-in?**`);
  await b.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await b.waitForURL(`${planner.base}/`);
  await b.locator('#account summary').waitFor();
  assert.equal(await b.locator('#account .nav-account-name').textContent(), 'Bob');

  // 9. Bob deletes his account (his passkey sign-in just now is fresh).
  //    After a feed poll, his planner sessions are gone.
  const bobId = userId('Bob');
  await b.locator('#account summary').click();
  await b.locator('#account').getByRole('link', { name: 'Account' }).click();
  await b.waitForURL(`${planner.suite.issuer}/account`);
  await b.getByRole('button', { name: 'Delete account' }).click();
  const dialog = b.locator('#delete-dialog');
  await dialog.getByLabel('Display name').fill('Bob');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await b.waitForURL(/\/signed-out\?deleted$/);
  assert.ok(plannerSessions(bobId) >= 1, 'the planner still holds a session for Bob until it reads the feed');
  const polled = await feed.poll();
  assert.equal(polled.error, undefined, feedLog.join('\n'));
  assert.ok(polled.processed >= 1, 'the feed had his deletion');
  assert.equal(plannerSessions(bobId), 0, 'his planner sessions are gone');
  await b.goto('/');
  await b.locator('#account .nav-sign-in').waitFor();

  // Alice is untouched by all of it.
  await a.goto('/');
  await a.locator('#account summary').waitFor();
  assert.ok((await libraryJson(a)).body.workspaces.some((w) => w.id === clubId));
});

test('logging out of the planner as one user does not sign another out of accounts', async (t) => {
  // Carol logs in to the planner. In the same browser, the accounts session
  // then changes to Dave's (Carol's accounts cookie gone, Dave signs up).
  // Carol's logout carries her id_token_hint, which is not for Dave's
  // session: Dave must stay signed in, and is asked instead.
  const { context, page } = await device(t);
  await page.goto('/');
  await page.locator('#account .nav-sign-in').click();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await signUpHere(page, 'Carol');
  await page.locator('#account summary').waitFor();
  assert.equal(await page.locator('#account .nav-account-name').textContent(), 'Carol');

  await context.clearCookies({ domain: 'localhost' });
  await page.goto(`${planner.suite.issuer}/sign-up`);
  await signUpHere(page, 'Dave');
  await page.getByText('Your account is ready').waitFor();
  const dave = userId('Dave');
  assert.equal(accountsSessions(dave), 1);

  await page.goto('/');
  await page.locator('#account summary').waitFor();
  assert.equal(await page.locator('#account .nav-account-name').textContent(), 'Carol');
  await page.locator('#account summary').click();
  await page.locator('#account').getByRole('button', { name: 'Sign out' }).click();
  await page.getByText('You are still signed in as Dave.').waitFor();
  assert.equal(accountsSessions(dave), 1, `Dave is still signed in to accounts (ended on ${page.url()})`);
  assert.equal(page.url(), `${planner.suite.issuer}/signed-out`, 'asked at accounts, not sent back to the planner');
  // The planner session is gone either way.
  await page.goto('/');
  await page.locator('#account .nav-sign-in').waitFor();
});
