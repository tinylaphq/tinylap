// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The private library (identity spec §4–§6, §9) against a real accounts:
// private snapshots per workspace, tracks with their history, roles, the
// stranger's 404 that is the unknown key's 404 byte for byte, sharing
// through the public path, and the quotas.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, snapshotKey, shapeKey, shapeOf, canonicalJson } from '@tinylap/track-format';
import { createClub, createInvite, redeemInvite, setRole } from '../../../accounts/server/workspaces.js';
import { createHandler } from '../../server/app.js';
import { appDir, closedLayout, startPlanner } from './helpers.js';
import { createServer } from 'node:http';

const CHROME = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/** @type {Awaited<ReturnType<typeof startPlanner>>} */
let planner;
/** Logged-in users: the club's owner, a member, an admin, and a stranger with a club of their own. */
let owner;
let member;
let admin;
let stranger;
let club;
let second;
let foreign;

/** An open layout, different for every `n`. */
const variant = (n) => createLayout({ pieces: [{ type: 'straight', x: n, y: 0, rot: 0 }] });

/** Adds `userId` to `workspaceId` through an invite. */
function join(db, ownerId, workspaceId, userId) {
  const { link } = createInvite(db, ownerId, workspaceId);
  redeemInvite(db, userId, link.split('/').pop());
}

before(async () => {
  planner = await startPlanner({ saveLimit: 10_000 });
  const db = planner.suite.accounts.db;
  const users = {};
  for (const name of ['Owner', 'Member', 'Admin', 'Stranger']) users[name] = (await planner.suite.signInUser(undefined, name)).user;
  club = createClub(db, users.Owner.id, 'Kart Club');
  second = createClub(db, users.Owner.id, 'Second Club');
  foreign = createClub(db, users.Stranger.id, 'Elsewhere');
  join(db, users.Owner.id, club.id, users.Member.id);
  join(db, users.Owner.id, club.id, users.Admin.id);
  setRole(db, users.Owner.id, club.id, users.Admin.id, 'admin');
  // Log in after the memberships exist: the token carries them.
  owner = await planner.login('/', users.Owner);
  member = await planner.login('/', users.Member);
  admin = await planner.login('/', users.Admin);
  stranger = await planner.login('/', users.Stranger);
});
after(() => planner.close());

