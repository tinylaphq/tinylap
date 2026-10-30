// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The track operations (named tracks spec §3): add, rename, attach a layout,
// make current, archive, restore and delete, against the rig and a pretend planner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../../server/operations.js';
import { AGAIN, CLOSED, OPEN, OTHER, closed, other, startPlannerStub } from './planner-stub.js';
import { T0, W, rig } from './rig.js';

let planner;
before(async () => { planner = await startPlannerStub(); });
after(() => planner.close());

const BY = { userId: 'u1', name: 'Ana Admin' };
const link = (key) => `${planner.url}/layouts/${key}`;

/** The rig with a request as the routes hand the operations one. */
function setup() {
  const r = rig();
  r.store.ensureWorkspace(W);
  const request = { store: r.store, engine: r.engine, hub: r.hub, workspaceId: W, now: () => r.clock.now, plannerUrl: planner.url, userId: BY.userId };
  const current = () => r.store.workspace(W).trackId;
  return { ...r, request, current };
}

const refused = (result, status, problem, message, field) => {
  assert.equal(result.error?.status, status, JSON.stringify(result));
  assert.equal(result.error.problem, problem);
  if (message !== undefined) assert.equal(result.error.message, message);
  if (field !== undefined) assert.equal(result.error.field, field);
};

test('a track is added by name, without a layout, and does not become current or end a practice', async () => {
  const { request, store, current, startPractice } = setup();
  const before = current();
  const practice = startPractice();
  const { value } = await ops.addTrack(request, { name: '  Office  ', by: BY });
  assert.deepEqual(value, { id: value.id, name: 'Office', archived: false, current: false, layout: null });
  assert.equal(current(), before);
  assert.equal(store.runningSession(W)?.id, practice.id);
  assert.deepEqual(store.tracks(W, { archived: false }).map((t) => t.name), ['Office', 'Track']);
});

test('a track added with a planner link has it as its first layout, attached by the member', async () => {
  const { request, store } = setup();
  const { value } = await ops.addTrack(request, { name: 'Office', link: link(CLOSED), by: BY });
  assert.deepEqual(value.layout, { plannerId: closed.track.id, snapshotKey: CLOSED, attachedAt: T0, by: 'Ana Admin' });
  assert.equal(store.layouts(W, value.id).length, 1);
});

test('adding refuses a bad name, a name in use in any case, and a bad link, and adds nothing', async () => {
  const { request, store } = setup();
  for (const name of ['', '   ', 'x'.repeat(61), 'A\nB', undefined, 7]) {
    refused(await ops.addTrack(request, { name, by: BY }), 422, 'invalid-request', 'A track name is 1 to 60 characters.', 'name');
  }
  refused(await ops.addTrack(request, { name: 'TRACK', by: BY }), 409, 'conflict', 'A track named TRACK is already in use. Rename one of them first.', 'name');
  refused(await ops.addTrack(request, { name: 'Office', link: link(OPEN), by: BY }), 422, 'not-a-circuit', undefined, 'link');
  refused(await ops.addTrack(request, { name: 'Office', link: 'https://elsewhere.example/layouts/x', by: BY }), 422, 'invalid-request', undefined, 'link');
  assert.deepEqual(store.tracks(W, { archived: false }).map((t) => t.name), ['Track']);
});

test('a track is renamed; a name in use, a bad name or no such track is refused', async () => {
  const { request, store } = setup();
  const office = (await ops.addTrack(request, { name: 'Office', by: BY })).value;
  assert.deepEqual((await ops.renameTrack(request, { id: office.id, name: 'Office loop' })).value, { ...office, name: 'Office loop' });
  refused(await ops.renameTrack(request, { id: office.id, name: 'track' }), 409, 'conflict', 'A track named track is already in use. Rename one of them first.', 'name');
  refused(await ops.renameTrack(request, { id: office.id, name: '' }), 422, 'invalid-request', 'A track name is 1 to 60 characters.', 'name');
  refused(await ops.renameTrack(request, { id: 'nope', name: 'Hall' }), 404, 'not-found');
  assert.equal(store.track(W, office.id).name, 'Office loop');
});

