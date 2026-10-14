# Planner Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The track planner becomes its own Node server: it serves the app, stores shared layouts as content-addressed snapshots at `/layouts/<key>` (HTML or JSON by content negotiation), indexes them by shape at `/shapes/<key>`, and describes itself with OpenAPI 3.1.

**Architecture:** One `node:http` server in `apps/track-planner/server/`, no framework, SQLite through `node:sqlite`. Handlers return plain `{ status, headers, body }` objects and one function writes them, so every route is testable through a real server on a random port. `@tinylap/track-format` gains the key functions and the JSON Schema, so browsers, the timing app and the server compute identical keys.

**Tech Stack:** Node 24 (`node:http`, `node:sqlite`, `crypto.subtle`), plain ES modules with JSDoc, `node:test`, Ajv (dev only, for schema and contract tests), Docker on Fly.io.

**Spec:** `docs/superpowers/specs/2026-10-14-planner-server-design.md`

## Global Constraints

- No framework, no bundler. Only built-in Node modules at runtime; Ajv and ajv-formats are dev dependencies.
- Every new file starts with the SPDX header used across the repo: `apps/**` and `tools/**` are `AGPL-3.0-or-later`, `packages/**` are `MPL-2.0`, `docs/**` are `CC-BY-SA-4.0`. REUSE.toml already covers these paths, so JSON files need no header.
- Commits: conventional messages, `git commit -s`, author `1009814+jostsg@users.noreply.github.com`. **No AI attribution of any kind** (no `Co-Authored-By`, no tool mentions).
- Before every commit: `pnpm check` (tests, lint, typecheck on all workspaces) must pass.
- Keys: SHA-256, first 16 bytes, base64url without padding, 22 characters (`/^[A-Za-z0-9_-]{22}$/`).
- Body limit 512 KiB. Rate limit default 30 posts per hour per client.
- Cache: `/layouts/<key>` JSON `public, max-age=31536000, immutable` with `ETag: "<key>"`; HTML `no-cache` with `ETag: "<key>-<build>"`; `/shapes/<key>` `public, max-age=60`; errors `no-store`.
- Every error body is `application/problem+json` `{ type, title, status, detail }`; titles come from `x-tinylap-problems` in `openapi.json`.
- API responses carry `Access-Control-Allow-Origin: *` and `Link: </openapi.json>; rel="service-desc"`.
- The planner app is `@ts-nocheck` in `js/app.js`; the server and new modules are typechecked (`strict: false` in the planner, strict in track-format).

## Review Focus

1. **A browser navigation to `/layouts/<key>` must get HTML, while `fetch` and `curl` get JSON.** Chrome's navigation `Accept` is `text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8`. Task 3 pins it with that exact header.
2. **The same layout posted with its pieces in another order must give the same link,** and an exported HTML page must store the same snapshot as its JSON. Task 1 pins the order; Task 5 pins HTML against JSON.
3. **CSP must not break the planner in the browser.** The import map is inline and only allowed by hash. Task 4 tests the hash against the real `index.html` and scans the app for inline handlers and `eval`.
4. **A forged `X-Forwarded-For` or `Fly-Client-IP` must not bypass the rate limit** unless that header is configured. Task 5 pins this.
5. **Opening `/?layout=<key>` with a bad or unknown key** must show a readable error and keep the current layout. Task 7 pins this.

---

## File Structure

```
packages/track-format/
  keys.js                 canonicalJson, snapshotKey, shapeKey, parseLayout, KEY_PATTERN   (new)
  layout.schema.json      JSON Schema 2020-12 for the file format                           (new)
  index.js                re-exports keys.js                                                (modify)
  package.json            exports ./layout.schema.json, files, devDeps ajv               (modify)
  README.md               keys and schema section                                           (modify)
  test/keys.test.js       (new)
  test/schema.test.js     (new)
apps/track-planner/
  server/
    main.js               entry: env → createHandler → listen                              (new)
    app.js                createHandler, dispatch, send, response helpers, problem()       (new)
    static.js             static files (assembled or dev), gzip, ETag, planner CSP         (new)
    layouts.js            POST /layouts, GET /layouts/<key>, GET /shapes/<key>             (new)
    discovery.js          /openapi.json, /schemas/layout.json, api-catalog, /problems, /api (new)
    negotiate.js          prefersHtml, mediaType, matchesEtag                              (new)
    rate-limit.js         rateLimiter                                                      (new)
    store.js              openStore                                                        (new)
    problems.js           PROBLEMS (from openapi.json)                                     (new)
    pages.js              shapePage, apiPage                                               (new)
    openapi.json          the API description                                              (new)
  js/share.js             shareLayout, fetchShared                                         (new)
  js/storage.js           exportHtml(layout, { openUrl })                                  (modify)
  js/app.js               Share button, ?layout=, .json open, notice                       (modify)
  index.html              Share button, accept .json                                       (modify)
  test/server/helpers.js  startServer, layouts                                             (new)
  test/server/*.test.js   (new)
  test/share.test.js      (new)
  test/csp.test.js        (new)
  test/smoke-api.js       post and fetch against a running image                           (new)
  Dockerfile, fly.toml    Node image, volume, env                                          (modify)
  Caddyfile               (delete)
  package.json            dev/start scripts, devDeps ajv                                   (modify)
  tsconfig.json           include server                                                   (modify)
tools/
  serve-map.js            export within                                                    (modify)
  assemble.js             gzip every text file                                             (modify)
  dev-server.js           (delete)
  test/assemble.test.js   gzip test                                                        (modify)
eslint.config.js          node globals for apps/*/server                                    (modify)
.github/workflows/ci.yml  run smoke-api                                                    (modify)
docs/identity.md          (new)
README.md                 self-hosting section                                             (modify)
docs/superpowers/specs/2026-10-14-planner-server-design.md   file tree matches this plan   (modify)
```

---

### Task 1: Keys and `parseLayout` in the package

**Files:**
- Create: `packages/track-format/keys.js`
- Modify: `packages/track-format/index.js`
- Test: `packages/track-format/test/keys.test.js`

**Interfaces:**
- Produces: `canonicalJson(layout: unknown): string`, `snapshotKey(layout: unknown): Promise<string>`, `shapeKey(shape: string): Promise<string>`, `parseLayout(text: string): Layout`, `KEY_PATTERN: RegExp`, all exported from `@tinylap/track-format`.

- [ ] **Step 1: Write the failing tests**

`packages/track-format/test/keys.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, snapshotKey, shapeKey, parseLayout, KEY_PATTERN, createLayout, assignTrack, shapeOf, rectangularRing } from '../index.js';
import { rotated } from './fixtures.js';

const GOLDEN = {
  version: 2,
  unit: 'mat',
  room: { w: 10, h: 8 },
  pieces: [
    { type: 'cornerR30', x: 4, y: 2, rot: 90 },
    { type: 'straight', x: 0, y: 0, rot: 0 },
  ],
};

test('the canonical form sorts pieces and fixes key order', () => {
  assert.equal(
    canonicalJson(GOLDEN),
    '{"version":2,"unit":"mat","room":{"w":10,"h":8},"pieces":[{"type":"straight","x":0,"y":0,"rot":0},{"type":"cornerR30","x":4,"y":2,"rot":90}]}',
  );
});

test('the snapshot key of a known layout never changes', async () => {
  // Pinned: changing the canonical form or the hash silently moves every
  // stored link. If this fails, that is what just happened.
  assert.equal(await snapshotKey(GOLDEN), 'gGzDWQuxgVLYMqBGHopfLA');
});

test('piece order does not change the snapshot key', async () => {
  const reversed = { ...GOLDEN, pieces: [...GOLDEN.pieces].reverse() };
  assert.equal(await snapshotKey(reversed), await snapshotKey(GOLDEN));
});

test('any change changes the snapshot key', async () => {
  const moved = { ...GOLDEN, pieces: [GOLDEN.pieces[0], { ...GOLDEN.pieces[1], x: 1 }] };
  const room = { ...GOLDEN, room: { w: 11, h: 8 } };
  const base = await snapshotKey(GOLDEN);
  assert.notEqual(await snapshotKey(moved), base);
  assert.notEqual(await snapshotKey(room), base);
});

test('keys are 22 url-safe characters', async () => {
  assert.match(await snapshotKey(GOLDEN), KEY_PATTERN);
  assert.equal(await shapeKey('c30:1:x'), 'ZledtuwItUHIKLi4IoHZyw');
});

test('the shape key is the same for a rotated build', async () => {
  const ring = createLayout({ pieces: rectangularRing() });
  const turned = createLayout({ pieces: rotated(rectangularRing(), 90) });
  assert.equal(await shapeKey(shapeOf(turned)), await shapeKey(shapeOf(ring)));
});

test('parseLayout reads JSON and exported HTML alike', () => {
  const layout = assignTrack(createLayout({ pieces: rectangularRing() }));
  const json = JSON.stringify(layout);
  const html = `<!doctype html><p>x</p><script type="application/json" id="layout">${json}</script>`;
  assert.deepEqual(parseLayout(`  \n${json}`), layout);
  assert.deepEqual(parseLayout(html), layout);
});

test('parseLayout rejects text that is neither', () => {
  assert.throws(() => parseLayout('hello'), /no layout data/);
  assert.throws(() => parseLayout('{"version":3,"pieces":[]}'), /newer planner/);
  assert.throws(() => parseLayout('{not json'), SyntaxError);
});
```

`rotated(pieces, rot)` lives inside `test/identity.test.js` today. Move it, with its comment, into `test/fixtures.js` as an export, and import it from there in both test files. Do not copy it.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @tinylap/track-format test`
Expected: FAIL, `canonicalJson` is not exported.

- [ ] **Step 3: Implement `keys.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Content addresses for layouts and shapes. A snapshot key names one exact
// layout, a shape key one physical build; see docs/identity.md. Both hash
// with crypto.subtle so browsers and Node compute the same keys.
import { layoutFromData, layoutFromHtml } from './data.js';

/** @import { Layout } from './types.js' */

/** 22 base64url characters: 16 bytes of SHA-256. */
export const KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const order = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The bytes a snapshot key is computed from. layoutFromData rebuilds the
 * layout with a fixed key order; pieces are sorted because their order
 * carries no meaning, so one build listed two ways is one snapshot.
 * @param {unknown} data @returns {string}
 */
export function canonicalJson(data) {
  const layout = layoutFromData(/** @type {any} */ (data));
  const pieces = [...layout.pieces].sort((a, b) => a.y - b.y || a.x - b.x || order(a.type, b.type) || a.rot - b.rot);
  return JSON.stringify({ ...layout, pieces });
}

/** @param {string} text @returns {Promise<string>} */
async function key(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest).subarray(0, 16);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {unknown} layout @returns {Promise<string>} */
export const snapshotKey = (layout) => key(canonicalJson(layout));

/** @param {string} shape A shapeOf result, prefix included. @returns {Promise<string>} */
export const shapeKey = (shape) => key(shape);

/**
 * Reads a layout from JSON or from a page the planner exported.
 * @param {string} text @returns {Layout}
 */
