// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The MCP tools (timing MCP spec §5, §6), through the official client against
// a real accounts: what each does, the permissions of its route, the
// confirmation before anything is lost, and that no API operation is missed.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import openapi from '../../server/openapi.json' with { type: 'json' };
import { routes } from '../../server/routes.js';
import { LEFT_OUT, TOOLS } from '../../server/mcp/tools.js';
import { startMcpTiming } from './mcp-rig.js';
import { CLOSED, OTHER, startPlannerStub } from './planner-stub.js';

/** @type {Awaited<ReturnType<typeof startMcpTiming>>} */
let t;
let clubId;
/** The owner's client, and a plain member's. */
let owner;
let member;
let admin;
let outsider;
let planner;

before(async () => {
  planner = await startPlannerStub();
  t = await startMcpTiming({ plannerUrl: planner.url });
  const ownerUser = await t.signUp('Ayrton');
  const memberUser = await t.signUp('Brigitte');
  const adminUser = await t.signUp('Dana');
  const outsiderUser = await t.signUp('Clara');
  clubId = t.club(ownerUser, 'Office').id;
  t.join(ownerUser, clubId, memberUser, 'member');
  t.join(ownerUser, clubId, adminUser, 'admin');
  owner = await t.client((await t.connect(ownerUser)).accessToken);
  member = await t.client((await t.connect(memberUser)).accessToken);
  admin = await t.client((await t.connect(adminUser)).accessToken);
  outsider = await t.client((await t.connect(outsiderUser)).accessToken);
});
after(async () => {
  for (const c of [owner, member, admin, outsider]) await c?.close();
  await t.close();
  await planner.close();
});

const call = (client, name, args = {}) => t.call(client, name, name === 'list_spaces' ? args : { space: clubId, ...args });

test('every API operation under /workspaces is a tool or deliberately left out', () => {
  const covered = new Set(TOOLS.map((tool) => tool.route).filter(Boolean));
  for (const [path, item] of Object.entries(openapi.paths)) {
    if (!path.startsWith('/workspaces/')) continue;
    for (const method of Object.keys(item)) {
      const op = `${method.toUpperCase()} ${path}`;
      assert.ok(covered.has(op) || LEFT_OUT.has(op), `${op} is neither a tool nor left out`);
    }
  }
  for (const op of covered) {
    const [method, path] = op.split(' ');
    assert.ok(openapi.paths[path]?.[method.toLowerCase()], `${op} is not in openapi.json`);
  }
});

test('every tool asks for the same permission as its route', () => {
  for (const tool of TOOLS.filter((x) => x.route)) {
    const [method, template] = /** @type {string} */ (tool.route).split(' ');
    const path = template.replace(/\{[^}]+\}/g, 'x');
    const route = routes.find((r) => r.pattern.test(path) && !r.unknown);
    assert.ok(route, `no route for ${tool.route}`);
    assert.equal(route.methods[method]?.action, tool.action, `${tool.name} asks for ${tool.action}, its route for ${route.methods[method]?.action}`);
  }
});

test('every write says whether it is destructive, and the destructive ones ask first', () => {
  for (const tool of TOOLS) {
    if (tool.annotations.readOnlyHint) continue;
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean', `${tool.name} must set destructiveHint`);
    if (tool.annotations.destructiveHint) assert.ok(tool.ask, `${tool.name} is destructive but never asks`);
  }
});

test('tools/list has every tool, with its annotations and an output schema', async () => {
  const { tools } = await owner.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), TOOLS.map((x) => x.name).sort());
  const del = tools.find((x) => x.name === 'delete_driver');
  assert.equal(del.annotations.destructiveHint, true);
  assert.ok(del.outputSchema);
  assert.ok(!tools.some((x) => x.name === 'pair_decoder' || x.name === 'tap'));
});

test('list_spaces lists the member\'s clubs and personal space, and a single space is the default', async () => {
  const { value } = await call(owner, 'list_spaces');
  assert.deepEqual(value.spaces.map((w) => w.name).sort(), ['Ayrton', 'Office']);
  // The owner has two spaces: leaving the space out names them.
  const unnamed = await t.call(owner, 'list_drivers', {});
  assert.equal(unnamed.error, true);
  assert.match(unnamed.text, /Name the club or personal space: one of/);
  // The outsider has only their personal space: it is the default.
  const own = await t.call(outsider, 'add_driver', { name: 'Solo' });
  assert.equal(own.error, false, own.text);
  assert.equal((await t.call(outsider, 'list_drivers', {})).value.drivers[0].name, 'Solo');
});

