// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '@tinylap/track-format';
import { TrackError, fetchTrack } from '../../server/planner.js';
import { CLOSED, OPEN, closed, startPlannerStub } from './planner-stub.js';

let planner;
before(async () => { planner = await startPlannerStub(); });
after(() => planner.close());

const fails = async (promise, code) => {
  await assert.rejects(promise, (error) => error instanceof TrackError && error.code === code);
};

test('a closed layout from the planner is a track', async () => {
  const track = await fetchTrack(planner.url, `${planner.url}/layouts/${CLOSED}`);
  assert.deepEqual([track.id, track.shape, track.snapshotKey], [closed.track.id, closed.track.shape, CLOSED]);
  assert.equal(track.layout, canonicalJson(closed));
  const json = await fetchTrack(`${planner.url}/`, `${planner.url}/layouts/${CLOSED}.json`);
  assert.equal(json.id, closed.track.id, 'the .json form of the link works too');
});

test('anything else is refused, and never fetched from elsewhere', async () => {
  await fails(fetchTrack(planner.url, `${planner.url}/layouts/${OPEN}`), 'not-a-circuit');
  await fails(fetchTrack(planner.url, 'not a url'), 'invalid');
  await fails(fetchTrack(planner.url, `http://169.254.169.254/layouts/${CLOSED}`), 'invalid');
  await fails(fetchTrack(planner.url, `${planner.url}/shapes/${CLOSED}`), 'invalid');
  await fails(fetchTrack(planner.url, `${planner.url}/layouts/${'C'.repeat(22)}`), 'invalid');
  await fails(fetchTrack(null, `${planner.url}/layouts/${CLOSED}`), 'unavailable');
  await fails(fetchTrack('http://127.0.0.1:9', `http://127.0.0.1:9/layouts/${CLOSED}`), 'unavailable');
});