export function parseLayout(text) {
  return /^\s*\{/.test(text) ? layoutFromData(JSON.parse(text)) : layoutFromHtml(text);
}
```

Add to `index.js` after the `identity.js` line: `export * from './keys.js';`

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tinylap/track-format test`
Expected: PASS.

- [ ] **Step 5: Document in the README**

In `packages/track-format/README.md`, after the "Track identity" section, add:

````markdown
## Keys

Shared layouts are addressed by content. See [docs/identity.md](https://github.com/tinylaphq/tinylap/blob/main/docs/identity.md) for how snapshots, track ids and shapes relate.

- `snapshotKey(layout)` names one exact layout: SHA-256 of `canonicalJson(layout)`, first 16 bytes, base64url (22 characters). Piece order does not matter; anything else does.
- `shapeKey(shapeOf(layout))` names one physical build, wherever and however it was laid out.
- `parseLayout(text)` reads a layout from JSON or from an exported page.
- `KEY_PATTERN` matches a valid key.

```js
import { parseLayout, snapshotKey, shapeKey, shapeOf } from '@tinylap/track-format';

const layout = parseLayout(text);
const link = `/layouts/${await snapshotKey(layout)}`;
const shape = shapeOf(layout);
const sameBuild = shape && `/shapes/${await shapeKey(shape)}`;
```
````

- [ ] **Step 6: Check and commit**

Run: `pnpm check`
Expected: all green.

```bash
git add packages/track-format
git commit -s -m "feat(track-format): address layouts and shapes by content"
```

---

### Task 2: JSON Schema for the layout format

**Files:**
- Create: `packages/track-format/layout.schema.json`
- Modify: `packages/track-format/package.json`
- Test: `packages/track-format/test/schema.test.js`

**Interfaces:**
- Produces: `@tinylap/track-format/layout.schema.json` (importable with `with { type: 'json' }`, resolvable with `import.meta.resolve`). It has no `$id`; the server serves it at `/schemas/layout.json`.

- [ ] **Step 1: Add Ajv as a dev dependency**

Run: `pnpm --filter @tinylap/track-format add -D ajv@^8.20.0`

- [ ] **Step 2: Write the failing test**

`packages/track-format/test/schema.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import schema from '../layout.schema.json' with { type: 'json' };
import { PIECES, createLayout, assignTrack, rectangularRing, stockL, extractLayoutJson } from '../index.js';

const validate = new Ajv({ allErrors: true }).compile(schema);
const ok = (data) => assert.ok(validate(data), JSON.stringify(validate.errors));

test('every reference layout, with and without a track, is valid', () => {
  for (const pieces of [rectangularRing(), stockL()]) {
    ok(createLayout({ pieces }));
    ok(assignTrack(createLayout({ pieces, room: { w: 12, h: 15 } })));
  }
});

test('the v1 golden export is valid', () => {
  const html = readFileSync(new URL('../../../apps/track-planner/test/fixtures/live-export.html', import.meta.url), 'utf8');
  ok(extractLayoutJson(html));
});

test('broken layouts are rejected', () => {
  for (const bad of [
    { version: 2, unit: 'mat', room: null },
    { version: 3, unit: 'mat', room: null, pieces: [] },
    { version: 2, unit: 'mat', room: null, pieces: [{ type: 'hairpin', x: 0, y: 0, rot: 0 }] },
    { version: 2, unit: 'mat', room: null, pieces: [{ type: 'straight', x: 0, y: 0, rot: 45 }] },
    { version: 2, unit: 'mat', room: null, pieces: [], track: { id: 'nope', shape: 'c30:1:x' } },
  ]) assert.equal(validate(bad), false, JSON.stringify(bad));
});

test('the schema lists exactly the known piece types', () => {
  assert.deepEqual(schema.$defs.piece.properties.type.enum, Object.keys(PIECES));
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @tinylap/track-format test`
Expected: FAIL, cannot find `layout.schema.json`.

- [ ] **Step 4: Write the schema**

`packages/track-format/layout.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "TinyLap Circuit 30 layout",
  "description": "A track layout for the Kyosho Mini-Z Grand Prix Circuit 30, as the planner saves it. Readers accept versions 1 and 2 and upgrade 1 in memory. See docs/identity.md for the track block.",
  "type": "object",
  "required": ["version", "pieces"],
  "properties": {
    "version": { "enum": [1, 2] },
    "unit": { "const": "mat", "description": "Coordinates count Circuit 30 mats (500 mm)." },
    "room": {
      "description": "The floor the layout must fit, in mats, or null for none.",
      "oneOf": [
        { "type": "null" },
        {
          "type": "object",
          "required": ["w", "h"],
          "properties": { "w": { "type": "number" }, "h": { "type": "number" } }
        }
      ]
    },
    "pieces": { "type": "array", "items": { "$ref": "#/$defs/piece" } },
    "track": { "$ref": "#/$defs/track" }
  },
  "$defs": {
    "piece": {
      "type": "object",
      "required": ["type", "x", "y", "rot"],
      "properties": {
        "type": { "enum": ["straight", "cornerR30", "cornerR60"] },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "rot": { "enum": [0, 90, 180, 270] }
      }
    },
    "track": {
      "description": "Present only on a single closed loop. id names the track; shape fingerprints its build.",
      "type": "object",
      "required": ["id", "shape"],
      "properties": {
        "id": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },
        "shape": { "type": "string", "pattern": "^c30:" }
      }
    }
  }
}
```

If `Object.keys(PIECES)` is in a different order, reorder the `enum` to match it rather than changing `PIECES`.

- [ ] **Step 5: Export it**

In `packages/track-format/package.json`, add to `exports` after `"./types"`:

```json
"./layout.schema.json": "./layout.schema.json"
```

and add `"layout.schema.json"` to `files`.

- [ ] **Step 6: Run the tests, check, commit**

Run: `pnpm --filter @tinylap/track-format test` → PASS, then `pnpm check` → green.

Add one line to the README "Keys" section: `` - `@tinylap/track-format/layout.schema.json` is the format as JSON Schema 2020-12, for validating layouts without this package. ``

```bash
git add packages/track-format pnpm-lock.yaml
git commit -s -m "feat(track-format): describe the layout format as JSON Schema"
```

---

### Task 3: Server building blocks and the API description

**Files:**
- Create: `apps/track-planner/server/negotiate.js`, `rate-limit.js`, `store.js`, `problems.js`, `openapi.json`
- Modify: `apps/track-planner/tsconfig.json`, `eslint.config.js`
- Test: `apps/track-planner/test/server/units.test.js`

**Interfaces:**
- Produces:
  - `prefersHtml(accept: string | undefined): boolean`
  - `mediaType(contentType: string | undefined): string` (lowercase, parameters stripped, `''` when missing)
  - `matchesEtag(req: IncomingMessage, etag: string): boolean`
  - `rateLimiter({ limit: number, windowMs?: number, now?: () => number }) → { take(client: string): number }`, which returns 0 when allowed, otherwise the whole seconds until the window resets
  - `openStore(path: string) → { put({ key, json, shapeKey, trackId }): boolean /* created */, get(key): string | null, listByShape(shapeKey, limit?): { key, trackId, createdAt }[], close() }`
  - `PROBLEMS: Record<string, { status: number, title: string, description: string }>`
  - `openapi.json`, the complete description used by every later task.

- [ ] **Step 1: Make the server checkable**

`apps/track-planner/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "strict": false, "resolveJsonModule": true }, "include": ["js/**/*.js", "server/**/*.js"] }
```

`eslint.config.js`: change the node-globals entry to

```js
  { files: ['**/test/**/*.js', 'tools/**/*.js', 'apps/*/server/**/*.js', '*.config.js'], languageOptions: { globals: globals.node } },
```

- [ ] **Step 2: Write the failing unit tests**

`apps/track-planner/test/server/units.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { prefersHtml, mediaType, matchesEtag } from '../../server/negotiate.js';
import { rateLimiter } from '../../server/rate-limit.js';
import { openStore } from '../../server/store.js';
import { PROBLEMS } from '../../server/problems.js';

const CHROME = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

test('a browser navigation prefers html; fetch, curl and no header get json', () => {
  assert.equal(prefersHtml(CHROME), true);
  assert.equal(prefersHtml('*/*'), false);
  assert.equal(prefersHtml(undefined), false);
  assert.equal(prefersHtml(''), false);
  assert.equal(prefersHtml('application/json'), false);
});

test('q-values decide, and the most specific range wins', () => {
  assert.equal(prefersHtml('application/json;q=0.5, text/html'), true);
  assert.equal(prefersHtml('text/html;q=0.4, application/json;q=0.6'), false);
  assert.equal(prefersHtml('text/*, application/json;q=0.9'), true);
  assert.equal(prefersHtml('text/html;q=0, */*'), false);
});

test('media types lose their parameters and case', () => {
  assert.equal(mediaType('Application/JSON; charset=utf-8'), 'application/json');
  assert.equal(mediaType(undefined), '');
});

test('etags match exactly, in lists, weakly, or by star', () => {
  const req = (value) => ({ headers: { 'if-none-match': value } });
  assert.equal(matchesEtag(req('"a"'), '"a"'), true);
  assert.equal(matchesEtag(req('"b", "a"'), '"a"'), true);
  assert.equal(matchesEtag(req('W/"a"'), '"a"'), true);
  assert.equal(matchesEtag(req('*'), '"a"'), true);
  assert.equal(matchesEtag(req('"ab"'), '"a"'), false);
  assert.equal(matchesEtag({ headers: {} }, '"a"'), false);
});

test('the rate limiter allows the limit per window, per client', () => {
  let t = 0;
  const limiter = rateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(limiter.take('a'), 0);
  assert.equal(limiter.take('a'), 0);
  assert.equal(limiter.take('a'), 1);
  assert.equal(limiter.take('b'), 0);
  t = 1000;
  assert.equal(limiter.take('a'), 0);
});

test('the store keeps one row per key and lists by shape, newest first', () => {
  const store = openStore(':memory:');
  assert.equal(store.put({ key: 'k1', json: '{"a":1}', shapeKey: 's', trackId: 't1' }), true);
  assert.equal(store.put({ key: 'k1', json: '{"a":1}', shapeKey: 's', trackId: 't1' }), false);
  store.put({ key: 'k2', json: '{}', shapeKey: 's', trackId: 't2' });
  store.put({ key: 'k3', json: '{}', shapeKey: null, trackId: null });
  assert.equal(store.get('k1'), '{"a":1}');
  assert.equal(store.get('nope'), null);
  const listed = store.listByShape('s');
  assert.deepEqual(listed.map((r) => r.key).sort(), ['k1', 'k2']);
  assert.deepEqual(Object.keys(listed[0]), ['key', 'trackId', 'createdAt']);
  assert.equal(Object.getPrototypeOf(listed[0]), Object.prototype);
  assert.deepEqual(store.listByShape('none'), []);
  store.close();
});

test('every problem type has a status, a title and a description', () => {
  assert.deepEqual(Object.keys(PROBLEMS).sort(), [
    'invalid-layout', 'method-not-allowed', 'not-found', 'rate-limited',
    'too-large', 'track-mismatch', 'unavailable', 'unsupported-media-type',
  ]);
  for (const p of Object.values(PROBLEMS)) {
    assert.equal(typeof p.status, 'number');
    assert.ok(p.title && p.description);
  }
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @tinylap/track-planner test`
Expected: FAIL, modules not found.

- [ ] **Step 4: `negotiate.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Content negotiation (RFC 9110 §12.5.1). Only one question is ever asked:
// does this client prefer HTML to JSON? Ties go to JSON, so */* and a missing
// header (fetch, curl, scripts) get data, and a browser navigation, which
// names text/html explicitly, gets the page.

/** @param {string} accept @returns {{ range: string, q: number }[]} */
function ranges(accept) {
  return accept.split(',').map((part) => {
    const [range, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    const q = params.find((p) => p.startsWith('q='));
    const quality = q === undefined ? 1 : Number(q.slice(2));
    return { range, q: Number.isFinite(quality) ? quality : 0 };
  }).filter((r) => r.range);
}

/** The quality of the most specific range matching `type`. */
function quality(list, type) {
  const major = type.split('/')[0];
  let best = 0;
  let rank = -1;
  for (const { range, q } of list) {
    const r = range === type ? 2 : range === `${major}/*` ? 1 : range === '*/*' ? 0 : -1;
    if (r > rank) { rank = r; best = q; }
  }
  return best;
}

/** @param {string | undefined} accept @returns {boolean} */
export function prefersHtml(accept) {
  if (!accept) return false;
  const list = ranges(accept);
  return quality(list, 'text/html') > quality(list, 'application/json');
}