test('renaming the current track publishes it to the board', async () => {
  const { request, events, current } = setup();
  await ops.renameTrack(request, { id: current(), name: 'Home' });
  assert.deepEqual(events.filter((e) => e.type === 'track').at(-1).data.track, { id: current(), name: 'Home' });
});

test('a layout is attached to a track without one, with no confirmation', async () => {
  const { request, current } = setup();
  const { value } = await ops.attachLayout(request, { id: current(), link: link(CLOSED), by: BY });
  assert.equal(value.result, 'added');
  assert.deepEqual(value.track.layout, { plannerId: closed.track.id, snapshotKey: CLOSED, attachedAt: T0, by: 'Ana Admin' });
});

test('the same planner layout again: no warning, and a new entry only for a new snapshot', async () => {
  const { request, store, current, clock } = setup();
  await ops.attachLayout(request, { id: current(), link: link(CLOSED), by: BY });
  clock.now += 1000;
  const same = await ops.attachLayout(request, { id: current(), link: link(CLOSED), by: BY });
  assert.equal(same.value.result, 'same');
  assert.equal(store.layouts(W, current()).length, 1);
  const again = await ops.attachLayout(request, { id: current(), link: link(AGAIN), by: BY });
  assert.equal(again.value.result, 'added');
  assert.deepEqual(store.layouts(W, current()).map((l) => [l.plannerId, l.snapshotKey]), [[closed.track.id, AGAIN], [closed.track.id, CLOSED]]);
});

test('changing to a different planner track needs a confirmation, and names the current layout', async () => {
  const { request, store, current } = setup();
  assert.notEqual(other.track.id, closed.track.id);
  const name = store.track(W, current()).name;
  await ops.attachLayout(request, { id: current(), link: link(CLOSED), by: BY });
  for (const confirm of [undefined, false, 'true']) {
    const r = await ops.attachLayout(request, { id: current(), link: link(OTHER), confirm, by: BY });
    refused(r, 409, 'conflict', `${name} has a layout. Changing it keeps its records; confirm to change it.`, 'link');
    assert.deepEqual(r.error.current, { plannerId: closed.track.id, snapshotKey: CLOSED, attachedAt: T0, by: 'Ana Admin' });
  }
  assert.equal(store.layouts(W, current()).length, 1);
  const { value } = await ops.attachLayout(request, { id: current(), link: link(OTHER), confirm: true, by: BY });
  assert.equal(value.result, 'added');
  assert.equal(value.track.layout.plannerId, other.track.id);
  assert.equal(store.layouts(W, current()).length, 2);
});

test('attaching refuses no such track and a bad link', async () => {
  const { request, store, current } = setup();
  refused(await ops.attachLayout(request, { id: 'nope', link: link(CLOSED), by: BY }), 404, 'not-found');
  refused(await ops.attachLayout(request, { id: current(), link: link(OPEN), by: BY }), 422, 'not-a-circuit', undefined, 'link');
  refused(await ops.attachLayout(request, { id: current(), link: '', by: BY }), 422, 'invalid-request', undefined, 'link');
  assert.deepEqual(store.layouts(W, current()), []);
});

test('making a track current ends a running practice and tells the board', async () => {
  const { request, store, events, current, startPractice } = setup();
  const office = (await ops.addTrack(request, { name: 'Office', by: BY })).value;
  startPractice();
  const { value } = await ops.setCurrentTrack(request, { id: office.id, direction: 'cw' });
  assert.deepEqual(value, { track: { ...office, current: true }, direction: 'cw' });
  assert.equal(current(), office.id);
  assert.equal(store.workspace(W).direction, 'cw');
  assert.equal(store.runningSession(W), null);
  assert.deepEqual(events.filter((e) => e.type === 'track').at(-1).data, { track: { id: office.id, name: 'Office' }, direction: 'cw', bests: [] });
});

