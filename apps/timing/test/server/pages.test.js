// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The page shell and the space addresses (spec §3, §4.2): the start page,
// / sending you to your last space, /clubs/<id> and /personal, sign-in
// redirects, the not-found and forbidden pages, and the account menu.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { removeMember } from '../../../accounts/server/workspaces.js';
import { pageRoute } from '../../server/page-access.js';
import { page } from '../../server/respond.js';
import { spacePath } from '../../server/spaces.js';
import { html } from '../../server/views/html.js';
import { layout } from '../../server/views/layout.js';
import { routes } from '../../server/routes.js';
import { startTiming } from './helpers.js';
import { SPECULATION_RULES } from '@tinylap/design/html/speculation.js';

// A test page behind pageRoute, so the access rules are tested before any real screen exists.
const probe = {
  pattern: spacePath('probe'),
  credentials: true,
  methods: {
    GET: pageRoute('timing.run', (request) => page(request, 200, layout(request, { title: 'Probe', body: html`<p id="probe">${request.space.name}</p>` }))),
    POST: pageRoute('timing.delete', (request) => page(request, 200, layout(request, { title: 'Probe', body: html`<p>posted</p>` })), { write: true }),
  },
};

let app;
let ana;
let ben;
let zed;
let office;
let anaLogin;
let benLogin;
let zedLogin;

before(async () => {
  // First, so the space catch-all doesn't answer for it.
  app = await startTiming({ routes: [probe, ...routes] });
  ana = await app.signUp('Ana <b>');
  ben = await app.signUp('Ben');
  zed = await app.signUp('Zed');
  office = app.club(ana, 'Office & Co');
  app.join(ana, office.id, ben);
  anaLogin = await app.login(ana);
  benLogin = await app.login(ben);
  zedLogin = await app.login(zed);
});
after(() => app.close());

const get = (who, path, headers = {}) => app.api(who, 'GET', path, undefined, { accept: 'text/html', ...headers });
const locationOf = (res) => res.headers.get('location');