/** @param {string | undefined} contentType @returns {string} */
export const mediaType = (contentType) => (contentType ?? '').split(';')[0].trim().toLowerCase();

/** @param {{ headers: Record<string, string | string[] | undefined> }} req @param {string} etag */
export function matchesEtag(req, etag) {
  const header = req.headers['if-none-match'];
  if (typeof header !== 'string') return false;
  return header.split(',').map((s) => s.trim()).some((t) => t === '*' || t === etag || t === `W/${etag}`);
}
```

- [ ] **Step 5: `rate-limit.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A fixed window per client, in memory only: a restart forgets everyone,
// and an address is dropped once its window is over, so nothing about a
// client is kept longer than one window.

/** @param {{ limit: number, windowMs?: number, now?: () => number }} options */
export function rateLimiter({ limit, windowMs = 3_600_000, now = Date.now }) {
  /** @type {Map<string, { start: number, count: number }>} */
  const windows = new Map();
  let pruned = 0;
  return {
    /** @param {string} client @returns {number} 0 when allowed, else seconds until it is again. */
    take(client) {
      const t = now();
      if (t - pruned >= 60_000) {
        for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
        pruned = t;
      }
      let w = windows.get(client);
      if (!w || t - w.start >= windowMs) {
        w = { start: t, count: 0 };
        windows.set(client, w);
      }
      if (w.count >= limit) return Math.max(1, Math.ceil((w.start + windowMs - t) / 1000));
      w.count += 1;
      return 0;
    },
  };
}
```

- [ ] **Step 6: `store.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Snapshots never change, so the store only inserts and reads. A repeated
// post of the same snapshot is a no-op, not an error.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS layouts (
  key        TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  shape_key  TEXT,
  track_id   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS layouts_shape ON layouts (shape_key);
`;

/** @param {string} path A file path, or ':memory:'. */
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const insert = db.prepare(
    'INSERT INTO layouts (key, json, shape_key, track_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
  );
  const select = db.prepare('SELECT json FROM layouts WHERE key = ?');
  const byShape = db.prepare(
    'SELECT key, track_id, created_at FROM layouts WHERE shape_key = ? ORDER BY created_at DESC, key LIMIT ?',
  );
  return {
    /** @param {{ key: string, json: string, shapeKey: string | null, trackId: string | null }} row @returns {boolean} created */
    put({ key, json, shapeKey, trackId }) {
      return insert.run(key, json, shapeKey, trackId, new Date().toISOString()).changes === 1;
    },
    /** @param {string} key @returns {string | null} */
    get(key) {
      const row = select.get(key);
      return row ? String(row.json) : null;
    },
    /** @param {string} shapeKey @param {number} [limit] */
    listByShape(shapeKey, limit = 100) {
      return byShape.all(shapeKey, limit).map((r) => ({
        key: String(r.key),
        trackId: String(r.track_id),
        createdAt: String(r.created_at),
      }));
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 7: `openapi.json`**

`apps/track-planner/server/openapi.json`. This is the full description; later tasks implement exactly this:

```json
{
  "openapi": "3.1.1",
  "info": {
    "title": "TinyLap planner API",
    "version": "1.0.0",
    "license": { "name": "AGPL-3.0-or-later", "identifier": "AGPL-3.0-or-later" },
    "description": "Shared Circuit 30 layouts. A layout is stored as an immutable snapshot under a key computed from its content, so the same layout always has the same link and a changed layout gets a new one. Every snapshot of one physical build is also listed under its shape key, so someone who only has the layout can find it without a link. Each URL serves HTML to browsers and JSON to everything else."
  },
  "externalDocs": {
    "description": "Snapshots, tracks and shapes: how the identifiers relate",
    "url": "https://github.com/tinylaphq/tinylap/blob/main/docs/identity.md"
  },
  "paths": {
    "/layouts": {
      "post": {
        "summary": "Store a snapshot",
        "description": "Accepts a layout as JSON, or a page the planner exported. A single closed loop must carry a track block whose shape matches its geometry (run assignTrack first); any other layout must carry none. The server never assigns track ids.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": { "schema": { "$ref": "#/components/schemas/Layout" } },
            "text/html": { "schema": { "type": "string", "description": "A page exported by the planner." } }
          }
        },
        "responses": {
          "200": { "description": "The snapshot was already stored.", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Snapshot" } } } },
          "201": {
            "description": "The snapshot was stored.",
            "headers": { "Location": { "schema": { "type": "string" }, "description": "/layouts/<key>" } },
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Snapshot" } } }
          },
          "413": { "$ref": "#/components/responses/Problem" },
          "415": { "$ref": "#/components/responses/Problem" },
          "422": { "$ref": "#/components/responses/Problem" },
          "429": { "$ref": "#/components/responses/Problem" },
          "503": { "$ref": "#/components/responses/Problem" }
        }
      }
    },
    "/layouts/{key}": {
      "get": {
        "summary": "A snapshot, as JSON or as a page",
        "description": "Browsers that prefer text/html get the page with the drawing and the bill of materials; every other client gets the JSON. The JSON never changes and may be cached forever.",
        "parameters": [{ "$ref": "#/components/parameters/key" }],
        "responses": {
          "200": {
            "description": "The snapshot.",
            "content": {
              "application/json": { "schema": { "$ref": "#/components/schemas/Layout" } },
              "text/html": { "schema": { "type": "string" } }
            }
          },
          "304": { "description": "Not modified." },
          "404": { "$ref": "#/components/responses/Problem" },
          "503": { "$ref": "#/components/responses/Problem" }
        }
      }
    },
    "/layouts/{key}.json": {
      "get": {
        "summary": "A snapshot as JSON, whatever Accept says",
        "parameters": [{ "$ref": "#/components/parameters/key" }],
        "responses": {
          "200": { "description": "The snapshot.", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Layout" } } } },
          "304": { "description": "Not modified." },
          "404": { "$ref": "#/components/responses/Problem" },
          "503": { "$ref": "#/components/responses/Problem" }
        }
      }
    },
    "/layouts/{key}.html": {
      "get": {
        "summary": "A snapshot as a page, whatever Accept says",
        "parameters": [{ "$ref": "#/components/parameters/key" }],
        "responses": {
          "200": { "description": "The page.", "content": { "text/html": { "schema": { "type": "string" } } } },
          "304": { "description": "Not modified." },
          "404": { "$ref": "#/components/responses/Problem" },
          "503": { "$ref": "#/components/responses/Problem" }
        }
      }
    },
    "/shapes/{key}": {
      "get": {
        "summary": "Every snapshot of one build",
        "description": "Compute the key locally with shapeKey(shapeOf(layout)). Snapshots with the same track id are the same track; different track ids are separate tracks built the same way.",
        "parameters": [{ "$ref": "#/components/parameters/key" }],
        "responses": {
          "200": {
            "description": "Up to 100 snapshots, newest first.",
            "content": {
              "application/json": { "schema": { "$ref": "#/components/schemas/ShapeListing" } },
              "text/html": { "schema": { "type": "string" } }
            }
          },
          "404": { "$ref": "#/components/responses/Problem" },
          "503": { "$ref": "#/components/responses/Problem" }
        }
      }
    },
    "/openapi.json": {
      "get": {
        "summary": "This description",
        "responses": { "200": { "description": "OpenAPI 3.1.", "content": { "application/vnd.oai.openapi+json": { "schema": { "type": "object" } } } } }
      }
    },
    "/schemas/layout.json": {
      "get": {
        "summary": "The layout format as JSON Schema 2020-12",
        "responses": { "200": { "description": "The schema.", "content": { "application/schema+json": { "schema": { "type": "object" } } } } }
      }
    },
    "/.well-known/api-catalog": {
      "get": {
        "summary": "The API catalog (RFC 9727)",
        "responses": {
          "200": {
            "description": "A linkset naming this description and its docs.",
            "content": { "application/linkset+json": { "schema": { "type": "object", "required": ["linkset"] } } }
          }
        }
      }
    },
    "/problems/{name}": {
      "get": {
        "summary": "A problem type",
        "description": "Redirects to the problem type's description on /api.",
        "parameters": [{ "name": "name", "in": "path", "required": true, "schema": { "type": "string" } }],
        "responses": {
          "302": { "description": "To /api#problem-<name>." },
          "404": { "$ref": "#/components/responses/Problem" }
        }
      }
    },
    "/api": {
      "get": {
        "summary": "This description as a page",
        "responses": { "200": { "description": "The docs.", "content": { "text/html": { "schema": { "type": "string" } } } } }
      }
    }
  },
  "components": {
    "parameters": {
      "key": {
        "name": "key",
        "in": "path",
        "required": true,
        "description": "22 base64url characters: the first 16 bytes of a SHA-256.",
        "schema": { "type": "string", "pattern": "^[A-Za-z0-9_-]{22}$" }
      }
    },
    "schemas": {
      "Layout": { "$ref": "/schemas/layout.json" },
      "Snapshot": {
        "type": "object",
        "required": ["key", "url", "shapeKey"],
        "properties": {
          "key": { "type": "string", "pattern": "^[A-Za-z0-9_-]{22}$" },
          "url": { "type": "string", "format": "uri" },
          "shapeKey": { "type": ["string", "null"], "pattern": "^[A-Za-z0-9_-]{22}$", "description": "null for a layout without a track." }
        }
      },
      "ShapeListing": {
        "type": "object",
        "required": ["shapeKey", "shape", "layouts"],
        "properties": {
          "shapeKey": { "type": "string", "pattern": "^[A-Za-z0-9_-]{22}$" },
          "shape": { "type": "string", "pattern": "^c30:" },
          "layouts": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["key", "trackId", "createdAt"],
              "properties": {
                "key": { "type": "string", "pattern": "^[A-Za-z0-9_-]{22}$" },
                "trackId": { "type": "string" },
                "createdAt": { "type": "string", "format": "date-time" }
              }
            }
          }
        }
      },
      "Problem": {
        "type": "object",
        "description": "RFC 9457 Problem Details.",
        "required": ["type", "title", "status"],
        "properties": {
          "type": { "type": "string", "format": "uri" },
          "title": { "type": "string" },
          "status": { "type": "integer" },
          "detail": { "type": "string" }
        }
      }
    },
    "responses": {
      "Problem": {
        "description": "An error as RFC 9457 Problem Details; its type names one of the problem types below.",
        "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/Problem" } } }
      }
    }
  },
  "x-tinylap-problems": {
    "invalid-layout": { "status": 422, "title": "The layout is not valid", "description": "The body could not be read as a layout: not JSON, no layout data in the page, an unknown version, piece type or rotation." },
    "track-mismatch": { "status": 422, "title": "The track block does not match the layout", "description": "A single closed loop must carry a track whose shape equals its geometry, and any other layout must carry none. Run assignTrack before posting." },
    "too-large": { "status": 413, "title": "The layout is too large", "description": "A request body may be at most 512 KiB." },
    "rate-limited": { "status": 429, "title": "Too many layouts posted", "description": "Wait for the number of seconds in Retry-After." },
    "unsupported-media-type": { "status": 415, "title": "Unsupported media type", "description": "Send application/json, or text/html for an exported page." },
    "not-found": { "status": 404, "title": "Not found", "description": "Nothing is stored under this key, or the key is malformed." },
    "method-not-allowed": { "status": 405, "title": "Method not allowed", "description": "The Allow header lists the methods this URL supports." },
    "unavailable": { "status": 503, "title": "The service is unavailable", "description": "Layouts cannot be stored or read right now. The planner itself keeps working." }
  }
}
```

- [ ] **Step 8: `problems.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Problem types are defined once, in the API description, so the errors the
// server sends and the ones /api documents cannot disagree.
import openapi from './openapi.json' with { type: 'json' };

