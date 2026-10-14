// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The account page and its API (spec §6, §7, §9, §12): passkeys (never the
// last one removed), new recovery codes, sign out everywhere, export,
// deletion, RP-initiated logout, the privacy and signed-out pages, and the
// fresh-session rule for adding a passkey, new codes, removing a passkey
// and deleting the account.
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { PAGE_CSP } from '../server/app.js';
import { createRecoveryCodes } from '../server/recovery.js';
import { createClub, createPersonalWorkspace, createInvite } from '../server/workspaces.js';
import { createTestUser, driveAuthorize, Jar, navigate, startAccounts, testSession } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
/** @type {oidc.Configuration} */
let rp;

before(async () => {
  accounts = await startAccounts({ plannerPort: 8124, env: { TINYLAP_CLIENT_IP_HEADER: 'X-Test-Client' } });
  rp = await oidc.discovery(new URL(accounts.issuer), accounts.client.clientId, undefined,
    oidc.ClientSecretBasic(accounts.client.clientSecret), { execute: [oidc.allowInsecureRequests] });
});
after(() => accounts.close());

let clients = 0;

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, jar?: Jar, site?: string | null, headers?: Record<string, string> }} [init]
 */
async function call(path, { method = 'GET', body = undefined, jar = new Jar(), site = 'same-origin', headers = {} } = {}) {
  const res = await fetch(`${accounts.issuer}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(site ? { 'sec-fetch-site': site } : {}),
      'x-test-client': `203.0.113.${(clients += 1) % 250}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(jar.header() ? { cookie: jar.header() } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.store(res);
  return res;
}

const page = (path, jar = new Jar()) => navigate(`${accounts.issuer}${path}`, { accept: 'text/html', 'sec-fetch-mode': 'navigate', ...(jar.header() ? { cookie: jar.header() } : {}) });

/** A passkey row as the plugin writes it, with key material to look for. */
function addPasskey(userId, name = null) {
  const id = randomBytes(8).toString('hex');
  accounts.db.prepare(`INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt)
    VALUES (?, ?, ?, ?, ?, 0, 'multiDevice', 1, 'internal', ?)`).run(id, name, `PUBLICKEY-${id}`, userId, `CREDENTIAL-${id}`, new Date().toISOString());
  return id;
}

let n = 0;
/** A signed-up user: personal workspace, one passkey, recovery codes, a fresh session. */
async function person(name = `Person ${(n += 1)}`) {
  const user = await createTestUser(accounts.auth, name);
  const workspace = createPersonalWorkspace(accounts.db, user.id, name);
  const passkey = addPasskey(user.id, 'Laptop');
  createRecoveryCodes(accounts.db, user.id);
  return { id: user.id, name, workspace, passkey, jar: await testSession(accounts.auth, user.id) };
}

/** Ages every session of `userId` past the 10-minute fresh window. */
const age = (userId) => accounts.db.prepare('UPDATE session SET createdAt = ? WHERE userId = ?').run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), userId);

async function assertProblem(res, status, type) {
  assert.equal(res.status, status);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  const body = await res.json();
  assert.equal(body.type, `${accounts.issuer}/problems/${type}`);
  return body;
}

/** A full OIDC login for a person; a new session each time. */
async function login(p) {
  const jar = await testSession(accounts.auth, p.id);
  const pkceCodeVerifier = oidc.randomPKCECodeVerifier();
  const expectedNonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(rp, {
    redirect_uri: accounts.client.redirectUri,
    scope: 'openid profile offline_access',
    code_challenge: await oidc.calculatePKCECodeChallenge(pkceCodeVerifier),
    code_challenge_method: 'S256',
    nonce: expectedNonce,
    resource: accounts.client.resource,
  });
  const res = await driveAuthorize(url, jar);
  const tokens = await oidc.authorizationCodeGrant(rp, new URL(res.headers.get('location')), { pkceCodeVerifier, expectedNonce, idTokenExpected: true }, { resource: accounts.client.resource });
  return { jar, tokens, url };
}