test('drivers: add, rename and list; a bad name is a readable error', async () => {
  const added = await call(owner, 'add_driver', { name: 'Anna' });
  assert.equal(added.error, false);
  assert.equal(added.value.name, 'Anna');
  const renamed = await call(owner, 'update_driver', { driver: added.value.id, name: 'Anna B.', colour: '#2D9BFF' });
  assert.equal(renamed.value.colour, '#2d9bff');
  const list = await call(member, 'list_drivers');
  assert.ok(list.value.drivers.some((d) => d.name === 'Anna B.'));
  const bad = await call(owner, 'add_driver', { name: '   ' });
  assert.equal(bad.error, true);
  assert.match(bad.text, /name/);
  const none = await call(owner, 'update_driver', { driver: added.value.id });
  assert.equal(none.error, true);
});

test('permissions: a member may not delete, a non-member finds nothing', async () => {
  const { value: driver } = await call(owner, 'add_driver', { name: 'Ben' });
  const refused = await call(member, 'delete_driver', { driver: driver.id });
  assert.equal(refused.error, true);
  assert.equal(refused.value.problem, 'forbidden');
  const away = await call(outsider, 'list_drivers');
  assert.equal(away.error, true);
  assert.equal(away.value.problem, 'not-found');
});

test('delete_driver asks first, then deletes only with the confirmation it gave', async () => {
  const { value: driver } = await call(owner, 'add_driver', { name: 'Chris' });
  const asked = await call(owner, 'delete_driver', { driver: driver.id });
  assert.equal(asked.error, false);
  assert.equal(asked.value.status, 'confirm');
  assert.match(asked.value.message, /^Delete Chris\? Their laps stay on the board as "Former driver"/);
  assert.ok(t.store.driver(clubId, driver.id), 'the first call changes nothing');

  // A made-up confirmation, or one for another driver, is refused.
  const forged = await call(owner, 'delete_driver', { driver: driver.id, confirmation: 'k1.AAAA.BBBB' });
  assert.equal(forged.value.problem, 'invalid-request');
  const { value: other } = await call(owner, 'add_driver', { name: 'Dora' });
  const elsewhere = await call(owner, 'delete_driver', { driver: other.id, confirmation: asked.value.confirmation });
  assert.equal(elsewhere.value.problem, 'invalid-request');
  assert.ok(t.store.driver(clubId, other.id));

  const done = await call(owner, 'delete_driver', { driver: driver.id, confirmation: asked.value.confirmation });
  assert.deepEqual(done.value, { status: 'done', result: { deleted: driver.id } });
  assert.equal(t.store.driver(clubId, driver.id), null);
  const replay = await call(owner, 'delete_driver', { driver: driver.id, confirmation: asked.value.confirmation });
  assert.equal(replay.value.problem, 'not-found', 'a replay finds nothing to act on');
});

test('a confirmation belongs to the member it was given to', async () => {
  const { value: driver } = await call(owner, 'add_driver', { name: 'Emil' });
  const asked = await call(owner, 'delete_driver', { driver: driver.id });
  // An admin may delete drivers, but not with the owner's confirmation.
  const stolen = await call(admin, 'delete_driver', { driver: driver.id, confirmation: asked.value.confirmation });
  assert.equal(stolen.error, true);
  assert.equal(stolen.value.problem, 'invalid-request');
  assert.ok(t.store.driver(clubId, driver.id));
});