/** @type {Record<string, { status: number, title: string, description: string }>} */
export const PROBLEMS = openapi['x-tinylap-problems'];
```

- [ ] **Step 9: Run tests, check, commit**

Run: `pnpm --filter @tinylap/track-planner test` → PASS; `pnpm check` → green. If `node:sqlite` prints an ExperimentalWarning in test output, that is expected.

```bash
git add apps/track-planner eslint.config.js
git commit -s -m "feat(track-planner): add the server's building blocks and API description"
```

---

### Task 4: The server: static files, CSP, dev mode

**Files:**
- Create: `apps/track-planner/server/app.js`, `static.js`, `main.js`
- Create: `apps/track-planner/test/server/helpers.js`, `apps/track-planner/test/server/static.test.js`, `apps/track-planner/test/csp.test.js`
- Modify: `tools/serve-map.js` (export `within`), `tools/assemble.js` (gzip), `tools/test/assemble.test.js`, `apps/track-planner/package.json`
- Delete: `tools/dev-server.js`

**Interfaces:**
- Consumes: `negotiate.js`, `problems.js` (Task 3).
- Produces:
  - `createHandler(options) → (req, res) => Promise<void>`. Options: `{ store, root?, appDir, publicUrl?, rateLimit?, clientIpHeader?, build?, now?, log? }`. `root` set means serve the assembled tree; otherwise the app source is served through `serve-map`.
  - In `app.js`, exported for later tasks:
    - `problem(request, name, detail, headers?)`
    - `json(status, value, headers?)`
    - `html(status, text, headers?)`
    - `PAGE_CSP`
    - the `request` context object `{ req, url, origin, store, publicUrl, build, limiter, clientIpHeader }`
    - routes as `{ pattern: RegExp, methods: { [METHOD]: (request, match) => Response | Promise<Response> } }`
  - Test helper `startServer(options) → { base, store, close }`.

- [ ] **Step 1: Export `within` from `serve-map.js`**

Change `function within(root, rest)` to `export function within(root, rest)`. Nothing else changes.

- [ ] **Step 2: Gzip in the assemble step, test first**

Append to `tools/test/assemble.test.js`:

```js
test('every text file gets a gzip twin, binaries do not', async () => {
  const { gunzipSync } = await import('node:zlib');
  const { app, out } = fixture();
  writeFileSync(join(app, 'css', 'font.woff2'), 'binary');
  assemble(app, out, SHA);
  const css = join(out, 'v', SHA, 'css', 'a.css');
  assert.equal(gunzipSync(readFileSync(`${css}.gz`)).toString(), 'a{}');
  assert.ok(existsSync(join(out, 'index.html.gz')));
  assert.ok(existsSync(join(out, 'v', SHA, 'pkg', 'fmt', 'index.js.gz')));
  assert.ok(!existsSync(join(out, 'v', SHA, 'css', 'font.woff2.gz')));
});
```

Run `pnpm --filter @tinylap/tools test` and watch it fail. Then, in `tools/assemble.js`, add imports `readdirSync` (from `node:fs`), `extname` (from `node:path`) and `gzipSync` (from `node:zlib`), and this function:

```js
// Compressed once here rather than on every request: the server sends the
// .gz twin to clients that accept it. woff2 and images are compressed already.
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt']);

function gzipTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const file = join(entry.parentPath, entry.name);
    if (entry.isFile() && COMPRESSIBLE.has(extname(entry.name))) {
      writeFileSync(`${file}.gz`, gzipSync(readFileSync(file), { level: 9 }));
    }
  }
}
```

and call `gzipTree(outDir);` as the last line of `assemble`. Run the tools tests again → PASS.

- [ ] **Step 3: Write the failing server tests**

`apps/track-planner/test/server/helpers.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createLayout, assignTrack, stockL } from '@tinylap/track-format';
import { createHandler } from '../../server/app.js';
import { openStore } from '../../server/store.js';

export const appDir = fileURLToPath(new URL('../..', import.meta.url));

/** Starts the real server on a random port. Pass `store: null` for an unavailable database. */
export async function startServer(options = {}) {
  const store = 'store' in options ? options.store : openStore(':memory:');
  const server = createServer(createHandler({ appDir, log: false, ...options, store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    store,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

export const closedLayout = () => assignTrack(createLayout({ pieces: stockL() }));
export const openLayout = () => createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });
```

`apps/track-planner/test/server/static.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { assemble } from '../../../../tools/assemble.js';
import { startServer, appDir } from './helpers.js';

const SHA = 'abc1234';
const root = mkdtempSync(join(tmpdir(), 'planner-'));
assemble(appDir, root, SHA);

const server = await startServer({ root });
test.after(() => server.close());
const get = (path, headers = {}) => fetch(server.base + path, { headers });

test('the page revalidates and carries the security headers', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.equal(res.headers.get('server'), null);
  assert.match(await res.text(), new RegExp(`<base href="/v/${SHA}/">`));
});

test('versioned assets are immutable and gzipped on request', async () => {
  const path = `/v/${SHA}/js/app.js`;
  const plain = await get(path, { 'accept-encoding': 'identity' });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(plain.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(plain.headers.get('content-encoding'), null);
  const body = await plain.text();

  // fetch decompresses gzip itself and keeps the Content-Encoding header, so
  // the decoded text must equal the plain body.
  const zipped = await fetch(server.base + path, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(zipped.headers.get('content-encoding'), 'gzip');
  assert.match(zipped.headers.get('vary'), /Accept-Encoding/);
  assert.equal(await zipped.text(), body);
  assert.notEqual(zipped.headers.get('etag'), plain.headers.get('etag'));
});

test('a matching etag gives 304', async () => {
  const first = await get(`/v/${SHA}/css/app.css`, { 'accept-encoding': 'identity' });
  const again = await get(`/v/${SHA}/css/app.css`, { 'accept-encoding': 'identity', 'if-none-match': first.headers.get('etag') });
  assert.equal(again.status, 304);
});

test('missing files and escapes are 404 and never cached', async () => {
  for (const path of [`/v/${SHA}/nope.js`, '/../package.json', '/%2e%2e/package.json', `/v/${SHA}/%2e%2e/%2e%2e/index.html.gz`, `/v/${SHA}/js`]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get('cache-control'), 'no-store', path);
  }
});

test('other methods on static paths are 405', async () => {
  const res = await fetch(server.base + '/', { method: 'DELETE' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});

test('dev mode serves the source and caches nothing', async () => {
  const dev = await startServer({});
  try {
    const page = await fetch(dev.base + '/');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(await page.text(), /<base href="\/">/);
    const pkg = await fetch(dev.base + '/pkg/track-format/index.js');
    assert.equal(pkg.status, 200);
  } finally {
    await dev.close();
  }
});

test('the gzip twin really is gzip of the file', () => {
  // Guards the assemble step against writing something the server would
  // then label Content-Encoding: gzip.
  const html = gunzipSync(readFileSync(join(root, 'index.html.gz'))).toString();
  assert.match(html, /<base href=/);
});
```

`apps/track-planner/test/csp.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The planner's CSP allows scripts from its own origin and the inline import
// map by hash, nothing else. These checks catch what would silently break
// in a browser: another inline script, an inline handler, eval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { plannerCsp } from '../server/static.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the policy allows exactly the import map by hash', () => {
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1];
  const hash = createHash('sha256').update(map).digest('base64');
  assert.match(plannerCsp(html), new RegExp(`script-src 'self' 'sha256-${hash.replace(/[+/=]/g, '\\$&')}'`));
});

test('index.html has no other inline script and no inline handlers', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  for (const attrs of scripts) assert.ok(/type="importmap"/.test(attrs) || /\bsrc=/.test(attrs), attrs);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
});

test('the app code uses no eval and writes no inline handlers', () => {
  const dir = new URL('../js/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const code = readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(code, /\beval\(|new Function\(/, name);
    assert.doesNotMatch(code, /<[a-z][^>]*\son[a-z]+=/i, name);
  }
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `pnpm --filter @tinylap/track-planner test`
Expected: FAIL, `server/app.js` not found.

- [ ] **Step 5: `static.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Serves the app. With `root`, the assembled tree from tools/assemble.js:
// pages revalidate, /v/<sha>/ is immutable, .gz twins go to clients that
// accept them. Without it, the source through serve-map, never cached, so
// an edit shows on the next reload.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { packageRoots, resolveUrl, within } from '../../../tools/serve-map.js';
import { matchesEtag } from './negotiate.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const isFile = (path) => stat(path).then((s) => s.isFile(), () => false);
const digest = (body) => createHash('sha256').update(body).digest('base64url').slice(0, 22);

/**
 * The planner's policy: everything from its own origin, plus the inline
 * import map, allowed by its hash. Styles may be inline (SVG thumbnails
 * carry style attributes); scripts may not.
 * @param {string} html
 */
export function plannerCsp(html) {
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const scripts = map === undefined ? "'self'" : `'self' 'sha256-${createHash('sha256').update(map).digest('base64')}'`;
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** @param {{ root?: string, appDir: string }} options */
export function staticFiles({ root, appDir }) {
  const dev = !root;
  const roots = dev ? packageRoots(appDir) : null;
  /** @type {Map<string, string>} */
  const etags = new Map();
  const missing = { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: 'not found' };

  return async (req, url) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }, body: '' };
    }
    const { pathname } = url;
    const file = dev
      ? resolveUrl(appDir, roots, pathname)
      : pathname === '/' ? join(root, 'index.html') : within(root, pathname.slice(1));
    if (!file || file.endsWith('.gz') || !(await isFile(file))) return missing;

    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const cache = dev ? 'no-store' : pathname.startsWith('/v/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': type, 'Cache-Control': cache };
    let body = await readFile(file);
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = plannerCsp(body.toString('utf8'));
    if (dev) return { status: 200, headers, body };

    let tag = etags.get(file);
    if (!tag) etags.set(file, (tag = digest(body)));
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && (await isFile(`${file}.gz`));
    headers.Vary = 'Accept-Encoding';
    headers.ETag = gzip ? `"${tag}-gz"` : `"${tag}"`;
    if (matchesEtag(req, headers.ETag)) return { status: 304, headers };
    if (gzip) {
      headers['Content-Encoding'] = 'gzip';
      body = await readFile(`${file}.gz`);
    }
    return { status: 200, headers, body };
  };
}
```

- [ ] **Step 6: `app.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The request handler. Routes return plain { status, headers, body }
// objects and send() writes them, so every rule about headers lives here
// once: security headers on everything, CORS and the service-desc link on
// the API, Problem Details for every API error.
import { PROBLEMS } from './problems.js';
import { rateLimiter } from './rate-limit.js';
import { staticFiles } from './static.js';

/** @typedef {{ status: number, headers?: Record<string, string>, body?: string | Buffer }} Response */

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Location, Link, ETag, Retry-After',
  Link: '</openapi.json>; rel="service-desc"',
};

/** Pages the server renders have no scripts at all. */
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** @returns {Response} */
export const json = (status, value, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof value === 'string' ? value : JSON.stringify(value),
});

/** @returns {Response} */
export const html = (status, text, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, ...headers },
  body: text,
});

/** RFC 9457. @param {{ origin: string }} request @param {string} name @param {string} detail @returns {Response} */
export function problem(request, name, detail, headers = {}) {
  const { status, title } = PROBLEMS[name];
  return {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify({ type: `${request.origin}/problems/${name}`, title, status, detail }),
  };
}

function send(req, res, { status, headers = {}, body }) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function dispatch(request, routes, serveStatic) {
  const { req, url } = request;
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    const allowed = Object.keys(route.methods).join(', ');
    if (req.method === 'OPTIONS') {
      return {
        status: 204,
        headers: { ...API_HEADERS, 'Access-Control-Allow-Methods': allowed, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
      };
    }
    const handler = route.methods[req.method === 'HEAD' ? 'GET' : req.method];
    const response = handler
      ? await handler(request, match)
      : problem(request, 'method-not-allowed', `${req.method} is not allowed on ${url.pathname}.`, { Allow: allowed });
    return { ...response, headers: { ...API_HEADERS, ...response.headers } };
  }
  return serveStatic(req, url);
}

/**
 * @param {{ store: ReturnType<typeof import('./store.js').openStore> | null, root?: string, appDir: string,
 *   publicUrl?: string, rateLimit?: number, clientIpHeader?: string, build?: string,
 *   now?: () => number, log?: boolean, routes?: any[] }} options
 */
export function createHandler(options) {
  const context = {
    store: options.store ?? null,
    publicUrl: options.publicUrl?.replace(/\/$/, '') ?? null,
    build: options.build ?? 'dev',
    limiter: rateLimiter({ limit: options.rateLimit ?? 30, now: options.now }),
    clientIpHeader: options.clientIpHeader?.toLowerCase() || null,
  };
  const routes = options.routes ?? [];
  const serveStatic = staticFiles(options);

  return async (req, res) => {
    const started = performance.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = context.publicUrl ?? `http://${req.headers.host ?? 'localhost'}`;
    const request = { ...context, req, url, origin };
    let response;
    try {
      response = await dispatch(request, routes, serveStatic);
    } catch (error) {
      console.error(error);
      response = { ...problem(request, 'unavailable', 'The server could not complete the request.'), headers: { ...API_HEADERS, 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } };
    }
    send(req, res, response);
    // No client addresses in the log, ever.
    if (options.log !== false) console.log(`${req.method} ${url.pathname} ${response.status} ${Math.round(performance.now() - started)}ms`);
  };
}
```

Task 5 replaces `const routes = options.routes ?? [];` with the real route table. The `routes` option stays for tests.

- [ ] **Step 7: `main.js` and the scripts**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Production: node server/main.js (serves TINYLAP_ROOT, default /srv).
// Development: node server/main.js --dev (serves the source on :8000, with
// an in-memory database unless TINYLAP_DB says otherwise).
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHandler } from './app.js';
import { openStore } from './store.js';

const env = process.env;
const dev = process.argv.includes('--dev');

let store = null;
try {
  store = openStore(env.TINYLAP_DB ?? (dev ? ':memory:' : '/data/tinylap.sqlite'));
} catch (error) {
  // The planner still works without a database; the API answers 503.
  console.error(`database unavailable: ${error.message}`);
}

const handler = createHandler({
  store,
  root: dev ? undefined : env.TINYLAP_ROOT ?? '/srv',
  appDir: fileURLToPath(new URL('..', import.meta.url)),
  publicUrl: env.TINYLAP_PUBLIC_URL,
  rateLimit: env.TINYLAP_RATE_LIMIT ? Number(env.TINYLAP_RATE_LIMIT) : undefined,
  clientIpHeader: env.TINYLAP_CLIENT_IP_HEADER,
  build: env.TINYLAP_BUILD,
});

const port = Number(env.PORT ?? (dev ? 8000 : 8080));
const host = dev ? '127.0.0.1' : '0.0.0.0';
createServer(handler).listen(port, host, () => console.log(`planner on http://${host}:${port}${dev ? ' (dev, no-store)' : ''}`));
```

In `apps/track-planner/package.json` scripts, replace `"dev"` and add `"start"`:

```json
"dev": "node --disable-warning=ExperimentalWarning server/main.js --dev",
"start": "node --disable-warning=ExperimentalWarning server/main.js",
```

Delete `tools/dev-server.js`. Search for other references: `grep -rn dev-server --exclude-dir=node_modules --exclude-dir=.git .` should then show only the old specs and plans under `docs/superpowers/`; leave those alone.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @tinylap/track-planner test` and `pnpm --filter @tinylap/tools test`
Expected: PASS. Then `pnpm dev`, open `http://localhost:8000/` in a browser, check that the planner works and that the console shows no CSP violation, and stop it. If no browser is available, say so in the report; the controller will ask the maintainer to check.