const refreshFails = (token) => assert.rejects(
  oidc.refreshTokenGrant(rp, token, { resource: accounts.client.resource }),
  (/** @type {any} */ error) => error.error === 'invalid_grant',
);

describe('passkeys', () => {
  test('removing a passkey works; removing the last one is refused', async () => {
    const p = await person();
    const second = addPasskey(p.id, 'Phone');
    const res = await call(`/api/me/passkeys/${second}`, { method: 'DELETE', jar: p.jar });
    assert.equal(res.status, 204);
    const last = await call(`/api/me/passkeys/${p.passkey}`, { method: 'DELETE', jar: p.jar });
    const body = await assertProblem(last, 409, 'conflict');
    assert.match(body.detail, /only passkey/);
    assert.equal(accounts.db.prepare('SELECT COUNT(*) AS c FROM passkey WHERE userId = ?').get(p.id).c, 1);
  });

  test("someone else's passkey is not found, and nothing goes", async () => {
    const [a, b] = [await person(), await person()];
    addPasskey(b.id);
    await assertProblem(await call(`/api/me/passkeys/${b.passkey}`, { method: 'DELETE', jar: a.jar }), 404, 'not-found');
    assert.equal(accounts.db.prepare('SELECT COUNT(*) AS c FROM passkey WHERE userId = ?').get(b.id).c, 2);
  });

  test("Better Auth's own delete and update passkey routes are off", async () => {
    const p = await person();
    assert.equal((await call('/passkey/delete-passkey', { method: 'POST', jar: p.jar, body: { id: p.passkey } })).status, 404);
    assert.equal((await call('/passkey/update-passkey', { method: 'POST', jar: p.jar, body: { id: p.passkey, name: 'x' } })).status, 404);
    assert.equal(accounts.db.prepare('SELECT COUNT(*) AS c FROM passkey WHERE userId = ?').get(p.id).c, 1);
  });
});

describe('a fresh session', () => {
  test('adding a passkey, new codes, removing a passkey and deleting the account need one', async () => {
    const p = await person();
    const second = addPasskey(p.id);
    age(p.id);
    for (const res of [
      await call('/passkey/generate-register-options?name=X', { jar: p.jar }),
      await call('/passkey/verify-registration', { method: 'POST', jar: p.jar, body: { response: {} } }),
      await call('/recovery-codes', { method: 'POST', jar: p.jar, body: {} }),
      await call(`/api/me/passkeys/${second}`, { method: 'DELETE', jar: p.jar }),
      await call('/api/me', { method: 'DELETE', jar: p.jar }),
    ]) {
      const body = await assertProblem(res, 403, 'reauthenticate');
      assert.match(body.detail, /passkey/);
    }
    assert.ok(accounts.db.prepare('SELECT 1 FROM "user" WHERE id = ?').get(p.id), 'still there');
    assert.equal(accounts.db.prepare('SELECT COUNT(*) AS c FROM passkey WHERE userId = ?').get(p.id).c, 2);

    // A new passkey sign-in (here: a new session) makes it fresh again.
    const fresh = await testSession(accounts.auth, p.id);
    assert.equal((await call('/passkey/generate-register-options?name=X', { jar: fresh })).status, 200);
    assert.equal((await call('/recovery-codes', { method: 'POST', jar: fresh, body: {} })).status, 200);
  });

  test('a stale session may still read, export and sign out everywhere', async () => {
    const p = await person();
    age(p.id);
    assert.equal((await page('/account', p.jar)).status, 200);
    assert.equal((await call('/api/me/export', { jar: p.jar })).status, 200);
    assert.equal((await call('/api/me/sign-out-everywhere', { method: 'POST', jar: p.jar })).status, 204);
  });

  test('a recovery session adds its passkey and codes however old it is', async () => {
    const p = await person();
    const [code] = createRecoveryCodes(accounts.db, p.id);
    const jar = new Jar();
    assert.equal((await call('/recover', { method: 'POST', jar, body: { code } })).status, 200);
    age(p.id);
    assert.equal((await call('/passkey/generate-register-options?name=X', { jar })).status, 200);
    assert.equal((await call('/recovery-codes', { method: 'POST', jar, body: {} })).status, 200);
    // and still nothing else
    assert.equal((await page('/account', jar)).status, 403);
    await assertProblem(await call('/api/me/export', { jar }), 403, 'recovery-only');
    await assertProblem(await call('/api/me', { method: 'DELETE', jar }), 403, 'recovery-only');
  });
});

