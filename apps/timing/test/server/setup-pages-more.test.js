// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup forms, continued (spec §6.4): the track from a planner link,
// pairing a decoder over Wi-Fi with its token shown once, unpairing, and
// the watchers link.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { open, seal } from '@tinylap/auth';
import { readFileSync } from 'node:fs';
import { startTiming } from './helpers.js';
import { CLOSED, OPEN, closed, startPlannerStub } from './planner-stub.js';

let app;
let planner;
let owner;
let member;
let office;
let base;
let ana;
let ben;
const keys = [{ id: 'k1', key: randomBytes(32) }];
const lines = [];

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ plannerUrl: planner.url, log: (line) => lines.push(line), keys });
  ana = await app.signUp('Ana');
  ben = await app.signUp('Ben');
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  owner = await app.login(ana);
  member = await app.login(ben);
  base = `/clubs/${office.id}`;
});
after(async () => {
  await app.close();
  await planner.close();
});

const get = (who, path, cookie = '') => app.api(who, 'GET', path, undefined, { accept: 'text/html', ...(cookie ? { cookie: `${who.jar.header()}; ${cookie}` } : {}) });

test('the track comes from a planner link; a bad one comes back with the link kept', async () => {
  const ok = await app.form(member, `${base}/track`, { link: `${planner.url}/layouts/${CLOSED}`, name: 'Office loop', direction: 'cw' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), `${base}/setup#track`);
  const added = app.store.track(office.id, app.store.workspace(office.id).trackId);
  assert.deepEqual([added.name, added.layout.plannerId], ['Office loop', closed.track.id]);
  assert.match(await (await get(member, `${base}/setup`)).text(), /Now: <strong>Office loop<\/strong>, clockwise\./);
  const open = await app.form(member, `${base}/track`, { link: `${planner.url}/layouts/${OPEN}`, name: '', direction: 'cw' });
  assert.equal(open.status, 422);
  const body = await open.text();
  assert.match(body, /not a closed circuit/);
  assert.match(body, /<p class="status status-error" role="alert"><a href="#track-link">/);
  assert.equal((body.match(/role="alert"/g) ?? []).length, 1, 'one page-level summary, none in the form');
  assert.match(body, new RegExp(`id="track-link"[^>]*value="${planner.url}/layouts/${OPEN}"`));
  const down = await app.form(member, `${base}/track`, { link: 'http://127.0.0.1:9/layouts/x', direction: 'cw' });
  assert.equal(down.status, 422, 'a link from elsewhere is refused before anything is fetched');
});