- [ ] **Step 9: Check and commit**

Run: `pnpm check` → green.

```bash
git add -A apps/track-planner tools
git commit -s -m "feat(track-planner): serve the planner from its own node server"
```

---

### Task 5: Layout routes

**Files:**
- Create: `apps/track-planner/server/layouts.js`, `apps/track-planner/server/pages.js` (the `shapePage` and shared `page` parts; `apiPage` follows in Task 6)
- Modify: `apps/track-planner/server/app.js`, `apps/track-planner/js/storage.js`
- Test: `apps/track-planner/test/server/layouts.test.js`, add one test to `apps/track-planner/test/storage.test.js`

**Interfaces:**
- Consumes: Task 1 keys, Task 3 store, negotiation and problems, Task 4 `problem`, `json`, `html` and the context.
- Produces:
  - `layoutRoutes` (array of routes)
  - `exportHtml(layout, { openUrl }?)`
  - `page(title, body): string` and `esc(value): string` exported from `pages.js`
  - `shapePage(listing): string`

- [ ] **Step 1: `exportHtml` takes an open link, test first**

Append to `apps/track-planner/test/storage.test.js`:

```js
test('a served export links back to the planner; a downloaded one does not', () => {
  assert.match(exportHtml(ring(), { openUrl: '/?layout=abc' }), /<a href="\/\?layout=abc">Open in planner<\/a>/);
  assert.doesNotMatch(exportHtml(ring()), /Open in planner/);
});
```

Run it → FAIL. In `js/storage.js` change the signature to `export function exportHtml(layout, { openUrl } = {})` and replace the note paragraph with:

```js
${openUrl ? `<p class="note"><a href="${openUrl}">Open in planner</a></p>` : '<p class="note">Open this file in the Circuit 30 Planner to keep editing it.</p>'}
```

Run → PASS.

- [ ] **Step 2: Write the failing route tests**

`apps/track-planner/test/server/layouts.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotKey, shapeKey, shapeOf, assignTrack } from '@tinylap/track-format';
import { exportHtml } from '../../js/storage.js';
import { startServer, closedLayout, openLayout } from './helpers.js';

const CHROME = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

const server = await startServer({ publicUrl: 'https://planner.example', build: 'b1' });
test.after(() => server.close());

const post = (body, type = 'application/json', base = server.base) =>
  fetch(`${base}/layouts`, { method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const problemOf = async (res) => {
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.status, res.status);
  assert.match(body.type, /^https:\/\/planner\.example\/problems\/[a-z-]+$/);
  return body;
};

test('posting a layout stores it once', async () => {
  const layout = closedLayout();
  const first = await post(layout);
  assert.equal(first.status, 201);
  const key = await snapshotKey(layout);
  assert.equal(first.headers.get('location'), `/layouts/${key}`);
  assert.deepEqual(await first.json(), {
    key,
    url: `https://planner.example/layouts/${key}`,
    shapeKey: await shapeKey(shapeOf(layout)),
  });
  const again = await post(layout);
  assert.equal(again.status, 200);
});

test('an exported page stores the same snapshot as its json', async () => {
  const layout = closedLayout();
  const fromHtml = await (await post(exportHtml(layout), 'text/html')).json();
  assert.equal(fromHtml.key, await snapshotKey(layout));
});

test('open layouts are stored without a shape key', async () => {
  const res = await post(openLayout());
  assert.equal(res.status, 201);
  assert.equal((await res.json()).shapeKey, null);
});

test('bad posts get problem details', async () => {
  assert.equal((await problemOf(await post('{}', 'text/plain'))).title, 'Unsupported media type');
  assert.equal((await problemOf(await post('x'.repeat(600 * 1024)))).status, 413);
  assert.match((await problemOf(await post('{"version":9,"pieces":[]}'))).detail, /newer planner/);
  assert.equal((await problemOf(await post('{oops'))).status, 422);

  const closed = closedLayout();
  const { track, ...untracked } = closed;
  assert.ok(track);
  const wrongShape = { ...closed, track: { ...track, shape: 'c30:1:other' } };
  const trackedOpen = { ...openLayout(), track };
  for (const body of [untracked, wrongShape, trackedOpen]) {
    const p = await problemOf(await post(body));
    assert.match(p.type, /track-mismatch$/);
    assert.match(p.detail, /assignTrack/);
  }
});