describe('sign out everywhere', () => {
  test('ends every session and makes every refresh token invalid_grant', async () => {
    const p = await person();
    const first = await login(p);
    const second = await login(p);
    const res = await call('/api/me/sign-out-everywhere', { method: 'POST', jar: p.jar });
    assert.equal(res.status, 204);
    assert.ok(res.headers.getSetCookie().some((c) => /session_token=;/.test(c) && /Max-Age=0/i.test(c)), 'the cookie is cleared');
    await refreshFails(first.tokens.refresh_token);
    await refreshFails(second.tokens.refresh_token);
    assert.equal(accounts.db.prepare('SELECT COUNT(*) AS c FROM session WHERE userId = ?').get(p.id).c, 0);
    for (const jar of [first.jar, second.jar]) assert.equal((await call('/api/me', { jar })).status, 401);
    // and the next authorize asks for a passkey again
    const again = await driveAuthorize(first.url, first.jar);
    assert.equal(new URL(again.headers.get('location'), accounts.issuer).pathname, '/sign-in');
  });

  test('is same-origin only and needs a session', async () => {
    const p = await person();
    await assertProblem(await call('/api/me/sign-out-everywhere', { method: 'POST', jar: p.jar, site: 'cross-site' }), 403, 'cross-site');
    assert.equal((await call('/api/me', { jar: p.jar })).status, 200);
    await assertProblem(await call('/api/me/sign-out-everywhere', { method: 'POST' }), 401, 'unauthorized');
  });
});

describe('export', () => {
  test('the user, passkeys, memberships and invites created, with no key material', async () => {
    const p = await person('Exporter');
    addPasskey(p.id, null);
    const club = createClub(accounts.db, p.id, 'Export Club');
    const { invite } = createInvite(accounts.db, p.id, club.id, { singleUse: false, ttlDays: 7 });
    const res = await call('/api/me/export', { jar: p.jar });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="tinylap-account\.json"$/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const text = await res.text();
    const data = JSON.parse(text);
    assert.equal(data.user.id, p.id);
    assert.equal(data.user.displayName, 'Exporter');
    assert.ok(!Number.isNaN(Date.parse(data.user.createdAt)));
    assert.deepEqual(data.passkeys.map((k) => k.name), ['Laptop', null]);
    for (const k of data.passkeys) {
      assert.deepEqual(Object.keys(k).sort(), ['createdAt', 'name']);
      assert.ok(!Number.isNaN(Date.parse(k.createdAt)));
    }
    assert.deepEqual(data.memberships.map((m) => [m.kind, m.name, m.role]), [['personal', 'Exporter', 'owner'], ['club', 'Export Club', 'owner']]);
    assert.deepEqual(data.invitesCreated.map((i) => ({ id: i.id, workspace: i.workspace.name, singleUse: i.singleUse })), [{ id: invite.id, workspace: 'Export Club', singleUse: false }]);
    for (const field of ['publicKey', 'credentialID', 'PUBLICKEY-', 'CREDENTIAL-', 'token_hash', 'secret_hash', 'tokenHash', 'email']) {
      assert.equal(text.includes(field), false, `no ${field}`);
    }
  });

  test('needs a session', async () => {
    await assertProblem(await call('/api/me/export'), 401, 'unauthorized');
  });
});

