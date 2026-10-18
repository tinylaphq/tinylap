// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tracks come from the planner by share link (spec §3). The server fetches
// only from its configured planner origin and only /layouts/<key>, so a
// pasted link can't make it request anything else.
import { KEY_PATTERN, canonicalJson, isTrack, parseLayout } from '@tinylap/track-format';

const MAX_LAYOUT = 64 * 1024;

export class TrackError extends Error {
  /** @param {'invalid' | 'not-a-circuit' | 'unavailable'} code @param {string} message @param {ErrorOptions} [options] */
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
}

/**
 * @param {string | null | undefined} plannerUrl @param {string} link
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function fetchTrack(plannerUrl, link, { fetch: fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (!plannerUrl) throw new TrackError('unavailable', 'This server has no planner to import tracks from.');
  const planner = new URL(plannerUrl);
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new TrackError('invalid', 'The link is not a URL.');
  }
  if (url.origin !== planner.origin) throw new TrackError('invalid', `Paste a link from ${planner.origin}.`);
  const key = /^\/layouts\/([^/.]+)(?:\.json|\.html)?$/.exec(url.pathname)?.[1];
  if (!key || !KEY_PATTERN.test(key)) throw new TrackError('invalid', 'Paste the link of a track shared from the planner.');
  let res;
  try {
    res = await fetchImpl(`${planner.origin}/layouts/${key}`, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new TrackError('unavailable', 'The planner cannot be reached right now.', { cause: error });
  }
  if (res.status === 404) throw new TrackError('invalid', 'The planner has no shared track at this link. Share it again and paste the new link.');
  if (!res.ok) throw new TrackError('unavailable', `The planner answered ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_LAYOUT) throw new TrackError('invalid', 'This track is too large to time.');
  let layout;
  try {
    layout = parseLayout(text);
  } catch {
    throw new TrackError('invalid', 'The planner sent something that is not a track. Share the track again and paste the new link.');
  }
  if (!isTrack(layout.track)) throw new TrackError('not-a-circuit', 'This track is not a closed circuit, so there is nothing to time. Close the loop in the planner and share it again.');
  return { id: layout.track.id, shape: layout.track.shape, snapshotKey: key, layout: canonicalJson(layout) };
}