test('a browser gets the page, everything else gets json', async () => {
  const layout = closedLayout();
  const { key } = await (await post(layout)).json();
  const page = await fetch(`${server.base}/layouts/${key}`, { headers: { accept: CHROME } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.equal(page.headers.get('etag'), `"${key}-b1"`);
  assert.match(await page.text(), new RegExp(`href="/\\?layout=${key}"`));

  for (const accept of [undefined, '*/*', 'application/json']) {
    const res = await fetch(`${server.base}/layouts/${key}`, { headers: accept ? { accept } : {} });
    assert.equal(res.headers.get('content-type'), 'application/json', String(accept));
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(res.headers.get('etag'), `"${key}"`);
    assert.equal(res.headers.get('vary'), 'Accept');
    assert.deepEqual(await res.json(), layout);
  }
});

test('suffixes override accept, and etags give 304', async () => {
  const { key } = await (await post(closedLayout())).json();
  const asJson = await fetch(`${server.base}/layouts/${key}.json`, { headers: { accept: CHROME } });
  assert.equal(asJson.headers.get('content-type'), 'application/json');
  const asHtml = await fetch(`${server.base}/layouts/${key}.html`);
  assert.match(asHtml.headers.get('content-type'), /^text\/html/);
  const cached = await fetch(`${server.base}/layouts/${key}`, { headers: { 'if-none-match': `"${key}"` } });
  assert.equal(cached.status, 304);
  const cachedPage = await fetch(`${server.base}/layouts/${key}.html`, { headers: { 'if-none-match': `"${key}-b1"` } });
  assert.equal(cachedPage.status, 304);
});

test('unknown and malformed keys are 404 problems', async () => {
  for (const path of ['/layouts/AAAAAAAAAAAAAAAAAAAAAA', '/layouts/short', '/shapes/AAAAAAAAAAAAAAAAAAAAAA', '/shapes/x.json']) {
    assert.equal((await problemOf(await fetch(server.base + path))).status, 404, path);
  }
});

test('a shape lists every snapshot of the build, across track ids', async () => {
  const a = closedLayout();
  const b = assignTrack({ ...a, track: undefined, room: { w: 30, h: 30 } });
  assert.notEqual(a.track.id, b.track.id);
  await post(a);
  await post(b);
  const sk = await shapeKey(a.track.shape);
  const res = await fetch(`${server.base}/shapes/${sk}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  const listing = await res.json();
  assert.equal(listing.shapeKey, sk);
  assert.equal(listing.shape, a.track.shape);
  const ids = new Set(listing.layouts.map((l) => l.trackId));
  assert.ok(ids.has(a.track.id) && ids.has(b.track.id));
  const page = await fetch(`${server.base}/shapes/${sk}`, { headers: { accept: CHROME } });
  assert.match(await page.text(), new RegExp(`/layouts/${await snapshotKey(a)}`));
});

test('the api answers cross-origin and points at its description', async () => {
  const res = await post(openLayout());
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('link'), '</openapi.json>; rel="service-desc"');
  const preflight = await fetch(`${server.base}/layouts`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type');
  const wrong = await fetch(`${server.base}/layouts`, { method: 'GET' });
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'POST');
});

test('posts over the limit are refused with retry-after', async () => {
  const limited = await startServer({ rateLimit: 1 });
  try {
    assert.equal((await post(openLayout(), 'application/json', limited.base)).status, 201);
    const res = await post(openLayout(), 'application/json', limited.base);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
  } finally {
    await limited.close();
  }
});

test('a client ip header is trusted only when configured', async () => {
  const forged = (base, ip) => fetch(`${base}/layouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Fly-Client-IP': ip, 'X-Forwarded-For': ip },
    body: JSON.stringify(openLayout()),
  });
  const plain = await startServer({ rateLimit: 1 });
  const fly = await startServer({ rateLimit: 1, clientIpHeader: 'Fly-Client-IP' });
  try {
    assert.equal((await forged(plain.base, '1.1.1.1')).status, 201);
    assert.equal((await forged(plain.base, '2.2.2.2')).status, 429, 'an unconfigured header must not reset the limit');
    assert.equal((await forged(fly.base, '1.1.1.1')).status, 201);
    assert.equal((await forged(fly.base, '2.2.2.2')).status, 200, 'a configured header names the client');
  } finally {
    await plain.close();
    await fly.close();
  }
});

test('without a database the api is unavailable', async () => {
  const down = await startServer({ store: null });
  try {
    const res = await post(openLayout(), 'application/json', down.base);
    assert.equal(res.status, 503);
    assert.equal((await fetch(`${down.base}/layouts/AAAAAAAAAAAAAAAAAAAAAA`)).status, 503);
  } finally {
    await down.close();
  }
});
```

The configured-header case expects `200`: the same layout is already stored, so the second post from a different client succeeds as "already existed".

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @tinylap/track-planner test`
Expected: FAIL (404 everywhere, no routes yet).

- [ ] **Step 4: `pages.js` (shared page frame and the shape page)**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pages the server renders itself. No scripts, and palace-ui's look written
// out literally, like the export page, so they need nothing from elsewhere.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** @param {unknown} value */
export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const STYLE = `
  * { box-sizing: border-box; }
  body { font: 14px/1.5 'Space Grotesk', system-ui, sans-serif; color: #0a0a0a;
         background: #f0f0f0; margin: 0; padding: 48px 24px; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 8px; }
  h2 { font-size: 16px; font-weight: 700; margin: 40px 0 8px; }
  .subtitle { color: #666; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; font-weight: 600; margin: 0 0 32px; }
  .meta { color: #666; font-size: 12px; }
  .method { background: #0a0a0a; color: #fff; padding: 2px 6px; font-size: 12px; letter-spacing: 1px; }
  code { font: 13px ui-monospace, monospace; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 2px solid #0a0a0a; margin: 8px 0; }
  th, td { padding: 8px 12px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { font-size: 12px; white-space: nowrap; }
  ul { padding-left: 20px; }
  a { color: inherit; }
`;

/** @param {string} title @param {string} body Already escaped HTML. */
export const page = (title, body) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
<main>
${body}
</main>
</html>
`;

/** @param {{ shapeKey: string, layouts: { key: string, trackId: string, createdAt: string }[] }} listing */
export function shapePage({ shapeKey, layouts }) {
  const items = layouts
    .map((l) => `<li><a href="/layouts/${esc(l.key)}"><code>${esc(l.key)}</code></a> <span class="meta">track ${esc(l.trackId)} &middot; ${esc(l.createdAt)}</span></li>`)
    .join('\n');
  return page('One build, every snapshot', `<h1>One build</h1>
<p class="subtitle">Shape ${esc(shapeKey)}</p>
<p>Every stored snapshot of this build. Snapshots with the same track id are the same track; different track ids are separate tracks built the same way.</p>
<ul>
${items}
</ul>`);
}
```

- [ ] **Step 5: `layouts.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Snapshots and shapes. See docs/identity.md for what the keys mean.
import { canonicalJson, snapshotKey, shapeKey, shapeOf, parseLayout, layoutFromData, KEY_PATTERN } from '@tinylap/track-format';
import { exportHtml } from '../js/storage.js';
import { problem, json, html } from './app.js';
import { prefersHtml, mediaType, matchesEtag } from './negotiate.js';
import { shapePage } from './pages.js';

const MAX_BODY = 512 * 1024;
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
  return typeof value === 'string' && value ? value : request.req.socket.remoteAddress ?? 'unknown';
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

  const key = await snapshotKey(layout);
  const sk = shape ? await shapeKey(shape) : null;
  const created = request.store.put({ key, json: canonicalJson(layout), shapeKey: sk, trackId: layout.track?.id ?? null });
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
];
```

`app.js` and `layouts.js` import each other. That is safe, because neither uses the other's exports at module load. If the typechecker or a test runner trips on the cycle, move `problem`, `json`, `html` and `PAGE_CSP` into `server/responses.js` and import them from there in both files.

- [ ] **Step 6: Wire the routes**

In `app.js`, add `import { layoutRoutes } from './layouts.js';` and change the routes line to:

```js
  const routes = options.routes ?? [...layoutRoutes];
```

- [ ] **Step 7: Run the tests, check, commit**

Run: `pnpm --filter @tinylap/track-planner test` → PASS; `pnpm check` → green.

```bash
git add apps/track-planner
git commit -s -m "feat(track-planner): store and serve layout snapshots"
```

---

### Task 6: Discovery, the docs page and the contract tests

**Files:**
- Create: `apps/track-planner/server/discovery.js`, `apps/track-planner/test/server/contract.test.js`, `apps/track-planner/test/server/discovery.test.js`
- Modify: `apps/track-planner/server/pages.js` (add `apiPage`), `apps/track-planner/server/app.js`, `apps/track-planner/package.json`

**Interfaces:**
- Consumes: `openapi.json`, `PROBLEMS`, `page`, `esc`, the Task 4 response helpers, and the Task 2 schema export.
- Produces: `discoveryRoutes` and `apiPage(doc)`.

- [ ] **Step 1: Dev dependencies**

Run: `pnpm --filter @tinylap/track-planner add -D ajv@^8.20.0 ajv-formats@^3.0.1`

- [ ] **Step 2: Write the failing discovery tests**

`apps/track-planner/test/server/discovery.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import openapi from '../../server/openapi.json' with { type: 'json' };
import { startServer } from './helpers.js';

const server = await startServer({ publicUrl: 'https://planner.example' });
test.after(() => server.close());
const get = (path, init) => fetch(server.base + path, init);

test('the description and the schema are served', async () => {
  const doc = await get('/openapi.json');
  assert.equal(doc.headers.get('content-type'), 'application/vnd.oai.openapi+json;version=3.1');
  assert.deepEqual(await doc.json(), openapi);
  const schema = await get('/schemas/layout.json');
  assert.equal(schema.headers.get('content-type'), 'application/schema+json');
  assert.equal((await schema.json()).title, 'TinyLap Circuit 30 layout');
});

test('the api catalog names the description and the docs', async () => {
  const res = await get('/.well-known/api-catalog');
  assert.equal(res.headers.get('content-type'), 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"');
  const [entry] = (await res.json()).linkset;
  assert.equal(entry.anchor, 'https://planner.example/layouts');
  assert.equal(entry['service-desc'][0].href, 'https://planner.example/openapi.json');
  assert.equal(entry['service-doc'][0].href, 'https://planner.example/api');
});

test('problem types redirect to their description', async () => {
  const res = await get('/problems/track-mismatch', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/api#problem-track-mismatch');
  assert.equal((await get('/problems/nope', { redirect: 'manual' })).status, 404);
});

test('the docs page lists every operation and problem type, with no scripts', async () => {
  const res = await get('/api');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  const text = await res.text();
  assert.doesNotMatch(text, /<script/i);
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const method of Object.keys(item)) assert.ok(text.includes(`${method.toUpperCase()}</span> <code>${path.replace(/&/g, '&amp;')}</code>`), `${method} ${path}`);
  }
  for (const name of Object.keys(openapi['x-tinylap-problems'])) assert.match(text, new RegExp(`id="problem-${name}"`));
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @tinylap/track-planner test` → FAIL.

- [ ] **Step 4: `apiPage` in `pages.js`**

Append:

```js
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Renders an OpenAPI 3.1 document. Local $refs only; that is all ours uses. @param {any} doc */
export function apiPage(doc) {
  const resolve = (node) => (typeof node?.$ref === 'string' && node.$ref.startsWith('#/')
    ? node.$ref.slice(2).split('/').reduce((o, k) => o[k], doc)
    : node);

  const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((method) => {
      const op = item[method];
      const params = (op.parameters ?? []).map(resolve)
        .map((p) => `<li><code>${esc(p.name)}</code> <span class="meta">${esc(p.in)}</span> ${esc(p.description ?? '')}</li>`).join('');
      const body = op.requestBody
        ? `<p>Request body: ${Object.keys(resolve(op.requestBody).content).map((t) => `<code>${esc(t)}</code>`).join(', ')}</p>`
        : '';
      const responses = Object.entries(op.responses).map(([status, r]) => {
        const res = resolve(r);
        const types = Object.keys(res.content ?? {});
        return `<tr><th scope="row">${esc(status)}</th><td>${esc(res.description)}${types.length ? ` <span class="meta">${types.map(esc).join(', ')}</span>` : ''}</td></tr>`;
      }).join('');
      return `<section>
<h2><span class="method">${method.toUpperCase()}</span> <code>${esc(path)}</code></h2>
<p>${esc(op.summary)}</p>
${op.description ? `<p>${esc(op.description)}</p>` : ''}
${params ? `<ul>${params}</ul>` : ''}
${body}
<table><tbody>${responses}</tbody></table>
</section>`;
    }));

  const problems = Object.entries(doc['x-tinylap-problems'])
    .map(([name, p]) => `<tr id="problem-${esc(name)}"><th scope="row"><code>${esc(name)}</code><br>${p.status}</th><td><strong>${esc(p.title)}.</strong> ${esc(p.description)}</td></tr>`)
    .join('');

  return page(doc.info.title, `<h1>${esc(doc.info.title)}</h1>
<p class="subtitle">OpenAPI ${esc(doc.openapi)} &middot; <a href="/openapi.json">openapi.json</a> &middot; <a href="/schemas/layout.json">layout schema</a></p>
<p>${esc(doc.info.description)}</p>
<p><a href="${esc(doc.externalDocs.url)}">${esc(doc.externalDocs.description)}</a></p>
${operations.join('\n')}
<section id="problems">
<h2>Problem types</h2>
<p>Errors are RFC 9457 Problem Details. Their <code>type</code> ends in one of these names.</p>
<table><tbody>${problems}</tbody></table>
</section>`);
}
```

- [ ] **Step 5: `discovery.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// How a client finds out what this server is: the OpenAPI description
// (linked from every API response by rel="service-desc"), the layout schema
// it references, the RFC 9727 catalog, the problem types and the docs page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import openapi from './openapi.json' with { type: 'json' };
import { PROBLEMS } from './problems.js';
import { problem, html } from './app.js';
import { apiPage } from './pages.js';

const DESCRIPTION = JSON.stringify(openapi);
const SCHEMA = readFileSync(fileURLToPath(import.meta.resolve('@tinylap/track-format/layout.schema.json')), 'utf8');
const DOCS = apiPage(openapi);
const fresh = { 'Cache-Control': 'no-cache' };

const catalog = (request) => ({
  status: 200,
  headers: { 'Content-Type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"', ...fresh },
  body: JSON.stringify({
    linkset: [{
      anchor: `${request.origin}/layouts`,
      'service-desc': [{ href: `${request.origin}/openapi.json`, type: 'application/vnd.oai.openapi+json' }],
      'service-doc': [{ href: `${request.origin}/api`, type: 'text/html' }],
    }],
  }),
});

export const discoveryRoutes = [
  { pattern: /^\/openapi\.json$/, methods: { GET: () => ({ status: 200, headers: { 'Content-Type': 'application/vnd.oai.openapi+json;version=3.1', ...fresh }, body: DESCRIPTION }) } },
  { pattern: /^\/schemas\/layout\.json$/, methods: { GET: () => ({ status: 200, headers: { 'Content-Type': 'application/schema+json', ...fresh }, body: SCHEMA }) } },
  { pattern: /^\/\.well-known\/api-catalog$/, methods: { GET: catalog } },
  {
    pattern: /^\/problems\/([^/]+)$/,
    methods: {
      GET: (request, [, name]) => (Object.hasOwn(PROBLEMS, name)
        ? { status: 302, headers: { Location: `/api#problem-${name}`, ...fresh } }
        : problem(request, 'not-found', 'There is no such problem type.')),
    },
  },
  { pattern: /^\/api$/, methods: { GET: () => html(200, DOCS, fresh) } },
];
```

In `app.js`: `import { discoveryRoutes } from './discovery.js';` and `const routes = options.routes ?? [...layoutRoutes, ...discoveryRoutes];`.

- [ ] **Step 6: Run the discovery tests**

Run: `pnpm --filter @tinylap/track-planner test` → the discovery tests PASS.

- [ ] **Step 7: The contract test**

`apps/track-planner/test/server/contract.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Keeps openapi.json honest: every response below is checked against what
// the description says for its path, method and status, and every response
// the description documents must have been produced at least once.
import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import openapi from '../../server/openapi.json' with { type: 'json' };
import layoutSchema from '@tinylap/track-format/layout.schema.json' with { type: 'json' };
import { snapshotKey, shapeKey } from '@tinylap/track-format';
import { mediaType } from '../../server/negotiate.js';
import { startServer, closedLayout, openLayout } from './helpers.js';