describe('DELETE /api/me', () => {
  test('is refused with 409, naming the club, while the user owns one', async () => {
    const p = await person();
    createClub(accounts.db, p.id, 'Still Mine');
    const body = await assertProblem(await call('/api/me', { method: 'DELETE', jar: p.jar }), 409, 'conflict');
    assert.match(body.detail, /"Still Mine"/);
    assert.ok(accounts.db.prepare('SELECT 1 FROM "user" WHERE id = ?').get(p.id));
  });

  test('deletes the user and the personal workspace, and the feed shows both', async () => {
    const p = await person('Leaving');
    const { tokens } = await login(p);
    const before = Number(accounts.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM deletion').get().s);
    const res = await call('/api/me', { method: 'DELETE', jar: p.jar });
    assert.equal(res.status, 204);
    assert.ok(res.headers.getSetCookie().some((c) => /session_token=;/.test(c)), 'the cookie is cleared');
    assert.equal(accounts.db.prepare('SELECT 1 FROM "user" WHERE id = ?').get(p.id), undefined);
    assert.equal(accounts.db.prepare('SELECT 1 FROM workspace WHERE id = ?').get(p.workspace), undefined);
    for (const table of ['passkey', 'session']) assert.equal(accounts.db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE userId = ?`).get(p.id).c, 0, table);
    assert.equal(accounts.db.prepare('SELECT COUNT(*) AS c FROM recovery_code WHERE user_id = ?').get(p.id).c, 0);
    await refreshFails(tokens.refresh_token);
    const feed = await (await fetch(`${accounts.issuer}/deletions?after=${before}`, { headers: { authorization: 'Bearer feed-test' } })).json();
    assert.deepEqual(feed.deletions.map(({ kind, id }) => ({ kind, id })), [{ kind: 'workspace', id: p.workspace }, { kind: 'user', id: p.id }]);
    assert.equal((await call('/api/me', { jar: p.jar })).status, 401);
  });

  test('is same-origin only', async () => {
    const p = await person();
    await assertProblem(await call('/api/me', { method: 'DELETE', jar: p.jar, site: 'cross-site' }), 403, 'cross-site');
    assert.ok(accounts.db.prepare('SELECT 1 FROM "user" WHERE id = ?').get(p.id));
  });
});

describe('RP-initiated logout', () => {
  const endSession = (params, jar) => navigate(`${accounts.issuer}/oauth2/end-session?${new URLSearchParams(params)}`, {
    accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site', ...(jar.header() ? { cookie: jar.header() } : {}),
  });

  test('with id_token_hint and the registered post_logout_redirect_uri: ends the session, redirects, and the next authorize asks to sign in', async () => {
    const p = await person();
    const { jar, tokens, url } = await login(p);
    const stale = jar.header();
    const res = await endSession({ id_token_hint: tokens.id_token, post_logout_redirect_uri: accounts.client.postLogoutRedirectUri, state: 'st' }, jar);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${accounts.client.postLogoutRedirectUri}?state=st`);
    jar.store(res);
    const again = await driveAuthorize(url, jar);
    const to = new URL(again.headers.get('location'), accounts.issuer);
    assert.equal(to.origin + to.pathname, `${accounts.issuer}/sign-in`, 'no silent login');
    // A browser that kept the old cookie is no better off: the session is gone.
    const kept = new Jar();
    for (const pair of stale.split('; ')) kept.cookies.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
    assert.equal(new URL((await driveAuthorize(url, kept)).headers.get('location'), accounts.issuer).pathname, '/sign-in');
  });

  test('the post-logout URIs registered are exactly those configured', () => {
    const row = accounts.db.prepare('SELECT postLogoutRedirectUris FROM oauthClient WHERE clientId = ?').get(accounts.client.clientId);
    assert.deepEqual(JSON.parse(String(row.postLogoutRedirectUris)), accounts.config.clients[0].postLogoutRedirectUris);
  });

  test('without a valid hint it goes to /signed-out, and the session stays until the person signs out there', async () => {
    const p = await person('Still In');
    for (const params of [{}, { id_token_hint: 'garbage' }, { id_token_hint: 'garbage', post_logout_redirect_uri: accounts.client.postLogoutRedirectUri }]) {
      const res = await endSession(params, p.jar);
      assert.equal(res.status, 303, JSON.stringify(params));
      assert.equal(res.headers.get('location'), '/signed-out');
      assert.equal((await call('/api/me', { jar: p.jar })).status, 200, 'no silent logout without a hint');
    }
    const html = await (await page('/signed-out', p.jar)).text();
    assert.match(html, /Still In/);
    assert.match(html, /id="sign-out"/);
  });

  test('an unregistered post_logout_redirect_uri is never followed', async () => {
    const p = await person();
    const { jar, tokens } = await login(p);
    const res = await endSession({ id_token_hint: tokens.id_token, post_logout_redirect_uri: 'https://evil.test/' }, jar);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/signed-out');
  });
});

describe('pages', () => {
  const assertPage = (res) => {
    assert.equal(res.headers.get('content-security-policy'), PAGE_CSP);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  };
  const noInline = (html) => {
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script');
    assert.doesNotMatch(html, /<style|style="/, 'no inline style');
  };

  test('/account signed out goes to sign-in and back', async () => {
    const res = await page('/account');
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/sign-in?next=%2Faccount');
  });

  test('/account lists passkeys, codes left, sign out everywhere, export and delete', async () => {
    const p = await person('Page <Owner>');
    addPasskey(p.id, 'Phone');
    const res = await page('/account', p.jar);
    assert.equal(res.status, 200);
    assertPage(res);
    const html = await res.text();
    noInline(html);
    assert.match(html, /Page &lt;Owner&gt;/);
    assert.equal((html.match(/data-passkey="/g) ?? []).length, 2);
    assert.match(html, /Laptop/);
    assert.match(html, /Phone/);
    assert.match(html, /10 of 10/);
    assert.match(html, /id="sign-out-everywhere"/);
    assert.match(html, /href="\/api\/me\/export"/);
    assert.ok(html.includes(`href="${accounts.client.resource}/library/export"`), 'links to the planner export');
    assert.match(html, /id="delete-account"/);
    assert.match(html, /data-name="Page &lt;Owner&gt;"/);
    assert.match(html, /src="\/public\/account.js"/);
  });

  test('/account: the only passkey cannot be removed; an owner is told which club to hand on', async () => {
    const p = await person();
    createClub(accounts.db, p.id, 'Keep Me');
    const html = await (await page('/account', p.jar)).text();
    assert.match(html, /data-action="remove"[^>]*disabled/);
    assert.match(html, /&quot;Keep Me&quot;|"Keep Me"/);
    assert.match(html, /id="delete-account"[^>]*disabled/);
  });

  test('/account warns when no recovery codes are left', async () => {
    const p = await person();
    accounts.db.prepare('DELETE FROM recovery_code WHERE user_id = ?').run(p.id);
    const html = await (await page('/account', p.jar)).text();
    assert.match(html, /no recovery codes/i);
  });

  test('/privacy says what is stored, and how to export and delete it', async () => {
    const res = await page('/privacy');
    assert.equal(res.status, 200);
    assertPage(res);
    const html = await res.text();
    noInline(html);
    for (const words of [/display name/i, /passkey/i, /membership/i, /private tracks/i, /export/i, /delete/i, /Operator: see the project README/]) assert.match(html, words);
  });

  test('/signed-out signed out says so', async () => {
    const res = await page('/signed-out');
    assert.equal(res.status, 200);
    assertPage(res);
    const html = await res.text();
    noInline(html);
    assert.match(html, /signed out/i);
    assert.doesNotMatch(html, /id="sign-out"/);
  });
});