test('attach_layout: a first layout at once, a different planner track only after a question', async () => {
  const { value: track } = await call(owner, 'add_track', { name: 'Loft' });
  const first = await call(owner, 'attach_layout', { track: track.id, link: `${planner.url}/layouts/${CLOSED}` });
  assert.equal(first.value.status, 'done', first.text);
  assert.equal(first.value.result.track.layout.snapshotKey, CLOSED);
  assert.equal(first.value.result.track.layout.by, 'Ayrton', 'by the member the token names');
  const asked = await call(owner, 'attach_layout', { track: track.id, link: `${planner.url}/layouts/${OTHER}` });
  assert.equal(asked.value.status, 'confirm');
  assert.match(asked.value.message, /^Loft has a layout of another planner track\. Replace it\?/);
  assert.equal(t.store.track(clubId, track.id).layout.snapshotKey, CLOSED);
  const done = await call(owner, 'attach_layout', { track: track.id, link: `${planner.url}/layouts/${OTHER}`, confirmation: asked.value.confirmation });
  assert.equal(done.value.status, 'done');
  assert.equal(t.store.track(clubId, track.id).layout.snapshotKey, OTHER);
});

test('transponders: assign and unassign', async () => {
  const { value: driver } = await call(owner, 'add_driver', { name: 'Fritz' });
  const assigned = await call(owner, 'assign_transponder', { code: 'A1B2', driver: driver.id });
  assert.equal(assigned.error, false, assigned.text);
  assert.equal(assigned.value.driverId, driver.id);
  const list = await call(member, 'list_transponders');
  assert.ok(list.value.transponders.some((x) => x.code === assigned.value.code));
  const freed = await call(owner, 'assign_transponder', { code: 'A1B2', driver: null });
  assert.equal(freed.value.driverId, null);
});

test('tracks: add, rename, make current, archive, restore and delete with confirmation', async () => {
  const { value: track } = await call(owner, 'add_track', { name: 'Kitchen' });
  assert.equal(track.current, false);
  const renamed = await call(owner, 'rename_track', { track: track.id, name: 'Kitchen loop' });
  assert.equal(renamed.value.name, 'Kitchen loop');
  const current = await call(owner, 'set_current_track', { track: track.id, direction: 'cw' });
  assert.equal(current.value.status, 'done');
  assert.equal(t.store.workspace(clubId).trackId, track.id);
  const refused = await call(owner, 'archive_track', { track: track.id });
  assert.equal(refused.value.problem, 'conflict', 'the current track stays');

  const { value: spare } = await call(owner, 'add_track', { name: 'Garage' });
  const early = await call(owner, 'delete_track', { track: spare.id });
  assert.equal(early.value.problem, 'conflict', 'archive first, before any question');
  assert.equal((await call(owner, 'archive_track', { track: spare.id })).value.archived, true);
  assert.ok((await call(member, 'list_tracks', { include_archived: true })).value.tracks.some((x) => x.id === spare.id && x.archived));
  assert.equal((await call(owner, 'restore_track', { track: spare.id })).value.archived, false);
  await call(owner, 'archive_track', { track: spare.id });
  const asked = await call(owner, 'delete_track', { track: spare.id });
  assert.match(asked.value.message, /^Delete Garage\? Its records and layouts are removed\. It has no sessions\./);
  const done = await call(owner, 'delete_track', { track: spare.id, confirmation: asked.value.confirmation });
  assert.deepEqual(done.value.result, { deleted: spare.id });
});