test('pairing over Wi-Fi shows the token once, never in a URL or a log', async () => {
  const res = await app.form(member, `${base}/decoders`, { name: 'Start line' });
  assert.equal(res.status, 303);
  const [decoder] = app.store.decoders(office.id);
  assert.equal(res.headers.get('location'), `${base}/setup?paired=${decoder.id}#decoders`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('__Host-tl-paired='));
  assert.match(cookie, /Path=\/; Max-Age=300; HttpOnly; Secure; SameSite=Strict/);
  const pair = cookie.split(';')[0];
  const payload = JSON.parse(open(keys, decodeURIComponent(pair.split('=')[1]), 'paired'));
  assert.equal(payload.sub, ben.id, 'the cookie is for this user');
  assert.ok(payload.exp > Date.now() && payload.exp <= Date.now() + 300_000, 'and expires with it');
  const shown = await get(member, `${base}/setup?paired=${decoder.id}`, pair);
  const body = await shown.text();
  const token = /<code class="token">([A-Za-z0-9_-]{43})<\/code>/.exec(body)?.[1];
  assert.ok(token, 'the token is on the page');
  assert.ok(shown.headers.getSetCookie().some((c) => c.startsWith('__Host-tl-paired=;') && /Max-Age=0/.test(c)), 'and its cookie is cleared');
  assert.ok(!cookie.includes(token), 'the cookie holds it sealed');
  assert.doesNotMatch(await (await get(member, `${base}/setup?paired=${decoder.id}`)).text(), /class="token"/, 'a reload shows nothing');
  assert.ok(lines.every((line) => !line.includes(token)));
  // The token works for the decoder.
  const post = await fetch(`${app.base}/decoders/${decoder.id}/passings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1 }] }) });
  assert.equal(post.status, 200);
});

test('a blank decoder name pairs a decoder called Decoder', async () => {
  const before = app.store.decoders(office.id).length;
  const res = await app.form(member, `${base}/decoders`, { name: '' });
  assert.equal(res.status, 303);
  const added = app.store.decoders(office.id);
  assert.equal(added.length, before + 1);
  assert.ok(added.some((d) => d.name === 'Decoder'));
  for (const d of added.filter((x) => x.name === 'Decoder')) app.store.deleteDecoder(office.id, d.id);
});

test('unpairing asks first and needs an admin', async () => {
  const [decoder] = app.store.decoders(office.id);
  assert.equal((await get(member, `${base}/decoders/${decoder.id}/unpair`)).status, 403);
  const ask = await (await get(owner, `${base}/decoders/${decoder.id}/unpair`)).text();
  assert.match(ask, /<h1>Unpair Start line\?<\/h1>/);
  const done = await app.form(owner, `${base}/decoders/${decoder.id}/unpair`, {});
  assert.equal(done.status, 303);
  assert.deepEqual(app.store.decoders(office.id), []);
  const again = await app.form(owner, `${base}/decoders/${decoder.id}/unpair`, {});
  assert.equal(again.status, 404);
  assert.equal(((await again.text()).match(/role="alert"/g) ?? []).length, 1);
  assert.equal((await get(owner, `${base}/decoders/${decoder.id}/unpair`)).status, 404);
});

test('too many pairings come back as one page-level message with Retry-After', async () => {
  let last;
  for (let i = 0; i < 40 && (!last || last.status === 303); i += 1) last = await app.form(member, `${base}/decoders`, { name: `D${i}` });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  const body = await last.text();
  assert.match(body, /<p class="status status-error" role="alert">You paired a lot/);
  assert.equal((body.match(/role="alert"/g) ?? []).length, 1);
});

test('the watchers link: make one, then replace it after confirming', async () => {
  assert.equal((await get(member, `${base}/watch-link/new`)).headers.get('location'), `${base}/setup#watchers`, 'nothing to replace yet');
  const made = await app.form(member, `${base}/watch-link`, {});
  assert.equal(made.status, 303);
  const first = app.store.workspace(office.id).watchToken;
  assert.match(first, /^[A-Za-z0-9_-]{22}$/);
  assert.match(await (await get(member, `${base}/setup`)).text(), new RegExp(`value="${app.base}/watch/${first}"[^>]*readonly`));
  const ask = await (await get(member, `${base}/watch-link/new`)).text();
  assert.match(ask, /The old link stops working/);
  await app.form(member, `${base}/watch-link`, {});
  assert.notEqual(app.store.workspace(office.id).watchToken, first);
});

const forged = (payload) => `__Host-tl-paired=${encodeURIComponent(seal(keys, JSON.stringify(payload), 'paired'))}`;

test('a paired cookie that is expired or for another user shows nothing and is still cleared', async () => {
  app.store.addDecoder(office.id, { id: 'dec-forged', name: 'Forged', tokenHash: 'x', createdAt: 1 });
  const url = `${base}/setup?paired=dec-forged`;
  const good = { id: 'dec-forged', token: 'T'.repeat(43), sub: ben.id, exp: Date.now() + 60_000 };
  assert.match(await (await get(member, url, forged(good))).text(), /<code class="token">T{43}<\/code>/, 'a fresh cookie for this user shows');
  for (const [why, payload, who] of [['expired', { ...good, exp: Date.now() - 1 }, member], ['another user', good, owner], ['no user or expiry', { id: good.id, token: good.token }, member]]) {
    const res = await get(who, url, forged(payload));
    assert.equal(res.status, 200, why);
    assert.doesNotMatch(await res.text(), /class="token"/, why);
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('__Host-tl-paired=;') && /Max-Age=0/.test(c)), `${why}: cookie cleared`);
  }
});

test('forms from another site change nothing, as for the other setup forms', async () => {
  const foreign = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };
  const before = app.store.decoders(office.id).length;
  const [decoder] = app.store.decoders(office.id);
  const token = app.store.workspace(office.id).watchToken;
  for (const path of [`${base}/decoders`, `${base}/decoders/${decoder.id}/unpair`, `${base}/watch-link`]) {
    const res = await app.form(owner, path, { name: 'Mallory' }, foreign);
    assert.equal(res.status, 403, path);
    assert.match(await res.text(), /<h1>Not allowed<\/h1>/, path);
  }
  assert.equal(app.store.decoders(office.id).length, before);
  assert.equal(app.store.workspace(office.id).watchToken, token);
});

test('a member cannot unpair a decoder', async () => {
  const [decoder] = app.store.decoders(office.id);
  const res = await app.form(member, `${base}/decoders/${decoder.id}/unpair`, {});
  assert.equal(res.status, 403);
  assert.ok(app.store.decoders(office.id).some((d) => d.id === decoder.id));
});

test('the token and decoder id are shown exactly as they are, not styled upper-case', () => {
  const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
  const rule = /\.token, \.token-id \{([^}]*)\}/.exec(css)?.[1] ?? '';
  for (const declaration of ['text-transform: none', 'letter-spacing: 0', 'font-weight: 400', 'font-variant-ligatures: none']) assert.ok(rule.includes(declaration), declaration);
});
