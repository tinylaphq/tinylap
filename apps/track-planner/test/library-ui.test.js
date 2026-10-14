// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The planner's side of the library API, with a stubbed fetch, and the
// small pure helpers the library dialog shows its rows with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, assignTrack, stockL } from '@tinylap/track-format';
import { libraryApi, linkedHistory, may, relativeTime, saverName, workspaceLabel } from '../js/library.js';

const layout = () => assignTrack(createLayout({ pieces: stockL() }));
const reply = (status, body, type = 'application/json') =>
  new Response(body === null ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': type } });

/** A fetch that records every call and answers `status`/`body`. */
function recorder(status = 200, body = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return reply(status, body);
  };
  return { calls, fetch };
}

const track = { id: 'T1', workspaceId: 'W1', name: 'Monza', currentKey: 'AAAAAAAAAAAAAAAAAAAAAA' };

test('list reads /library and sends the cookie', async () => {
  const { calls, fetch } = recorder(200, { workspaces: [] });
  assert.deepEqual(await libraryApi({ fetch }).list(), { workspaces: [] });
  assert.equal(calls[0].url, '/library');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.body, undefined);
});

test('saveNew posts the workspace, the name and the layout', async () => {
  const { calls, fetch } = recorder(201, { track });
  const l = layout();
  assert.deepEqual(await libraryApi({ fetch }).saveNew('W1', 'Monza', l), { track });
  assert.equal(calls[0].url, '/library/tracks');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { workspaceId: 'W1', name: 'Monza', layout: l });
});

test('saveVersion posts the layout to the track', async () => {
  const { calls, fetch } = recorder(201, { track, version: { key: 'k' } });
  const l = layout();
  await libraryApi({ fetch }).saveVersion('T1', l);
  assert.equal(calls[0].url, '/library/tracks/T1/versions');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { layout: l });
});

test('every other call goes to its route', async () => {
  const cases = [
    ['rename', ['T1', 'Imola'], 'PATCH', '/library/tracks/T1', { name: 'Imola' }],
    ['copy', ['T1', 'W2'], 'POST', '/library/tracks/T1/copy', { workspaceId: 'W2' }],
    ['versions', ['T1'], 'GET', '/library/tracks/T1/versions', undefined],
    ['share', ['T1'], 'POST', '/library/tracks/T1/share', {}],
  ];
  for (const [method, args, verb, url, body] of cases) {
    const { calls, fetch } = recorder(200, { ok: method });
    assert.deepEqual(await libraryApi({ fetch })[method](...args), { ok: method }, method);
    assert.equal(calls[0].url, url, method);
    assert.equal(calls[0].init.method, verb, method);
    assert.deepEqual(calls[0].init.body === undefined ? undefined : JSON.parse(calls[0].init.body), body, method);
  }
});

test('deletes answer null for a 204', async () => {
  for (const [method, args, url] of [['remove', ['T1'], '/library/tracks/T1'], ['removeVersion', ['T1', 'K1'], '/library/tracks/T1/versions/K1']]) {
    const calls = [];
    const fetch = async (u, init) => { calls.push({ u, init }); return reply(204, null); };
    assert.equal(await libraryApi({ fetch })[method](...args), null, method);
    assert.equal(calls[0].u, url);
    assert.equal(calls[0].init.method, 'DELETE');
  }
});

test('ids and keys are escaped into the path', async () => {
  const { calls, fetch } = recorder(204, null);
  await libraryApi({ fetch }).removeVersion('a/b', '../c').catch(() => {});
  assert.equal(calls[0].url, '/library/tracks/a%2Fb/versions/..%2Fc');
});

test('a refused call throws the problem title and keeps the status', async () => {
  const fetch = async () => reply(422, { type: 'x', title: 'Quota exceeded', status: 422 }, 'application/problem+json');
  await assert.rejects(libraryApi({ fetch }).saveNew('W1', 'Monza', layout()), (error) => {
    assert.equal(error.message, 'Quota exceeded');
    assert.equal(error.status, 422);
    return true;
  });
});

test('a call that never reaches the server says so', async () => {
  const fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(libraryApi({ fetch }).list(), /could not reach/i);
});

test('only the owner and admins may delete; everyone may save, copy and share', () => {
  for (const role of ['owner', 'admin']) assert.equal(may(role, 'track.delete'), true, role);
  assert.equal(may('member', 'track.delete'), false);
  for (const action of ['track.save', 'track.copy', 'track.share', 'track.read']) {
    for (const role of ['owner', 'admin', 'member']) assert.equal(may(role, action), true, `${role} ${action}`);
  }
  assert.equal(may('guest', 'track.read'), false);
  assert.equal(may('owner', 'club.nonsense'), false);
});

test('relative dates read like speech', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const at = (seconds) => new Date(now - seconds * 1000).toISOString();
  assert.equal(relativeTime(at(10), now), 'just now');
  assert.equal(relativeTime(at(5 * 60), now), '5 minutes ago');
  assert.equal(relativeTime(at(90 * 60), now), '1 hour ago');
  assert.equal(relativeTime(at(26 * 3600), now), 'yesterday');
  assert.equal(relativeTime(at(3 * 86400), now), '3 days ago');
  assert.equal(relativeTime(at(40 * 86400), now), 'last month');
  assert.equal(relativeTime(at(400 * 86400), now), 'last year');
  assert.equal(relativeTime('not a date', now), '');
});

test('a saver without a name is a former member', () => {
  assert.equal(saverName({ id: 'u', name: 'Ayrton' }), 'Ayrton');
  assert.equal(saverName({ id: 'u', name: null }), 'former member');
  assert.equal(saverName(null), 'former member');
});

test('the first workspace is the personal one', () => {
  assert.equal(workspaceLabel({ id: 'W1', name: 'Ayrton', role: 'owner' }, 0), 'Ayrton (personal)');
  assert.equal(workspaceLabel({ id: 'W2', name: 'Kart Club', role: 'member' }, 1), 'Kart Club');
  assert.equal(workspaceLabel({ id: 'W3', name: null, role: 'member' }, 2), 'Unnamed workspace');
});

test('undo restores the track link that belonged to the layout it brings back', () => {
  let link = null;
  const restored = [];
  const history = linkedHistory({ load: () => link, restore: (ref) => { restored.push(ref); link = ref; } });
  const A = { id: 'A', name: 'Monza', workspaceId: 'W1' };
  // Layout X (no link) on the canvas; the user opens library track A.
  history.push('X');
  link = A;
  // An edit of A keeps A.
  history.push('A1');
  assert.equal(history.length, 2);
  assert.equal(history.pop(), 'A1');
  assert.deepEqual(link, A, 'undoing an edit of A is still A');
  // Undo the open: X is back, and so is its (absent) link.
  assert.equal(history.pop(), 'X');
  assert.equal(link, null, 'X never came from A, so Save must not post it as a version of A');
  assert.deepEqual(restored, [A, null]);
  assert.equal(history.pop(), undefined, 'an empty history pops nothing');
  assert.deepEqual(restored, [A, null], 'and restores nothing');
});