const BASE = 'http://tinylap.test';
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(layoutSchema, `${BASE}/schemas/layout.json`);

const local = (ref) => ref.slice(2).split('/').reduce((o, k) => o[k], openapi);
const deref = (node) => {
  if (Array.isArray(node)) return node.map(deref);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) return deref(local(node.$ref));
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(v)]));
};

// Longest first, so /layouts/{key}.json wins over /layouts/{key}.
const templates = Object.keys(openapi.paths)
  .map((path) => ({ path, re: new RegExp(`^${path.replace(/[.]/g, '\\.').replace(/\{[^}]+\}/g, '[^/]+')}$`) }))
  .sort((a, b) => b.path.length - a.path.length);

const seen = new Set();
let schemas = 0;

async function check(method, url, res) {
  const path = new URL(url).pathname;
  const template = templates.find((t) => t.re.test(path));
  assert.ok(template, `undocumented path ${path}`);
  const op = deref(openapi.paths[template.path])[method.toLowerCase()];
  assert.ok(op, `undocumented ${method} ${template.path}`);
  const documented = op.responses[String(res.status)];
  assert.ok(documented, `${method} ${template.path} does not document ${res.status}`);
  seen.add(`${method} ${template.path} ${res.status}`);
  const text = await res.text();
  if (!documented.content) return assert.equal(text, '', `${res.status} has an undocumented body`);
  const type = mediaType(res.headers.get('content-type'));
  const media = documented.content[type];
  assert.ok(media, `${method} ${template.path} ${res.status} does not document ${type}`);
  if (!type.endsWith('json')) return;
  const validate = ajv.compile({ $id: `${BASE}/r/${schemas++}`, ...media.schema });
  assert.ok(validate(JSON.parse(text)), `${method} ${path} ${res.status}: ${ajv.errorsText(validate.errors)}`);
}

const CHROME = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

test('every response matches the description', async () => {
  const up = await startServer();
  const limited = await startServer({ rateLimit: 0 });
  const down = await startServer({ store: null });
  const call = async (base, method, path, init = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', ...init });
    await check(method, base + path, res);
    return res;
  };
  const postJson = (base, body) => call(base, 'POST', '/layouts', { headers: { 'Content-Type': 'application/json' }, body });
  try {
    const layout = closedLayout();
    const key = await snapshotKey(layout);
    const sk = await shapeKey(layout.track.shape);
    const missing = 'AAAAAAAAAAAAAAAAAAAAAA';

    await postJson(up.base, JSON.stringify(layout));            // 201
    await postJson(up.base, JSON.stringify(layout));            // 200
    await postJson(up.base, JSON.stringify(openLayout()));
    await call(up.base, 'POST', '/layouts', { headers: { 'Content-Type': 'text/plain' }, body: 'x' });  // 415
    await postJson(up.base, 'x'.repeat(600 * 1024));            // 413
    await postJson(up.base, '{oops');                           // 422
    await postJson(limited.base, JSON.stringify(layout));       // 429
    await postJson(down.base, JSON.stringify(layout));          // 503

    for (const suffix of ['', '.json', '.html']) {
      const res = await call(up.base, 'GET', `/layouts/${key}${suffix}`, { headers: { accept: CHROME } });
      await call(up.base, 'GET', `/layouts/${key}${suffix}`, { headers: { 'if-none-match': res.headers.get('etag') } });
      await call(up.base, 'GET', `/layouts/${missing}${suffix}`);
      await call(down.base, 'GET', `/layouts/${key}${suffix}`);
    }
    await call(up.base, 'GET', `/layouts/${key}`);
    await call(up.base, 'GET', `/shapes/${sk}`);
    await call(up.base, 'GET', `/shapes/${sk}`, { headers: { accept: CHROME } });
    await call(up.base, 'GET', `/shapes/${missing}`);
    await call(down.base, 'GET', `/shapes/${sk}`);
    for (const path of ['/openapi.json', '/schemas/layout.json', '/.well-known/api-catalog', '/api', '/problems/too-large', '/problems/nope']) {
      await call(up.base, 'GET', path);
    }
  } finally {
    await Promise.all([up.close(), limited.close(), down.close()]);
  }
});

test('every documented response was produced', () => {
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const [method, op] of Object.entries(item)) {
      for (const status of Object.keys(op.responses)) {
        assert.ok(seen.has(`${method.toUpperCase()} ${path} ${status}`), `${method.toUpperCase()} ${path} ${status} was never produced`);
      }
    }
  }
});
```

`rateLimit: 0` means every post is refused. `rateLimiter` already handles this, because `w.count >= 0` is always true.

- [ ] **Step 8: Run, fix the description or the server until both tests pass**

Run: `pnpm --filter @tinylap/track-planner test`
Expected: PASS. A mismatch means the description and the server disagree. Fix whichever is wrong against the spec, and never loosen the contract check.

- [ ] **Step 9: Check and commit**

Run: `pnpm check` → green.

```bash
git add apps/track-planner pnpm-lock.yaml
git commit -s -m "feat(track-planner): describe the API with OpenAPI and check it"
```

---

### Task 7: Share and open links in the planner

**Files:**
- Create: `apps/track-planner/js/share.js`, `apps/track-planner/test/share.test.js`
- Modify: `apps/track-planner/js/app.js`, `apps/track-planner/index.html`

**Interfaces:**
- Consumes: `parseLayout`, `KEY_PATTERN` (Task 1); `prepareExport`, `importHtml` (existing); `POST /layouts`, `GET /layouts/<key>.json` (Task 5).
- Produces:
  - `shareLayout(layout, { fetch? }) → Promise<string>`, the absolute share URL
  - `fetchShared(key, { fetch? }) → Promise<Layout>`

- [ ] **Step 1: Write the failing tests**

`apps/track-planner/test/share.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, assignTrack, stockL } from '@tinylap/track-format';
import { shareLayout, fetchShared } from '../js/share.js';

const layout = () => assignTrack(createLayout({ pieces: stockL() }));
const reply = (status, body, type = 'application/json') => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': type } });

test('sharing posts the layout as json and returns the link', async () => {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, init });
    return reply(201, { key: 'k', url: 'https://p.example/layouts/k', shapeKey: null })();
  };
  const l = layout();
  assert.equal(await shareLayout(l, { fetch }), 'https://p.example/layouts/k');
  assert.equal(sent[0].url, '/layouts');
  assert.equal(sent[0].init.method, 'POST');
  assert.equal(sent[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(sent[0].init.body), l);
});

test('a refused share throws the problem title', async () => {
  const fetch = reply(429, { type: 'x', title: 'Too many layouts posted', status: 429 }, 'application/problem+json');
  await assert.rejects(shareLayout(layout(), { fetch }), /Too many layouts posted/);
});

test('a share that never reaches the server says so', async () => {
  const fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(shareLayout(layout(), { fetch }), /could not reach/i);
  const html = reply(502, '<html>bad gateway</html>', 'text/html');
  await assert.rejects(shareLayout(layout(), { fetch: html }), /502/);
});

test('opening a shared layout fetches its json', async () => {
  const l = layout();
  const urls = [];
  const fetch = async (url) => { urls.push(url); return reply(200, l)(); };
  assert.deepEqual(await fetchShared('AAAAAAAAAAAAAAAAAAAAAA', { fetch }), l);
  assert.deepEqual(urls, ['/layouts/AAAAAAAAAAAAAAAAAAAAAA.json']);
});

test('a malformed key is refused without a request', async () => {
  const fetch = async () => assert.fail('no request expected');
  await assert.rejects(fetchShared('../x', { fetch }), /not point to a layout/);
});

