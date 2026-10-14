// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Snapshots and shapes. See docs/identity.md for what the keys mean.
import { canonicalJson, snapshotKey, shapeKey, shapeOf, parseLayout, layoutFromData, KEY_PATTERN } from '@tinylap/track-format';
import { exportHtml } from '../js/storage.js';
import { problem, json, html } from './responses.js';
import { prefersHtml, mediaType, matchesEtag } from './negotiate.js';
import { shapePage } from './pages.js';
import { clientBucket } from '@tinylap/auth';

const MAX_BODY = 512 * 1024;
const MAX_LAYOUT = 64 * 1024;
const TYPES = new Set(['application/json', 'text/html']);

/** Reads at most `max` bytes; past that it drains the rest and returns null. */
async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= max) chunks.push(chunk);
  }
  return size > max ? null : Buffer.concat(chunks).toString('utf8');
}

/** Only a configured header names the client: an unconfigured one is just a forgery. */
function clientOf(request) {
  const value = request.clientIpHeader && request.req.headers[request.clientIpHeader];
  return clientBucket(typeof value === 'string' && value ? value : request.req.socket.remoteAddress ?? 'unknown');
}

const notFound = (request, detail = 'Nothing is stored under this key.') => problem(request, 'not-found', detail);
const unavailable = (request) => problem(request, 'unavailable', 'Layouts cannot be stored or read right now.');

async function postLayout(request) {
  const { req } = request;
  if (!TYPES.has(mediaType(req.headers['content-type']))) {
    req.resume();
    return problem(request, 'unsupported-media-type', 'Send a layout as application/json, or an exported page as text/html.');
  }
  const tooLarge = () => problem(request, 'too-large', 'A request body may be at most 512 KiB.');
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) {
    req.resume();
    return tooLarge();
  }
  const text = await readBody(req, MAX_BODY);
  if (text === null) return tooLarge();

  const wait = request.limiter.take(clientOf(request));
  if (wait) return problem(request, 'rate-limited', `Try again in ${wait} seconds.`, { 'Retry-After': String(wait) });
  if (!request.store) return unavailable(request);

  let layout;
  try {
    layout = parseLayout(text);
  } catch (error) {
    return problem(request, 'invalid-layout', error.message);
  }
  // The server never issues track ids: a random id here would turn one
  // layout posted twice into two snapshots. It only checks the client's.
  const shape = shapeOf(layout);
  if (shape ? layout.track?.shape !== shape : layout.track) {
    return problem(request, 'track-mismatch', shape
      ? 'This layout is a single closed loop, so it needs a track block whose shape matches it. Run assignTrack before posting.'
      : 'Only a single closed loop carries a track. Remove the track block, or run assignTrack before posting.');
  }

  const canonical = canonicalJson(layout);
  if (Buffer.byteLength(canonical) > MAX_LAYOUT) {
    return problem(request, 'too-large', 'A layout may be at most 64 KiB once read, however large the page or file it came in.');
  }

  const key = await snapshotKey(layout);
  const sk = shape ? await shapeKey(shape) : null;
  const created = request.store.put({ key, json: canonical, shapeKey: sk, trackId: layout.track?.id ?? null });
  return json(created ? 201 : 200, { key, url: `${request.origin}/layouts/${key}`, shapeKey: sk }, {
    Location: `/layouts/${key}`,
    'Cache-Control': 'no-store',
  });
}

async function getLayout(request, [, key, suffix]) {
  if (!KEY_PATTERN.test(key)) return notFound(request, 'This is not a layout key.');
  if (!request.store) return unavailable(request);
  const stored = request.store.get(key);
  if (!stored) return notFound(request);

  const asHtml = suffix ? suffix === 'html' : prefersHtml(request.req.headers.accept);
  if (asHtml) {
    // The page is a rendering, and renderings change with the planner, so it
    // revalidates; the build is part of its etag.
    const headers = { Vary: 'Accept', ETag: `"${key}-${request.build}"`, 'Cache-Control': 'no-cache' };
    if (matchesEtag(request.req, headers.ETag)) return { status: 304, headers };
    return html(200, exportHtml(layoutFromData(JSON.parse(stored)), { openUrl: `/?layout=${key}` }), headers);
  }
  const headers = { Vary: 'Accept', ETag: `"${key}"`, 'Cache-Control': 'public, max-age=31536000, immutable' };
  if (matchesEtag(request.req, headers.ETag)) return { status: 304, headers };
  return json(200, stored, headers);
}

async function getShape(request, [, key]) {
  if (!KEY_PATTERN.test(key)) return notFound(request, 'This is not a shape key.');
  if (!request.store) return unavailable(request);
  const layouts = request.store.listByShape(key, 100);
  if (layouts.length === 0) return notFound(request, 'No layout of this shape is stored.');
  const listing = { shapeKey: key, shape: JSON.parse(request.store.get(layouts[0].key)).track.shape, layouts };
  const headers = { Vary: 'Accept', 'Cache-Control': 'public, max-age=60' };
  return prefersHtml(request.req.headers.accept) ? html(200, shapePage(listing), headers) : json(200, listing, headers);
}

export const layoutRoutes = [
  { pattern: /^\/layouts$/, methods: { POST: postLayout } },
  { pattern: /^\/layouts\/([^/]+?)(?:\.(json|html))?$/, methods: { GET: getLayout } },
  { pattern: /^\/shapes\/([^/]+)$/, methods: { GET: getShape } },
  // Last: anything else under these prefixes is an API miss, not a static one.
  { pattern: /^\/(?:layouts|shapes)(?:\/.*)?$/, unknown: true, methods: {} },
];