/** A library call as `who` (a login, or null for nobody), from the planner's own origin. */
function api(who, method, path, body, headers = {}) {
  return fetch(planner.base + path, {
    method,
    headers: {
      origin: planner.base,
      ...(who ? { cookie: who.jar.header() } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  const body = await res.json();
  assert.equal(body.type, `${planner.base}/problems/${name}`);
  return body;
};

async function save(who, workspaceId, layout, name = 'Monza') {
  const res = await api(who, 'POST', '/library/tracks', { workspaceId, name, layout });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).track;
}

const comparable = (res) => {
  const headers = Object.fromEntries([...res.headers].filter(([k]) => k !== 'date'));
  return res.text().then((body) => ({ status: res.status, headers, body }));
};

test('a save creates a private row and a version; two workspaces get two rows, and deleting one leaves the other', async () => {
  const layout = variant(1);
  const key = await snapshotKey(layout);
  const a = await save(owner, club.id, layout);
  const b = await save(owner, second.id, layout);
  assert.equal(a.currentKey, key);
  assert.equal(a.workspaceId, club.id);
  assert.deepEqual(a.updatedBy, { id: owner.user.id, name: 'Owner' });
  assert.equal(planner.store.getPrivate(key, club.id), canonicalJson(layout));
  assert.equal(planner.store.getPrivate(key, second.id), canonicalJson(layout));
  assert.equal(planner.store.get(key), null, 'saving publishes nothing');

  const versions = await (await api(owner, 'GET', `/library/tracks/${a.id}/versions`)).json();
  assert.deepEqual(versions.versions.map((v) => v.key), [key]);
  assert.deepEqual(versions.versions[0].savedBy, { id: owner.user.id, name: 'Owner' });

  planner.store.deleteWorkspaceData(second.id);
  assert.equal(planner.store.getPrivate(key, second.id), null);
  assert.equal(planner.store.getTrack(b.id), null);
  assert.equal(planner.store.getPrivate(key, club.id), canonicalJson(layout));
  assert.ok(planner.store.getTrack(a.id));
});

test("a stranger's GET of a private key is byte for byte an unknown key's 404", async () => {
  const layout = variant(2);
  const key = await snapshotKey(layout);
  await save(owner, club.id, layout);
  const unknown = 'AAAAAAAAAAAAAAAAAAAAAA';
  const as = (who, extra = {}) => ({ headers: { ...(who ? { cookie: who.jar.header() } : {}), ...extra } });
  for (const who of [null, stranger]) {
    for (const suffix of ['', '.json', '.html']) {
      for (const extra of [{}, { accept: CHROME }, { 'if-none-match': `"${key}"` }, { 'if-none-match': `"${key}-dev"`, accept: CHROME }]) {
        const priv = await comparable(await fetch(`${planner.base}/layouts/${key}${suffix}`, as(who, extra)));
        const miss = await comparable(await fetch(`${planner.base}/layouts/${unknown}${suffix}`, as(who, extra)));
        const plain = await comparable(await fetch(`${planner.base}/layouts/${unknown}${suffix}`, as(who)));
        assert.equal(priv.status, 404);
        assert.deepEqual(priv, miss, `${who ? 'stranger' : 'nobody'} ${suffix} ${JSON.stringify(extra)}`);
        assert.deepEqual(priv, plain, 'an etag changes nothing for a stranger');
        assert.equal(priv.headers.vary, 'Cookie');
      }
    }
  }
});

test('a member gets the private snapshot, private and no-store, varying on Cookie, without CORS', async () => {
  const layout = variant(3);
  const key = await snapshotKey(layout);
  await save(owner, club.id, layout);
  const res = await fetch(`${planner.base}/layouts/${key}`, { headers: { cookie: member.jar.header() } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), canonicalJson(layout));
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.match(res.headers.get('vary'), /\bCookie\b/);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  const page = await fetch(`${planner.base}/layouts/${key}.html`, { headers: { cookie: member.jar.header() } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('vary'), /\bCookie\b/);
  // The member's 304 comes after the check.
  const again = await fetch(`${planner.base}/layouts/${key}`, { headers: { cookie: member.jar.header(), 'if-none-match': res.headers.get('etag') } });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get('cache-control'), 'private, no-store');

  // A public snapshot keeps CORS and its caching, and varies on Cookie too.
  const pub = closedLayout();
  await fetch(`${planner.base}/layouts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pub) });
  const open = await fetch(`${planner.base}/layouts/${await snapshotKey(pub)}`, { headers: { cookie: member.jar.header() } });
  assert.equal(open.status, 200);
  assert.equal(open.headers.get('access-control-allow-origin'), '*');
  assert.equal(open.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(open.headers.get('vary'), 'Accept, Cookie');
});

test('a private key is not listed under its shape', async () => {
  const layout = closedLayout();
  const key = await snapshotKey(layout);
  await save(owner, club.id, layout);
  // Other tests publish the same shape, so the listing may exist; the private key is never in it.
  const res = await fetch(`${planner.base}/shapes/${await shapeKey(shapeOf(layout))}`);
  const listed = res.status === 200 ? (await res.json()).layouts.map((l) => l.key) : [];
  assert.ok(!listed.includes(key));
  assert.ok(planner.store.getPrivate(key, club.id));
});

test('the 51st version drops the oldest, and its private row goes when nothing references it', async () => {
  const track = await save(owner, second.id, variant(100), 'History');
  const first = await snapshotKey(variant(100));
  for (let i = 101; i <= 150; i += 1) {
    const res = await api(owner, 'POST', `/library/tracks/${track.id}/versions`, { layout: variant(i) });
    assert.equal(res.status, 201);
  }
  const { versions, kept } = await (await api(owner, 'GET', `/library/tracks/${track.id}/versions`)).json();
  assert.equal(kept, 50);
  assert.equal(versions.length, 50);
  assert.equal(versions[0].key, await snapshotKey(variant(150)), 'newest first');
  assert.ok(!versions.some((v) => v.key === first));
  assert.equal(planner.store.getPrivate(first, second.id), null);
  assert.ok(planner.store.getPrivate(await snapshotKey(variant(101)), second.id));
});

test('a private row another track still uses is kept when one track drops it', async () => {
  const shared = variant(200);
  const key = await snapshotKey(shared);
  const a = await save(owner, club.id, shared, 'A');
  await save(owner, club.id, shared, 'B');
  assert.equal((await api(owner, 'DELETE', `/library/tracks/${a.id}`)).status, 204);
  assert.ok(planner.store.getPrivate(key, club.id));
});

test('versions: saving again, deleting one, the current key follows', async () => {
  const track = await save(member, club.id, variant(300), 'Spa');
  const res = await api(member, 'POST', `/library/tracks/${track.id}/versions`, { layout: variant(301) });
  const body = await res.json();
  assert.equal(body.version.key, await snapshotKey(variant(301)));
  assert.equal(body.track.currentKey, body.version.key);
  assert.equal((await api(admin, 'DELETE', `/library/tracks/${track.id}/versions/${body.version.key}`)).status, 204);
  const { workspaces } = await (await api(member, 'GET', '/library')).json();
  const listed = workspaces.find((w) => w.id === club.id).tracks.find((t) => t.id === track.id);
  assert.equal(listed.currentKey, await snapshotKey(variant(300)));
  assert.equal(planner.store.getPrivate(body.version.key, club.id), null);
  await problemOf(await api(admin, 'DELETE', `/library/tracks/${track.id}/versions/${body.version.key}`), 404, 'not-found');
});

test('GET /library lists the workspaces from the token with their tracks; rename', async () => {
  const track = await save(member, club.id, variant(400), 'Old name');
  const renamed = await api(member, 'PATCH', `/library/tracks/${track.id}`, { name: '  Imola ' });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).track.name, 'Imola');
  const res = await api(member, 'GET', '/library');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.match(res.headers.get('vary'), /Cookie/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { workspaces } = await res.json();
  assert.deepEqual(workspaces.map(({ id, name, role }) => ({ id, name, role })), [{ id: club.id, name: 'Kart Club', role: 'member' }]);
  const listed = workspaces[0].tracks.find((t) => t.id === track.id);
  assert.deepEqual(Object.keys(listed).sort(), ['createdAt', 'currentKey', 'id', 'name', 'updatedAt', 'updatedBy', 'workspaceId']);
  assert.equal(listed.name, 'Imola');
  await problemOf(await api(member, 'PATCH', `/library/tracks/${track.id}`, { name: '' }), 422, 'invalid-request');
  await problemOf(await api(stranger, 'GET', `/library/tracks/${track.id}/versions`), 404, 'not-found');
});

test('a member cannot delete a track (403); an admin can', async () => {
  const track = await save(member, club.id, variant(500));
  await problemOf(await api(member, 'DELETE', `/library/tracks/${track.id}`), 403, 'forbidden');
  await problemOf(await api(member, 'DELETE', `/library/tracks/${track.id}/versions/${track.currentKey}`), 403, 'forbidden');
  await problemOf(await api(stranger, 'DELETE', `/library/tracks/${track.id}`), 404, 'not-found');
  assert.equal((await api(admin, 'DELETE', `/library/tracks/${track.id}`)).status, 204);
  assert.equal(planner.store.getTrack(track.id), null);
  assert.equal(planner.store.getPrivate(track.currentKey, club.id), null);
});

test('copy: to a workspace you do not belong to is a 404; to yours, with the current version only', async () => {
  const track = await save(owner, club.id, variant(600), 'Suzuka');
  await api(owner, 'POST', `/library/tracks/${track.id}/versions`, { layout: variant(601) });
  await problemOf(await api(owner, 'POST', `/library/tracks/${track.id}/copy`, { workspaceId: foreign.id }), 404, 'not-found');
  await problemOf(await api(stranger, 'POST', `/library/tracks/${track.id}/copy`, { workspaceId: foreign.id }), 404, 'not-found');
  const res = await api(owner, 'POST', `/library/tracks/${track.id}/copy`, { workspaceId: second.id });
  assert.equal(res.status, 201);
  const copy = (await res.json()).track;
  assert.equal(copy.workspaceId, second.id);
  assert.equal(copy.name, 'Suzuka');
  assert.equal(copy.currentKey, await snapshotKey(variant(601)));
  const { versions } = await (await api(owner, 'GET', `/library/tracks/${copy.id}/versions`)).json();
  assert.deepEqual(versions.map((v) => v.key), [copy.currentKey]);
  assert.ok(planner.store.getPrivate(copy.currentKey, second.id));
});

test('share publishes the current version: public, listed under its shape, and the private row stays', async () => {
  const layout = closedLayout();
  const key = await snapshotKey(layout);
  const track = await save(member, club.id, layout);
  const res = await api(member, 'POST', `/library/tracks/${track.id}/share`);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { key, url: `${planner.base}/layouts/${key}`, shapeKey: await shapeKey(shapeOf(layout)) });
  assert.equal((await api(member, 'POST', `/library/tracks/${track.id}/share`)).status, 200, 'sharing twice is a no-op');
  const pub = await fetch(`${planner.base}/layouts/${key}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('access-control-allow-origin'), '*');
  const shapes = await (await fetch(`${planner.base}/shapes/${await shapeKey(shapeOf(layout))}`)).json();
  assert.ok(shapes.layouts.some((l) => l.key === key));
  assert.ok(planner.store.getPrivate(key, club.id));
});

test('share applies the public rules: a closed loop without its track block is a track-mismatch', async () => {
  const bare = { ...closedLayout(), track: undefined }; // dropped by JSON.stringify
  const track = await save(member, club.id, bare, 'No track block');
  await problemOf(await api(member, 'POST', `/library/tracks/${track.id}/share`), 422, 'track-mismatch');
});

test('quotas: the 201st track and a 65 KiB layout give 422 quota-exceeded', async () => {
  const quotaClub = createClub(planner.suite.accounts.db, owner.user.id, 'Full Club');
  const owner2 = await planner.login('/', owner.user);
  for (let i = 0; i < 200; i += 1) {
    planner.store.createTrack({ id: `seed-${i}`, workspaceId: quotaClub.id, name: `T${i}`, key: String(i).padStart(22, 'A'), json: canonicalJson(variant(i)), userId: owner.user.id, userName: 'Owner' });
  }
  const full = await problemOf(await api(owner2, 'POST', '/library/tracks', { workspaceId: quotaClub.id, name: 'One more', layout: variant(1) }), 422, 'quota-exceeded');
  assert.match(full.detail, /200/);
  const track = await save(owner, club.id, variant(700));
  await problemOf(await api(owner2, 'POST', `/library/tracks/${track.id}/copy`, { workspaceId: quotaClub.id }), 422, 'quota-exceeded');

  const big = createLayout({ pieces: Array.from({ length: 2000 }, (_, i) => ({ type: 'straight', x: i, y: 0, rot: 0 })) });
  assert.ok(Buffer.byteLength(canonicalJson(big)) > 65 * 1024);
  const large = await problemOf(await api(owner, 'POST', '/library/tracks', { workspaceId: club.id, name: 'Big', layout: big }), 422, 'quota-exceeded');
  assert.match(large.detail, /64 KiB/);
  await problemOf(await api(owner, 'POST', `/library/tracks/${track.id}/versions`, { layout: big }), 422, 'quota-exceeded');
});

test('quotas: the 61st save in an hour gives 422 quota-exceeded', async () => {
  // A second server on the same store and log-in, with the default save limit.
  const server = createServer(createHandler({ appDir, log: false, store: planner.store, publicUrl: planner.base, auth: planner.auth }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const call = (body, path = '/library/tracks') => fetch(base + path, {
      method: 'POST', headers: { origin: planner.base, cookie: member.jar.header(), 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const first = await call({ workspaceId: club.id, name: 'Busy', layout: variant(800) });
    assert.equal(first.status, 201);
    const { track } = await first.json();
    for (let i = 1; i < 60; i += 1) assert.equal((await call({ layout: variant(800 + i) }, `/library/tracks/${track.id}/versions`)).status, 201);
    const res = await call({ layout: variant(900) }, `/library/tracks/${track.id}/versions`);
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.type, `${planner.base}/problems/quota-exceeded`);
    assert.match(body.detail, /60/);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('not logged in: 401 on every library route; a foreign Origin on a write: 403', async () => {
  const track = await save(owner, club.id, variant(1000));
  const routes = [
    ['GET', '/library'],
    ['GET', '/library/export'],
    ['POST', '/library/tracks', { workspaceId: club.id, name: 'x', layout: variant(1) }],
    ['PATCH', `/library/tracks/${track.id}`, { name: 'x' }],
    ['DELETE', `/library/tracks/${track.id}`],
    ['GET', `/library/tracks/${track.id}/versions`],
    ['POST', `/library/tracks/${track.id}/versions`, { layout: variant(1) }],
    ['DELETE', `/library/tracks/${track.id}/versions/${track.currentKey}`],
    ['POST', `/library/tracks/${track.id}/copy`, { workspaceId: second.id }],
    ['POST', `/library/tracks/${track.id}/share`],
  ];
  for (const [method, path, body] of routes) {
    const res = await api(null, method, path, body);
    await problemOf(res, 401, 'unauthorized');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    if (method === 'GET') continue;
    await problemOf(await api(owner, method, path, body, { origin: 'https://evil.test' }), 403, 'forbidden');
    await problemOf(await api(owner, method, path, body, { origin: '', 'sec-fetch-site': 'cross-site' }), 403, 'forbidden');
  }
  assert.ok(planner.store.getTrack(track.id), 'nothing was changed');
  // A cross-origin preflight gets nothing to allow it.
  const pre = await fetch(`${planner.base}/library/tracks`, { method: 'OPTIONS', headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
});

test('export: every track and version of the user’s workspaces, with layouts', async () => {
  const track = await save(admin, club.id, variant(1100), 'Exported');
  const res = await api(admin, 'GET', '/library/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const body = await res.json();
  assert.deepEqual(body.workspaces.map((w) => w.id), [club.id]);
  const exported = body.workspaces[0].tracks.find((t) => t.id === track.id);
  assert.equal(exported.name, 'Exported');
  assert.deepEqual(exported.versions.map((v) => v.key), [track.currentKey]);
  assert.deepEqual(exported.versions[0].layout, JSON.parse(canonicalJson(variant(1100))));
  assert.ok(!JSON.stringify(body).includes(foreign.id), 'nothing of a workspace the user is not in');
});

test('a deleted user shows as "former member" on what they saved', async () => {
  const track = await save(admin, club.id, variant(1200), 'Left behind');
  planner.store.forgetUser(admin.user.id);
  const { versions } = await (await api(owner, 'GET', `/library/tracks/${track.id}/versions`)).json();
  assert.deepEqual(versions[0].savedBy, { id: admin.user.id, name: 'former member' });
  const { workspaces } = await (await api(owner, 'GET', '/library')).json();
  const listed = workspaces.find((w) => w.id === club.id).tracks.find((t) => t.id === track.id);
  assert.deepEqual(listed.updatedBy, { id: admin.user.id, name: 'former member' });
});