test('sessions: start, the replace question bound to the running session, end and abort', async () => {
  const { value: anna } = await call(owner, 'add_driver', { name: 'Gina' });
  const practice = await call(member, 'start_session', { kind: 'practice' });
  assert.equal(practice.value.status, 'done', practice.text);
  const running = practice.value.result;

  const asked = await call(member, 'start_session', { kind: 'race', roster: [anna.id], duration_seconds: 60, countdown_seconds: 0 });
  assert.equal(asked.value.status, 'confirm');
  assert.match(asked.value.message, /A practice has been running for under a minute/);
  assert.equal(t.store.runningSession(clubId).id, running.id, 'nothing replaced yet');

  // Another session starts in between: the old confirmation asks again, and replaces nothing.
  t.engine.end(clubId, running.id);
  await call(member, 'start_session', { kind: 'practice' });
  const between = t.store.runningSession(clubId);
  const stale = await call(member, 'start_session', { kind: 'race', roster: [anna.id], duration_seconds: 60, countdown_seconds: 0, confirmation: asked.value.confirmation });
  assert.equal(stale.value.status, 'confirm');
  assert.match(stale.value.message, /has changed/);
  assert.equal(t.store.runningSession(clubId).id, between.id);

  const race = await call(member, 'start_session', { kind: 'race', roster: [anna.id], duration_seconds: 60, countdown_seconds: 0, confirmation: stale.value.confirmation });
  assert.equal(race.value.status, 'done', race.text);
  assert.equal(race.value.result.kind, 'race');

  const wrongEnd = await call(member, 'end_session', { session: race.value.result.id });
  assert.equal(wrongEnd.value.problem, 'not-found', 'end is for a practice');
  const abortAsk = await call(member, 'abort_session', { session: race.value.result.id });
  assert.match(abortAsk.value.message, /^Abort the race\? The race ends now\./);
  const aborted = await call(member, 'abort_session', { session: race.value.result.id, confirmation: abortAsk.value.confirmation });
  assert.equal(aborted.value.status, 'done');
  assert.equal(t.store.runningSession(clubId), null);

  const list = await call(member, 'list_sessions', { limit: 2 });
  assert.equal(list.value.sessions.length, 2);
  const detail = await call(member, 'get_session', { session: race.value.result.id });
  assert.equal(detail.value.session.id, race.value.result.id);
  assert.equal(detail.value.crossings, undefined, 'crossings only when asked');
  assert.equal(typeof detail.value.crossingsTotal, 'number');
  const withCrossings = await call(member, 'get_session', { session: race.value.result.id, include_crossings: true, crossings_limit: 5 });
  assert.ok(Array.isArray(withCrossings.value.crossings));
});

test('switching tracks during a practice asks first', async () => {
  const { value: track } = await call(owner, 'add_track', { name: 'Hall' });
  await call(member, 'start_session', { kind: 'practice' });
  const asked = await call(owner, 'set_current_track', { track: track.id, direction: 'ccw' });
  assert.equal(asked.value.status, 'confirm');
  assert.match(asked.value.message, /A practice is running\. Switching to Hall \(ccw\) ends it/);
  const done = await call(owner, 'set_current_track', { track: track.id, direction: 'ccw', confirmation: asked.value.confirmation });
  assert.equal(done.value.status, 'done');
  assert.equal(t.store.runningSession(clubId), null);
});

test('decoders: listed without tokens, unpaired with confirmation', async () => {
  t.store.addDecoder(clubId, { id: 'dec-1', name: 'Gate', tokenHash: 'h'.repeat(64), createdAt: Date.now() });
  const list = await call(member, 'list_decoders');
  const listed = list.value.decoders.find((d) => d.id === 'dec-1');
  assert.ok(listed);
  assert.doesNotMatch(JSON.stringify(list.value), /hhhh|token/i);
  const refused = await call(member, 'unpair_decoder', { decoder: 'dec-1' });
  assert.equal(refused.value.problem, 'forbidden', 'unpairing needs the delete permission');
  const asked = await call(owner, 'unpair_decoder', { decoder: 'dec-1' });
  assert.match(asked.value.message, /^Unpair Gate\? Its token stops working at once/);
  const done = await call(owner, 'unpair_decoder', { decoder: 'dec-1', confirmation: asked.value.confirmation });
  assert.deepEqual(done.value.result, { deleted: 'dec-1' });
});

test('the watchers link: read, made, and replaced only after a question', async () => {
  const before = await call(member, 'get_watch_link');
  const first = await call(owner, 'rotate_watch_link');
  if (before.value.url === null) assert.equal(first.value.status, 'done', 'no link yet: nothing to cut off');
  const url = first.value.status === 'done' ? first.value.result.url : before.value.url;
  assert.ok(url.startsWith(`${t.base}/watch/`));
  const asked = await call(owner, 'rotate_watch_link');
  assert.equal(asked.value.status, 'confirm');
  const done = await call(owner, 'rotate_watch_link', { confirmation: asked.value.confirmation });
  assert.notEqual(done.value.result.url, url);
  assert.equal((await call(member, 'get_watch_link')).value.url, done.value.result.url);
});

test('get_live answers the board now', async () => {
  const live = await call(member, 'get_live');
  assert.equal(live.error, false, live.text);
  assert.equal(typeof live.value.track.name, 'string');
  assert.ok(Array.isArray(live.value.drivers));
});