test('an unknown key throws the problem title', async () => {
  const fetch = reply(404, { type: 'x', title: 'Not found', status: 404 }, 'application/problem+json');
  await assert.rejects(fetchShared('AAAAAAAAAAAAAAAAAAAAAA', { fetch }), /Not found/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @tinylap/track-planner test` → FAIL.

- [ ] **Step 3: `share.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The planner's side of the snapshot API. Paths are absolute, so they reach
// the server's /layouts whatever <base href> the page has.
import { parseLayout, KEY_PATTERN } from '@tinylap/track-format';

/** @import { Layout } from '@tinylap/track-format' */

async function request(fetch, url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Could not reach the planner server. Check your connection and try again.');
  }
  if (res.ok) return res;
  const problem = await res.json().catch(() => null);
  throw new Error(problem?.title ?? `The planner server answered ${res.status}.`);
}

/**
 * Stores the layout as a snapshot. Settle its track first (prepareExport),
 * as the server refuses a closed loop without one.
 * @param {Layout} layout @returns {Promise<string>} the link to share
 */
export async function shareLayout(layout, { fetch = globalThis.fetch } = {}) {
  const res = await request(fetch, '/layouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
  return (await res.json()).url;
}

/** @param {string} key @returns {Promise<Layout>} */
export async function fetchShared(key, { fetch = globalThis.fetch } = {}) {
  if (!KEY_PATTERN.test(key)) throw new Error('This link does not point to a layout.');
  const res = await request(fetch, `/layouts/${key}.json`);
  return parseLayout(await res.text());
}
```

Run the tests → PASS.

- [ ] **Step 4: Wire it into the page**

`index.html`: between the Open and Save buttons add

```html
      <button type="button" class="btn btn-sm btn-secondary" id="btn-share">Share</button>
```

and change the file input to `accept=".html,.json,text/html,application/json"`.

`js/app.js`:

1. Imports: change the storage import to `import { prepareExport, carryTrack } from './storage.js';`, add `import { parseLayout } from '@tinylap/track-format';` to the existing package import list (append `parseLayout`), and add `import { shareLayout, fetchShared } from './share.js';`.
2. State: after `error: null, ...` add `notice: null,     // a success message (e.g. a copied share link), shown when there is no error`.
3. `renderStatus()`: directly after the `if (state.error) { ... return; }` block add:

```js
  if (state.notice) {
    status.textContent = state.notice;
    status.className = 'status status-success';
    return;
  }
```

4. `commit()`: next to `state.error = null;` add `state.notice = null;`.
5. Split `loadFile` so a link and a file open the same way. Keep the existing comments and move the body after a successful parse into `adoptLayout(imported)`:

```js
function adoptLayout(imported) {
  state.history.push(structuredClone(state.layout));
  state.layout = imported;
  // ...the existing lines from `state.selection = [];` to `render();`, unchanged...
}

async function loadFile(file) {
  if (!file) return;
  // (existing C1 comment)
  let imported;
  try {
    imported = parseLayout(await file.text());
  } catch (error) {
    // (existing comment)
    state.error = error.message;
    render();
    return;
  }
  adoptLayout(imported);
}
```

Set `state.notice = null;` inside `adoptLayout` next to `state.error = null;`. `parseLayout` replaces `importHtml` here: it reads HTML exactly as `importHtml` did, and JSON as well.

6. Share button, after the Save handler:

```js
// Sharing settles the track exactly as Save does, then stores the result as
// a snapshot. The layout itself is never touched by a failed share.
document.querySelector('#btn-share').addEventListener('click', async () => {
  const { layout } = prepareExport(state.layout);
  state.layout = layout;
  saveLayout(sessionStorage, state.layout);
  try {
    const url = await shareLayout(state.layout);
    const copied = await navigator.clipboard?.writeText(url).then(() => true, () => false);
    state.error = null;
    state.notice = copied ? `Link copied: ${url}` : `Share link: ${url}`;
  } catch (error) {
    state.notice = null;
    state.error = error.message;
  }
  render();
});
```

7. Opening a link, at the end of the file:

```js
// /?layout=<key> opens a shared snapshot like a file: one undo step, its
// track adopted. The parameter is dropped either way, so a reload does not
// open it again over later edits.
const sharedKey = new URLSearchParams(location.search).get('layout');
if (sharedKey) {
  history.replaceState(null, '', location.pathname);
  fetchShared(sharedKey).then(adoptLayout, (error) => {
    state.error = error.message;
    render();
  });
}
```

8. Check for other uses of `importHtml` in `app.js` (for example, a drop handler). Route them through `loadFile` or `parseLayout` too, so dropped `.json` files open as well. Leave the `importHtml` export in `storage.js` alone; tests use it.

- [ ] **Step 5: Run the tests and try it**

Run: `pnpm --filter @tinylap/track-planner test` → PASS. Then run `pnpm dev`. In a browser, build or pick a closed layout, press Share, and check that the status shows the copied link. Open that link (you get the export page), follow "Open in planner", and check the layout loads. Then open `/?layout=AAAAAAAAAAAAAAAAAAAAAA` and check for "Not found" with the layout untouched. Open a `.json` file saved from `/layouts/<key>.json`. If no browser is available, say so in the report.

- [ ] **Step 6: Check and commit**

Run: `pnpm check` → green.

```bash
git add apps/track-planner
git commit -s -m "feat(track-planner): share layouts as links and open them"
```

---

### Task 8: Deployment, smoke test and documentation

**Files:**
- Modify: `apps/track-planner/Dockerfile`, `apps/track-planner/fly.toml`, `.github/workflows/ci.yml`, `README.md`, `packages/track-format/README.md`, `docs/superpowers/specs/2026-10-14-planner-server-design.md`
- Delete: `apps/track-planner/Caddyfile`
- Create: `apps/track-planner/test/smoke-api.js`, `docs/identity.md`

- [ ] **Step 1: The image**

`apps/track-planner/Dockerfile`:

```dockerfile
# SPDX-FileCopyrightText: 2026 The TinyLap contributors
#
# SPDX-License-Identifier: AGPL-3.0-or-later

# One stage installs and assembles; the second runs the server with the
# assembled app in /srv and the server's own modules from /repo.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@tinylap/track-planner..."
ARG GIT_SHA
RUN node tools/assemble.js apps/track-planner /out "$GIT_SHA"

FROM node:24-alpine
WORKDIR /repo
COPY --from=build /repo /repo
COPY --from=build /out /srv
# The volume is mounted here on Fly; without one (CI, a quick local run) the
# database lives in the container and is lost with it.
RUN mkdir -p /data
ARG GIT_SHA
ENV NODE_ENV=production TINYLAP_BUILD=$GIT_SHA
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/track-planner/server/main.js"]
```

Keep the existing SPDX header lines exactly as the current Dockerfile has them, if they differ from the above.

The container runs as root because Fly mounts volumes root-owned. Add that as a comment above `RUN mkdir`.

Delete `apps/track-planner/Caddyfile`.

- [ ] **Step 2: Fly**

In `apps/track-planner/fly.toml`, add:

```toml
[env]
  TINYLAP_PUBLIC_URL = 'https://circuit30-planner.fly.dev'
  TINYLAP_CLIENT_IP_HEADER = 'Fly-Client-IP'

# SQLite on one volume means exactly one machine. Fly snapshots the volume
# daily; that is the backup. Create it once:
#   fly volumes create tinylap_data --app circuit30-planner --region fra --size 1
[mounts]
  source = 'tinylap_data'
  destination = '/data'
```

Replace the VM comment's "It is Caddy serving 580 KB of static files" with "It is one Node process serving a small app and a SQLite file". Keep the rest.

Check the real public hostname. If the README or a custom domain says something other than `circuit30-planner.fly.dev`, use that, and say which in the report.

- [ ] **Step 3: The API smoke test**

`apps/track-planner/test/smoke-api.js` (not a `*.test.js`, so `pnpm test` skips it; it needs no install):

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Against a running image: a layout goes in, and comes back as JSON and as
// a page. Self-contained, so CI can run it without installing anything.
const base = new URL(process.argv[2] ?? 'http://localhost:8080/');
const layout = { version: 2, unit: 'mat', room: null, pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] };
const failures = [];
const expect = (ok, msg) => { if (!ok) failures.push(msg); };

const posted = await fetch(new URL('layouts', base), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(layout),
});
expect(posted.status === 201 || posted.status === 200, `POST /layouts -> ${posted.status}`);
const { key } = await posted.json();

const asJson = await fetch(new URL(`layouts/${key}`, base));
expect(asJson.headers.get('content-type') === 'application/json', `json content-type ${asJson.headers.get('content-type')}`);
expect(JSON.stringify(await asJson.json()) === JSON.stringify(layout), 'json round trip');

const asHtml = await fetch(new URL(`layouts/${key}`, base), { headers: { accept: 'text/html' } });
expect(/^text\/html/.test(asHtml.headers.get('content-type') ?? ''), `html content-type ${asHtml.headers.get('content-type')}`);
expect((await asHtml.text()).includes(`?layout=${key}`), 'page links back to the planner');

const doc = await fetch(new URL('openapi.json', base));
expect(doc.status === 200, `GET /openapi.json -> ${doc.status}`);

console.log(`api smoke: posted ${key}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
```

In `.github/workflows/ci.yml`, in the `smoke` job, after the `node tools/smoke.js` step add:

```yaml
      - run: node apps/track-planner/test/smoke-api.js http://localhost:8080/
```

and change `sleep 2` to `sleep 3`, because Node starts slightly slower than Caddy.

Build and run locally if Docker is available:

```bash
docker build -f apps/track-planner/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t planner .
docker run -d --rm -p 8080:8080 --name planner-smoke planner && sleep 3
node tools/smoke.js http://localhost:8080/ && node apps/track-planner/test/smoke-api.js http://localhost:8080/
docker stop planner-smoke
```

Expected: both scripts print and exit 0. If `tools/smoke.js` fails on the `.gz` files or on a header, fix the server, not the smoke test.

- [ ] **Step 4: `docs/identity.md`**

```markdown
# Snapshots, tracks and shapes

A TinyLap layout can be named three ways. Each answers a different question,
and mixing them up is the most common mistake when building against the
planner's API.

| Identifier | Answers | Changes when | Used for |
| --- | --- | --- | --- |
| **Snapshot key** | "this exact file" | anything in the layout changes | sharing links: `/layouts/<key>` |
| **Track id** | "this track, as its owner keeps it" | the built geometry changes | leaderboards at one venue |
| **Shape key** | "this build, wherever and however it was made" | the built geometry changes | finding the same build anywhere: `/shapes/<key>` |

## Snapshot key

A snapshot is one layout, frozen. Its key is computed from its content:

1. Read the layout with `layoutFromData` and sort its pieces by `y`, `x`, `type`, `rot`.
2. `JSON.stringify` it. That is the canonical JSON (`canonicalJson`).
3. SHA-256 the UTF-8 bytes, keep the first 16 bytes, and write them as base64url without padding: 22 characters (`snapshotKey`).

The same layout always gets the same key, however its pieces were listed, so
sharing twice gives the same link. Move a piece, change the room, add a
track block, and it is a different snapshot with a different link. Snapshots
are never edited or deleted, so a link always shows what was shared.

## Track id

`track.id` is a random UUID that the planner settles whenever a layout leaves
as a file or a link (`assignTrack`). It stays as long as the shape does. Moving
the whole layout, turning it, changing the room or describing the same build
with other pieces keeps it. Changing what is built issues a new one: a new
track, with its own leaderboards. Only a single closed loop has a track.

Many snapshots can share one track id. A track id proves no ownership, though:
anyone can post a snapshot carrying any id, as long as the shape matches.

## Shape key

`shapeOf(layout)` fingerprints what is physically built: covered cells,
barriers and corner caps, normalised for position and quarter turns, not for
mirroring (a mirrored track turns the other way, so it is a different track).
`shapeKey(shape)` hashes that string the same way as a snapshot key.

Many track ids can share one shape: two people who built the same thing
independently, or one who lost the file and built it again. A shape key says
"built the same". It does not say "the same venue".

## Examples

**Sharing a link.** Press Share in the planner. It settles the track, posts
the layout and copies `…/layouts/<key>`. Whoever opens it sees the drawing
and the bill of materials, and can open it in their own planner.

**Two friends who lost the link.** Both still have the layout in their app.
Each computes `shapeKey(shapeOf(layout))` locally, with no server and no link,
and gets the same key. `/shapes/<key>` lists every stored snapshot of that
build, so they find each other's, even if one of them rebuilt it by hand and
has a different track id.

**An online race** (planned). A race is defined by shape key, direction and
number of laps. Every venue whose layout has that shape can take part, and
the results merge. Each venue's own leaderboard stays keyed by venue and
track id (`leaderboardKey`).

## Getting a layout

Every URL serves JSON to programs and HTML to browsers (content negotiation
on `Accept`; `.json` or `.html` force one). The full API is described at
`/openapi.json`, readable at `/api`, and the file format is JSON Schema at
`/schemas/layout.json`.
```

- [ ] **Step 5: READMEs and the spec's file tree**

Root `README.md`: add a "Self-hosting the planner" section:

````markdown
## Self-hosting the planner

The planner is one Node 24 process: it serves the app and stores shared layouts in SQLite.

```sh
docker build -f apps/track-planner/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t tinylap-planner .
docker run -p 8080:8080 -v tinylap-data:/data -e TINYLAP_PUBLIC_URL=https://planner.example tinylap-planner
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on |
| `TINYLAP_DB` | `/data/tinylap.sqlite` | SQLite file (`:memory:` for none) |
| `TINYLAP_PUBLIC_URL` | the request's `Host` | Origin used in share links |
| `TINYLAP_RATE_LIMIT` | `30` | Posts per hour per client |
| `TINYLAP_CLIENT_IP_HEADER` | none | Header carrying the client IP behind a proxy (`Fly-Client-IP` on Fly). Unset means the socket address; never set it without a proxy that overwrites it. |

The API is described at `/openapi.json` and `/api`. See [docs/identity.md](docs/identity.md) for snapshots, tracks and shapes. For development, `pnpm dev` serves the source on `http://localhost:8000` with an in-memory database.
````

If the README already describes `pnpm dev` or the Caddy setup elsewhere, update those lines to match.

In `docs/superpowers/specs/2026-10-14-planner-server-design.md` §4, make the file tree match what was built: add `layouts.js` (snapshot and shape routes), `discovery.js` (description, schema, catalog, problem types, docs page) and `static.js`'s planner CSP. Also note that `/shapes/<key>` negotiates by `Accept` only, without suffixes.

- [ ] **Step 6: Check, REUSE, commit**

Run: `pnpm check` → green; `pipx run reuse lint` (or `uvx reuse lint`) → compliant.

```bash
git add -A apps/track-planner .github docs README.md packages/track-format/README.md
git commit -s -m "feat(track-planner): deploy the node server with a volume and document identities"
```

The Fly volume `tinylap_data` already exists (created 2026-10-14), and the app is scaled to one machine. That machine was created without a volume: if the first deploy with `[mounts]` refuses to attach it, the controller destroys that one machine (`fly machine destroy <id> --app circuit30-planner`) and re-runs the deploy, after asking the maintainer.
