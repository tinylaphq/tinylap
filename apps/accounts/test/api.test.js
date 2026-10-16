// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The clubs API and pages over HTTP: session-only, same-origin for changes,
// no CORS, Problem Details, the recovery restriction, the invite rate limit,
// and pages that show only what the viewer's role may do (spec §5, §6, §9).
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_CSP } from '../server/app.js';
import { createRecoveryCodes } from '../server/recovery.js';
import { createClub, createInvite, createPersonalWorkspace, redeemInvite, setRole } from '../server/workspaces.js';
import { createTestUser, Jar, navigate, startAccounts, testSession } from './helpers.js';
import { SPECULATION_RULES } from '@tinylap/design/html/speculation.js';

/** @type {Awaited<ReturnType<typeof startAccounts>>} */
let accounts;
before(async () => {
  accounts = await startAccounts({ env: { TINYLAP_CLIENT_IP_HEADER: 'X-Test-Client' } });
});
after(() => accounts.close());

let clients = 0;

/**
 * A request as the pages' scripts make them: same-origin unless `site` says otherwise.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, jar?: Jar, site?: string | null, headers?: Record<string, string> }} [init]
 */
async function call(path, { method = 'GET', body = undefined, jar = new Jar(), site = 'same-origin', headers = {} } = {}) {
  const res = await fetch(`${accounts.issuer}${path}`, {
    method,
    headers: {
      ...(site ? { 'sec-fetch-site': site } : {}),
      'x-test-client': `198.51.100.${(clients += 1) % 250}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(jar.header() ? { cookie: jar.header() } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.store(res);
  return res;
}

let n = 0;
async function person(name = `Person ${(n += 1)}`) {
  const user = await createTestUser(accounts.auth, name);
  createPersonalWorkspace(accounts.db, user.id, name);
  return { id: user.id, name, jar: await testSession(accounts.auth, user.id) };
}

/** A club with an owner, an admin and a member, all signed in. */
async function club() {
  const [owner, admin, member] = [await person(), await person(), await person()];
  const { id } = createClub(accounts.db, owner.id, `Club ${(n += 1)}`);
  for (const p of [admin, member]) redeemInvite(accounts.db, p.id, createInvite(accounts.db, owner.id, id, { singleUse: true }).link.split('/').pop());
  setRole(accounts.db, owner.id, id, admin.id, 'admin');
  return { id, owner, admin, member };
}

async function assertProblem(res, status, type) {
  assert.equal(res.status, status);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  const body = await res.json();
  assert.equal(body.status, status);
  assert.equal(body.type, `${accounts.issuer}/problems/${type}`);
  assert.equal(typeof body.detail, 'string');
  return body;
}

describe('the API', () => {
  test('needs a session', async () => {
    for (const path of ['/api/me', '/api/workspaces', '/api/clubs/x/members']) await assertProblem(await call(path), 401, 'unauthorized');
    await assertProblem(await call('/api/clubs', { method: 'POST', body: { name: 'X' } }), 401, 'unauthorized');
  });

  test('GET /api/me and /api/workspaces describe the user', async () => {
    const p = await person('Mika');
    const me = await call('/api/me', { jar: p.jar });
    assert.deepEqual(await me.json(), { id: p.id, name: 'Mika' });
    const { workspaces } = await (await call('/api/workspaces', { jar: p.jar })).json();
    assert.deepEqual(workspaces.map((w) => ({ kind: w.kind, name: w.name, role: w.role })), [{ kind: 'personal', name: 'Mika', role: 'owner' }]);
  });

  test('state changes must be same-origin; nothing changes otherwise', async () => {
    const p = await person();
    for (const site of ['cross-site', 'same-site', null]) {
      await assertProblem(await call('/api/clubs', { method: 'POST', body: { name: 'Sneaky' }, jar: p.jar, site }), 403, 'cross-site');
    }
    const ok = await call('/api/clubs', { method: 'POST', body: { name: 'Honest' }, jar: p.jar, site: null, headers: { origin: accounts.issuer } });
    assert.equal(ok.status, 201, 'a same-origin Origin header is enough');
    const names = accounts.db.prepare('SELECT w.name FROM workspace w JOIN membership m ON m.workspace_id = w.id WHERE m.user_id = ?').all(p.id).map((r) => r.name);
    assert.equal(names.includes('Sneaky'), false);
  });

  test('never sends CORS headers', async () => {
    const p = await person();
    for (const [path, method] of [['/api/workspaces', 'GET'], ['/api/workspaces', 'OPTIONS'], ['/api/clubs', 'POST']]) {
      const res = await call(path, { method, jar: p.jar, headers: { origin: 'https://evil.test' }, site: 'cross-site' });
      assert.equal(res.headers.get('access-control-allow-origin'), null, `${method} ${path}`);
      assert.equal(res.headers.get('access-control-allow-credentials'), null);
    }
  });

  test('unknown routes are 404, wrong methods 405, bad bodies 400', async () => {
    const p = await person();
    await assertProblem(await call('/api/nope', { jar: p.jar }), 404, 'not-found');
    const res = await call('/api/clubs', { method: 'PUT', jar: p.jar, body: {} });
    await assertProblem(res, 405, 'method-not-allowed');
    assert.equal(res.headers.get('allow'), 'POST');
    await assertProblem(await call('/api/clubs', { method: 'POST', jar: p.jar, body: [] }), 400, 'invalid');
    const raw = await fetch(`${accounts.issuer}/api/clubs`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie: p.jar.header() }, body: '{not json' });
    await assertProblem(raw, 400, 'invalid');
    await assertProblem(await call('/api/clubs/%E0%A4%A/members', { jar: p.jar }), 400, 'bad-request');
  });

  test('a club, its invites and its members, end to end', async () => {
    const owner = await person('Owner');
    const created = await call('/api/clubs', { method: 'POST', jar: owner.jar, body: { name: '  Slot  Racers ' } });
    assert.equal(created.status, 201);
    const clubInfo = await created.json();
    assert.deepEqual({ ...clubInfo, id: undefined }, { id: undefined, kind: 'club', name: 'Slot Racers', role: 'owner' });
    const base = `/api/clubs/${clubInfo.id}`;

    const inv = await call(`${base}/invites`, { method: 'POST', jar: owner.jar, body: { singleUse: false, ttlDays: 30 } });
    assert.equal(inv.status, 201);
    const { link, invite } = await inv.json();
    assert.match(link, new RegExp(`^${accounts.issuer}/invite/[A-Za-z0-9_-]{43}$`));
    assert.equal(invite.singleUse, false);
    const listed = await (await call(`${base}/invites`, { jar: owner.jar })).json();
    assert.deepEqual(listed.invites.map((i) => i.id), [invite.id]);
    assert.equal(JSON.stringify(listed).includes(link.split('/').pop()), false, 'the token is never listed');

    const [ana, ben] = [await person('Ana'), await person('Ben')];
    for (const p of [ana, ben]) {
      const res = await call('/api/invites/redeem', { method: 'POST', jar: p.jar, body: { token: link.split('/').pop() } });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { workspace: { id: clubInfo.id, name: 'Slot Racers' }, joined: true });
    }

    const promoted = await call(`${base}/members/${ana.id}`, { method: 'PATCH', jar: owner.jar, body: { role: 'admin' } });
    assert.equal(promoted.status, 200);
    assert.deepEqual((await promoted.json()).members.map((m) => [m.name, m.role]), [['Owner', 'owner'], ['Ana', 'admin'], ['Ben', 'member']]);

    await assertProblem(await call(`${base}/members/${ana.id}`, { method: 'PATCH', jar: ben.jar, body: { role: 'member' } }), 403, 'forbidden');
    await assertProblem(await call(`${base}/members/${owner.id}`, { method: 'DELETE', jar: ana.jar }), 403, 'forbidden');
    assert.equal((await call(`${base}/members/${ben.id}`, { method: 'DELETE', jar: ana.jar })).status, 204);
    const members = await (await call(`${base}/members`, { jar: ana.jar })).json();
    assert.deepEqual(members.members.map((m) => m.name), ['Owner', 'Ana']);
    await assertProblem(await call(`${base}/members`, { jar: ben.jar }), 404, 'not-found');

    assert.equal((await call(`${base}/invites/${invite.id}`, { method: 'DELETE', jar: ana.jar })).status, 204);
    await assertProblem(await call('/api/invites/redeem', { method: 'POST', jar: ben.jar, body: { token: link.split('/').pop() } }), 400, 'invalid');

    await assertProblem(await call(`${base}/leave`, { method: 'POST', jar: owner.jar }), 403, 'forbidden');
    const moved = await call(`${base}/transfer`, { method: 'POST', jar: owner.jar, body: { userId: ana.id } });
    assert.equal(moved.status, 200);
    assert.deepEqual((await moved.json()).members.map((m) => [m.name, m.role]), [['Ana', 'owner'], ['Owner', 'admin']]);
    assert.equal((await call(`${base}/leave`, { method: 'POST', jar: owner.jar })).status, 204);

    const renamed = await call(base, { method: 'PATCH', jar: ana.jar, body: { name: 'Slot Masters' } });
    assert.equal((await renamed.json()).name, 'Slot Masters');
    assert.equal((await call(base, { jar: ana.jar })).status, 200);
    assert.equal((await call(base, { method: 'DELETE', jar: ana.jar })).status, 204);
    await assertProblem(await call(base, { jar: ana.jar }), 404, 'not-found');
  });

  test('quotas are 422 Problem Details with the limit', async () => {
    const p = await person();
    for (let i = 0; i < 5; i += 1) assert.equal((await call('/api/clubs', { method: 'POST', jar: p.jar, body: { name: `C${i}` } })).status, 201);
    const body = await assertProblem(await call('/api/clubs', { method: 'POST', jar: p.jar, body: { name: 'C6' } }), 422, 'quota-exceeded');
    assert.match(body.detail, /5/);
  });

  test('a transfer to someone who owns 5 clubs is 422 quota-exceeded', async () => {
    const [a, b] = [await person(), await person()];
    for (let i = 0; i < 5; i += 1) createClub(accounts.db, b.id, `B${i}`);
    const { id } = createClub(accounts.db, a.id, 'Handover');
    redeemInvite(accounts.db, b.id, createInvite(accounts.db, a.id, id, { singleUse: true }).link.split('/').pop());
    const body = await assertProblem(await call(`/api/clubs/${id}/transfer`, { method: 'POST', jar: a.jar, body: { userId: b.id } }), 422, 'quota-exceeded');
    assert.match(body.detail, /5/);
  });

  test('a recovery session reaches none of it', async () => {
    const user = await createTestUser(accounts.auth, 'Lost');
    const c = createClub(accounts.db, user.id, 'Lost Club');
    const jar = new Jar();
    await call('/recover', { method: 'POST', body: { code: createRecoveryCodes(accounts.db, user.id)[0] }, jar });
    for (const path of ['/api/workspaces', `/api/clubs/${c.id}/members`]) await assertProblem(await call(path, { jar }), 403, 'recovery-only');
    await assertProblem(await call('/api/clubs', { method: 'POST', jar, body: { name: 'X' } }), 403, 'recovery-only');
    for (const path of ['/clubs', `/clubs/${c.id}`, '/invite/x']) {
      const res = await navigate(`${accounts.issuer}${path}`, { accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie: jar.header() });
      assert.equal(res.status, 403, path);
      assert.match(await res.text(), /Add a passkey first/);
    }
  });
});

describe('invite redemption rate limit', () => {
  test('20 per hour per client', async () => {
    const limited = await startAccounts();
    try {
      const user = await createTestUser(limited.auth, 'Busy');
      const jar = await testSession(limited.auth, user.id);
      const redeem = () => fetch(`${limited.issuer}/api/invites/redeem`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie: jar.header() },
        body: JSON.stringify({ token: 'A'.repeat(43) }),
      });
      for (let i = 0; i < 20; i += 1) assert.equal((await redeem()).status, 400);
      const res = await redeem();
      assert.equal(res.status, 429);
      assert.ok(Number(res.headers.get('retry-after')) > 0);
    } finally {
      await limited.close();
    }
  });
});

describe('pages', () => {
  const page = (path, jar) => navigate(`${accounts.issuer}${path}`, { accept: 'text/html', 'sec-fetch-mode': 'navigate', ...(jar ? { cookie: jar.header() } : {}) });

  /** Asserts the page is ours: CSP, no inline script or style; returns its HTML. */
  async function ours(res, status = 200) {
    assert.equal(res.status, status);
    assert.equal(res.headers.get('content-security-policy'), PAGE_CSP);
    const text = await res.text();
    assert.doesNotMatch(text.replace(SPECULATION_RULES, ''), /<script(?![^>]*\bsrc=)/, 'no inline script but the speculation rules');
    assert.doesNotMatch(text, /<style|\sstyle=/, 'no inline style');
    return text;
  }

  test('signed out, /clubs and /clubs/:id go to sign-in and come back', async () => {
    for (const path of ['/clubs', '/clubs/abc']) {
      const res = await page(path);
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('location'), `/sign-in?next=${encodeURIComponent(path)}`);
    }
  });

  test('/clubs lists the workspaces and offers a new club', async () => {
    const c = await club();
    const text = await ours(await page('/clubs', c.member.jar));
    assert.match(text, new RegExp(`href="/clubs/${c.id}"`));
    assert.match(text, /Personal, only you/);
    assert.match(text, /id="create-club"/);
    assert.match(text, /src="\/public\/club\.js"/);
  });

  test('/clubs/:id shows a member only what a member may do', async () => {
    const c = await club();
    const text = await ours(await page(`/clubs/${c.id}`, c.member.jar));
    assert.doesNotMatch(text, /data-action="(role|remove)"/);
    assert.doesNotMatch(text, /id="create-invite"|id="rename"|id="transfer"|id="delete-club"/);
    assert.match(text, /id="leave-club"/);
  });

  test('/clubs/:id shows an admin invites and member removal, not admin changes', async () => {
    const c = await club();
    const text = await ours(await page(`/clubs/${c.id}`, c.admin.jar));
    assert.match(text, /id="create-invite"/);
    assert.match(text, new RegExp(`data-user="${c.member.id}"[\\s\\S]*?data-action="remove"`));
    assert.doesNotMatch(text, /data-action="role"/);
    assert.equal((new RegExp(`data-user="${c.owner.id}"[^]*?</li>`).exec(text)?.[0] ?? '').includes('data-action'), false, 'no actions on the owner');
    assert.doesNotMatch(text, /id="rename"|id="transfer"|id="delete-club"/);
    assert.match(text, /id="leave-club"/);
  });

  test('/clubs/:id gives the owner everything but leaving', async () => {
    const c = await club();
    const text = await ours(await page(`/clubs/${c.id}`, c.owner.jar));
    for (const id of ['create-invite', 'rename', 'transfer', 'delete-club', 'confirm']) assert.match(text, new RegExp(`id="${id}"`));
    assert.match(text, /data-role="member">Make member/);
    assert.match(text, /data-role="admin">Make admin/);
    assert.doesNotMatch(text, /id="leave-club"/);
  });

  test('/clubs/:id is 404 for outsiders and for a personal workspace', async () => {
    const c = await club();
    const stranger = await person();
    await ours(await page(`/clubs/${c.id}`, stranger.jar), 404);
    const personal = accounts.db.prepare("SELECT w.id FROM workspace w JOIN membership m ON m.workspace_id = w.id WHERE m.user_id = ? AND w.kind = 'personal'").get(stranger.id).id;
    await ours(await page(`/clubs/${personal}`, stranger.jar), 404);
  });

  test('/invite/:token: join, already in, or why not', async () => {
    const c = await club();
    const fresh = createInvite(accounts.db, c.owner.id, c.id, { singleUse: true });
    const token = fresh.link.split('/').pop();

    const out = await ours(await page(`/invite/${token}`));
    assert.match(out, new RegExp(`href="/sign-in\\?next=${encodeURIComponent(`/invite/${token}`)}"`));
    assert.match(out, new RegExp(`href="/sign-up\\?next=${encodeURIComponent(`/invite/${token}`)}"`));

    const newcomer = await person();
    assert.match(await ours(await page(`/invite/${token}`, newcomer.jar)), /id="join"/);
    assert.match(await ours(await page(`/invite/${token}`, c.member.jar)), /already a member/);

    await ours(await page('/invite/nonsense'), 404);
    accounts.db.prepare('UPDATE invite SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), fresh.invite.id);
    const expired = await ours(await page(`/invite/${token}`, newcomer.jar), 410);
    assert.match(expired, /expired/);
    assert.match(expired, /new invite link/);
  });
});