test('making a track current leaves a running race on its own track', async () => {
  const { request, store, current } = setup();
  const home = current();
  const office = (await ops.addTrack(request, { name: 'Office', by: BY })).value;
  const race = ops.startSession(request, { kind: 'race', roster: ['ana'], durationSeconds: 60, countdownSeconds: 0 }).value;
  await ops.setCurrentTrack(request, { id: office.id, direction: 'cw' });
  assert.equal(store.runningSession(W)?.id, race.id);
  assert.equal(store.runningSession(W).trackId, home);
});

test('making current refuses a bad direction, an archived track and no such track', async () => {
  const { request, current } = setup();
  const home = current();
  const office = (await ops.addTrack(request, { name: 'Office', by: BY })).value;
  refused(await ops.setCurrentTrack(request, { id: office.id, direction: 'up' }), 422, 'invalid-request', 'Pick the direction you race.', 'direction');
  await ops.archiveTrack(request, { id: office.id });
  refused(await ops.setCurrentTrack(request, { id: office.id, direction: 'cw' }), 409, 'conflict', 'Office is archived. Restore it first.');
  refused(await ops.setCurrentTrack(request, { id: 'nope', direction: 'cw' }), 404, 'not-found');
  assert.equal(current(), home);
});

test('archive and restore; archiving an archived track or restoring an active one changes nothing', async () => {
  const { request, store, current, clock } = setup();
  const office = (await ops.addTrack(request, { name: 'Office', by: BY })).value;
  assert.deepEqual((await ops.archiveTrack(request, { id: office.id })).value, { ...office, archived: true });
  const at = store.track(W, office.id).archivedAt;
  clock.now += 1000;
  assert.equal((await ops.archiveTrack(request, { id: office.id })).value.archived, true);
  assert.equal(store.track(W, office.id).archivedAt, at, 'the first archive date stays');
  assert.deepEqual((await ops.restoreTrack(request, { id: office.id })).value, office);
  assert.deepEqual((await ops.restoreTrack(request, { id: office.id })).value, office);
  const name = store.track(W, current()).name;
  refused(await ops.archiveTrack(request, { id: current() }), 409, 'conflict', `${name} is the current track. Make another track current first.`);
  refused(await ops.archiveTrack(request, { id: 'nope' }), 404, 'not-found');
  refused(await ops.restoreTrack(request, { id: 'nope' }), 404, 'not-found');
});

test('restoring a track whose name an active track now uses is refused, and nothing changes', async () => {
  const { request, store } = setup();
  const office = (await ops.addTrack(request, { name: 'Office', by: BY })).value;
  await ops.archiveTrack(request, { id: office.id });
  const newer = (await ops.addTrack(request, { name: 'OFFICE', by: BY })).value;
  refused(await ops.restoreTrack(request, { id: office.id }), 409, 'conflict', 'A track named Office is already in use. Rename one of them first.', 'name');
  assert.notEqual(store.track(W, office.id).archivedAt, null);
  assert.deepEqual([store.track(W, newer.id).name, store.track(W, newer.id).archivedAt], ['OFFICE', null]);
});

test('only an archived track is deleted, and not while a running session uses it', async () => {
  const { request, store, current } = setup();
  const home = current();
  const name = store.track(W, home).name;
  const office = (await ops.addTrack(request, { name: 'Office', by: BY })).value;
  refused(await ops.deleteTrack(request, { id: office.id }), 409, 'conflict', 'Archive Office before deleting it.');
  // A race started on the first track, then the club switched away and archived it mid-race.
  const race = ops.startSession(request, { kind: 'race', roster: ['ana'], durationSeconds: 60, countdownSeconds: 0 }).value;
  await ops.setCurrentTrack(request, { id: office.id, direction: 'ccw' });
  assert.equal((await ops.archiveTrack(request, { id: home })).value.archived, true);
  refused(await ops.deleteTrack(request, { id: home }), 409, 'conflict', `${name} is in use by the running session.`);
  assert.ok(store.track(W, home));
  ops.abortSession(request, { id: race.id });
  assert.deepEqual(await ops.deleteTrack(request, { id: home }), { value: true });
  assert.equal(store.track(W, home), null);
  refused(await ops.deleteTrack(request, { id: home }), 404, 'not-found');
});
