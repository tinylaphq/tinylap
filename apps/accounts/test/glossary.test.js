// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What people read says "sign in", "club" and "personal": every page as it
// renders, and every prose string in the sources, which also covers branches
// a render misses and text only the page scripts show.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANNED, exempt, proseLiterals, visibleText } from '../../../tools/glossary.js';
import { createClub, createInvite, createPersonalWorkspace, redeemInvite, setRole } from '../server/workspaces.js';
import { createTestUser, Jar, navigate, startAccounts, testSession } from './helpers.js';

const appDir = fileURLToPath(new URL('../', import.meta.url));
const banned = (text) => BANNED.test(exempt(text));

// Operator text for admin.js, never shown on a page; exact strings only.
const ALLOWED = new Set([
  'server/workspaces.js: There is no workspace  .',
  'server/workspaces.js: A personal workspace cannot change hands.',
]);

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
before(async () => { accounts = await startAccounts(); });
after(() => accounts.close());

const page = async (path, jar = new Jar()) => {
  const res = await navigate(`${accounts.issuer}${path}`, { accept: 'text/html', 'sec-fetch-mode': 'navigate', ...(jar.header() ? { cookie: jar.header() } : {}) });
  assert.match(res.headers.get('content-type') ?? '', /text\/html/, path);
  return res.text();
};

async function person(name) {
  const user = await createTestUser(accounts.auth, name);
  createPersonalWorkspace(accounts.db, user.id, name);
  return { id: user.id, jar: await testSession(accounts.auth, user.id) };
}

test('every page says "sign in", "club" and "personal"', async () => {
  const owner = await person('Ana');
  const admin = await person('Bea');
  const member = await person('Cleo');
  const club = createClub(accounts.db, owner.id, 'Office');
  for (const who of [admin, member]) redeemInvite(accounts.db, who.id, createInvite(accounts.db, owner.id, club.id).link.split('/').pop());
  setRole(accounts.db, owner.id, club.id, admin.id, 'admin');
  const invite = createInvite(accounts.db, owner.id, club.id, { singleUse: false }).link;
  const signedOutJar = new Jar();

  const pages = {
    'sign-in': await page('/sign-in'),
    'sign-up': await page('/sign-up'),
    recover: await page('/recover'),
    'signed-out': await page('/signed-out'),
    'signed-out, deleted': await page('/signed-out?deleted'),
    privacy: await page('/privacy'),
    error: await page('/error?error=invalid_client&error_description=Unknown+client'),
    'account, owner of a club': await page('/account', owner.jar),
    'account, member': await page('/account', member.jar),
    clubs: await page('/clubs', owner.jar),
    'club, owner': await page(`/clubs/${club.id}`, owner.jar),
    'club, admin': await page(`/clubs/${club.id}`, admin.jar),
    'club, member': await page(`/clubs/${club.id}`, member.jar),
    'invite, signed out': await page(invite, signedOutJar),
    'invite, signed in': await page(invite, (await person('Dora')).jar),
    'invite, already a member': await page(invite, member.jar),
  };
  assert.match(pages.clubs, /Office/, 'the clubs page lists the club');
  assert.match(pages['club, member'], /Leave this club/, 'the member sees the club');
  assert.match(pages['account, owner of a club'], /You own/, 'the owner branch renders');
  assert.match(pages['account, member'], /your personal space with its tracks/, 'the member branch renders');
  assert.match(pages['invite, signed out'], /Sign in to join/, 'the signed-out invite renders');
  assert.match(pages['invite, signed in'], /You were invited to the TinyLap club/, 'the signed-in invite renders');
  assert.match(pages['invite, already a member'], /You are in Office/, 'the member invite renders');
  for (const [name, html] of Object.entries(pages)) {
    const text = visibleText(html);
    assert.ok(!banned(text), `${name}: ${text.match(BANNED)?.[0]}`);
  }
});

test('the pages say TinyLap Accounts', async () => {
  const html = await page('/sign-in');
  assert.match(html, /<title>Sign in · TinyLap Accounts<\/title>/);
  assert.match(html, /<p class="brand-lockup">[^]*?<span class="brand">TinyLap Accounts<\/span><\/p>/);
});

test('the words in the sources follow the glossary', () => {
  const pages = readdirSync(join(appDir, 'server/pages')).filter((f) => f.endsWith('.js')).map((f) => `server/pages/${f}`);
  const scripts = readdirSync(join(appDir, 'public')).filter((f) => f.endsWith('.js')).map((f) => `public/${f}`);
  const files = [...pages, 'server/app.js', 'server/api.js', 'server/workspaces.js', ...scripts];
  const found = files.flatMap((file) => proseLiterals(readFileSync(join(appDir, file), 'utf8')).map((l) => ({ ...l, file })));
  assert.ok(found.length > 100, 'the prose is read');
  const hits = found.filter((l) => banned(l.text) && !ALLOWED.has(`${l.file}: ${l.text}`));
  assert.deepEqual(hits.map((l) => `${l.file}:${l.line}: ${l.text}`), []);
  for (const allowed of ALLOWED) assert.ok(found.some((l) => `${l.file}: ${l.text}` === allowed), `still needed: ${allowed}`);
});