test('signed out, / is the start page with Sign in', async () => {
  const res = await get(null, '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /form-action 'self'/);
  const body = await res.text();
  assert.match(body, /<title>TinyLap Timing<\/title>/);
  assert.match(body, /href="\/auth\/login\?returnTo=%2F">Sign in</);
  assert.doesNotMatch(body, /workspace/i);
});

test('signed in, / goes to your personal board, or the space you used last', async () => {
  let res = await get(anaLogin, '/');
  assert.equal(res.status, 303);
  assert.equal(locationOf(res), '/personal/board');
  res = await get(anaLogin, `/clubs/${office.id}/probe`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('__Host-tl-space='));
  assert.match(cookie, new RegExp(`^__Host-tl-space=%2Fclubs%2F${office.id}; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`));
  res = await get(anaLogin, '/', { cookie: `${anaLogin.jar.header()}; ${cookie.split(';')[0]}` });
  assert.equal(locationOf(res), `/clubs/${office.id}/board`);
  // A space you aren't in is ignored.
  res = await get(zedLogin, '/', { cookie: `${zedLogin.jar.header()}; ${cookie.split(';')[0]}` });
  assert.equal(locationOf(res), '/personal/board');
});

test('a malformed space cookie is ignored', async () => {
  for (const bad of ['%E0%A4%A', '%']) {
    const res = await get(anaLogin, '/', { cookie: `${anaLogin.jar.header()}; __Host-tl-space=${bad}` });
    assert.equal(res.status, 303, bad);
    assert.equal(locationOf(res), '/personal/board');
  }
});

test('a space path names the space; its own id under /clubs goes to /personal', async () => {
  const personal = await get(anaLogin, '/personal/probe');
  assert.equal(personal.status, 200);
  assert.match(await personal.text(), /<p id="probe">Personal<\/p>/);
  const club = await (await get(anaLogin, `/clubs/${office.id}/probe`)).text();
  assert.match(club, /<p id="probe">Office &amp; Co<\/p>/);
  const me = await (await get(anaLogin, '/auth/me', { accept: 'application/json' })).json();
  const own = me.workspaces.find((w) => w.id !== office.id).id;
  const redirect = await get(anaLogin, `/clubs/${own}/probe?x=1`);
  assert.equal(redirect.status, 303);
  assert.equal(locationOf(redirect), '/personal/probe?x=1');
  assert.equal(locationOf(await get(anaLogin, `/clubs/${office.id}`)), `/clubs/${office.id}/board`);
  assert.equal(locationOf(await get(anaLogin, '/personal')), '/personal/board');
});

test('signed out, a space page sends you to sign in and back', async () => {
  const res = await get(null, `/clubs/${office.id}/probe?big`);
  assert.equal(res.status, 303);
  assert.equal(locationOf(res), `/auth/login?returnTo=${encodeURIComponent(`/clubs/${office.id}/probe?big`)}`);
  const posted = await app.api(null, 'POST', `/clubs/${office.id}/probe`, undefined, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(locationOf(posted), '/auth/login?returnTo=%2F');
});

test('not a member, or removed from the club: the not-found page', async () => {
  const stranger = await get(zedLogin, `/clubs/${office.id}/probe`);
  assert.equal(stranger.status, 404);
  assert.match(stranger.headers.get('content-type'), /^text\/html/);
  assert.match(await stranger.text(), /<h1>Not found<\/h1>/);
  assert.equal((await get(anaLogin, `/clubs/${office.id}/nothing`)).status, 404);
  const removed = await app.signUp('Cy');
  app.join(ana, office.id, removed);
  removeMember(app.suite.accounts.db, ana.id, office.id, removed.id);
  assert.equal((await get(await app.login(removed), `/clubs/${office.id}/probe`)).status, 404);
});

test('a role that may not, or a form from elsewhere: the forbidden page', async () => {
  const member = await app.api(benLogin, 'POST', `/clubs/${office.id}/probe`, undefined, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(member.status, 403);
  assert.match(await member.text(), /<h1>Not allowed<\/h1>/);
  const elsewhere = await app.api(anaLogin, 'POST', `/clubs/${office.id}/probe`, undefined, { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(elsewhere.status, 403);
  assert.equal((await app.api(anaLogin, 'POST', `/clubs/${office.id}/probe`, undefined, { 'content-type': 'application/x-www-form-urlencoded' })).status, 200);
});

test('the navbar: brand, screens, and the account menu with your spaces and Sign out', async () => {
  const body = await (await get(anaLogin, `/clubs/${office.id}/probe`)).text();
  assert.match(body, /<a class="navbar-brand" href="\/">/);
  for (const [path, label] of [['board', 'Board'], ['race', 'Race'], ['tap', 'Tap'], ['setup', 'Setup'], ['bridge', 'Bridge']]) {
    assert.match(body, new RegExp(`href="/clubs/${office.id}/${path}"[^>]*>${label}</a>`));
  }
  assert.match(body, /<details class="nav-account">\s*<summary[^>]*>Ana &lt;b&gt;<\/summary>/);
  assert.match(body, /href="\/personal\/board"[^>]*>Personal<\/a>/);
  assert.match(body, new RegExp(`href="/clubs/${office.id}/board" aria-current="true"[^>]*>Office &amp; Co</a>`));
  assert.match(body, /<form method="post" action="\/auth\/logout">\s*<button[^>]*>Sign out<\/button>/);
  assert.match(body, /<link rel="stylesheet" href="\/pkg\/palace-ui\/palace.css">/);
  assert.match(body, /<link rel="icon" href="\/public\/mark.svg"/);
  assert.doesNotMatch(body.replace(SPECULATION_RULES, ''), /<script/, 'no script but the speculation rules');
});

test('in production every asset is under /v/<build>/', async () => {
  const prod = await startTiming({ build: 'abc1234' });
  const user = await prod.signUp('Pia');
  const body = await (await prod.api(null, 'GET', '/', undefined, { accept: 'text/html' })).text();
  assert.match(body, /href="\/v\/abc1234\/pkg\/palace-ui\/palace.css"/);
  assert.match(body, /href="\/v\/abc1234\/public\/app.css"/);
  assert.ok(user);
  await prod.close();
});
