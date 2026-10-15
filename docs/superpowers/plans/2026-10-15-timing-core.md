# Timing Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web app that times laps from a decoder (over USB through a browser tab, and over Wi-Fi), turns passings into practice, qualifying and race results, and shows them live on any screen, including a public watchers view.

**Architecture:** A pure library `packages/timing` (passings, laps, session rules, ZRound protocol, a decoder simulator) shared by a new Node server `apps/timing` (`node:http` + `node:sqlite`, the planner's structure, login through `accounts`) and its browser app (palace-ui, plain ES modules, import maps). The server is the authority: it stores passings once, whichever transport delivers them, computes crossings and sessions, and streams events over SSE.

**Tech Stack:** Node 24, `node:sqlite`, `node:test`, plain JS checked by `tsc --checkJs`, `@tinylap/auth` (BFF login, permissions, rate limits), `@tinylap/track-format` (tracks), palace-ui + `@tinylap/design`, Web Serial, IndexedDB, EventSource, playwright-core with Chrome.

**Spec:** `docs/superpowers/specs/2026-10-15-timing-core-design.md`

## Global Constraints

- Node `>=24`; pnpm `10.34.7`; no bundler, no framework, no new runtime dependencies.
- Licenses: `packages/timing` is `MPL-2.0`; `apps/timing` and `tools/` are `AGPL-3.0-or-later`. Every new `.js` file starts with the SPDX header used in its folder (copy it from a neighbouring file).
- Every UI is palace-ui plus `@tinylap/design` (`AGENTS.md`). **Use the `frontend-design` skill for every task that touches UI** (Tasks 16–18), and within palace's classes and tokens.
- Commits: conventional messages, `git commit -s`, author email `1009814+jostsg@users.noreply.github.com`, **no AI attribution of any kind** (no `Co-Authored-By`, no "Generated with").
- Times: decoder `t` is **milliseconds** since boot; server times are epoch milliseconds (`Date.now()`).
- Defaults from the spec: `minLap` 1500 ms, `maxLap` 60 000 ms, practice split after 30 min without a passing, qualifying and race 5 min, race countdown 10 s, batch ≤ 500 passings, SSE replay window 10 min, heartbeat 15 s, ZRound serial 19200 8N1.
- Before each commit: `pnpm --filter <package> test`, `pnpm --filter <package> lint`, `pnpm --filter <package> typecheck` for the packages the task touched.
- Package names: the library is `@tinylap/timing` (private for now, `version` `0.0.0`); the app is `@tinylap/timing-app`.

## Review Focus

1. **Server restart in the middle of a race:** the race must finish normally from what is stored (crossings are replayed, the tick resumes). Test in Task 10.
2. **Decoder reboot in the middle of a race:** the first crossing after the reboot is a start, not a lap; the driver keeps their laps and the next lap counts. Test in Task 10.
3. **Deleting a driver who has laps:** their transponders become unassigned, their old laps stay and the board shows "former driver". Tests in Task 12 and Task 16.
4. **Rotating the watchers link while people watch:** open watcher streams on the old token must close, and the old token must 404. Test in Task 14.
5. **A screen whose clock is off:** countdown and session clocks use the server's `now` from the snapshot, not the device clock. Test in Task 16.

---

## File Structure

```
packages/timing/                 MPL-2.0, pure, Node + browser
  package.json, tsconfig.json, README.md
  index.js                       re-exports
  types.d.ts                     shared types
  passing.js                     ids, transponder codes, batch validation, passing key
  laps.js                        nextLap / lapsOf: start, lap, double read, parked, backwards
  sessions.js                    applyCrossing, standings, isComplete: practice, qualifying, race
  zround.js                      ZRound Free LapCounter + TinyLap %TL… extension: reader, parser, commands
  simulator.js                   a fake decoder: cars, laps, TinyLap/ZRound replies
  test/*.test.js

apps/timing/                     AGPL-3.0-or-later
  package.json, tsconfig.json, turbo.json, Dockerfile, fly.toml
  index.html, css/app.css
  js/main.js                     router: login, workspace, views, watch mode
  js/api.js                      fetch wrappers
  js/dom.js                      h(): builds elements without parsing HTML
  js/format.js                   lap and clock formatting
  js/view.js                     live view model: applyEvent (pure)
  js/live.js                     EventSource connection
  js/board.js                    live board and watchers view rendering
  js/control.js                  race control
  js/tap.js                      tap entry
  js/setup.js                    drivers, transponders, decoders, track, watchers link
  js/outbox.js                   IndexedDB outbox (+ memory fallback)
  js/bridge.js                   Bridge: Web Serial ↔ server
  js/sim-port.js                 a SerialPort look-alike driven by the simulator (?simulate)
  js/bridge-view.js              bridge screen and pairing
  server/main.js                 env, wiring, tick
  server/app.js                  handler (planner's, plus streaming responses)
  server/routes.js               the route list
  server/responses.js, problems.js, negotiate.js, static.js, pages.js, feed.js, auth.js   (copied from the planner)
  server/discovery.js            openapi.json, catalog, problems, /api
  server/openapi.json            the API description and problem types
  server/body.js                 JSON body reading
  server/access.js               workspaceRoute(): session, membership, role, same-origin
  server/store.js                SQLite schema and queries
  server/live.js                 createHub: event log, replay, watcher filtering
  server/engine.js               passings → crossings, sessions, tick, snapshot
  server/planner.js              fetchTrack from the configured planner
  server/workspace.js            GET /workspaces/{id}
  server/setup.js                drivers, transponders, decoders, track, watch token routes
  server/ingest.js               POST /decoders/{id}/passings, POST /workspaces/{id}/tap
  server/control.js              sessions routes
  server/stream.js               SSE routes, watch routes
  test/*.test.js                 browser-side unit tests (node)
  test/server/*.test.js          server tests (node, real accounts)
  test/browser/*.test.js         Playwright

packages/auth/permissions.js, types.d.ts, README.md   timing.run, timing.setup, timing.delete
tools/decoder-sim.js             CLI: net mode and ZRound-on-stdio mode
tools/test/decoder-sim.test.js
docs/timing.md                   passing format, ingest API, ZRound extension
README.md, .github/workflows/ci.yml
```

---

### Task 1: Timing permissions in `@tinylap/auth`

**Files:**
- Modify: `packages/auth/permissions.js` (the `MATRIX` object)
- Modify: `packages/auth/types.d.ts` (the `Action` union)
- Modify: `packages/auth/README.md` (the permission matrix table)
- Test: `packages/auth/test/timing-permissions.test.js`

**Interfaces:**
- Produces: actions `'timing.run'` (owner, admin, member), `'timing.setup'` (owner, admin, member), `'timing.delete'` (owner, admin), usable with `can(claims, workspaceId, action)`.

- [ ] **Step 1: Write the failing test**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, can } from '../index.js';

const as = (role) => ({ workspaces: [{ id: 'w1', role }] });

test('every member may run timing and change its setup', () => {
  for (const role of ['owner', 'admin', 'member']) {
    assert.equal(can(as(role), 'w1', 'timing.run'), true, role);
    assert.equal(can(as(role), 'w1', 'timing.setup'), true, role);
  }
});

test('only owners and admins may delete drivers and decoders', () => {
  assert.equal(can(as('owner'), 'w1', 'timing.delete'), true);
  assert.equal(can(as('admin'), 'w1', 'timing.delete'), true);
  assert.equal(can(as('member'), 'w1', 'timing.delete'), false);
});

test('the timing actions are listed and need membership', () => {
  for (const action of ['timing.run', 'timing.setup', 'timing.delete']) assert.ok(ACTIONS.includes(action), action);
  assert.equal(can(as('owner'), 'w2', 'timing.run'), false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/auth test`
Expected: FAIL in `timing-permissions.test.js` (`can` returns false for unknown actions).

- [ ] **Step 3: Add the actions**

In `packages/auth/permissions.js`, add to `MATRIX` after `'club.leave'`:

```js
  'timing.run': ['owner', 'admin', 'member'],
  'timing.setup': ['owner', 'admin', 'member'],
  'timing.delete': ['owner', 'admin'],
```

In `packages/auth/types.d.ts`, extend `Action` after `| 'club.leave'`:

```ts
  | 'timing.run'
  | 'timing.setup'
  | 'timing.delete';
```

(and remove the `;` that ended the `'club.leave'` line).

In `packages/auth/README.md`, add three rows to the permission matrix table after `club.leave`:

```markdown
| `timing.run` (watch, run sessions, tap, bridge) | ✓ | ✓ | ✓ |
| `timing.setup` (drivers, transponders, pairing, track) | ✓ | ✓ | ✓ |
| `timing.delete` (drivers, decoders) | ✓ | ✓ | |
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tinylap/auth test && pnpm --filter @tinylap/accounts test`
Expected: PASS (accounts reads `ACTIONS`; it must not break).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm --filter @tinylap/auth lint && pnpm --filter @tinylap/auth typecheck
git add packages/auth
git commit -s -m "feat(auth): add the timing permissions"
```

---

### Task 2: `packages/timing` with passings

**Files:**
- Create: `packages/timing/package.json`, `packages/timing/tsconfig.json`, `packages/timing/README.md`, `packages/timing/index.js`, `packages/timing/types.d.ts`, `packages/timing/passing.js`
- Test: `packages/timing/test/passing.test.js`

**Interfaces:**
- Produces (from `@tinylap/timing`):
  - `DECODER_ID: RegExp` (`/^[A-Za-z0-9_-]{1,64}$/`), `BOOT_ID: RegExp` (`/^[A-Za-z0-9_-]{8,32}$/`), `TRANSPONDER: RegExp` (`/^[0-9A-F]{1,16}$/`), `MAX_BATCH = 500`
  - `transponderCode(value: unknown): string | null`
  - `passingKey(p: Passing): string`
  - `readBatch(value: unknown): { ok: true, batch: Batch } | { ok: false, error: string }`
  - `randomBoot(): string` (11 base64url characters)
  - types in `types.d.ts`: `Passing`, `Batch`, `Mark`, `LapStep`, `SessionKind`, `SessionRules`, `Crossing`, `DriverState`, `SessionState`, `Standing`, `ZroundMessage`

- [ ] **Step 1: Scaffold the package**

`packages/timing/package.json`:

```json
{
  "name": "@tinylap/timing",
  "version": "0.0.0",
  "private": true,
  "description": "Turn timing passings into laps, sessions and results, and read the ZRound lap counter protocol.",
  "license": "MPL-2.0",
  "type": "module",
  "exports": {
    ".": {
      "source": "./index.js",
      "default": "./index.js"
    },
    "./types": {
      "types": "./types.d.ts"
    }
  },
  "scripts": {
    "test": "node --test 'test/**/*.test.js'",
    "typecheck": "tsc -p tsconfig.json",
    "lint": "eslint ."
  }
}
```

`packages/timing/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "strict": true }, "include": ["*.js", "types.d.ts"] }
```

`packages/timing/types.d.ts`:

```ts
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

/** One car crossing the line, as a decoder reports it (spec §4). */
export interface Passing {
  decoder: string;
  boot: string;
  transponder: string;
  /** Milliseconds on the decoder's clock since `boot`. */
  t: number;
}

/** An ingest batch: one boot of one decoder (spec §5). */
export interface Batch {
  boot: string;
  passings: { transponder: string; t: number }[];
}

/** The decoder-time position of a passing, for lap arithmetic. */
export interface Mark {
  boot: string;
  t: number;
}

/** What one passing means for its transponder (laps.js). */
export type LapStep =
  | { kind: 'start'; reference: Mark }
  | { kind: 'lap'; ms: number; reference: Mark }
  | { kind: 'double'; reference: Mark }
  | { kind: 'backwards'; reference: Mark };

export type SessionKind = 'practice' | 'qualifying' | 'race';

/** What sessions.js needs to know about a session. Times are server epoch ms. */
export interface SessionRules {
  kind: SessionKind;
  /** Driver ids, or null for practice (anyone). */
  roster: string[] | null;
  /** Qualifying: the window opens. Race: "go". Practice: unused. */
  opensAt: number | null;
  /** Qualifying: the window closes. Race: time is up. Practice: null. */
  closesAt: number | null;
}

/** A passing as a session sees it. */
export interface Crossing {
  driverId: string | null;
  /** Server time of the passing (decoder time mapped, spec §6). */
  at: number;
  /** The lap this passing completes, or null (start, double read, parked car). */
  lapMs: number | null;
}

export interface DriverState {
  started: boolean;
  startAt: number | null;
  laps: number;
  totalMs: number;
  bestMs: number | null;
  bestAt: number | null;
  lastAt: number | null;
  finished: boolean;
}

export interface SessionState {
  drivers: Record<string, DriverState>;
}

export interface Standing {
  driverId: string;
  position: number;
  laps: number;
  bestMs: number | null;
  bestAt: number | null;
  totalMs: number;
  /** Race only: reaction after "go" plus the laps. */
  elapsedMs: number | null;
  finished: boolean;
}

export type ZroundMessage =
  | { type: 'startup' }
  | { type: 'ack' }
  | { type: 'reset' }
  | { type: 'stop' }
  | { type: 'clock'; t: number }
  | { type: 'lap'; transponder: string; t: number }
  | { type: 'hello-request' }
  | { type: 'hello'; decoder: string | null; boot: string }
  | { type: 'pair'; decoder: string; token: string }
  | { type: 'wifi'; ssid: string; password: string }
  | { type: 'ok' }
  | { type: 'error'; text: string }
  | { type: 'unknown'; raw: string };
```

`packages/timing/index.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

export * from './passing.js';
```

(Later tasks add one `export * from` line each.)

`packages/timing/README.md`:

```markdown
# @tinylap/timing

Pure functions for lap timing, shared by the TinyLap timing server and its browser bridge: passings, laps, the rules of practice, qualifying and races, and the ZRound Free LapCounter protocol with TinyLap's extension commands. No I/O; runs in Node and in browsers.

See `docs/timing.md` for the passing format and the protocol.
```

Run: `pnpm install`
Expected: the workspace links `@tinylap/timing`.

- [ ] **Step 2: Write the failing test**

`packages/timing/test/passing.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOT_ID, MAX_BATCH, passingKey, randomBoot, readBatch, transponderCode } from '../index.js';

test('transponder codes are upper-case hex', () => {
  assert.equal(transponderCode('4a1f'), '4A1F');
  assert.equal(transponderCode(' 07 '), '07');
  assert.equal(transponderCode('xyz'), null);
  assert.equal(transponderCode(''), null);
  assert.equal(transponderCode(42), null);
  assert.equal(transponderCode('1'.repeat(17)), null);
});

test('the same passing has the same key, whichever way it came', () => {
  const p = { decoder: 'd1', boot: 'b00tb00t', transponder: '4A', t: 1234 };
  assert.equal(passingKey(p), passingKey({ ...p }));
  assert.notEqual(passingKey(p), passingKey({ ...p, t: 1235 }));
  assert.notEqual(passingKey(p), passingKey({ ...p, boot: 'b00tb00u' }));
});

test('a valid batch is read and normalised', () => {
  const result = readBatch({ boot: 'b00tb00t', passings: [{ transponder: '4a', t: 0 }, { transponder: '4A', t: 5000 }] });
  assert.deepEqual(result, { ok: true, batch: { boot: 'b00tb00t', passings: [{ transponder: '4A', t: 0 }, { transponder: '4A', t: 5000 }] } });
});

test('a bad batch says what is wrong', () => {
  const bad = (value, pattern) => {
    const result = readBatch(value);
    assert.equal(result.ok, false);
    assert.match(/** @type {any} */ (result).error, pattern);
  };
  bad(null, /JSON object/);
  bad([], /JSON object/);
  bad({ boot: 'short', passings: [{ transponder: '4A', t: 1 }] }, /boot/);
  bad({ boot: 'b00tb00t', passings: [] }, /non-empty/);
  bad({ boot: 'b00tb00t', passings: [{ transponder: 'zz', t: 1 }] }, /passings\[0\]\.transponder/);
  bad({ boot: 'b00tb00t', passings: [{ transponder: '4A', t: -1 }] }, /passings\[0\]\.t/);
  bad({ boot: 'b00tb00t', passings: [{ transponder: '4A', t: 1.5 }] }, /passings\[0\]\.t/);
  bad({ boot: 'b00tb00t', passings: [{ transponder: '4A', t: '1' }] }, /passings\[0\]\.t/);
  bad({ boot: 'b00tb00t', passings: Array.from({ length: MAX_BATCH + 1 }, (_, t) => ({ transponder: '4A', t })) }, /at most 500/);
});

test('random boots are valid and differ', () => {
  const a = randomBoot();
  assert.match(a, BOOT_ID);
  assert.equal(a.length, 11);
  assert.notEqual(a, randomBoot());
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing test`
Expected: FAIL, `passing.js` does not exist.

- [ ] **Step 4: Implement `passing.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Passings (spec §4): what a decoder reports when a car crosses the line,
// and the batches decoders and bridges post (spec §5).

/** @import { Batch, Passing } from './types.js' */

export const DECODER_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const BOOT_ID = /^[A-Za-z0-9_-]{8,32}$/;
export const TRANSPONDER = /^[0-9A-F]{1,16}$/;
export const MAX_BATCH = 500;

/** Upper-cases a hex transponder code; null when it isn't one. @param {unknown} value */
export function transponderCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return TRANSPONDER.test(code) ? code : null;
}

/** One passing, whichever transport carried it. @param {Passing} p */
export const passingKey = ({ decoder, boot, transponder, t }) => `${decoder} ${boot} ${transponder} ${t}`;

/** @param {Uint8Array} bytes */
export const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A new boot id: 64 random bits, base64url. */
export const randomBoot = () => base64url(globalThis.crypto.getRandomValues(new Uint8Array(8)));

/**
 * Reads an ingest batch: `{ boot, passings: [{ transponder, t }] }`.
 * @param {unknown} value
 * @returns {{ ok: true, batch: Batch } | { ok: false, error: string }}
 */
export function readBatch(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'The body must be a JSON object.' };
  const { boot, passings } = /** @type {{ boot?: unknown, passings?: unknown }} */ (value);
  if (typeof boot !== 'string' || !BOOT_ID.test(boot)) return { ok: false, error: '`boot` must be 8 to 32 base64url characters.' };
  if (!Array.isArray(passings) || passings.length === 0) return { ok: false, error: '`passings` must be a non-empty array.' };
  if (passings.length > MAX_BATCH) return { ok: false, error: `A batch holds at most ${MAX_BATCH} passings.` };
  /** @type {Batch['passings']} */
  const out = [];
  for (const [i, item] of passings.entries()) {
    const p = /** @type {{ transponder?: unknown, t?: unknown } | null} */ (item);
    const transponder = transponderCode(p?.transponder);
    const t = p?.t;
    if (transponder === null) return { ok: false, error: `passings[${i}].transponder must be a hex code.` };
    if (typeof t !== 'number' || !Number.isSafeInteger(t) || t < 0) return { ok: false, error: `passings[${i}].t must be a whole number of milliseconds, 0 or more.` };
    out.push({ transponder, t });
  }
  return { ok: true, batch: { boot, passings: out } };
}
```

- [ ] **Step 5: Run the tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing test && pnpm --filter @tinylap/timing lint && pnpm --filter @tinylap/timing typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/timing pnpm-lock.yaml
git commit -s -m "feat(timing): add the timing package with passings"
```

---

### Task 3: Laps

**Files:**
- Create: `packages/timing/laps.js`
- Modify: `packages/timing/index.js` (add `export * from './laps.js';`)
- Test: `packages/timing/test/laps.test.js`

**Interfaces:**
- Consumes: `Mark`, `LapStep` (types.d.ts).
- Produces: `MIN_LAP_MS = 1500`, `MAX_LAP_MS = 60_000`, `nextLap(reference: Mark | null, mark: Mark, options?: { minLap?: number, maxLap?: number }): LapStep`, `lapsOf(marks: Mark[], options?): LapStep[]`. A step's `reference` is the mark later laps are measured from: the new mark for `start` and `lap`, the old one for `double` and `backwards`.

- [ ] **Step 1: Write the failing test**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { lapsOf, nextLap } from '../index.js';

const at = (t, boot = 'b00tb00t') => ({ boot, t });
const kinds = (steps) => steps.map((s) => (s.kind === 'lap' ? s.ms : s.kind));

test('the first passing starts, the next completes a lap', () => {
  assert.deepEqual(kinds(lapsOf([at(1000), at(9500), at(17_800)])), ['start', 8500, 8300]);
});

test('a double read is dropped and the lap is measured from the first read', () => {
  assert.deepEqual(kinds(lapsOf([at(1000), at(9500), at(9600), at(18_000)])), ['start', 8500, 'double', 8500]);
});

test('a gap longer than maxLap is a parked car: no lap, a new start', () => {
  assert.deepEqual(kinds(lapsOf([at(0), at(8000), at(90_000), at(98_000)])), ['start', 8000, 'start', 8000]);
});

test('a new boot is a new start', () => {
  assert.deepEqual(kinds(lapsOf([at(1000), at(9000), at(500, 'n3wb00t1'), at(8500, 'n3wb00t1')])), ['start', 8000, 'start', 8000]);
});

test('a passing older than the reference makes no lap and keeps the reference', () => {
  assert.deepEqual(kinds(lapsOf([at(1000), at(9000), at(5000), at(17_000)])), ['start', 8000, 'backwards', 8000]);
});

test('limits are options, and the bounds themselves are laps', () => {
  assert.equal(nextLap(at(0), at(1500)).kind, 'lap');
  assert.equal(nextLap(at(0), at(1499)).kind, 'double');
  assert.equal(nextLap(at(0), at(60_000)).kind, 'lap');
  assert.equal(nextLap(at(0), at(60_001)).kind, 'start');
  assert.equal(nextLap(at(0), at(500), { minLap: 100 }).kind, 'lap');
  assert.equal(nextLap(at(0), at(20_000), { maxLap: 10_000 }).kind, 'start');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing test`
Expected: FAIL, `lapsOf` is not exported.

- [ ] **Step 3: Implement `laps.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Passings of one transponder become laps (spec §3). A lap is the difference
// of two decoder times from the same boot, so network delay never changes it.

/** @import { LapStep, Mark } from './types.js' */

export const MIN_LAP_MS = 1500;
export const MAX_LAP_MS = 60_000;

/**
 * What `mark` means, given the passing laps are measured from (null at
 * first sight of the transponder).
 * @param {Mark | null} reference @param {Mark} mark
 * @param {{ minLap?: number, maxLap?: number }} [options]
 * @returns {LapStep}
 */
export function nextLap(reference, mark, { minLap = MIN_LAP_MS, maxLap = MAX_LAP_MS } = {}) {
  if (!reference || reference.boot !== mark.boot) return { kind: 'start', reference: mark };
  const ms = mark.t - reference.t;
  if (ms <= 0) return { kind: 'backwards', reference };
  if (ms < minLap) return { kind: 'double', reference };
  if (ms > maxLap) return { kind: 'start', reference: mark };
  return { kind: 'lap', ms, reference: mark };
}

/** Every step of a sequence of marks, in order. @param {Mark[]} marks @param {{ minLap?: number, maxLap?: number }} [options] */
export function lapsOf(marks, options) {
  /** @type {Mark | null} */
  let reference = null;
  return marks.map((mark) => {
    const step = nextLap(reference, mark, options);
    reference = step.reference;
    return step;
  });
}
```

Add `export * from './laps.js';` to `index.js`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing test && pnpm --filter @tinylap/timing lint && pnpm --filter @tinylap/timing typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/timing
git commit -s -m "feat(timing): turn passings into laps"
```

---

### Task 4: Session rules

**Files:**
- Create: `packages/timing/sessions.js`
- Modify: `packages/timing/index.js` (add `export * from './sessions.js';`)
- Test: `packages/timing/test/sessions.test.js`

**Interfaces:**
- Consumes: `SessionRules`, `SessionState`, `Crossing`, `Standing` (types.d.ts), `MAX_LAP_MS` (laps.js).
- Produces:
  - `SESSION_KINDS: readonly ['practice', 'qualifying', 'race']`
  - `emptyState(): SessionState`
  - `applyCrossing(rules, state, crossing): boolean` — mutates `state`, returns whether the crossing counts as a lap of the session.
  - `standings(rules, state): Standing[]` — positions from 1.
  - `isComplete(rules, state, now: number, maxLap?: number): boolean` — whether a qualifying or race past `closesAt` is over.

- [ ] **Step 1: Write the failing test**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCrossing, emptyState, isComplete, standings } from '../index.js';

const practice = { kind: 'practice', roster: null, opensAt: null, closesAt: null };
const qualifying = { kind: 'qualifying', roster: ['ana', 'ben'], opensAt: 100_000, closesAt: 400_000 };
const race = { kind: 'race', roster: ['ana', 'ben'], opensAt: 100_000, closesAt: 400_000 };

/** Applies crossings `[driverId, at, lapMs]` and returns what counted. */
function run(rules, crossings, state = emptyState()) {
  return { state, counted: crossings.map(([driverId, at, lapMs]) => applyCrossing(rules, state, { driverId, at, lapMs })) };
}

test('practice counts every lap of every known driver', () => {
  const { state, counted } = run(practice, [['ana', 1000, null], ['ana', 9000, 8000], ['ben', 9500, 7900], [null, 9600, 7000]]);
  assert.deepEqual(counted, [false, true, true, false]);
  assert.deepEqual(standings(practice, state).map((s) => [s.driverId, s.position, s.bestMs]), [['ben', 1, 7900], ['ana', 2, 8000]]);
});

test('practice standings leave out drivers without a lap', () => {
  const { state } = run(practice, [['ana', 1000, null]]);
  assert.deepEqual(standings(practice, state), []);
});

test('qualifying counts laps begun inside the window', () => {
  const { counted } = run(qualifying, [
    ['ana', 105_000, 8000], // began at 97 000, before the window
    ['ana', 113_000, 8000], // began at 105 000
    ['ana', 407_999, 8000], // began at 399 999, a millisecond before the close
    ['ana', 416_000, 8001], // began at 407 999, after the close
    ['zed', 120_000, 8000], // not on the roster
  ]);
  assert.deepEqual(counted, [false, true, true, false, false]);
});

test('qualifying ranks by best lap, then by who set it first', () => {
  const { state } = run(qualifying, [['ana', 120_000, 8000], ['ben', 110_000, 8000], ['ben', 118_000, 8000]]);
  assert.deepEqual(standings(qualifying, state).map((s) => s.driverId), ['ben', 'ana']);
});

test('a race starts each driver at their first crossing after go', () => {
  const { state, counted } = run(race, [
    ['ana', 99_000, null], // before go: ignored
    ['ana', 100_400, 1400], // first crossing after go: the start, not a lap
    ['ana', 108_400, 8000],
    ['ben', 101_000, 8000], // ben's start, even with a lap time from practice
    ['ben', 108_900, 7900],
  ]);
  assert.deepEqual(counted, [false, false, true, false, true]);
  assert.equal(state.drivers.ana.startAt, 100_400);
  assert.equal(state.drivers.ana.laps, 1);
});

test('when time is up each driver finishes at their next crossing', () => {
  const { state, counted } = run(race, [
    ['ana', 100_000, null], ['ana', 399_000, 8000], ['ana', 407_000, 8000], ['ana', 415_000, 8000],
  ]);
  assert.deepEqual(counted, [false, true, true, false]);
  assert.equal(state.drivers.ana.finished, true);
});

test('a race ranks by laps, then by reaction plus lap time', () => {
  const { state } = run(race, [
    ['ana', 100_100, null], ['ana', 108_100, 8000],
    ['ben', 100_500, null], ['ben', 108_400, 7900],
  ]);
  // ana: 100 + 8000 = 8100; ben: 500 + 7900 = 8400
  const rows = standings(race, state);
  assert.deepEqual(rows.map((s) => [s.driverId, s.elapsedMs]), [['ana', 8100], ['ben', 8400]]);
  const more = run(race, [['ben', 116_300, 7900]], state).state;
  assert.equal(standings(race, more)[0].driverId, 'ben');
});

test('a roster driver without crossings is listed last', () => {
  const { state } = run(race, [['ana', 100_100, null], ['ana', 108_100, 8000]]);
  assert.deepEqual(standings(race, state).map((s) => [s.driverId, s.laps]), [['ana', 1], ['ben', 0]]);
});

test('a race is complete when everyone finished, or a lap after time up', () => {
  const { state } = run(race, [['ana', 100_100, null], ['ana', 401_000, 8000]]);
  assert.equal(isComplete(race, state, 401_000), false); // ben has not finished
  run(race, [['ben', 100_200, null], ['ben', 402_000, 8000]], state);
  assert.equal(isComplete(race, state, 402_000), true);
  assert.equal(isComplete(race, emptyState(), 460_000), true); // 400 000 + maxLap
  assert.equal(isComplete(race, emptyState(), 459_999), false);
});

test('qualifying is complete when every driver crossed after the close', () => {
  const { state } = run(qualifying, [['ana', 401_000, 8000]]);
  assert.equal(isComplete(qualifying, state, 401_000), false);
  run(qualifying, [['ben', 402_000, 8000]], state);
  assert.equal(isComplete(qualifying, state, 402_000), true);
  assert.equal(isComplete(practice, emptyState(), Number.MAX_SAFE_INTEGER), false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing test`
Expected: FAIL, `applyCrossing` is not exported.

- [ ] **Step 3: Implement `sessions.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The rules of practice, qualifying and races (spec §6), over crossings whose
// times the server has already mapped to its own clock. Lap times come from
// the decoder; only the window edges use server time.

import { MAX_LAP_MS } from './laps.js';

/** @import { Crossing, DriverState, SessionRules, SessionState, Standing } from './types.js' */

export const SESSION_KINDS = /** @type {const} */ (['practice', 'qualifying', 'race']);

/** @returns {SessionState} */
export const emptyState = () => ({ drivers: {} });

/** @returns {DriverState} */
const fresh = () => ({ started: false, startAt: null, laps: 0, totalMs: 0, bestMs: null, bestAt: null, lastAt: null, finished: false });

/** @param {DriverState} d @param {number} ms @param {number} at */
function addLap(d, ms, at) {
  d.laps += 1;
  d.totalMs += ms;
  if (d.bestMs === null || ms < d.bestMs) {
    d.bestMs = ms;
    d.bestAt = at;
  }
}

/**
 * Applies one crossing to a session's state. Returns whether it counts as a
 * lap of this session.
 * @param {SessionRules} rules @param {SessionState} state @param {Crossing} crossing
 */
export function applyCrossing(rules, state, { driverId, at, lapMs }) {
  if (driverId === null) return false;
  if (rules.roster && !rules.roster.includes(driverId)) return false;
  const d = (state.drivers[driverId] ??= fresh());
  d.lastAt = at;
  if (rules.kind === 'practice') {
    if (lapMs === null) return false;
    addLap(d, lapMs, at);
    return true;
  }
  if (rules.opensAt === null || rules.closesAt === null) return false;
  if (rules.kind === 'qualifying') {
    if (lapMs === null) return false;
    const began = at - lapMs;
    if (began < rules.opensAt || began >= rules.closesAt) return false;
    addLap(d, lapMs, at);
    return true;
  }
  if (!d.started) {
    if (at < rules.opensAt) return false;
    d.started = true;
    d.startAt = at;
    return false;
  }
  if (d.finished || lapMs === null) return false;
  addLap(d, lapMs, at);
  if (at >= rules.closesAt) d.finished = true;
  return true;
}

const INF = Number.POSITIVE_INFINITY;
/** @param {Standing} a @param {Standing} b */
const byBest = (a, b) => (a.bestMs ?? INF) - (b.bestMs ?? INF) || (a.bestAt ?? INF) - (b.bestAt ?? INF) || a.driverId.localeCompare(b.driverId);
/** @param {Standing} a @param {Standing} b */
const byRace = (a, b) => b.laps - a.laps || (a.elapsedMs ?? INF) - (b.elapsedMs ?? INF) || a.driverId.localeCompare(b.driverId);

/** The standings, positions from 1. @param {SessionRules} rules @param {SessionState} state @returns {Standing[]} */
export function standings(rules, state) {
  const ids = rules.roster ?? Object.keys(state.drivers);
  /** @type {Standing[]} */
  const rows = [];
  for (const driverId of ids) {
    const d = state.drivers[driverId] ?? fresh();
    if (rules.kind === 'practice' && d.laps === 0) continue;
    const elapsedMs = rules.kind === 'race' && d.startAt !== null && rules.opensAt !== null ? d.startAt - rules.opensAt + d.totalMs : null;
    rows.push({ driverId, position: 0, laps: d.laps, bestMs: d.bestMs, bestAt: d.bestAt, totalMs: d.totalMs, elapsedMs, finished: d.finished });
  }
  rows.sort(rules.kind === 'race' ? byRace : byBest);
  rows.forEach((row, i) => {
    row.position = i + 1;
  });
  return rows;
}

/**
 * Whether a qualifying or race past its close is over: every roster driver
 * finished (race) or crossed after the close (qualifying), or a whole
 * `maxLap` has passed since the close. Practice never completes.
 * @param {SessionRules} rules @param {SessionState} state @param {number} now @param {number} [maxLap]
 */
export function isComplete(rules, state, now, maxLap = MAX_LAP_MS) {
  if (rules.kind === 'practice' || rules.closesAt === null) return false;
  if (now >= rules.closesAt + maxLap) return true;
  const closesAt = rules.closesAt;
  const roster = rules.roster ?? [];
  if (rules.kind === 'race') return roster.every((id) => state.drivers[id]?.finished === true);
  return roster.every((id) => (state.drivers[id]?.lastAt ?? -INF) >= closesAt);
}
```

Add `export * from './sessions.js';` to `index.js`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing test && pnpm --filter @tinylap/timing lint && pnpm --filter @tinylap/timing typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/timing
git commit -s -m "feat(timing): add practice, qualifying and race rules"
```

---

### Task 5: ZRound protocol and the simulator

**Files:**
- Create: `packages/timing/zround.js`, `packages/timing/simulator.js`
- Modify: `packages/timing/index.js` (add `export * from './zround.js';` and `export * from './simulator.js';`)
- Test: `packages/timing/test/zround.test.js`, `packages/timing/test/simulator.test.js`

**Interfaces:**
- Consumes: `DECODER_ID`, `BOOT_ID`, `base64url`, `randomBoot` (passing.js), `ZroundMessage` (types.d.ts).
- Produces:
  - `ZROUND_BAUD = 19200`
  - `parseMessage(body: string): ZroundMessage` — `body` is the text between `%` and `&`.
  - `createReader(): { push(chunk: string): ZroundMessage[] }`
  - `commands`: `startup`, `ack`, `hello`, `ok` (strings); `pair(decoder, token)`, `wifi(ssid, password)`, `id(decoder | null, boot)`, `error(text)`, `lap(transponder, t)`, `clock(t)` (functions returning one framed line).
  - `TOKEN = /^[A-Za-z0-9_-]{43}$/`
  - `createSimulator({ cars, jitterMs?, random?, decoder?, token? })` → `{ boot, decoder, token, advance(until: number): { transponder, t }[], reply(message: ZroundMessage, now: number): string[] }`. `cars`: `{ transponder: string, lapMs: number }[]`. `advance` returns the passings up to decoder time `until`, in order. `reply` answers commands: `hello-request` → `id`; `pair` → stores, `ok`; `wifi` → `ok`; `startup` → `ack`; `reset` → a new boot with its clock at zero, no reply.

Protocol facts (zround.com, "Free LapCounter Communication Protocol"): every message is `%` + code + data + `&`; `%C&` startup (PC → decoder), `%A&` ack, `%I&` race start (clock to zero), `%F&` race stop, `%T<hex ms>&` clock, `%L<transponder hex>[,]<hex ms>&` lap; without the comma the transponder is two hex digits.

TinyLap extension (spec §5), all upper-case, fields separated by one space:
- PC → decoder: `%TLHELLO&`, `%TLPAIR <decoder> <token>&`, `%TLWIFI <base64url ssid> <base64url password>&`
- decoder → PC: `%TLID <decoder or -> <boot>&`, `%TLOK&`, `%TLERR <text>&`

- [ ] **Step 1: Write the failing tests**

`packages/timing/test/zround.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, createReader, parseMessage } from '../index.js';

test('ZRound messages', () => {
  assert.deepEqual(parseMessage('C'), { type: 'startup' });
  assert.deepEqual(parseMessage('A'), { type: 'ack' });
  assert.deepEqual(parseMessage('I'), { type: 'reset' });
  assert.deepEqual(parseMessage('F'), { type: 'stop' });
  assert.deepEqual(parseMessage('T1F4'), { type: 'clock', t: 500 });
  assert.deepEqual(parseMessage('L0A0003E8'), { type: 'lap', transponder: '0A', t: 1000 });
  assert.deepEqual(parseMessage('L4a1f,3E8'), { type: 'lap', transponder: '4A1F', t: 1000 });
  assert.deepEqual(parseMessage('Lzz,1'), { type: 'unknown', raw: 'Lzz,1' });
  assert.deepEqual(parseMessage('L0A'), { type: 'unknown', raw: 'L0A' });
});

test('TinyLap extension messages', () => {
  assert.deepEqual(parseMessage('TLHELLO'), { type: 'hello-request' });
  assert.deepEqual(parseMessage('TLID - b00tb00t'), { type: 'hello', decoder: null, boot: 'b00tb00t' });
  assert.deepEqual(parseMessage('TLID dec_1 b00tb00t'), { type: 'hello', decoder: 'dec_1', boot: 'b00tb00t' });
  assert.deepEqual(parseMessage('TLID dec_1 x'), { type: 'unknown', raw: 'TLID dec_1 x' });
  assert.deepEqual(parseMessage('TLOK'), { type: 'ok' });
  assert.deepEqual(parseMessage('TLERR no flash'), { type: 'error', text: 'no flash' });
  const token = 'a'.repeat(43);
  assert.deepEqual(parseMessage(`TLPAIR dec_1 ${token}`), { type: 'pair', decoder: 'dec_1', token });
  assert.deepEqual(parseMessage('TLPAIR dec_1 short'), { type: 'unknown', raw: 'TLPAIR dec_1 short' });
});

test('commands round-trip, Wi-Fi credentials included', () => {
  const body = (line) => line.slice(1, -1);
  assert.deepEqual(parseMessage(body(commands.lap('4A1F', 1000))), { type: 'lap', transponder: '4A1F', t: 1000 });
  assert.deepEqual(parseMessage(body(commands.clock(500))), { type: 'clock', t: 500 });
  assert.deepEqual(parseMessage(body(commands.id(null, 'b00tb00t'))), { type: 'hello', decoder: null, boot: 'b00tb00t' });
  assert.deepEqual(parseMessage(body(commands.wifi('Office 5G & Co', 'p%ss wörd'))), { type: 'wifi', ssid: 'Office 5G & Co', password: 'p%ss wörd' });
  // "%" and "&" are removed, so two spaces remain.
  assert.equal(commands.error('50% & more'), '%TLERR 50  more&');
});

test('the reader splits a stream at any chunk boundary and drops noise', () => {
  const reader = createReader();
  assert.deepEqual(reader.push('boot noise %L0A00'), []);
  assert.deepEqual(reader.push('03E8&%T1F4&%A'), [{ type: 'lap', transponder: '0A', t: 1000 }, { type: 'clock', t: 500 }]);
  assert.deepEqual(reader.push('&'), [{ type: 'ack' }]);
});

test('the reader does not grow without an end', () => {
  const reader = createReader();
  reader.push(`%${'x'.repeat(5000)}`);
  assert.deepEqual(reader.push('%A&'), [{ type: 'ack' }]);
});
```

`packages/timing/test/simulator.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOT_ID, createSimulator, lapsOf } from '../index.js';

/** A seeded random, so laps are repeatable. */
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('cars cross at about their lap time, in time order', () => {
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 8000 }, { transponder: '0B', lapMs: 9000 }], jitterMs: 100, random: seeded() });
  const passings = sim.advance(60_000);
  assert.deepEqual(passings.map((p) => p.t), [...passings.map((p) => p.t)].sort((a, b) => a - b));
  for (const transponder of ['0A', '0B']) {
    const laps = lapsOf(passings.filter((p) => p.transponder === transponder).map((p) => ({ boot: sim.boot, t: p.t })))
      .filter((s) => s.kind === 'lap').map((s) => /** @type {any} */ (s).ms);
    const target = transponder === '0A' ? 8000 : 9000;
    assert.ok(laps.length >= 5, transponder);
    for (const ms of laps) assert.ok(Math.abs(ms - target) <= 100, `${transponder} ${ms}`);
  }
  assert.deepEqual(sim.advance(60_000), [], 'nothing twice');
});

test('the simulator answers hello, pairing, Wi-Fi and a ZRound startup', () => {
  const sim = createSimulator({ cars: [] });
  assert.match(sim.boot, BOOT_ID);
  assert.deepEqual(sim.reply({ type: 'hello-request' }, 0), [`%TLID - ${sim.boot}&`]);
  const token = 't'.repeat(43);
  assert.deepEqual(sim.reply({ type: 'pair', decoder: 'dec_1', token }, 0), ['%TLOK&']);
  assert.equal(sim.decoder, 'dec_1');
  assert.equal(sim.token, token);
  assert.deepEqual(sim.reply({ type: 'wifi', ssid: 'x', password: 'y' }, 0), ['%TLOK&']);
  assert.deepEqual(sim.reply({ type: 'startup' }, 0), ['%A&']);
  assert.deepEqual(sim.reply({ type: 'hello-request' }, 0), [`%TLID dec_1 ${sim.boot}&`]);
});

test('a ZRound reset starts a new boot with its clock at zero', () => {
  const sim = createSimulator({ cars: [{ transponder: '0A', lapMs: 8000 }], jitterMs: 0, random: () => 0.5 });
  sim.advance(30_000);
  const before = sim.boot;
  assert.deepEqual(sim.reply({ type: 'reset' }, 30_000), []);
  assert.notEqual(sim.boot, before);
  const next = sim.advance(10_000);
  assert.ok(next.length >= 1);
  assert.ok(next.every((p) => p.t <= 10_000));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @tinylap/timing test`
Expected: FAIL, `parseMessage` is not exported.

- [ ] **Step 3: Implement `zround.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The ZRound Free LapCounter protocol (zround.com wiki, CC BY-SA), which
// TinyLap decoders speak over USB so existing software works with them, plus
// TinyLap's own %TL… commands (spec §5), which ZRound never sends.
// Every message is "%" + code + data + "&". Times are hex milliseconds.

import { BOOT_ID, DECODER_ID, base64url } from './passing.js';

/** @import { ZroundMessage } from './types.js' */

export const ZROUND_BAUD = 19200;
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HEX = /^[0-9A-Fa-f]+$/;
const MAX_PENDING = 1024;

/** @param {string} text */
const encode = (text) => base64url(new TextEncoder().encode(text));
/** @param {string} value @returns {string | null} */
function decode(value) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** One message. @param {string} body the text between "%" and "&" @returns {ZroundMessage} */
export function parseMessage(body) {
  const unknown = /** @type {const} */ ({ type: 'unknown', raw: body });
  if (body === 'C') return { type: 'startup' };
  if (body === 'A') return { type: 'ack' };
  if (body === 'I') return { type: 'reset' };
  if (body === 'F') return { type: 'stop' };
  if (body.startsWith('TL')) {
    const [word, ...fields] = body.split(' ');
    if (word === 'TLHELLO' && fields.length === 0) return { type: 'hello-request' };
    if (word === 'TLOK' && fields.length === 0) return { type: 'ok' };
    if (word === 'TLERR') return { type: 'error', text: fields.join(' ') };
    if (word === 'TLID' && fields.length === 2) {
      const [decoder, boot] = fields;
      if (BOOT_ID.test(boot) && (decoder === '-' || DECODER_ID.test(decoder))) return { type: 'hello', decoder: decoder === '-' ? null : decoder, boot };
    }
    if (word === 'TLPAIR' && fields.length === 2 && DECODER_ID.test(fields[0]) && TOKEN.test(fields[1])) return { type: 'pair', decoder: fields[0], token: fields[1] };
    if (word === 'TLWIFI' && fields.length === 2) {
      const ssid = decode(fields[0]);
      const password = decode(fields[1]);
      if (ssid !== null && password !== null) return { type: 'wifi', ssid, password };
    }
    return unknown;
  }
  if (body[0] === 'T' && HEX.test(body.slice(1))) return { type: 'clock', t: parseInt(body.slice(1), 16) };
  if (body[0] === 'L') {
    const rest = body.slice(1);
    const [transponder, time] = rest.includes(',') ? rest.split(',', 2) : [rest.slice(0, 2), rest.slice(2)];
    if (HEX.test(transponder) && HEX.test(time)) return { type: 'lap', transponder: transponder.toUpperCase(), t: parseInt(time, 16) };
  }
  return unknown;
}

/** Splits a serial text stream into messages. Text outside "%…&" is dropped. */
export function createReader() {
  let pending = '';
  return {
    /** @param {string} chunk @returns {ZroundMessage[]} */
    push(chunk) {
      pending += chunk;
      /** @type {ZroundMessage[]} */
      const out = [];
      for (;;) {
        const start = pending.indexOf('%');
        if (start === -1) {
          pending = '';
          break;
        }
        const end = pending.indexOf('&', start);
        if (end === -1) {
          pending = pending.slice(start);
          break;
        }
        out.push(parseMessage(pending.slice(start + 1, end)));
        pending = pending.slice(end + 1);
      }
      if (pending.length > MAX_PENDING) pending = '';
      return out;
    },
  };
}

/** @param {number} n */
const hex = (n) => n.toString(16).toUpperCase();

/** Framed lines, ready to write. */
export const commands = Object.freeze({
  startup: '%C&',
  ack: '%A&',
  hello: '%TLHELLO&',
  ok: '%TLOK&',
  /** @param {string} decoder @param {string} token */
  pair: (decoder, token) => `%TLPAIR ${decoder} ${token}&`,
  /** @param {string} ssid @param {string} password */
  wifi: (ssid, password) => `%TLWIFI ${encode(ssid)} ${encode(password)}&`,
  /** @param {string | null} decoder @param {string} boot */
  id: (decoder, boot) => `%TLID ${decoder ?? '-'} ${boot}&`,
  /** @param {string} text */
  error: (text) => `%TLERR ${text.replace(/[%&]/g, '')}&`,
  /** @param {string} transponder @param {number} t */
  lap: (transponder, t) => `%L${transponder},${hex(t)}&`,
  /** @param {number} t */
  clock: (t) => `%T${hex(t)}&`,
});
```

- [ ] **Step 4: Implement `simulator.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// A pretend decoder: cars that cross the line at about their lap time, and
// the replies a TinyLap decoder gives to ZRound and %TL… commands. Drives
// tools/decoder-sim.js and the bridge's ?simulate port, so the whole chain
// can be tried without hardware.

import { randomBoot } from './passing.js';
import { commands } from './zround.js';

/** @import { ZroundMessage } from './types.js' */

/**
 * @param {{ cars: { transponder: string, lapMs: number }[], jitterMs?: number, random?: () => number,
 *   decoder?: string | null, token?: string | null }} options
 */
export function createSimulator({ cars, jitterMs = 150, random = Math.random, decoder = null, token = null }) {
  let boot = randomBoot();
  let paired = decoder;
  let secret = token;
  /** Each car's next crossing in decoder time. The first comes within one lap. */
  const next = cars.map((car) => ({ ...car, at: 2000 + random() * car.lapMs }));
  const jitter = () => (random() * 2 - 1) * jitterMs;

  return {
    get boot() {
      return boot;
    },
    get decoder() {
      return paired;
    },
    get token() {
      return secret;
    },
    /** The passings up to decoder time `until`, in time order. @param {number} until */
    advance(until) {
      /** @type {{ transponder: string, t: number }[]} */
      const out = [];
      for (;;) {
        let first = -1;
        for (let i = 0; i < next.length; i += 1) if (first === -1 || next[i].at < next[first].at) first = i;
        if (first === -1 || next[first].at > until) return out;
        const car = next[first];
        out.push({ transponder: car.transponder, t: Math.round(car.at) });
        car.at += Math.max(car.lapMs + jitter(), 1);
      }
    },
    /** What the decoder answers. `now` is its current clock. @param {ZroundMessage} message @param {number} now @returns {string[]} */
    reply(message, now) {
      switch (message.type) {
        case 'hello-request':
          return [commands.id(paired, boot)];
        case 'pair':
          paired = message.decoder;
          secret = message.token;
          return [commands.ok];
        case 'wifi':
          return [commands.ok];
        case 'startup':
          return [commands.ack];
        case 'reset':
          boot = randomBoot();
          for (const car of next) car.at -= now;
          return [];
        default:
          return [];
      }
    },
  };
}
```

Add both `export * from` lines to `index.js`.

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing test && pnpm --filter @tinylap/timing lint && pnpm --filter @tinylap/timing typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/timing
git commit -s -m "feat(timing): read and write the ZRound protocol, and simulate a decoder"
```

---
### Task 6: `apps/timing` server scaffold

The server keeps the planner's structure, and the generic modules are copied from it. (Extracting a shared server package is a later refactor, not part of this plan.)

**Files:**
- Create: `apps/timing/package.json`, `apps/timing/tsconfig.json`, `apps/timing/turbo.json`, `apps/timing/index.html`, `apps/timing/css/app.css`, `apps/timing/js/main.js`
- Copy from `apps/track-planner/server/`: `responses.js`, `problems.js`, `negotiate.js`, `static.js`, `pages.js`
- Create: `apps/timing/server/app.js`, `apps/timing/server/routes.js`, `apps/timing/server/discovery.js`, `apps/timing/server/openapi.json`
- Test: `apps/timing/test/server/helpers.js`, `apps/timing/test/server/static.test.js`

**Interfaces:**
- Produces:
  - `createHandler(options)` in `server/app.js`: options `{ store, engine, hub, auth, root?, appDir, publicUrl?, plannerUrl?, clientIpHeader?, build?, now?, log?, routes?, fetch?, limits?: { ingest?: number, tap?: number, pair?: number } }`. Each request gets `request = { ...context, req, url, origin }` with `context = { store, engine, hub, auth, publicUrl, plannerUrl, build, clientIpHeader, fetch, now, limiters: { ingest, tap, pair } }`.
  - A route is `{ pattern: RegExp, credentials?: boolean, varyCookie?: boolean, unknown?: boolean, methods: Record<string, (request, match) => Response> }`. A handler returns `{ status, headers?, body? }`, or `{ status, headers, stream(req, res) }` for a response it writes itself (SSE). `credentials` routes get no CORS and `Vary: Cookie`.
  - `routes` in `server/routes.js`: the route list; later tasks add their routes to it.
  - `problem(request, name, detail, headers?)` (responses.js); every `name` must exist in `openapi.json`'s `x-tinylap-problems`.
  - Test helper `startServer(options)` in `test/server/helpers.js` → `{ base, close() }`.

- [ ] **Step 1: Create the package**

`apps/timing/package.json`:

```json
{
  "name": "@tinylap/timing-app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-or-later",
  "files": [
    "index.html",
    "css",
    "js"
  ],
  "scripts": {
    "test": "node --disable-warning=ExperimentalWarning --test 'test/server/*.test.js'",
    "dev": "node --disable-warning=ExperimentalWarning server/main.js --dev",
    "start": "node --disable-warning=ExperimentalWarning server/main.js",
    "typecheck": "tsc -p tsconfig.json",
    "lint": "eslint .",
    "test:browser": "node --disable-warning=ExperimentalWarning --test --test-concurrency=1 'test/browser/*.test.js'"
  },
  "dependencies": {
    "@tinylap/auth": "workspace:*",
    "@tinylap/design": "workspace:*",
    "@tinylap/timing": "workspace:*",
    "@tinylap/track-format": "workspace:*",
    "palace-ui": "^0.10.0"
  },
  "devDependencies": {
    "playwright-core": "^1.64.1"
  }
}
```

(The `test` script gains `'test/*.test.js'` in Task 16, when the first browser-side unit test exists.)

`apps/timing/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "strict": false, "resolveJsonModule": true }, "include": ["js/**/*.js", "server/**/*.js"] }
```

`apps/timing/turbo.json`: copy `apps/track-planner/turbo.json` unchanged (`cp apps/track-planner/turbo.json apps/timing/turbo.json`); the server tests run against a real `accounts` too.

`apps/timing/index.html` (the app shell; Task 16 fills in the body):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TinyLap Timing</title>
  <script type="importmap">
  { "imports": { "@tinylap/timing": "./pkg/timing/index.js", "@tinylap/track-format": "./pkg/track-format/index.js" } }
  </script>
  <link rel="stylesheet" href="./pkg/palace-ui/palace.css">
  <link rel="stylesheet" href="./pkg/design/design.css">
  <link rel="stylesheet" href="./css/app.css">
</head>
<body>
  <main id="app"></main>
  <script type="module" src="./js/main.js"></script>
</body>
</html>
```

The import map lists exactly the app's JS dependencies at their entries; `tools/test/import-map.test.js` checks that for every app.

`apps/timing/css/app.css`:

```css
/* SPDX-FileCopyrightText: 2026 The TinyLap contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later */
```

`apps/timing/js/main.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

document.querySelector('#app').textContent = 'TinyLap Timing';
```

Run: `pnpm install`

- [ ] **Step 2: Copy the generic server modules**

```bash
mkdir -p apps/timing/server apps/timing/test/server
cp apps/track-planner/server/{responses.js,problems.js,negotiate.js,static.js,pages.js} apps/timing/server/
```

Then edit the copies:
- `static.js`: rename `plannerCsp` to `appCsp` (both places), and change its doc comment's first sentence to "The app's policy: everything from its own origin, plus the inline import map, allowed by its hash."
- `responses.js`: change the header comment to "Response builders shared by every route module, kept apart from app.js so the modules do not import each other."
- `pages.js`: delete `shapePage` (the whole function and its doc comment). In `apiPage`, replace the subtitle line with

```js
<p class="subtitle">OpenAPI ${esc(doc.openapi)} &middot; <a href="/openapi.json">openapi.json</a></p>
```

- [ ] **Step 3: Write `server/app.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The request handler, as in the planner: routes return plain
// { status, headers, body } objects and send() writes them, so every rule
// about headers lives here once. A route may instead return
// { status, headers, stream(req, res) } and write the body itself (SSE).
import { rateLimiter } from '@tinylap/auth';
import { problem } from './responses.js';
import { staticFiles } from './static.js';
import { routes as defaultRoutes } from './routes.js';

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Location, Link, ETag, Retry-After',
  Link: '</openapi.json>; rel="service-desc"',
};
const CREDENTIAL_HEADERS = { Link: API_HEADERS.Link };

function send(req, res, { status, headers = {}, body, stream }) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  if (stream && req.method !== 'HEAD') return stream(req, res);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * @param {{ credentials?: boolean, varyCookie?: boolean }} route @param {Record<string, any>} [headers]
 * @param {boolean} [credentials] the response's own mark
 */
function withRouteHeaders(route, headers = {}, credentials = false) {
  const vary = headers.Vary ? `${headers.Vary}, Cookie` : 'Cookie';
  if (route.credentials || credentials) return { ...CREDENTIAL_HEADERS, ...headers, Vary: vary };
  if (route.varyCookie) return { ...API_HEADERS, ...headers, Vary: vary };
  return { ...API_HEADERS, ...headers };
}

async function dispatch(request, routes, serveStatic) {
  const { req, url } = request;
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    if (route.unknown) {
      const miss = problem(request, 'not-found', 'There is no such route.');
      return { ...miss, headers: withRouteHeaders(route, miss.headers) };
    }
    const names = Object.keys(route.methods);
    const allowed = [...names, ...(names.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].join(', ');
    if (req.method === 'OPTIONS') {
      if (route.credentials) return { status: 204, headers: withRouteHeaders(route, { Allow: allowed }) };
      return {
        status: 204,
        headers: { ...API_HEADERS, 'Access-Control-Allow-Methods': allowed, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID', 'Access-Control-Max-Age': '86400' },
      };
    }
    const handler = route.methods[req.method === 'HEAD' ? 'GET' : req.method];
    let response;
    try {
      response = handler
        ? await handler(request, match)
        : problem(request, 'method-not-allowed', `${req.method} is not allowed on ${url.pathname}.`, { Allow: allowed });
    } catch (error) {
      // createHandler's catch would add CORS; a credentials route must not get it.
      if (!route.credentials) throw error;
      console.error(error);
      response = problem(request, 'unavailable', 'The server could not complete the request.');
    }
    const { credentials, ...rest } = response;
    return { ...rest, headers: withRouteHeaders(route, response.headers, credentials) };
  }
  return serveStatic(req, url);
}

/** Per-minute and per-hour budgets (spec §9). */
const LIMITS = { ingest: 600, tap: 120, pair: 10 };

/**
 * @param {{ store?: any, engine?: any, hub?: any, auth?: any, root?: string, appDir: string, publicUrl?: string,
 *   plannerUrl?: string, clientIpHeader?: string, build?: string, now?: () => number, log?: boolean,
 *   routes?: any[], fetch?: typeof fetch, limits?: { ingest?: number, tap?: number, pair?: number } }} options
 */
export function createHandler(options) {
  const now = options.now ?? Date.now;
  const limits = { ...LIMITS, ...options.limits };
  const context = {
    store: options.store ?? null,
    engine: options.engine ?? null,
    hub: options.hub ?? null,
    auth: options.auth ?? null,
    publicUrl: options.publicUrl?.replace(/\/$/, '') ?? null,
    plannerUrl: options.plannerUrl?.replace(/\/$/, '') ?? null,
    build: options.build ?? 'dev',
    clientIpHeader: options.clientIpHeader?.toLowerCase() || null,
    fetch: options.fetch ?? globalThis.fetch,
    now,
    limiters: {
      // Batches per decoder per minute; a race of 8 cars is a few passings a second.
      ingest: rateLimiter({ limit: limits.ingest, windowMs: 60_000, now }),
      // Taps per member per minute.
      tap: rateLimiter({ limit: limits.tap, windowMs: 60_000, now }),
      // New decoders per member per hour.
      pair: rateLimiter({ limit: limits.pair, windowMs: 3_600_000, now }),
    },
  };
  const routes = options.routes ?? defaultRoutes;
  const serveStatic = staticFiles({ ...options, formAction: context.auth ? [new URL(context.auth.issuer).origin] : [] });

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

`server/routes.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every route, in matching order. The first pattern that matches wins.
import { discoveryRoutes } from './discovery.js';

export const routes = [
  ...discoveryRoutes,
];
```

- [ ] **Step 4: Write `server/discovery.js` and `server/openapi.json`**

`server/discovery.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// How a client finds out what this server is: the OpenAPI description
// (linked from every API response by rel="service-desc"), the RFC 9727
// catalog, the problem types and the docs page.
import openapi from './openapi.json' with { type: 'json' };
import { PROBLEMS } from './problems.js';
import { html, problem } from './responses.js';
import { apiPage } from './pages.js';

const DESCRIPTION = JSON.stringify(openapi);
const DOCS = apiPage(openapi);
const fresh = { 'Cache-Control': 'no-cache' };

const catalog = (request) => ({
  status: 200,
  headers: { 'Content-Type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"', ...fresh },
  body: JSON.stringify({
    linkset: [{
      anchor: `${request.origin}/workspaces`,
      'service-desc': [{ href: `${request.origin}/openapi.json`, type: 'application/vnd.oai.openapi+json' }],
      'service-doc': [{ href: `${request.origin}/api`, type: 'text/html' }],
    }],
  }),
});

export const discoveryRoutes = [
  { pattern: /^\/openapi\.json$/, methods: { GET: () => ({ status: 200, headers: { 'Content-Type': 'application/vnd.oai.openapi+json;version=3.1', ...fresh }, body: DESCRIPTION }) } },
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

`server/openapi.json` (the whole API, described once; later tasks implement it, and Task 14 checks every path has a route):

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "TinyLap timing API",
    "version": "1.0.0",
    "license": { "name": "AGPL-3.0-or-later", "identifier": "AGPL-3.0-or-later" },
    "description": "Lap timing for a workspace's track. Decoders post passings, over the internet with their own token or through a logged-in browser tab connected by USB; the server stores each passing once, turns passings into laps, practice, qualifying and race results, and streams them as Server-Sent Events. A read-only watchers view needs no log-in."
  },
  "externalDocs": { "description": "The passing format, the ingest API and the ZRound extension", "url": "https://github.com/tinylaphq/tinylap/blob/main/docs/timing.md" },
  "paths": {
    "/auth/login": { "get": { "summary": "Log in through TinyLap accounts", "responses": { "302": { "description": "To the issuer." }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/auth/callback": { "get": { "summary": "Finish logging in", "responses": { "302": { "description": "Back to the page that asked." }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/auth/logout": { "post": { "summary": "Log out", "responses": { "302": { "description": "To the issuer's end-session page." }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/auth/me": { "get": { "summary": "Who is logged in, and their workspaces", "responses": { "200": { "description": "The log-in state.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/workspaces/{workspace}": { "get": { "summary": "The workspace's live state: track, session, standings, recent crossings, drivers, personal bests", "security": [{ "session": [] }], "responses": { "200": { "description": "A snapshot.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/workspaces/{workspace}/live": { "get": { "summary": "Live events as Server-Sent Events", "description": "Events: snapshot, session, crossing, standings, results, drivers, track, setup. Reconnect with Last-Event-ID to get what you missed in the last 10 minutes; older, you get a snapshot.", "security": [{ "session": [] }], "responses": { "200": { "description": "An event stream.", "content": { "text/event-stream": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/workspaces/{workspace}/drivers": {
      "get": { "summary": "The drivers", "security": [{ "session": [] }], "responses": { "200": { "description": "Drivers.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } },
      "post": { "summary": "Add a driver", "security": [{ "session": [] }], "requestBody": { "content": { "application/json": {} } }, "responses": { "201": { "description": "The driver.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } }
    },
    "/workspaces/{workspace}/drivers/{driver}": {
      "patch": { "summary": "Rename or recolour a driver", "security": [{ "session": [] }], "requestBody": { "content": { "application/json": {} } }, "responses": { "200": { "description": "The driver.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } },
      "delete": { "summary": "Delete a driver; their transponders become unassigned, their laps stay", "security": [{ "session": [] }], "responses": { "204": { "description": "Deleted." }, "default": { "$ref": "#/components/responses/Problem" } } }
    },
    "/workspaces/{workspace}/transponders": { "get": { "summary": "Every transponder seen or assigned", "security": [{ "session": [] }], "responses": { "200": { "description": "Transponders.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/workspaces/{workspace}/transponders/{code}": { "put": { "summary": "Assign a transponder to a driver, or unassign it", "description": "Assigning gives the driver the transponder's unassigned laps.", "security": [{ "session": [] }], "requestBody": { "content": { "application/json": {} } }, "responses": { "200": { "description": "The transponder.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/workspaces/{workspace}/decoders": {
      "get": { "summary": "The paired decoders", "security": [{ "session": [] }], "responses": { "200": { "description": "Decoders.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } },
      "post": { "summary": "Pair a new decoder: answers its id and its token, once", "security": [{ "session": [] }], "requestBody": { "content": { "application/json": {} } }, "responses": { "201": { "description": "The decoder and its token.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } }
    },
    "/workspaces/{workspace}/decoders/{decoder}": { "delete": { "summary": "Unpair a decoder; its token stops working, its passings stay", "security": [{ "session": [] }], "responses": { "204": { "description": "Unpaired." }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/workspaces/{workspace}/track": { "put": { "summary": "Set the current track from a planner link, and the direction", "security": [{ "session": [] }], "requestBody": { "content": { "application/json": {} } }, "responses": { "200": { "description": "The track.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/workspaces/{workspace}/watch-token": {
      "get": { "summary": "The watchers link token, or null", "security": [{ "session": [] }], "responses": { "200": { "description": "The token.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } },
      "post": { "summary": "Make a new watchers link; the old one stops working", "security": [{ "session": [] }], "responses": { "200": { "description": "The new token.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } }
    },
    "/workspaces/{workspace}/sessions": {
      "get": { "summary": "Recent sessions, newest first", "security": [{ "session": [] }], "responses": { "200": { "description": "Sessions.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } },
      "post": { "summary": "Start a qualifying or a race", "security": [{ "session": [] }], "requestBody": { "content": { "application/json": {} } }, "responses": { "201": { "description": "The session.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } }
    },
    "/workspaces/{workspace}/sessions/{session}": { "get": { "summary": "A session with its standings and crossings", "security": [{ "session": [] }], "responses": { "200": { "description": "The session.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/workspaces/{workspace}/sessions/{session}/abort": { "post": { "summary": "Abort a qualifying or race", "security": [{ "session": [] }], "responses": { "200": { "description": "The session.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/workspaces/{workspace}/tap": { "post": { "summary": "Record a passing by hand for a driver (tap entry)", "security": [{ "session": [] }], "requestBody": { "content": { "application/json": {} } }, "responses": { "200": { "description": "Stored.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/decoders/{decoder}/passings": { "post": { "summary": "Post a batch of passings of one boot", "description": "Repeating a batch is safe. The answer's `through` is the highest t of this boot the server holds; drop everything up to it from your outbox.", "security": [{ "decoderToken": [] }, { "session": [] }], "requestBody": { "content": { "application/json": {} } }, "responses": { "200": { "description": "What was stored.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/watch/{token}": { "get": { "summary": "The watchers view's snapshot", "responses": { "200": { "description": "A snapshot without setup.", "content": { "application/json": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/watch/{token}/live": { "get": { "summary": "The watchers view's live events", "responses": { "200": { "description": "An event stream without setup events.", "content": { "text/event-stream": {} } }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/openapi.json": { "get": { "summary": "This description", "responses": { "200": { "description": "OpenAPI 3.1.", "content": { "application/vnd.oai.openapi+json": {} } } } } },
    "/.well-known/api-catalog": { "get": { "summary": "RFC 9727 API catalog", "responses": { "200": { "description": "A linkset.", "content": { "application/linkset+json": {} } } } } },
    "/problems/{name}": { "get": { "summary": "A problem type's documentation", "responses": { "302": { "description": "To its entry on /api." }, "default": { "$ref": "#/components/responses/Problem" } } } },
    "/api": { "get": { "summary": "This description as a page", "responses": { "200": { "description": "HTML.", "content": { "text/html": {} } } } } }
  },
  "components": {
    "responses": {
      "Problem": { "description": "RFC 9457 Problem Details; the type ends in one of the problem names below.", "content": { "application/problem+json": {} } }
    },
    "securitySchemes": {
      "session": { "type": "apiKey", "in": "cookie", "name": "__Host-tinylap-session", "description": "The log-in session. Writes must come from the app's own pages." },
      "decoderToken": { "type": "http", "scheme": "bearer", "description": "A decoder's token, from pairing. It can only post that decoder's passings." }
    }
  },
  "x-tinylap-problems": {
    "not-found": { "status": 404, "title": "Not found", "description": "No such route, workspace, driver, decoder, session or watchers link, or it is not one of yours." },
    "method-not-allowed": { "status": 405, "title": "Method not allowed", "description": "The Allow header lists the methods this URL supports." },
    "unavailable": { "status": 503, "title": "The service is unavailable", "description": "Timing data cannot be read or stored right now, or log-in is unavailable." },
    "unauthorized": { "status": 401, "title": "Not logged in", "description": "Log in, or send a valid decoder token." },
    "forbidden": { "status": 403, "title": "Forbidden", "description": "Your role may not do this, or the request did not come from the app's own pages." },
    "invalid-request": { "status": 422, "title": "The request is not valid", "description": "A field is missing or out of range; the detail says which." },
    "unsupported-media-type": { "status": 415, "title": "Unsupported media type", "description": "Send application/json." },
    "too-large": { "status": 413, "title": "The request is too large", "description": "A request body may be at most 64 KiB." },
    "rate-limited": { "status": 429, "title": "Too many requests", "description": "Wait for the number of seconds in Retry-After." },
    "conflict": { "status": 409, "title": "Something else is running", "description": "A qualifying or race is already running in this workspace; abort it or wait for it to end." },
    "not-a-circuit": { "status": 422, "title": "The layout is not a closed circuit", "description": "Only a closed circuit has a track to time. Close the loop in the planner and share it again." },
    "planner-unavailable": { "status": 502, "title": "The planner cannot be reached", "description": "The planner did not answer or answered with an error; try again." },
    "login-failed": { "status": 400, "title": "The log-in could not be completed", "description": "The log-in expired or was tampered with; log in again." }
  }
}
```

- [ ] **Step 5: Write the test helper and the failing test**

`apps/timing/test/server/helpers.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../../server/app.js';

export const appDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Starts the handler on a random port, without log-in. */
export async function startServer(options = {}) {
  const server = createServer(createHandler({ appDir, log: false, ...options }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  };
}
```

`apps/timing/test/server/static.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const server = await startServer();
after(() => server.close());
const get = (path, init) => fetch(server.base + path, init);

test('the app page carries its CSP and security headers', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await res.text(), /<title>TinyLap Timing<\/title>/);
});

test('the timing package is served to the browser, auth is not', async () => {
  const lib = await get('/pkg/timing/index.js');
  assert.equal(lib.status, 200);
  assert.match(lib.headers.get('content-type'), /javascript/);
  await lib.body?.cancel();
  assert.equal((await get('/pkg/auth/index.js')).status, 404);
});

test('discovery: the description, the catalog, problem types, the docs page', async () => {
  const doc = await get('/openapi.json');
  assert.equal(doc.status, 200);
  assert.equal((await doc.json()).info.title, 'TinyLap timing API');
  assert.equal((await get('/.well-known/api-catalog')).status, 200);
  const known = await get('/problems/conflict', { redirect: 'manual' });
  assert.equal(known.status, 302);
  assert.equal(known.headers.get('location'), '/api#problem-conflict');
  const unknown = await get('/problems/nope');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get('content-type'), 'application/problem+json');
  assert.match(await (await get('/api')).text(), /TinyLap timing API/);
});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/tools test`
Expected: PASS (the tools test checks the new app's import map and `<base>`).

- [ ] **Step 7: Lint, typecheck, commit**

```bash
pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck
git add apps/timing pnpm-lock.yaml
git commit -s -m "feat(timing-app): scaffold the timing server"
```

---
### Task 7: The store

**Files:**
- Create: `apps/timing/server/store.js`
- Test: `apps/timing/test/server/store.test.js`

**Interfaces:**
- Produces `openStore(path)` → a store with (all synchronous; times are epoch ms):
  - `sessions`: `@tinylap/auth`'s `SessionStore` plus `getName(id)`, `setName(id, name)` (the planner's, for `createAuth`)
  - `feedCursor(): number`, `setFeedCursor(seq)`, `deleteWorkspaceData(workspaceId)`, `forgetUser(userId)` (for `feed.js`)
  - `transaction(fn)` → `fn()`'s result, all or nothing
  - `ensureWorkspace(id)` / `workspace(id)` → `{ id, trackId: string | null, direction: 'cw' | 'ccw', watchToken: string | null }` (`workspace` returns null when unknown)
  - `setTrack(workspaceId, { id, shape, name, snapshotKey, layout }, direction)`, `track(workspaceId, trackId)` → `{ id, shape, name, snapshotKey } | null`
  - `setWatchToken(workspaceId, token)`, `workspaceByWatchToken(token)` → `string | null`
  - `drivers(ws)` → `{ id, name, colour }[]` (by name), `driver(ws, id)`, `addDriver(ws, { id, name, colour })`, `updateDriver(ws, id, { name, colour })` → `boolean`, `deleteDriver(ws, id)` → `boolean` (also unassigns its transponders)
  - `transponders(ws)` → `{ code, driverId, firstSeenAt }[]`, `seeTransponder(ws, code, at)` → `{ code, driverId, created }` (`created` is true the first time the code is seen), `assignTransponder(ws, code, driverId | null, at)`
  - `decoders(ws)` → `{ id, name, createdAt, lastSeenAt }[]`, `decoder(id)` → `{ id, workspaceId, name } | null`, `decoderByTokenHash(hash)` → `{ id, workspaceId } | null`, `addDecoder(ws, { id, name, tokenHash, createdAt })`, `deleteDecoder(ws, id)` → `boolean`, `touchDecoder(id, at)`
  - `insertPassing({ decoder, boot, transponder, t, receivedAt, via, workspaceId })` → `boolean` (false for a duplicate key), `through(decoder, boot)` → `number | null`
  - `lastReference(decoder, transponder)` → `{ boot, t } | null` (the newest crossing marked `ref`)
  - `addCrossing({ workspaceId, sessionId, decoder, boot, transponder, t, driverId, at, lapMs, counts, ref, via, flag })` → `seq`, `crossings(sessionId)` → crossing rows in order, `recentCrossings(sessionId, limit)` → newest first, `setCrossingCounts(seq, counts)`, `assignCrossings(ws, code, driverId)` → affected session ids, `lastCrossingAt(sessionId)` → `number | null`
  - crossing row: `{ seq, sessionId, decoder, boot, transponder, t, driverId, at, lapMs, counts: boolean, ref: boolean, via, flag }`
  - `addSession(session)`, `session(id)`, `updateSession(id, { state, endedAt? })`, `activeSession(ws)` (a qualifying or race in `countdown`, `running` or `finishing`), `openPractice(ws)` (a practice in `running`), `activeAll()` (every active qualifying or race), `listSessions(ws, limit)` (newest first)
  - session row: `{ id, workspaceId, kind, trackId, direction, roster: string[] | null, state, createdAt, opensAt, closesAt, endedAt, durationMs }`
  - `personalBests(ws, trackId, direction)` → `{ driverId, bestMs, at }[]`: counted, decoder-timed laps only
  - `close()`

- [ ] **Step 1: Write the failing test**

`apps/timing/test/server/store.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../../server/store.js';

const W = 'ws-1';

function practice(store, id = 's1', fields = {}) {
  store.addSession({ id, workspaceId: W, kind: 'practice', trackId: 't1', direction: 'ccw', roster: null, state: 'running', createdAt: 0, opensAt: 0, closesAt: null, endedAt: null, durationMs: null, ...fields });
  return store.session(id);
}

function crossing(store, fields) {
  return store.addCrossing({ workspaceId: W, sessionId: 's1', decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 0, driverId: null, at: 0, lapMs: null, counts: false, ref: true, via: 'net', flag: null, ...fields });
}

test('a workspace is created on first use with ccw and no track', () => {
  const store = openStore(':memory:');
  assert.equal(store.workspace(W), null);
  assert.deepEqual(store.ensureWorkspace(W), { id: W, trackId: null, direction: 'ccw', watchToken: null });
  store.setTrack(W, { id: 't1', shape: 'c30:1:x', name: 'Office', snapshotKey: 'k'.repeat(22), layout: '{}' }, 'cw');
  assert.deepEqual(store.workspace(W), { id: W, trackId: 't1', direction: 'cw', watchToken: null });
  assert.deepEqual(store.track(W, 't1'), { id: 't1', shape: 'c30:1:x', name: 'Office', snapshotKey: 'k'.repeat(22) });
});

test('a passing is stored once, and through is the highest t of its boot', () => {
  const store = openStore(':memory:');
  const p = { decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 5000, receivedAt: 1, via: 'net', workspaceId: W };
  assert.equal(store.insertPassing(p), true);
  assert.equal(store.insertPassing({ ...p, via: 'serial' }), false);
  store.insertPassing({ ...p, t: 9000 });
  store.insertPassing({ ...p, boot: 'otherboot', t: 99_000 });
  assert.equal(store.through('d1', 'b00tb00t'), 9000);
  assert.equal(store.through('d1', 'nothere1'), null);
});

test('the lap reference is the newest crossing marked ref', () => {
  const store = openStore(':memory:');
  practice(store);
  crossing(store, { t: 1000, ref: true });
  crossing(store, { t: 1100, ref: false });
  assert.deepEqual(store.lastReference('d1', '0A'), { boot: 'b00tb00t', t: 1000 });
  assert.equal(store.lastReference('d1', '0B'), null);
});

test('assigning a transponder gives its unassigned crossings to the driver', () => {
  const store = openStore(':memory:');
  practice(store);
  practice(store, 's2');
  store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  store.seeTransponder(W, '0A', 1);
  crossing(store, { t: 1, at: 1 });
  crossing(store, { sessionId: 's2', t: 2, at: 2 });
  crossing(store, { transponder: '0B', t: 3, at: 3 });
  store.assignTransponder(W, '0A', 'ana', 5);
  assert.deepEqual(store.assignCrossings(W, '0A', 'ana').sort(), ['s1', 's2']);
  assert.deepEqual(store.crossings('s1').map((c) => [c.transponder, c.driverId]), [['0A', 'ana'], ['0B', null]]);
  assert.deepEqual(store.seeTransponder(W, '0A', 9), { code: '0A', driverId: 'ana', created: false });
  assert.deepEqual(store.seeTransponder(W, '0C', 9), { code: '0C', driverId: null, created: true });
});

test('deleting a driver unassigns their transponders and keeps their laps', () => {
  const store = openStore(':memory:');
  practice(store);
  store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  store.assignTransponder(W, '0A', 'ana', 1);
  crossing(store, { driverId: 'ana', lapMs: 8000, counts: true });
  assert.equal(store.deleteDriver(W, 'ana'), true);
  assert.equal(store.deleteDriver(W, 'ana'), false);
  assert.deepEqual(store.transponders(W).map((t) => [t.code, t.driverId]), [['0A', null]]);
  assert.equal(store.crossings('s1')[0].driverId, 'ana');
});

test('personal bests: counted, decoder-timed, per track and direction', () => {
  const store = openStore(':memory:');
  practice(store);
  practice(store, 'cw', { direction: 'cw' });
  crossing(store, { driverId: 'ana', lapMs: 8000, counts: true, at: 10 });
  crossing(store, { driverId: 'ana', lapMs: 7000, counts: true, at: 20 });
  crossing(store, { driverId: 'ana', lapMs: 6000, counts: false, at: 30 });
  crossing(store, { driverId: 'ana', lapMs: 5000, counts: true, at: 40, via: 'tap' });
  crossing(store, { sessionId: 'cw', driverId: 'ana', lapMs: 4000, counts: true, at: 50 });
  assert.deepEqual(store.personalBests(W, 't1', 'ccw'), [{ driverId: 'ana', bestMs: 7000, at: 20 }]);
});

test('active and open sessions', () => {
  const store = openStore(':memory:');
  practice(store);
  assert.equal(store.openPractice(W).id, 's1');
  assert.equal(store.activeSession(W), null);
  store.addSession({ id: 'r1', workspaceId: W, kind: 'race', trackId: null, direction: 'ccw', roster: ['ana'], state: 'countdown', createdAt: 5, opensAt: 10, closesAt: 20, endedAt: null, durationMs: 10 });
  assert.deepEqual(store.activeSession(W).roster, ['ana']);
  assert.deepEqual(store.activeAll().map((s) => s.id), ['r1']);
  store.updateSession('r1', { state: 'done', endedAt: 30 });
  assert.equal(store.activeSession(W), null);
  assert.deepEqual(store.listSessions(W, 10).map((s) => s.id), ['r1', 's1']);
});

test('decoders are found by their token hash', () => {
  const store = openStore(':memory:');
  store.addDecoder(W, { id: 'd1', name: 'Gate', tokenHash: 'h1', createdAt: 1 });
  assert.deepEqual(store.decoderByTokenHash('h1'), { id: 'd1', workspaceId: W });
  assert.equal(store.decoderByTokenHash('h2'), null);
  store.touchDecoder('d1', 7);
  assert.deepEqual(store.decoders(W), [{ id: 'd1', name: 'Gate', createdAt: 1, lastSeenAt: 7 }]);
  assert.equal(store.deleteDecoder(W, 'd1'), true);
  assert.equal(store.decoder('d1'), null);
});

test('the watchers token finds its workspace', () => {
  const store = openStore(':memory:');
  store.ensureWorkspace(W);
  store.setWatchToken(W, 'tok');
  assert.equal(store.workspaceByWatchToken('tok'), W);
  store.setWatchToken(W, 'new');
  assert.equal(store.workspaceByWatchToken('tok'), null);
});

test('deleting a workspace removes all of its rows', () => {
  const store = openStore(':memory:');
  practice(store);
  store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  store.addDecoder(W, { id: 'd1', name: 'Gate', tokenHash: 'h1', createdAt: 1 });
  store.insertPassing({ decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 1, receivedAt: 1, via: 'net', workspaceId: W });
  crossing(store, {});
  store.deleteWorkspaceData(W);
  assert.equal(store.workspace(W), null);
  assert.deepEqual(store.drivers(W), []);
  assert.equal(store.decoder('d1'), null);
  assert.equal(store.session('s1'), null);
  assert.equal(store.through('d1', 'b00tb00t'), null);
});

test('a transaction is all or nothing', () => {
  const store = openStore(':memory:');
  assert.throws(() => store.transaction(() => {
    store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
    throw new Error('stop');
  }), /stop/);
  assert.deepEqual(store.drivers(W), []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `store.js` does not exist.

- [ ] **Step 3: Implement `server/store.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// SQLite (spec §3, Data). Every row belongs to a workspace, so the deletions
// feed removes a deleted one completely. Passings are stored once per key
// (spec §4); crossings are what the engine made of them, and can be rebuilt.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bff_session (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, sealed_tokens TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, name TEXT
);
CREATE INDEX IF NOT EXISTS bff_session_user ON bff_session (user_id);
CREATE TABLE IF NOT EXISTS feed_cursor (feed TEXT PRIMARY KEY, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY, track_id TEXT, direction TEXT NOT NULL DEFAULT 'ccw', watch_token TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS track (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, shape TEXT NOT NULL, name TEXT NOT NULL,
  snapshot_key TEXT NOT NULL, layout TEXT NOT NULL, PRIMARY KEY (workspace_id, id)
);
CREATE TABLE IF NOT EXISTS driver (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, colour TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS driver_workspace ON driver (workspace_id);
CREATE TABLE IF NOT EXISTS transponder (
  workspace_id TEXT NOT NULL, code TEXT NOT NULL, driver_id TEXT, first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, code)
);
CREATE TABLE IF NOT EXISTS decoder (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS decoder_workspace ON decoder (workspace_id);
CREATE TABLE IF NOT EXISTS passing (
  decoder_id TEXT NOT NULL, boot TEXT NOT NULL, transponder TEXT NOT NULL, t INTEGER NOT NULL,
  received_at INTEGER NOT NULL, via TEXT NOT NULL, workspace_id TEXT NOT NULL,
  PRIMARY KEY (decoder_id, boot, transponder, t)
);
CREATE INDEX IF NOT EXISTS passing_workspace ON passing (workspace_id);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, track_id TEXT, direction TEXT NOT NULL,
  roster TEXT, state TEXT NOT NULL, created_at INTEGER NOT NULL, opens_at INTEGER, closes_at INTEGER,
  ended_at INTEGER, duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS session_workspace ON session (workspace_id, state);
CREATE TABLE IF NOT EXISTS crossing (
  seq INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
  decoder_id TEXT NOT NULL, boot TEXT NOT NULL, transponder TEXT NOT NULL, t INTEGER NOT NULL,
  driver_id TEXT, at INTEGER NOT NULL, lap_ms INTEGER, counts INTEGER NOT NULL, ref INTEGER NOT NULL,
  via TEXT NOT NULL, flag TEXT
);
CREATE INDEX IF NOT EXISTS crossing_session ON crossing (session_id, seq);
CREATE INDEX IF NOT EXISTS crossing_reference ON crossing (decoder_id, transponder, ref, seq);
CREATE INDEX IF NOT EXISTS crossing_transponder ON crossing (workspace_id, transponder, driver_id);
`;

const ACTIVE = "('countdown', 'running', 'finishing')";

/** @param {DatabaseSync} db */
function sessionStore(db) {
  const select = db.prepare('SELECT user_id, sealed_tokens, created_at, expires_at FROM bff_session WHERE id = ?');
  const upsert = db.prepare(`INSERT INTO bff_session (id, user_id, sealed_tokens, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, sealed_tokens = excluded.sealed_tokens,
      created_at = excluded.created_at, expires_at = excluded.expires_at`);
  const remove = db.prepare('DELETE FROM bff_session WHERE id = ?');
  const removeUser = db.prepare('DELETE FROM bff_session WHERE user_id = ?');
  const selectName = db.prepare('SELECT name FROM bff_session WHERE id = ?');
  const updateName = db.prepare('UPDATE bff_session SET name = ? WHERE id = ?');
  return {
    async get(id) {
      const row = select.get(id);
      return row
        ? { userId: String(row.user_id), sealedTokens: String(row.sealed_tokens), createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) }
        : null;
    },
    async set(id, { userId, sealedTokens, createdAt, expiresAt }) {
      upsert.run(id, userId, sealedTokens, createdAt, expiresAt);
    },
    async delete(id) {
      remove.run(id);
    },
    async deleteUser(userId) {
      removeUser.run(userId);
    },
    getName(id) {
      const row = selectName.get(id);
      return row?.name == null ? null : String(row.name);
    },
    setName(id, name) {
      updateName.run(name, id);
    },
  };
}

const num = (v) => (v === null || v === undefined ? null : Number(v));
const str = (v) => (v === null || v === undefined ? null : String(v));

const workspaceOf = (r) => ({ id: String(r.id), trackId: str(r.track_id), direction: String(r.direction), watchToken: str(r.watch_token) });
const sessionOf = (r) => ({
  id: String(r.id), workspaceId: String(r.workspace_id), kind: String(r.kind), trackId: str(r.track_id), direction: String(r.direction),
  roster: r.roster === null ? null : JSON.parse(String(r.roster)), state: String(r.state), createdAt: Number(r.created_at),
  opensAt: num(r.opens_at), closesAt: num(r.closes_at), endedAt: num(r.ended_at), durationMs: num(r.duration_ms),
});
const crossingOf = (r) => ({
  seq: Number(r.seq), sessionId: String(r.session_id), decoder: String(r.decoder_id), boot: String(r.boot), transponder: String(r.transponder),
  t: Number(r.t), driverId: str(r.driver_id), at: Number(r.at), lapMs: num(r.lap_ms), counts: r.counts === 1, ref: r.ref === 1,
  via: String(r.via), flag: str(r.flag),
});

/** @param {string} path A file path, or ':memory:'. */
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const q = (sql) => db.prepare(sql);

  const s = {
    selectWorkspace: q('SELECT * FROM workspace WHERE id = ?'),
    insertWorkspace: q('INSERT INTO workspace (id) VALUES (?) ON CONFLICT DO NOTHING'),
    setTrackOf: q('UPDATE workspace SET track_id = ?, direction = ? WHERE id = ?'),
    upsertTrack: q(`INSERT INTO track (workspace_id, id, shape, name, snapshot_key, layout) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, id) DO UPDATE SET shape = excluded.shape, name = excluded.name,
        snapshot_key = excluded.snapshot_key, layout = excluded.layout`),
    selectTrack: q('SELECT id, shape, name, snapshot_key FROM track WHERE workspace_id = ? AND id = ?'),
    setWatch: q('UPDATE workspace SET watch_token = ? WHERE id = ?'),
    byWatch: q('SELECT id FROM workspace WHERE watch_token = ?'),
    drivers: q('SELECT id, name, colour FROM driver WHERE workspace_id = ? ORDER BY name COLLATE NOCASE, id'),
    driver: q('SELECT id, name, colour FROM driver WHERE workspace_id = ? AND id = ?'),
    addDriver: q('INSERT INTO driver (id, workspace_id, name, colour) VALUES (?, ?, ?, ?)'),
    updateDriver: q('UPDATE driver SET name = ?, colour = ? WHERE workspace_id = ? AND id = ?'),
    deleteDriver: q('DELETE FROM driver WHERE workspace_id = ? AND id = ?'),
    unassignDriver: q('UPDATE transponder SET driver_id = NULL WHERE workspace_id = ? AND driver_id = ?'),
    transponders: q('SELECT code, driver_id, first_seen_at FROM transponder WHERE workspace_id = ? ORDER BY code'),
    seeTransponder: q('INSERT INTO transponder (workspace_id, code, first_seen_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'),
    transponder: q('SELECT code, driver_id FROM transponder WHERE workspace_id = ? AND code = ?'),
    assignTransponder: q(`INSERT INTO transponder (workspace_id, code, driver_id, first_seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (workspace_id, code) DO UPDATE SET driver_id = excluded.driver_id`),
    decoders: q('SELECT id, name, created_at, last_seen_at FROM decoder WHERE workspace_id = ? ORDER BY created_at, id'),
    decoder: q('SELECT id, workspace_id, name FROM decoder WHERE id = ?'),
    decoderByHash: q('SELECT id, workspace_id FROM decoder WHERE token_hash = ?'),
    addDecoder: q('INSERT INTO decoder (id, workspace_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    deleteDecoder: q('DELETE FROM decoder WHERE workspace_id = ? AND id = ?'),
    touchDecoder: q('UPDATE decoder SET last_seen_at = ? WHERE id = ?'),
    insertPassing: q(`INSERT INTO passing (decoder_id, boot, transponder, t, received_at, via, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`),
    through: q('SELECT MAX(t) AS t FROM passing WHERE decoder_id = ? AND boot = ?'),
    lastReference: q('SELECT boot, t FROM crossing WHERE decoder_id = ? AND transponder = ? AND ref = 1 ORDER BY seq DESC LIMIT 1'),
    addCrossing: q(`INSERT INTO crossing (workspace_id, session_id, decoder_id, boot, transponder, t, driver_id, at, lap_ms, counts, ref, via, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    crossings: q('SELECT * FROM crossing WHERE session_id = ? ORDER BY seq'),
    recentCrossings: q('SELECT * FROM crossing WHERE session_id = ? ORDER BY seq DESC LIMIT ?'),
    setCounts: q('UPDATE crossing SET counts = ? WHERE seq = ?'),
    unassignedSessions: q("SELECT DISTINCT session_id FROM crossing WHERE workspace_id = ? AND transponder = ? AND driver_id IS NULL AND via != 'tap'"),
    assignCrossings: q("UPDATE crossing SET driver_id = ? WHERE workspace_id = ? AND transponder = ? AND driver_id IS NULL AND via != 'tap'"),
    lastCrossingAt: q('SELECT MAX(at) AS at FROM crossing WHERE session_id = ?'),
    addSession: q(`INSERT INTO session (id, workspace_id, kind, track_id, direction, roster, state, created_at, opens_at, closes_at, ended_at, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    session: q('SELECT * FROM session WHERE id = ?'),
    updateSession: q('UPDATE session SET state = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?'),
    activeSession: q(`SELECT * FROM session WHERE workspace_id = ? AND kind != 'practice' AND state IN ${ACTIVE} ORDER BY created_at DESC LIMIT 1`),
    openPractice: q("SELECT * FROM session WHERE workspace_id = ? AND kind = 'practice' AND state = 'running' ORDER BY created_at DESC LIMIT 1"),
    activeAll: q(`SELECT * FROM session WHERE kind != 'practice' AND state IN ${ACTIVE} ORDER BY created_at`),
    listSessions: q('SELECT * FROM session WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'),
    // SQLite: with one MIN(), the bare column `at` comes from the row holding the minimum.
    personalBests: q(`SELECT c.driver_id, MIN(c.lap_ms) AS best_ms, c.at FROM crossing c JOIN session s ON s.id = c.session_id
      WHERE c.workspace_id = ? AND s.track_id = ? AND s.direction = ? AND c.counts = 1 AND c.via != 'tap' AND c.driver_id IS NOT NULL
      GROUP BY c.driver_id ORDER BY best_ms`),
    selectCursor: q('SELECT seq FROM feed_cursor WHERE feed = ?'),
    upsertCursor: q('INSERT INTO feed_cursor (feed, seq) VALUES (?, ?) ON CONFLICT (feed) DO UPDATE SET seq = excluded.seq'),
  };
  const purge = ['workspace WHERE id', 'track WHERE workspace_id', 'driver WHERE workspace_id', 'transponder WHERE workspace_id',
    'decoder WHERE workspace_id', 'passing WHERE workspace_id', 'session WHERE workspace_id', 'crossing WHERE workspace_id']
    .map((t) => q(`DELETE FROM ${t} = ?`));

  let depth = 0;
  /** @template T @param {() => T} fn @returns {T} */
  function transaction(fn) {
    const name = `t${depth++}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw error;
    } finally {
      depth -= 1;
    }
  }

  const workspace = (id) => {
    const row = s.selectWorkspace.get(id);
    return row ? workspaceOf(row) : null;
  };
  const session = (id) => {
    const row = s.session.get(id);
    return row ? sessionOf(row) : null;
  };

  return {
    sessions: sessionStore(db),
    transaction,
    feedCursor() {
      const row = s.selectCursor.get('deletions');
      return row ? Number(row.seq) : 0;
    },
    setFeedCursor(seq) {
      s.upsertCursor.run('deletions', seq);
    },
    deleteWorkspaceData(workspaceId) {
      transaction(() => {
        for (const statement of purge) statement.run(workspaceId);
      });
    },
    // Timing keeps no user names: drivers are records, not accounts.
    forgetUser() {},

    workspace,
    ensureWorkspace(id) {
      s.insertWorkspace.run(id);
      return workspace(id);
    },
    setTrack(workspaceId, { id, shape, name, snapshotKey, layout }, direction) {
      transaction(() => {
        s.insertWorkspace.run(workspaceId);
        s.upsertTrack.run(workspaceId, id, shape, name, snapshotKey, layout);
        s.setTrackOf.run(id, direction, workspaceId);
      });
    },
    track(workspaceId, trackId) {
      const r = s.selectTrack.get(workspaceId, trackId);
      return r ? { id: String(r.id), shape: String(r.shape), name: String(r.name), snapshotKey: String(r.snapshot_key) } : null;
    },
    setWatchToken(workspaceId, token) {
      s.insertWorkspace.run(workspaceId);
      s.setWatch.run(token, workspaceId);
    },
    workspaceByWatchToken(token) {
      return str(s.byWatch.get(token)?.id);
    },

    drivers: (ws) => s.drivers.all(ws).map((r) => ({ id: String(r.id), name: String(r.name), colour: String(r.colour) })),
    driver(ws, id) {
      const r = s.driver.get(ws, id);
      return r ? { id: String(r.id), name: String(r.name), colour: String(r.colour) } : null;
    },
    addDriver(ws, { id, name, colour }) {
      s.addDriver.run(id, ws, name, colour);
    },
    updateDriver: (ws, id, { name, colour }) => s.updateDriver.run(name, colour, ws, id).changes === 1,
    deleteDriver(ws, id) {
      return transaction(() => {
        s.unassignDriver.run(ws, id);
        return s.deleteDriver.run(ws, id).changes === 1;
      });
    },

    transponders: (ws) => s.transponders.all(ws).map((r) => ({ code: String(r.code), driverId: str(r.driver_id), firstSeenAt: Number(r.first_seen_at) })),
    seeTransponder(ws, code, at) {
      const created = s.seeTransponder.run(ws, code, at).changes === 1;
      const r = s.transponder.get(ws, code);
      return { code: String(r.code), driverId: str(r.driver_id), created };
    },
    assignTransponder(ws, code, driverId, at) {
      s.assignTransponder.run(ws, code, driverId, at);
    },

    decoders: (ws) => s.decoders.all(ws).map((r) => ({ id: String(r.id), name: String(r.name), createdAt: Number(r.created_at), lastSeenAt: num(r.last_seen_at) })),
    decoder(id) {
      const r = s.decoder.get(id);
      return r ? { id: String(r.id), workspaceId: String(r.workspace_id), name: String(r.name) } : null;
    },
    decoderByTokenHash(hash) {
      const r = s.decoderByHash.get(hash);
      return r ? { id: String(r.id), workspaceId: String(r.workspace_id) } : null;
    },
    addDecoder(ws, { id, name, tokenHash, createdAt }) {
      s.addDecoder.run(id, ws, name, tokenHash, createdAt);
    },
    deleteDecoder: (ws, id) => s.deleteDecoder.run(ws, id).changes === 1,
    touchDecoder(id, at) {
      s.touchDecoder.run(at, id);
    },

    insertPassing: ({ decoder, boot, transponder, t, receivedAt, via, workspaceId }) =>
      s.insertPassing.run(decoder, boot, transponder, t, receivedAt, via, workspaceId).changes === 1,
    through: (decoder, boot) => num(s.through.get(decoder, boot)?.t),
    lastReference(decoder, transponder) {
      const r = s.lastReference.get(decoder, transponder);
      return r ? { boot: String(r.boot), t: Number(r.t) } : null;
    },
    addCrossing(c) {
      const result = s.addCrossing.run(c.workspaceId, c.sessionId, c.decoder, c.boot, c.transponder, c.t, c.driverId, c.at, c.lapMs, c.counts ? 1 : 0, c.ref ? 1 : 0, c.via, c.flag ?? null);
      return Number(result.lastInsertRowid);
    },
    crossings: (sessionId) => s.crossings.all(sessionId).map(crossingOf),
    recentCrossings: (sessionId, limit) => s.recentCrossings.all(sessionId, limit).map(crossingOf),
    setCrossingCounts(seq, counts) {
      s.setCounts.run(counts ? 1 : 0, seq);
    },
    assignCrossings(ws, code, driverId) {
      return transaction(() => {
        const ids = s.unassignedSessions.all(ws, code).map((r) => String(r.session_id));
        s.assignCrossings.run(driverId, ws, code);
        return ids;
      });
    },
    lastCrossingAt: (sessionId) => num(s.lastCrossingAt.get(sessionId)?.at),

    addSession(x) {
      s.addSession.run(x.id, x.workspaceId, x.kind, x.trackId, x.direction, x.roster === null ? null : JSON.stringify(x.roster), x.state, x.createdAt, x.opensAt, x.closesAt, x.endedAt, x.durationMs);
    },
    session,
    updateSession(id, { state, endedAt = null }) {
      s.updateSession.run(state, endedAt, id);
    },
    activeSession(ws) {
      const r = s.activeSession.get(ws);
      return r ? sessionOf(r) : null;
    },
    openPractice(ws) {
      const r = s.openPractice.get(ws);
      return r ? sessionOf(r) : null;
    },
    activeAll: () => s.activeAll.all().map(sessionOf),
    listSessions: (ws, limit) => s.listSessions.all(ws, limit).map(sessionOf),

    personalBests: (ws, trackId, direction) => s.personalBests.all(ws, trackId, direction).map((r) => ({ driverId: String(r.driver_id), bestMs: Number(r.best_ms), at: Number(r.at) })),

    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/timing
git commit -s -m "feat(timing-app): store passings, crossings, sessions and setup in SQLite"
```

---

### Task 8: The live hub

**Files:**
- Create: `apps/timing/server/live.js`
- Test: `apps/timing/test/server/live.test.js`

**Interfaces:**
- Produces `createHub({ now?, keepMs? = 600_000 })` →
  - `publish(workspaceId, type, data, watcherData?)`: `watcherData` `undefined` → watchers get `data`; `null` → members only; anything else → what watchers get instead.
  - `subscribe(workspaceId, { lastEventId: number | null, watcher: boolean, tag?: string }, send)` → `{ replay: 'events' | 'snapshot', unsubscribe() }`. `send({ id, type, data })` is called for every event. With a `lastEventId` still in the log, the events after it are sent at once and `replay` is `'events'`; otherwise `'snapshot'` (the caller sends a snapshot).
  - `lastId(): number`
  - `closeTagged(workspaceId, tag)`: ends the subscriptions with that tag (their `onClose` runs). `subscribe`'s options take `onClose?: () => void`.

- [ ] **Step 1: Write the failing test**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../../server/live.js';

const collect = () => {
  const got = [];
  return { got, send: (e) => got.push(e) };
};

test('subscribers get what is published in their workspace', () => {
  const hub = createHub();
  const a = collect();
  const b = collect();
  hub.subscribe('w1', { lastEventId: null, watcher: false }, a.send);
  hub.subscribe('w2', { lastEventId: null, watcher: false }, b.send);
  hub.publish('w1', 'crossing', { lapMs: 8000 });
  assert.deepEqual(a.got, [{ id: 1, type: 'crossing', data: { lapMs: 8000 } }]);
  assert.deepEqual(b.got, []);
});

test('watchers get the watcher version, or nothing for members-only events', () => {
  const hub = createHub();
  const w = collect();
  hub.subscribe('w1', { lastEventId: null, watcher: true }, w.send);
  hub.publish('w1', 'crossing', { transponder: '0A', lapMs: 8000 }, { lapMs: 8000 });
  hub.publish('w1', 'setup', { unknown: ['0B'] }, null);
  hub.publish('w1', 'drivers', [{ id: 'ana' }]);
  assert.deepEqual(w.got.map((e) => [e.type, e.data]), [['crossing', { lapMs: 8000 }], ['drivers', [{ id: 'ana' }]]]);
});

test('a reconnect gets the events after its last id, or a snapshot', () => {
  const hub = createHub();
  hub.publish('w1', 'a', 1);
  hub.publish('w1', 'b', 2);
  hub.publish('w1', 'c', 3);
  const r = collect();
  assert.equal(hub.subscribe('w1', { lastEventId: 1, watcher: false }, r.send).replay, 'events');
  assert.deepEqual(r.got.map((e) => e.type), ['b', 'c']);
  assert.equal(hub.subscribe('w1', { lastEventId: 99, watcher: false }, () => {}).replay, 'snapshot');
  assert.equal(hub.subscribe('w1', { lastEventId: null, watcher: false }, () => {}).replay, 'snapshot');
  assert.equal(hub.lastId(), 3);
});

test('events older than the window are forgotten', () => {
  let t = 0;
  const hub = createHub({ now: () => t, keepMs: 1000 });
  hub.publish('w1', 'old', 1);
  t = 2000;
  hub.publish('w1', 'new', 2);
  assert.equal(hub.subscribe('w1', { lastEventId: 1, watcher: false }, () => {}).replay, 'snapshot');
  assert.equal(hub.subscribe('w1', { lastEventId: 2, watcher: false }, () => {}).replay, 'events');
});

test('unsubscribe and closeTagged stop delivery', () => {
  const hub = createHub();
  const a = collect();
  const b = collect();
  let closed = 0;
  const sub = hub.subscribe('w1', { lastEventId: null, watcher: false }, a.send);
  hub.subscribe('w1', { lastEventId: null, watcher: true, tag: 'tok', onClose: () => { closed += 1; } }, b.send);
  sub.unsubscribe();
  hub.closeTagged('w1', 'tok');
  hub.publish('w1', 'x', 1);
  assert.deepEqual(a.got, []);
  assert.deepEqual(b.got, []);
  assert.equal(closed, 1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `live.js` does not exist.

- [ ] **Step 3: Implement `server/live.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Live events per workspace (spec §7): a log of the last ten minutes, so a
// reconnecting client gets what it missed, and fan-out to subscribers.
// Watchers see a redacted version of each event, or none (setup events).
// Ids restart with the process; an id the log doesn't hold means "send a
// snapshot", which is also right after a restart.

/**
 * @typedef {{ id: number, type: string, data: unknown, watcher: unknown, at: number }} LiveEvent
 * @typedef {{ id: number, type: string, data: unknown }} Sent
 * @typedef {{ watcher: boolean, tag: string | null, send: (event: Sent) => void, onClose: (() => void) | null }} Subscriber
 */

/** @param {{ now?: () => number, keepMs?: number }} [options] */
export function createHub({ now = Date.now, keepMs = 600_000 } = {}) {
  let next = 1;
  /** @type {Map<string, LiveEvent[]>} */
  const log = new Map();
  /** @type {Map<string, Set<Subscriber>>} */
  const subscribers = new Map();

  /** @param {Subscriber} sub @param {LiveEvent} event */
  const deliver = (sub, event) => {
    const data = sub.watcher ? event.watcher : event.data;
    if (data !== null) sub.send({ id: event.id, type: event.type, data });
  };
  /** @param {string} workspaceId */
  const events = (workspaceId) => {
    const list = log.get(workspaceId) ?? [];
    const cutoff = now() - keepMs;
    while (list.length && list[0].at < cutoff) list.shift();
    log.set(workspaceId, list);
    return list;
  };

  return {
    /** @param {string} workspaceId @param {string} type @param {unknown} data @param {unknown} [watcherData] */
    publish(workspaceId, type, data, watcherData) {
      const event = { id: next++, type, data, watcher: watcherData === undefined ? data : watcherData, at: now() };
      events(workspaceId).push(event);
      for (const sub of subscribers.get(workspaceId) ?? []) deliver(sub, event);
    },
    /**
     * @param {string} workspaceId
     * @param {{ lastEventId: number | null, watcher: boolean, tag?: string, onClose?: () => void }} options
     * @param {(event: Sent) => void} send
     */
    subscribe(workspaceId, { lastEventId, watcher, tag, onClose }, send) {
      /** @type {Subscriber} */
      const sub = { watcher, tag: tag ?? null, send, onClose: onClose ?? null };
      /** @type {'events' | 'snapshot'} */
      let replay = 'snapshot';
      if (lastEventId !== null) {
        const list = events(workspaceId);
        const i = list.findIndex((e) => e.id === lastEventId);
        if (i !== -1) {
          replay = 'events';
          for (const event of list.slice(i + 1)) deliver(sub, event);
        }
      }
      const set = subscribers.get(workspaceId) ?? new Set();
      subscribers.set(workspaceId, set);
      set.add(sub);
      return {
        replay,
        unsubscribe: () => void set.delete(sub),
      };
    },
    lastId: () => next - 1,
    /** Ends every subscription tagged `tag` (a rotated watchers token). @param {string} workspaceId @param {string} tag */
    closeTagged(workspaceId, tag) {
      const set = subscribers.get(workspaceId);
      if (!set) return;
      for (const sub of [...set]) {
        if (sub.tag !== tag) continue;
        set.delete(sub);
        sub.onClose?.();
      }
    },
  };
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/timing
git commit -s -m "feat(timing-app): fan live events out, with replay and watcher redaction"
```

---
### Task 9: The engine: passings to crossings, practice and tap

**Files:**
- Create: `apps/timing/server/engine.js`
- Test: `apps/timing/test/server/rig.js` (shared fixture), `apps/timing/test/server/engine.test.js`

**Interfaces:**
- Consumes: the store (Task 7), the hub (Task 8), `nextLap`, `applyCrossing`, `emptyState`, `standings`, `isComplete`, `MIN_LAP_MS`, `MAX_LAP_MS` from `@tinylap/timing`.
- Produces from `server/engine.js`:
  - `PRACTICE_GAP_MS = 1_800_000`
  - `memberCrossing(row)`, `watcherCrossing(row)` (null for unassigned cars; never a transponder code), `publicSession(session)` (the session without `workspaceId`)
  - `createEngine({ store, hub, now?, minLap?, maxLap?, practiceGap? })` → `{ ingest, tap, ... }` (Task 10 adds more):
    - `ingest({ workspaceId, decoder, via: 'serial' | 'net', batch })` → `{ stored, duplicates, through }`
    - `tap(workspaceId, driverId)` → the crossing row, or `null` if two taps fell on the same millisecond
  - Events it publishes (`hub.publish`): `session` (`publicSession` + `now`), `crossing` (member / watcher versions), `standings` (`{ sessionId, standings }`), `results` (same shape, when a qualifying or race ends), `setup` (`{ unknown: string[] }`, members only).

- [ ] **Step 1: Write the failing test**

`apps/timing/test/server/rig.js` (a fixture, not a test file, so importing it doesn't run tests twice):

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { openStore } from '../../server/store.js';
import { createHub } from '../../server/live.js';
import { createEngine } from '../../server/engine.js';

export const W = 'ws-1';
export const BOOT = 'b00tb00t';
export const T0 = 1_000_000_000_000;

/** An engine on a fresh store with a clock the test moves. Decoder t and the clock move together. */
export function rig() {
  const store = openStore(':memory:');
  const hub = createHub({ now: () => clock.now });
  const clock = { now: T0 };
  const engine = createEngine({ store, hub, now: () => clock.now });
  const events = [];
  hub.subscribe(W, { lastEventId: null, watcher: false }, (e) => events.push(e));
  store.addDriver(W, { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  store.addDriver(W, { id: 'ben', name: 'Ben', colour: '#2d9bff' });
  store.assignTransponder(W, '0A', 'ana', 0);
  store.assignTransponder(W, '0B', 'ben', 0);
  /** Posts one passing at decoder time `t`, received at T0 + t. */
  const pass = (t, transponder = '0A', boot = BOOT) => {
    clock.now = T0 + t;
    return engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot, passings: [{ transponder, t }] } });
  };
  return { store, hub, engine, clock, events, pass };
}
```

`apps/timing/test/server/engine.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOT, T0, W, rig } from './rig.js';

test('passings become laps in a practice session', () => {
  const { store, events, pass } = rig();
  pass(1000);
  pass(9000);
  pass(17_100);
  const practice = store.openPractice(W);
  assert.deepEqual(store.crossings(practice.id).map((c) => [c.lapMs, c.counts]), [[null, false], [8000, true], [8100, true]]);
  const standings = events.filter((e) => e.type === 'standings').at(-1).data;
  assert.deepEqual(standings.standings.map((s) => [s.driverId, s.bestMs, s.laps]), [['ana', 8000, 2]]);
  assert.ok(events.some((e) => e.type === 'session' && e.data.kind === 'practice'));
});

test('a batch posted twice is stored once', () => {
  const { engine, store } = rig();
  const batch = { boot: BOOT, passings: [{ transponder: '0A', t: 1000 }, { transponder: '0A', t: 9000 }] };
  assert.deepEqual(engine.ingest({ workspaceId: W, decoder: 'd1', via: 'serial', batch }), { stored: 2, duplicates: 0, through: 9000 });
  assert.deepEqual(engine.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch }), { stored: 0, duplicates: 2, through: 9000 });
  assert.equal(store.crossings(store.openPractice(W).id).length, 2);
});

test('an unknown transponder is announced once and its laps wait for a driver', () => {
  const { store, events, pass } = rig();
  pass(1000, '0C');
  pass(9000, '0C');
  const setup = events.filter((e) => e.type === 'setup');
  assert.deepEqual(setup.map((e) => e.data), [{ unknown: ['0C'] }]);
  const rows = store.crossings(store.openPractice(W).id);
  assert.deepEqual(rows.map((c) => [c.driverId, c.lapMs, c.counts]), [[null, null, false], [null, 8000, false]]);
});

test('watchers never see transponder codes or unknown cars', () => {
  const { hub, pass } = rig();
  const seen = [];
  hub.subscribe(W, { lastEventId: null, watcher: true }, (e) => seen.push(e));
  pass(1000, '0C');
  pass(2000, '0A');
  const crossings = seen.filter((e) => e.type === 'crossing');
  assert.equal(crossings.length, 1);
  assert.equal(crossings[0].data.driverId, 'ana');
  assert.equal('transponder' in crossings[0].data, false);
  assert.equal(seen.some((e) => e.type === 'setup'), false);
});

test('after 30 minutes without a passing, practice starts a new session', () => {
  const { store, pass } = rig();
  pass(1000);
  const first = store.openPractice(W).id;
  pass(1000 + 30 * 60_000);
  assert.equal(store.openPractice(W).id, first);
  pass(2000 + 61 * 60_000);
  const second = store.openPractice(W);
  assert.notEqual(second.id, first);
  assert.equal(store.session(first).state, 'done');
});

test('late passings are mapped with the freshest offset of their batch', () => {
  const { engine, store, clock } = rig();
  // The bridge was offline: three passings arrive together, long after the first.
  clock.now = T0 + 120_000;
  engine.ingest({ workspaceId: W, decoder: 'd1', via: 'serial', batch: { boot: BOOT, passings: [{ transponder: '0A', t: 1000 }, { transponder: '0A', t: 9000 }, { transponder: '0A', t: 119_000 }] } });
  const ats = store.crossings(store.openPractice(W).id).map((c) => c.at);
  assert.deepEqual(ats, [T0 + 2000, T0 + 10_000, T0 + 120_000]);
});

test('a passing older than the reference is stored and flagged, without a lap', () => {
  const { store, pass } = rig();
  pass(1000);
  pass(9000);
  pass(5000);
  const last = store.crossings(store.openPractice(W).id).at(-1);
  assert.deepEqual([last.t, last.lapMs, last.counts, last.flag], [5000, null, false, 'backwards']);
});

test('tap entry makes tap laps that never count as personal bests', () => {
  const { engine, store, clock } = rig();
  store.setTrack(W, { id: 't1', shape: 'c30:1:x', name: 'Office', snapshotKey: 'k'.repeat(22), layout: '{}' }, 'ccw');
  clock.now = T0;
  engine.tap(W, 'ben');
  clock.now = T0 + 8000;
  const row = engine.tap(W, 'ben');
  assert.deepEqual([row.lapMs, row.counts, row.via], [8000, true, 'tap']);
  assert.equal(engine.tap(W, 'ben'), null, 'same millisecond');
  assert.deepEqual(store.personalBests(W, 't1', 'ccw'), []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `engine.js` does not exist.

- [ ] **Step 3: Implement `server/engine.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Passings become crossings (spec §4–§6). The engine stores each passing
// once, computes its lap from the transponder's previous reference passing,
// puts it in the running qualifying or race, or in practice, and publishes
// what changed. Session state lives in memory as a cache over the stored
// crossings, so a restart only replays them.
import { randomUUID } from 'node:crypto';
import { MAX_LAP_MS, MIN_LAP_MS, applyCrossing, emptyState, isComplete, nextLap, standings } from '@tinylap/timing';

export const PRACTICE_GAP_MS = 30 * 60_000;
/** Offsets older than this don't count for mapping decoder time (spec §6). */
const OFFSET_WINDOW_MS = 60_000;
const ACTIVE = new Set(['countdown', 'running', 'finishing']);

/** What members see of a crossing. */
export const memberCrossing = (c) => ({
  seq: c.seq, sessionId: c.sessionId, driverId: c.driverId, transponder: c.transponder,
  at: c.at, lapMs: c.lapMs, counts: c.counts, via: c.via, flag: c.flag,
});
/** What watchers see: no transponder codes, nothing of unassigned cars. */
export const watcherCrossing = (c) => (c.driverId === null ? null : {
  seq: c.seq, sessionId: c.sessionId, driverId: c.driverId, at: c.at, lapMs: c.lapMs, counts: c.counts, via: c.via,
});
/** A session as clients see it: everything but its workspace. */
export function publicSession(session) {
  const out = { ...session };
  delete out.workspaceId;
  return out;
}

/**
 * @param {{ store: ReturnType<typeof import('./store.js').openStore>, hub: ReturnType<typeof import('./live.js').createHub>,
 *   now?: () => number, minLap?: number, maxLap?: number, practiceGap?: number }} options
 */
export function createEngine({ store, hub, now = Date.now, minLap = MIN_LAP_MS, maxLap = MAX_LAP_MS, practiceGap = PRACTICE_GAP_MS }) {
  /** `${decoder} ${boot}` → recent receive offsets. */
  const offsets = new Map();
  /** Session id → state, for open sessions. */
  const states = new Map();

  const rulesOf = (s) => ({ kind: s.kind, roster: s.roster, opensAt: s.opensAt, closesAt: s.closesAt });
  function replay(session) {
    const state = emptyState();
    const rules = rulesOf(session);
    for (const c of store.crossings(session.id)) applyCrossing(rules, state, c);
    return state;
  }
  function stateOf(session) {
    let state = states.get(session.id);
    if (!state) {
      state = replay(session);
      states.set(session.id, state);
    }
    return state;
  }
  const standingsOf = (session) => standings(rulesOf(session), ACTIVE.has(session.state) ? stateOf(session) : replay(session));
  const unknownOf = (workspaceId) => store.transponders(workspaceId).filter((t) => t.driverId === null).map((t) => t.code);

  const publishSession = (session) => hub.publish(session.workspaceId, 'session', { ...publicSession(session), now: now() });
  const publishStandings = (session) => hub.publish(session.workspaceId, 'standings', { sessionId: session.id, standings: standingsOf(session) });

  function createSession(workspaceId, fields) {
    const ws = store.ensureWorkspace(workspaceId);
    const session = { id: randomUUID(), workspaceId, trackId: ws.trackId, direction: ws.direction, createdAt: now(), endedAt: null, roster: null, durationMs: null, ...fields };
    store.addSession(session);
    publishSession(session);
    return session;
  }
  function endSession(session, endedAt, state = 'done') {
    store.updateSession(session.id, { state, endedAt });
    const ended = { ...session, state, endedAt };
    states.delete(session.id);
    publishSession(ended);
    if (session.kind !== 'practice') hub.publish(session.workspaceId, 'results', { sessionId: session.id, standings: standingsOf(ended) });
    return ended;
  }
  /** The open practice, or a new one after a long enough pause (spec §6). */
  function practiceFor(workspaceId, at) {
    const open = store.openPractice(workspaceId);
    if (open) {
      const last = store.lastCrossingAt(open.id) ?? open.opensAt;
      if (at - last <= practiceGap) return open;
      endSession(open, last);
    }
    return createSession(workspaceId, { kind: 'practice', state: 'running', opensAt: at, closesAt: null });
  }

  /** Records every passing's receive offset first, so a late batch maps by its newest passing. */
  function noteOffsets(decoder, boot, passings, receivedAt) {
    const key = `${decoder} ${boot}`;
    const list = (offsets.get(key) ?? []).filter((o) => o.receivedAt >= receivedAt - OFFSET_WINDOW_MS);
    for (const p of passings) list.push({ receivedAt, offset: receivedAt - p.t });
    offsets.set(key, list);
  }
  /** Server time of decoder time `t`: the smallest offset seen in the last minute. */
  function mapped(decoder, boot, t) {
    let best = Infinity;
    for (const o of offsets.get(`${decoder} ${boot}`)) best = Math.min(best, o.offset);
    return t + best;
  }

  function cross(workspaceId, passing, { at, driverId, via }) {
    const reference = store.lastReference(passing.decoder, passing.transponder);
    const step = nextLap(reference, { boot: passing.boot, t: passing.t }, { minLap, maxLap });
    const lapMs = step.kind === 'lap' ? step.ms : null;
    const session = store.activeSession(workspaceId) ?? practiceFor(workspaceId, at);
    const counts = applyCrossing(rulesOf(session), stateOf(session), { driverId, at, lapMs });
    const row = {
      workspaceId, sessionId: session.id, ...passing, driverId, at, lapMs, counts, via,
      ref: step.kind === 'start' || step.kind === 'lap',
      flag: step.kind === 'backwards' || step.kind === 'double' ? step.kind : null,
    };
    row.seq = store.addCrossing(row);
    hub.publish(workspaceId, 'crossing', memberCrossing(row), watcherCrossing(row));
    if (counts) publishStandings(session);
    if (session.state === 'finishing' && isComplete(rulesOf(session), stateOf(session), now(), maxLap)) endSession(session, now());
    return row;
  }

  /** Stores a batch (spec §5). Repeating it is safe. */
  function ingest({ workspaceId, decoder, via, batch }) {
    const receivedAt = now();
    const sorted = [...batch.passings].sort((a, b) => a.t - b.t);
    noteOffsets(decoder, batch.boot, sorted, receivedAt);
    return store.transaction(() => {
      let stored = 0;
      let seen = false;
      for (const p of sorted) {
        const passing = { decoder, boot: batch.boot, transponder: p.transponder, t: p.t };
        if (!store.insertPassing({ ...passing, receivedAt, via, workspaceId })) continue;
        stored += 1;
        const { driverId, created } = store.seeTransponder(workspaceId, p.transponder, receivedAt);
        seen ||= created;
        cross(workspaceId, passing, { at: mapped(decoder, batch.boot, p.t), driverId, via });
      }
      store.touchDecoder(decoder, receivedAt);
      if (seen) hub.publish(workspaceId, 'setup', { unknown: unknownOf(workspaceId) }, null);
      return { stored, duplicates: sorted.length - stored, through: store.through(decoder, batch.boot) };
    });
  }

  /** A passing by hand (spec §4): a virtual decoder per workspace, a boot per session, server time. */
  function tap(workspaceId, driverId) {
    const t = now();
    return store.transaction(() => {
      const session = store.activeSession(workspaceId) ?? practiceFor(workspaceId, t);
      const passing = { decoder: `tap:${workspaceId}`, boot: session.id, transponder: driverId, t };
      if (!store.insertPassing({ ...passing, receivedAt: t, via: 'tap', workspaceId })) return null;
      return cross(workspaceId, passing, { at: t, driverId, via: 'tap' });
    });
  }

  return { ingest, tap };
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/timing
git commit -s -m "feat(timing-app): turn passings into crossings, practice sessions and tap laps"
```

---

### Task 10: The engine: qualifying, races, assignment, snapshots

**Files:**
- Modify: `apps/timing/server/engine.js`
- Test: `apps/timing/test/server/engine-sessions.test.js`

**Interfaces:**
- Consumes: `rig`, `W`, `T0` from `test/server/rig.js` (Task 9).
- Produces, added to `createEngine`'s result:
  - `start(workspaceId, { kind: 'qualifying' | 'race', roster: string[], durationMs: number, countdownMs?: number })` → `{ session } | { error: 'conflict' }`. Ends the open practice.
  - `abort(workspaceId, sessionId)` → the ended session, or `null`.
  - `tick()`: moves `countdown` → `running` at `opensAt`, `running` → `finishing` at `closesAt`, `finishing` → `done` when `isComplete`. `server/main.js` calls it every 250 ms.
  - `assign(workspaceId, code, driverId | null)`: assigns, gives unassigned crossings to the driver, recounts the affected sessions.
  - `restartPractice(workspaceId)`: ends the open practice (after a track or direction change).
  - `snapshot(workspaceId, { watcher?: boolean })` → `{ now, track: { id, name } | null, direction, session, standings, crossings, drivers, bests, unknown? }` (`unknown` only for members; `crossings` newest first, at most 30).
  - `sessionDetail(workspaceId, sessionId)` → `{ session, standings, crossings } | null` (crossings in order).

- [ ] **Step 1: Write the failing test**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../server/engine.js';
import { T0, W, rig } from './rig.js';

test('a race: countdown, start crossings, laps, time up, finish, results', () => {
  const { engine, store, clock, events, pass } = rig();
  pass(1000);
  clock.now = T0 + 2000;
  const { session } = engine.start(W, { kind: 'race', roster: ['ana', 'ben'], durationMs: 60_000, countdownMs: 10_000 });
  assert.equal(session.state, 'countdown');
  assert.equal(store.openPractice(W), null, 'practice ended');
  assert.deepEqual(engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 1000 }), { error: 'conflict' });

  pass(9000); // before go: ignored
  clock.now = T0 + 12_000;
  engine.tick();
  assert.equal(store.session(session.id).state, 'running');
  pass(12_500); // ana's start
  pass(12_700, '0B'); // ben's start
  pass(20_500);
  pass(20_900, '0B');
  pass(28_500);
  clock.now = T0 + 72_000;
  engine.tick();
  assert.equal(store.session(session.id).state, 'finishing');
  pass(73_000); // ana's next crossing (a 44 500 ms lap) finishes her
  assert.equal(store.session(session.id).state, 'finishing', 'ben is still out');
  pass(78_000, '0B'); // ben finishes too (57 100 ms): the race is over
  assert.equal(store.session(session.id).state, 'done');
  const results = events.filter((e) => e.type === 'results').at(-1).data;
  assert.deepEqual(results.standings.map((s) => [s.driverId, s.laps, s.finished]), [['ana', 3, true], ['ben', 2, true]]);
  assert.equal(results.standings[0].elapsedMs, 500 + 8000 + 8000 + 44_500);

  pass(200_000);
  assert.equal(store.openPractice(W).kind, 'practice', 'practice resumes');
});

test('qualifying: a window, best lap, complete once everyone crossed after the close', () => {
  const { engine, store, clock, events, pass } = rig();
  pass(1000);
  clock.now = T0 + 5000;
  const { session } = engine.start(W, { kind: 'qualifying', roster: ['ana'], durationMs: 30_000 });
  assert.equal(session.state, 'running');
  pass(9000); // lap began at 1000, before the window
  pass(17_000);
  pass(25_500);
  pass(33_000);
  clock.now = T0 + 35_000;
  engine.tick();
  assert.equal(store.session(session.id).state, 'finishing');
  pass(41_000); // began 33 000, before the close at 35 000: counts, and ana crossed after the close
  assert.equal(store.session(session.id).state, 'done');
  const results = events.filter((e) => e.type === 'results').at(-1).data;
  assert.deepEqual(results.standings.map((s) => [s.driverId, s.bestMs, s.laps]), [['ana', 7500, 4]]);
});

test('abort ends a race at once', () => {
  const { engine, store, clock } = rig();
  const { session } = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 60_000, countdownMs: 0 });
  clock.now += 1000;
  assert.equal(engine.abort(W, session.id).state, 'aborted');
  assert.equal(store.session(session.id).state, 'aborted');
  assert.equal(engine.abort(W, session.id), null);
  assert.equal(engine.abort('other', session.id), null);
});

test('assigning a transponder recounts its laps', () => {
  const { engine, store, events, pass } = rig();
  store.addDriver(W, { id: 'cy', name: 'Cy', colour: '#2dff9b' });
  pass(1000, '0C');
  pass(9000, '0C');
  engine.assign(W, '0C', 'cy');
  const rows = store.crossings(store.openPractice(W).id);
  assert.deepEqual(rows.map((c) => [c.driverId, c.counts]), [['cy', false], ['cy', true]]);
  assert.deepEqual(events.filter((e) => e.type === 'standings').at(-1).data.standings.map((s) => s.driverId), ['cy']);
  assert.deepEqual(events.filter((e) => e.type === 'setup').at(-1).data, { unknown: [] });
});

test('a restart in the middle of a race finishes it from what is stored', () => {
  const { engine, store, hub, clock, pass } = rig();
  const { session } = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 30_000, countdownMs: 0 });
  pass(1000);
  pass(9000);
  // A new process: the same database, a new engine.
  const again = createEngine({ store, hub, now: () => clock.now });
  clock.now = T0 + 17_000;
  again.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 17_000 }] } });
  clock.now = T0 + 31_000;
  again.tick();
  clock.now = T0 + 33_000;
  again.ingest({ workspaceId: W, decoder: 'd1', via: 'net', batch: { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 33_000 }] } });
  assert.equal(store.session(session.id).state, 'done');
  assert.deepEqual(again.sessionDetail(W, session.id).standings.map((s) => [s.laps, s.finished]), [[3, true]]);
});

test('a decoder reboot mid-race costs one lap, not the race', () => {
  const { engine, store, pass } = rig();
  const { session } = engine.start(W, { kind: 'race', roster: ['ana'], durationMs: 120_000, countdownMs: 0 });
  pass(1000);
  pass(9000);
  pass(500, '0A', 'n3wb00t1'); // after the reboot: a start, no lap
  pass(8500, '0A', 'n3wb00t1');
  const detail = engine.sessionDetail(W, session.id);
  assert.deepEqual(detail.crossings.map((c) => [c.lapMs, c.counts]), [[null, false], [8000, true], [null, false], [8000, true]]);
  assert.equal(detail.standings[0].laps, 2);
  assert.equal(store.session(session.id).state, 'running');
});

test('the snapshot: members get setup, watchers do not', () => {
  const { engine, store, pass } = rig();
  store.setTrack(W, { id: 't1', shape: 'c30:1:x', name: 'Office', snapshotKey: 'k'.repeat(22), layout: '{}' }, 'cw');
  engine.restartPractice(W);
  pass(1000);
  pass(9000);
  pass(9500, '0C');
  const member = engine.snapshot(W);
  assert.deepEqual(member.track, { id: 't1', name: 'Office' });
  assert.equal(member.direction, 'cw');
  assert.equal(member.session.kind, 'practice');
  assert.deepEqual(member.standings.map((s) => s.driverId), ['ana']);
  assert.equal(member.crossings[0].transponder, '0C', 'newest first');
  assert.deepEqual(member.unknown, ['0C']);
  assert.deepEqual(member.bests, [{ driverId: 'ana', bestMs: 8000, at: member.crossings[1].at }]);
  assert.deepEqual(member.drivers.map((d) => d.id), ['ana', 'ben']);
  const watcher = engine.snapshot(W, { watcher: true });
  assert.equal('unknown' in watcher, false);
  assert.equal(watcher.crossings.length, 2);
  assert.ok(watcher.crossings.every((c) => !('transponder' in c)));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `engine.start` is not a function.

- [ ] **Step 3: Add the functions to `createEngine`**

Insert before `return { ingest, tap };` in `server/engine.js`:

```js
  function setState(session, state) {
    store.updateSession(session.id, { state });
    const next = { ...session, state };
    publishSession(next);
    return next;
  }

  /** Starts a qualifying or race (spec §6); one at a time per workspace. */
  function start(workspaceId, { kind, roster, durationMs, countdownMs = 0 }) {
    return store.transaction(() => {
      if (store.activeSession(workspaceId)) return { error: 'conflict' };
      const t = now();
      const open = store.openPractice(workspaceId);
      if (open) endSession(open, store.lastCrossingAt(open.id) ?? t);
      const opensAt = kind === 'race' ? t + countdownMs : t;
      const state = kind === 'race' && countdownMs > 0 ? 'countdown' : 'running';
      return { session: createSession(workspaceId, { kind, roster, durationMs, state, opensAt, closesAt: opensAt + durationMs }) };
    });
  }

  function abort(workspaceId, sessionId) {
    const session = store.session(sessionId);
    if (!session || session.workspaceId !== workspaceId || session.kind === 'practice' || !ACTIVE.has(session.state)) return null;
    return endSession(session, now(), 'aborted');
  }

  /** Moves sessions along their states as time passes. */
  function tick() {
    const t = now();
    for (let session of store.activeAll()) {
      if (session.state === 'countdown' && t >= session.opensAt) session = setState(session, 'running');
      if (session.state === 'running' && t >= session.closesAt) session = setState(session, 'finishing');
      if (session.state === 'finishing' && isComplete(rulesOf(session), stateOf(session), t, maxLap)) endSession(session, t);
    }
  }

  /** Recounts a session's crossings from scratch, after drivers changed. */
  function rebuild(sessionId) {
    const session = store.session(sessionId);
    const rules = rulesOf(session);
    const state = emptyState();
    for (const c of store.crossings(sessionId)) {
      const counts = applyCrossing(rules, state, c);
      if (counts !== c.counts) store.setCrossingCounts(c.seq, counts);
    }
    if (ACTIVE.has(session.state)) states.set(sessionId, state);
    else states.delete(sessionId);
    publishStandings(session);
  }

  function assign(workspaceId, code, driverId) {
    store.transaction(() => {
      store.assignTransponder(workspaceId, code, driverId, now());
      if (driverId !== null) for (const id of store.assignCrossings(workspaceId, code, driverId)) rebuild(id);
    });
    hub.publish(workspaceId, 'setup', { unknown: unknownOf(workspaceId) }, null);
  }

  /** A new track or direction starts a new practice (spec §6). */
  function restartPractice(workspaceId) {
    const open = store.openPractice(workspaceId);
    if (open) endSession(open, store.lastCrossingAt(open.id) ?? now());
  }

  function snapshot(workspaceId, { watcher = false } = {}) {
    const ws = store.ensureWorkspace(workspaceId);
    const session = store.activeSession(workspaceId) ?? store.openPractice(workspaceId);
    const track = ws.trackId ? store.track(workspaceId, ws.trackId) : null;
    const recent = session ? store.recentCrossings(session.id, 30) : [];
    return {
      now: now(),
      track: track && { id: track.id, name: track.name },
      direction: ws.direction,
      session: session && publicSession(session),
      standings: session ? standingsOf(session) : [],
      crossings: watcher ? recent.map(watcherCrossing).filter(Boolean) : recent.map(memberCrossing),
      drivers: store.drivers(workspaceId),
      bests: track ? store.personalBests(workspaceId, track.id, ws.direction) : [],
      ...(watcher ? {} : { unknown: unknownOf(workspaceId) }),
    };
  }

  function sessionDetail(workspaceId, sessionId) {
    const session = store.session(sessionId);
    if (!session || session.workspaceId !== workspaceId) return null;
    return { session: publicSession(session), standings: standingsOf(session), crossings: store.crossings(sessionId).map(memberCrossing) };
  }
```

and change the return to:

```js
  return { ingest, tap, start, abort, tick, assign, restartPractice, snapshot, sessionDetail };
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/timing
git commit -s -m "feat(timing-app): run qualifying and races, recount on assignment, serve snapshots"
```

---
### Task 11: Log-in, workspace access and the workspace snapshot

**Files:**
- Copy from `apps/track-planner/server/`: `auth.js`, `feed.js`
- Create: `apps/timing/server/body.js`, `apps/timing/server/access.js`, `apps/timing/server/workspace.js`
- Modify: `apps/timing/server/routes.js`
- Modify: `apps/timing/test/server/helpers.js` (add `startTiming`)
- Test: `apps/timing/test/server/auth.test.js`, `apps/timing/test/server/feed.test.js`

**Interfaces:**
- Consumes: `createBff` through the copied `createAuth`; `can` from `@tinylap/auth`; `engine.snapshot` (Task 10).
- Produces:
  - `createAuth(...)`, `withSession(handler)`, `authRoutes` (auth.js, as in the planner)
  - `startFeed({ issuer, token, store, ... })` (feed.js, as in the planner)
  - `readJson(request, max?: number = 65_536)` → `{ body: object } | { error: Response }` (body.js)
  - `clientOf(request)` → a rate-limit bucket for the request's client (body.js)
  - `workspaceRoute(action, handler, { write?: boolean })` (access.js): 401 without a session, 404 when not a member, 403 when the role may not or a write is cross-origin, 503 without a store; sets `request.workspaceId` and `request.userId`, and ensures the workspace row.
  - `NO_STORE = { 'Cache-Control': 'no-store' }` (access.js)
  - `GET /workspaces/{id}` → `engine.snapshot(id)`
  - test helper `startTiming(options)` → `{ base, store, hub, engine, suite, clock, signUp(name), club(owner, name), join(owner, clubId, member, role?), login(user), api(who, method, path, body?, headers?), close() }`; `who` is a login (`{ jar }`) or `null`. `options.clock` (`{ now }`) drives the engine, hub and limiters; `options.limits` and `options.plannerUrl` pass through to `createHandler`.

- [ ] **Step 1: Copy `auth.js` and `feed.js`, and adapt their wording**

```bash
cp apps/track-planner/server/auth.js apps/track-planner/server/feed.js apps/timing/server/
```

In `apps/timing/server/auth.js`:
- Header comment: replace "Log-in to TinyLap (identity spec §6): the planner is a backend-for-frontend" with "Log-in to TinyLap (identity spec §6): the timing app is a backend-for-frontend", and "Without `auth` in the handler's context, log-in is off and the planner is anonymous only." with "Without `auth` in the handler's context, log-in is off and every workspace route answers 401."
- `"${UNAVAILABLE} The planner still works; try again in a minute."` → `"${UNAVAILABLE} Timing keeps recording; try again in a minute."`
- `<a href="/">Back to the planner</a>` → `<a href="/">Back to timing</a>`
- `"Log out from the planner's own page."` → `"Log out from the app's own page."`
- the `createAuth` doc comment: "Log-in for a planner served at `publicUrl`" → "Log-in for the app served at `publicUrl`".

In `apps/timing/server/feed.js`, replace the header comment's first paragraph with:

```js
// The deletions feed (identity spec §7). accounts lists every deleted user
// and workspace in order; the timing app removes what it holds for them (a
// user's sessions; everything of a workspace) and keeps the highest seq it
// processed, so each row is handled once. Read on start and hourly.
// Processing is idempotent, so a crash between a row and the cursor only
// repeats work.
```

(keep the second paragraph about holding rows for one token lifetime unchanged).

- [ ] **Step 2: Write `body.js`, `access.js`, `workspace.js` and the routes**

`server/body.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Reading request bodies, and naming the client for rate limits.
import { clientBucket } from '@tinylap/auth';
import { mediaType } from './negotiate.js';
import { problem } from './responses.js';

export const MAX_BODY = 64 * 1024;

/** Reads at most `max` bytes; past that it drains the rest and returns null. */
export async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= max) chunks.push(chunk);
  }
  return size > max ? null : Buffer.concat(chunks).toString('utf8');
}

/** The JSON object body, or a problem response. */
export async function readJson(request, max = MAX_BODY) {
  const { req } = request;
  if (mediaType(req.headers['content-type']) !== 'application/json') {
    req.resume();
    return { error: problem(request, 'unsupported-media-type', 'Send the request as application/json.') };
  }
  const tooLarge = () => ({ error: problem(request, 'too-large', 'A request body may be at most 64 KiB.') });
  if (Number(req.headers['content-length'] ?? 0) > max) {
    req.resume();
    return tooLarge();
  }
  const text = await readBody(req, max);
  if (text === null) return tooLarge();
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return { body };
  } catch {
    // answered below
  }
  return { error: problem(request, 'invalid-request', 'The body must be a JSON object.') };
}

/** Only a configured header names the client: an unconfigured one is just a forgery. */
export function clientOf(request) {
  const value = request.clientIpHeader && request.req.headers[request.clientIpHeader];
  return clientBucket(typeof value === 'string' && value ? value : request.req.socket.remoteAddress ?? 'unknown');
}

/** A 429 with Retry-After. @param {any} request @param {number} wait seconds */
export const rateLimited = (request, wait) => problem(request, 'rate-limited', `Try again in ${wait} seconds.`, { 'Retry-After': String(wait) });
```

`server/access.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Access to a workspace's timing (spec §9): the token's `workspaces` claim
// through can(). Not a member is 404, like a workspace that doesn't exist;
// a role that may not is 403; every write must come from the app's pages.
import { can } from '@tinylap/auth';
import { withSession } from './auth.js';
import { problem } from './responses.js';

export const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * @param {string} action an @tinylap/auth action @param {(request: any, match: RegExpExecArray) => any} handler
 * @param {{ write?: boolean }} [options]
 */
export function workspaceRoute(action, handler, { write = false } = {}) {
  return withSession(async (request, match) => {
    const workspaceId = match[1];
    const refuse = (name, detail) => {
      request.req.resume();
      return problem(request, name, detail);
    };
    if (!request.session) return refuse('unauthorized', 'Log in to use timing.');
    const { claims } = request.session;
    if (!(claims.workspaces ?? []).some((w) => w.id === workspaceId)) return refuse('not-found', 'There is no such workspace, or you are not a member.');
    if (!can(claims, workspaceId, action)) return refuse('forbidden', 'Your role in this workspace may not do this.');
    if (write && !request.auth.bff.requireSameOrigin(request.req)) return refuse('forbidden', "Change timing from the app's own pages.");
    if (!request.store) return refuse('unavailable', 'Timing data cannot be read or stored right now.');
    request.workspaceId = workspaceId;
    request.userId = request.session.userId;
    request.store.ensureWorkspace(workspaceId);
    return handler(request, match);
  });
}
```

`server/workspace.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /workspaces/{id}: everything a screen needs to draw the board now.
import { NO_STORE, workspaceRoute } from './access.js';
import { json } from './responses.js';

export const workspaceRoutes = [
  {
    pattern: /^\/workspaces\/([^/]+)$/,
    credentials: true,
    methods: { GET: workspaceRoute('timing.run', (request) => json(200, request.engine.snapshot(request.workspaceId), NO_STORE)) },
  },
];
```

`server/routes.js` becomes:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every route, in matching order. The first pattern that matches wins.
import { authRoutes } from './auth.js';
import { discoveryRoutes } from './discovery.js';
import { workspaceRoutes } from './workspace.js';

export const routes = [
  ...authRoutes,
  ...workspaceRoutes,
  ...discoveryRoutes,
];
```

- [ ] **Step 3: Extend the test helper**

Append to `apps/timing/test/server/helpers.js` (and merge the imports at the top):

```js
import { randomBytes } from 'node:crypto';
import { openStore } from '../../server/store.js';
import { createHub } from '../../server/live.js';
import { createEngine } from '../../server/engine.js';
import { createAuth } from '../../server/auth.js';
import { driveAuthorize, Jar, startSuite } from '../../../../tools/test-env.js';
import { testSession } from '../../../accounts/test/helpers.js';
import { createClub, createInvite, redeemInvite, setRole } from '../../../accounts/server/workspaces.js';

/**
 * The timing app with log-in on, against a real accounts (tools/test-env.js).
 * The server listens first, so accounts can register its port.
 * @param {{ clock?: { now: number }, hostname?: string, env?: Record<string, string>, [key: string]: any }} [options]
 */
export async function startTiming(options = {}) {
  const { clock, hostname, env, ...rest } = options;
  const now = clock ? () => clock.now : Date.now;
  const store = openStore(':memory:');
  const hub = createHub({ now });
  const engine = createEngine({ store, hub, now });
  let handler = (_req, res) => res.writeHead(503).end();
  const server = createServer((req, res) => handler(req, res));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suite = await startSuite({ plannerPort: server.address().port, hostname, env });
  const auth = createAuth({
    issuer: suite.issuer, clientId: suite.clientId, clientSecret: suite.clientSecret,
    keys: [{ id: 'k1', key: randomBytes(32) }], publicUrl: base, sessions: store.sessions,
    logger: { warn: () => {} },
  });
  handler = createHandler({ appDir, log: false, store, hub, engine, auth, publicUrl: base, now, ...rest });
  const db = suite.accounts.db;

  /** A new accounts user. */
  const signUp = async (name) => (await suite.signInUser(undefined, name)).user;
  /** A club owned by `owner`. */
  const club = (owner, name = 'Office') => createClub(db, owner.id, name);
  /** Adds `member` to `clubId` with `role`. */
  function join(owner, clubId, member, role = 'member') {
    const { link } = createInvite(db, owner.id, clubId);
    redeemInvite(db, member.id, link.split('/').pop());
    if (role !== 'member') setRole(db, owner.id, clubId, member.id, role);
  }
  /** Logs `user` in through the app's routes. Memberships must exist first: the token carries them. */
  async function login(user) {
    const jar = new Jar();
    const start = await fetch(`${base}/auth/login?returnTo=%2F`, { redirect: 'manual' });
    jar.store(start);
    const back = await driveAuthorize(start.headers.get('location'), await testSession(suite.accounts.auth, user.id));
    const callback = await fetch(back.headers.get('location'), { redirect: 'manual', headers: { cookie: jar.header() } });
    jar.store(callback);
    return { jar, user };
  }
  /** A call as `who` (a login, or null), from the app's own origin. */
  function api(who, method, path, body, headers = {}) {
    return fetch(base + path, {
      method,
      headers: {
        origin: base,
        ...(who ? { cookie: who.jar.header() } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  return {
    base, store, hub, engine, suite, clock, signUp, club, join, login, api,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await suite.close();
    },
  };
}
```

`testSession(auth, userId)` returns an accounts cookie `Jar` standing in for a passkey sign-in, and `driveAuthorize(url, jar)` takes it.

- [ ] **Step 4: Write the failing tests**

`apps/timing/test/server/auth.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let owner;
let stranger;
let office;

before(async () => {
  app = await startTiming();
  const ana = await app.signUp('Ana');
  const zed = await app.signUp('Zed');
  office = app.club(ana, 'Office');
  owner = await app.login(ana);
  stranger = await app.login(zed);
});
after(() => app.close());

const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  assert.equal((await res.json()).type, `${app.base}/problems/${name}`);
};

test('who is logged in, with their workspaces', async () => {
  const out = await (await app.api(null, 'GET', '/auth/me')).json();
  assert.deepEqual(out, { loggedIn: false, available: true });
  const me = await (await app.api(owner, 'GET', '/auth/me')).json();
  assert.equal(me.loggedIn, true);
  assert.ok(me.workspaces.some((w) => w.id === office.id && w.role === 'owner'));
});

test('the workspace snapshot needs a member', async () => {
  await problemOf(await app.api(null, 'GET', `/workspaces/${office.id}`), 401, 'unauthorized');
  await problemOf(await app.api(stranger, 'GET', `/workspaces/${office.id}`), 404, 'not-found');
  const res = await app.api(owner, 'GET', `/workspaces/${office.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS on credentials routes');
  const snapshot = await res.json();
  assert.deepEqual([snapshot.session, snapshot.track, snapshot.direction, snapshot.standings, snapshot.unknown], [null, null, 'ccw', [], []]);
});
```

`apps/timing/test/server/feed.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../../server/store.js';
import { startFeed } from '../../server/feed.js';

test('the deletions feed removes a deleted workspace and a deleted user', async () => {
  const store = openStore(':memory:');
  store.ensureWorkspace('w1');
  store.addDriver('w1', { id: 'ana', name: 'Ana', colour: '#ff2d9b' });
  await store.sessions.set('s1', { userId: 'u1', sealedTokens: 'x', createdAt: 0, expiresAt: Date.now() + 60_000 });
  const pages = [
    { deletions: [{ seq: 1, kind: 'workspace', id: 'w1', deletedAt: '2026-01-01T00:00:00Z' }, { seq: 2, kind: 'user', id: 'u1', deletedAt: '2026-01-01T00:00:00Z' }] },
    { deletions: [] },
  ];
  const feed = startFeed({
    issuer: 'http://accounts.test', token: 't', store, poll: false, logger: { warn: () => {} },
    fetch: async () => new Response(JSON.stringify(pages.shift()), { headers: { 'content-type': 'application/json' } }),
  });
  assert.deepEqual(await feed.poll(), { processed: 2 });
  feed.stop();
  assert.equal(store.workspace('w1'), null);
  assert.deepEqual(store.drivers('w1'), []);
  assert.equal(await store.sessions.get('s1'), null);
  assert.equal(store.feedCursor(), 2);
});
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: PASS. If `auth.test.js` fails in `login`, compare with `apps/track-planner/test/server/helpers.js`'s `login`, which this mirrors.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck
git add apps/timing
git commit -s -m "feat(timing-app): log in through accounts and guard workspace routes"
```

---
### Task 12: Setup: drivers, transponders, decoders, track, watchers link

**Files:**
- Create: `apps/timing/server/planner.js`, `apps/timing/server/setup.js`
- Modify: `apps/timing/server/routes.js`
- Test: `apps/timing/test/server/planner-stub.js` (fixture), `apps/timing/test/server/planner.test.js`, `apps/timing/test/server/setup.test.js`

**Interfaces:**
- Consumes: `workspaceRoute`, `NO_STORE` (access.js), `readJson`, `rateLimited` (body.js), `engine.assign`, `engine.restartPractice` (Task 10), `transponderCode` (`@tinylap/timing`), `DIRECTIONS`, `KEY_PATTERN`, `isTrack`, `parseLayout`, `canonicalJson` (`@tinylap/track-format`).
- Produces:
  - `TrackError` with `code: 'invalid' | 'not-a-circuit' | 'unavailable'`, and `fetchTrack(plannerUrl, link, { fetch?, timeoutMs? })` → `{ id, shape, snapshotKey, layout }` (planner.js). Only `plannerUrl`'s origin, only `/layouts/<key>`.
  - `tokenHash(token)` → SHA-256 hex (setup.js), used by ingest (Task 13).
  - `COLOURS` (setup.js): the default driver colours, in order.
  - `setupRoutes` (setup.js), with these bodies and answers:
    - `GET /workspaces/{w}/drivers` → `{ drivers }`; `POST` `{ name, colour? }` → 201 driver; `PATCH /drivers/{id}` `{ name?, colour? }` → 200 driver; `DELETE` (admin) → 204
    - `GET /workspaces/{w}/transponders` → `{ transponders }`; `PUT /transponders/{code}` `{ driverId: string | null }` → 200 `{ code, driverId }`
    - `GET /workspaces/{w}/decoders` → `{ decoders }`; `POST` `{ name? }` → 201 `{ id, name, token }`; `DELETE /decoders/{id}` (admin) → 204
    - `PUT /workspaces/{w}/track` `{ link, name?, direction }` → 200 `{ id, name, direction, snapshotKey }`
    - `GET /workspaces/{w}/watch-token` → `{ token: string | null }`; `POST` → 200 `{ token }`, closing watcher streams on the old token
  - Events: `drivers` (all drivers, to everyone), `track` (`{ track: { id, name }, direction, bests }`, to everyone), `setup` (`{ unknown }`, members only).

- [ ] **Step 1: Write the failing planner test**

`apps/timing/test/server/planner-stub.js` (a fixture, imported by more than one test file):

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';
import { assignTrack, canonicalJson, createLayout, stockL } from '@tinylap/track-format';

export const CLOSED = 'A'.repeat(22);
export const OPEN = 'B'.repeat(22);
export const closed = assignTrack(createLayout({ pieces: stockL() }));

/** A pretend planner serving one closed and one open layout. */
export async function startPlannerStub() {
  const layouts = { [CLOSED]: canonicalJson(closed), [OPEN]: canonicalJson(createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] })) };
  const server = createServer((req, res) => {
    const key = /^\/layouts\/([^/]+)$/.exec(req.url ?? '')?.[1];
    if (req.headers.accept !== 'application/json' || !key || !layouts[key]) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(layouts[key]);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) };
}
```

`apps/timing/test/server/planner.test.js`:

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `planner.js` does not exist.

- [ ] **Step 3: Implement `server/planner.js`**

```js
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
  if (!key || !KEY_PATTERN.test(key)) throw new TrackError('invalid', 'The link must be a shared layout (/layouts/…).');
  let res;
  try {
    res = await fetchImpl(`${planner.origin}/layouts/${key}`, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new TrackError('unavailable', 'The planner cannot be reached right now.', { cause: error });
  }
  if (res.status === 404) throw new TrackError('invalid', 'The planner has no shared layout under this link.');
  if (!res.ok) throw new TrackError('unavailable', `The planner answered ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_LAYOUT) throw new TrackError('invalid', 'The layout is too large.');
  let layout;
  try {
    layout = parseLayout(text);
  } catch {
    throw new TrackError('invalid', 'The planner sent something that is not a layout.');
  }
  if (!isTrack(layout.track)) throw new TrackError('not-a-circuit', 'This layout is not a closed circuit, so it has no track to time.');
  return { id: layout.track.id, shape: layout.track.shape, snapshotKey: key, layout: canonicalJson(layout) };
}
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: `planner.test.js` passes.

- [ ] **Step 4: Write the failing setup test**

`apps/timing/test/server/setup.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';
import { CLOSED, OPEN, closed, startPlannerStub } from './planner-stub.js';

let app;
let planner;
let owner;
let member;
let admin;
let stranger;
let office;
let path;

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ plannerUrl: planner.url, limits: { pair: 3 } });
  const [ana, ben, cy, zed] = await Promise.all(['Ana', 'Ben', 'Cy', 'Zed'].map((n) => app.signUp(n)));
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  app.join(ana, office.id, cy, 'admin');
  [owner, member, admin, stranger] = await Promise.all([ana, ben, cy, zed].map((u) => app.login(u)));
  path = (rest) => `/workspaces/${office.id}/${rest}`;
});
after(async () => {
  await app.close();
  await planner.close();
});

const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal((await res.json()).type, `${app.base}/problems/${name}`);
};

test('members add, rename and list drivers', async () => {
  const res = await app.api(member, 'POST', path('drivers'), { name: '  Ana  ' });
  assert.equal(res.status, 201);
  const ana = await res.json();
  assert.deepEqual([ana.name, ana.colour], ['Ana', '#ff2d9b']);
  const second = await (await app.api(member, 'POST', path('drivers'), { name: 'Ben', colour: '#ABCDEF' })).json();
  assert.equal(second.colour, '#abcdef');
  const renamed = await (await app.api(member, 'PATCH', path(`drivers/${ana.id}`), { name: 'Ana P.' })).json();
  assert.deepEqual([renamed.name, renamed.colour], ['Ana P.', '#ff2d9b']);
  const { drivers } = await (await app.api(member, 'GET', path('drivers'))).json();
  assert.deepEqual(drivers.map((d) => d.name), ['Ana P.', 'Ben']);
});

test('bad driver input, strangers and cross-origin writes are refused', async () => {
  await problemOf(await app.api(member, 'POST', path('drivers'), { name: '' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'POST', path('drivers'), { name: 'x'.repeat(61) }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'POST', path('drivers'), { name: 'C', colour: 'red' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'PATCH', path('drivers/nope'), { name: 'X' }), 404, 'not-found');
  await problemOf(await app.api(stranger, 'POST', path('drivers'), { name: 'Z' }), 404, 'not-found');
  await problemOf(await app.api(member, 'POST', path('drivers'), { name: 'Z' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), 403, 'forbidden');
});

test('assigning a transponder; deleting its driver unassigns it', async () => {
  const cy = await (await app.api(member, 'POST', path('drivers'), { name: 'Cy' })).json();
  const put = await app.api(member, 'PUT', path('transponders/4a1f'), { driverId: cy.id });
  assert.deepEqual(await put.json(), { code: '4A1F', driverId: cy.id });
  await problemOf(await app.api(member, 'PUT', path('transponders/zz'), { driverId: cy.id }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'PUT', path('transponders/4a1f'), { driverId: 'nobody' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'DELETE', path(`drivers/${cy.id}`)), 403, 'forbidden');
  assert.equal((await app.api(admin, 'DELETE', path(`drivers/${cy.id}`))).status, 204);
  const { transponders } = await (await app.api(member, 'GET', path('transponders'))).json();
  assert.deepEqual(transponders.map((t) => [t.code, t.driverId]), [['4A1F', null]]);
  await problemOf(await app.api(admin, 'DELETE', path(`drivers/${cy.id}`)), 404, 'not-found');
});

test('pairing a decoder answers its token once', async () => {
  const res = await app.api(member, 'POST', path('decoders'), { name: 'Start line' });
  assert.equal(res.status, 201);
  const decoder = await res.json();
  assert.match(decoder.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(app.store.decoderByTokenHash(decoder.token), null, 'only a hash is stored');
  const { decoders } = await (await app.api(member, 'GET', path('decoders'))).json();
  assert.deepEqual(decoders.map((d) => [d.id, d.name, 'token' in d]), [[decoder.id, 'Start line', false]]);
  await problemOf(await app.api(member, 'DELETE', path(`decoders/${decoder.id}`)), 403, 'forbidden');
  assert.equal((await app.api(admin, 'DELETE', path(`decoders/${decoder.id}`))).status, 204);
});

test('pairing is rate limited per member', async () => {
  // The limit is 3 per hour here; the test above used one.
  assert.equal((await app.api(member, 'POST', path('decoders'), {})).status, 201);
  assert.equal((await app.api(member, 'POST', path('decoders'), {})).status, 201);
  const res = await app.api(member, 'POST', path('decoders'), {});
  await problemOf(res, 429, 'rate-limited');
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

test('the current track comes from a planner link', async () => {
  const res = await app.api(member, 'PUT', path('track'), { link: `${planner.url}/layouts/${CLOSED}`, name: 'Office loop', direction: 'cw' });
  assert.deepEqual(await res.json(), { id: closed.track.id, name: 'Office loop', direction: 'cw', snapshotKey: CLOSED });
  const snapshot = await (await app.api(member, 'GET', `/workspaces/${office.id}`)).json();
  assert.deepEqual([snapshot.track, snapshot.direction], [{ id: closed.track.id, name: 'Office loop' }, 'cw']);
  await problemOf(await app.api(member, 'PUT', path('track'), { link: `${planner.url}/layouts/${OPEN}`, direction: 'cw' }), 422, 'not-a-circuit');
  await problemOf(await app.api(member, 'PUT', path('track'), { link: `${planner.url}/layouts/${CLOSED}`, direction: 'up' }), 422, 'invalid-request');
  await problemOf(await app.api(member, 'PUT', path('track'), { link: 'https://elsewhere.example/layouts/x', direction: 'cw' }), 422, 'invalid-request');
});

test('a new watchers token replaces the old one', async () => {
  assert.deepEqual(await (await app.api(member, 'GET', path('watch-token'))).json(), { token: null });
  const first = (await (await app.api(member, 'POST', path('watch-token'))).json()).token;
  const second = (await (await app.api(member, 'POST', path('watch-token'))).json()).token;
  assert.match(first, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(first, second);
  assert.equal(app.store.workspaceByWatchToken(first), null);
  assert.equal(app.store.workspaceByWatchToken(second), office.id);
});
```

- [ ] **Step 5: Implement `server/setup.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A workspace's setup (spec §8 Setup): drivers, transponders, decoders and
// pairing, the current track and the watchers link. Every route reads the
// session cookie; deleting needs `timing.delete` (owners and admins).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DIRECTIONS } from '@tinylap/track-format';
import { transponderCode } from '@tinylap/timing';
import { NO_STORE, workspaceRoute } from './access.js';
import { rateLimited, readJson } from './body.js';
import { TrackError, fetchTrack } from './planner.js';
import { json, problem } from './responses.js';

/** Driver colours, handed out in order (palace's accents first). */
export const COLOURS = ['#ff2d9b', '#2d9bff', '#ffb82d', '#2dff9b', '#b82dff', '#ff5a2d', '#2dfff0', '#f0ff2d'];
const MAX_NAME = 60;
const MAX_DRIVERS = 200;
const COLOUR = /^#[0-9a-f]{6}$/i;

/** SHA-256, hex: what is stored of a decoder token. @param {string} token */
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

const nameOf = (value) => {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
};
const colourOf = (value) => (typeof value === 'string' && COLOUR.test(value) ? value.toLowerCase() : null);
const invalid = (request, detail) => problem(request, 'invalid-request', detail);
const notFound = (request, what) => problem(request, 'not-found', `There is no such ${what} in this workspace.`);

const publishDrivers = (request) => request.hub.publish(request.workspaceId, 'drivers', request.store.drivers(request.workspaceId));
const publishUnknown = (request) => request.hub.publish(request.workspaceId, 'setup', {
  unknown: request.store.transponders(request.workspaceId).filter((t) => t.driverId === null).map((t) => t.code),
}, null);

const listDrivers = (request) => json(200, { drivers: request.store.drivers(request.workspaceId) }, NO_STORE);

async function addDriver(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const name = nameOf(body.name);
  if (!name) return invalid(request, 'A driver needs a name of 1 to 60 characters.');
  const existing = request.store.drivers(request.workspaceId);
  if (existing.length >= MAX_DRIVERS) return invalid(request, `A workspace holds at most ${MAX_DRIVERS} drivers.`);
  const colour = body.colour === undefined ? COLOURS[existing.length % COLOURS.length] : colourOf(body.colour);
  if (!colour) return invalid(request, '`colour` must be #rrggbb.');
  const driver = { id: randomUUID(), name, colour };
  request.store.addDriver(request.workspaceId, driver);
  publishDrivers(request);
  return json(201, driver, NO_STORE);
}

async function updateDriver(request, match) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const current = request.store.driver(request.workspaceId, match[2]);
  if (!current) return notFound(request, 'driver');
  const name = body.name === undefined ? current.name : nameOf(body.name);
  if (!name) return invalid(request, 'A driver needs a name of 1 to 60 characters.');
  const colour = body.colour === undefined ? current.colour : colourOf(body.colour);
  if (!colour) return invalid(request, '`colour` must be #rrggbb.');
  request.store.updateDriver(request.workspaceId, current.id, { name, colour });
  publishDrivers(request);
  return json(200, { id: current.id, name, colour }, NO_STORE);
}

function deleteDriver(request, match) {
  if (!request.store.deleteDriver(request.workspaceId, match[2])) return notFound(request, 'driver');
  publishDrivers(request);
  publishUnknown(request);
  return { status: 204, headers: NO_STORE };
}

const listTransponders = (request) => json(200, { transponders: request.store.transponders(request.workspaceId) }, NO_STORE);

async function putTransponder(request, match) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const code = transponderCode(match[2]);
  if (!code) return invalid(request, 'A transponder code is 1 to 16 hex digits.');
  const { driverId } = body;
  if (driverId !== null && (typeof driverId !== 'string' || !request.store.driver(request.workspaceId, driverId))) {
    return invalid(request, '`driverId` must be a driver of this workspace, or null.');
  }
  request.engine.assign(request.workspaceId, code, driverId);
  return json(200, { code, driverId }, NO_STORE);
}

const listDecoders = (request) => json(200, { decoders: request.store.decoders(request.workspaceId) }, NO_STORE);

async function addDecoder(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const wait = request.limiters.pair.take(request.userId);
  if (wait) return rateLimited(request, wait);
  const name = body.name === undefined ? 'Decoder' : nameOf(body.name);
  if (!name) return invalid(request, 'A decoder name is 1 to 60 characters.');
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  request.store.addDecoder(request.workspaceId, { id, name, tokenHash: tokenHash(token), createdAt: request.now() });
  return json(201, { id, name, token }, NO_STORE);
}

function deleteDecoder(request, match) {
  if (!request.store.deleteDecoder(request.workspaceId, match[2])) return notFound(request, 'decoder');
  return { status: 204, headers: NO_STORE };
}

const TRACK_PROBLEMS = { invalid: 'invalid-request', 'not-a-circuit': 'not-a-circuit', unavailable: 'planner-unavailable' };

async function putTrack(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  if (!DIRECTIONS.includes(body.direction)) return invalid(request, '`direction` must be "cw" or "ccw".');
  const name = body.name === undefined ? 'Track' : nameOf(body.name);
  if (!name) return invalid(request, 'A track name is 1 to 60 characters.');
  if (typeof body.link !== 'string') return invalid(request, '`link` must be a planner share link.');
  let track;
  try {
    track = await fetchTrack(request.plannerUrl, body.link, { fetch: request.fetch });
  } catch (caught) {
    if (!(caught instanceof TrackError)) throw caught;
    return problem(request, TRACK_PROBLEMS[caught.code], caught.message);
  }
  const ws = request.workspaceId;
  request.store.setTrack(ws, { ...track, name }, body.direction);
  request.engine.restartPractice(ws);
  request.hub.publish(ws, 'track', { track: { id: track.id, name }, direction: body.direction, bests: request.store.personalBests(ws, track.id, body.direction) });
  return json(200, { id: track.id, name, direction: body.direction, snapshotKey: track.snapshotKey }, NO_STORE);
}

const getWatchToken = (request) => json(200, { token: request.store.workspace(request.workspaceId).watchToken }, NO_STORE);

function rotateWatchToken(request) {
  const old = request.store.workspace(request.workspaceId).watchToken;
  const token = randomBytes(16).toString('base64url');
  request.store.setWatchToken(request.workspaceId, token);
  if (old) request.hub.closeTagged(request.workspaceId, old);
  return json(200, { token }, NO_STORE);
}

const path = (rest) => new RegExp(`^/workspaces/([^/]+)/${rest}$`);
const write = { write: true };

export const setupRoutes = [
  { pattern: path('drivers'), credentials: true, methods: { GET: workspaceRoute('timing.run', listDrivers), POST: workspaceRoute('timing.setup', addDriver, write) } },
  { pattern: path('drivers/([^/]+)'), credentials: true, methods: { PATCH: workspaceRoute('timing.setup', updateDriver, write), DELETE: workspaceRoute('timing.delete', deleteDriver, write) } },
  { pattern: path('transponders'), credentials: true, methods: { GET: workspaceRoute('timing.run', listTransponders) } },
  { pattern: path('transponders/([^/]+)'), credentials: true, methods: { PUT: workspaceRoute('timing.setup', putTransponder, write) } },
  { pattern: path('decoders'), credentials: true, methods: { GET: workspaceRoute('timing.run', listDecoders), POST: workspaceRoute('timing.setup', addDecoder, write) } },
  { pattern: path('decoders/([^/]+)'), credentials: true, methods: { DELETE: workspaceRoute('timing.delete', deleteDecoder, write) } },
  { pattern: path('track'), credentials: true, methods: { PUT: workspaceRoute('timing.setup', putTrack, write) } },
  { pattern: path('watch-token'), credentials: true, methods: { GET: workspaceRoute('timing.run', getWatchToken), POST: workspaceRoute('timing.setup', rotateWatchToken, write) } },
];
```

In `server/routes.js`, import `setupRoutes` from `./setup.js` and add `...setupRoutes,` after `...workspaceRoutes,`.

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/timing
git commit -s -m "feat(timing-app): set up drivers, transponders, decoders, the track and the watchers link"
```

---
### Task 13: Ingest and tap endpoints

**Files:**
- Create: `apps/timing/server/ingest.js`
- Modify: `apps/timing/server/routes.js`
- Test: `apps/timing/test/server/ingest.test.js`

**Interfaces:**
- Consumes: `readBatch` (`@tinylap/timing`), `can`, `withSession`, `workspaceRoute`, `readJson`, `rateLimited`, `tokenHash` (Task 12), `engine.ingest`, `engine.tap`.
- Produces `ingestRoutes`:
  - `POST /decoders/{id}/passings` with a body `{ boot, passings }`. With `Authorization: Bearer <token>`, the token must be that decoder's (`via: 'net'`); without it, a member session of the decoder's workspace with `timing.run`, from the app's own pages (`via: 'serial'`, the bridge). Answers 200 `{ stored, duplicates, through }`; 401 for a wrong, foreign or revoked token, or a decoder not paired in one of your workspaces; 403 cross-origin; 415, 413, 422 for bad bodies; 429 past 600 batches per decoder per minute.
  - `POST /workspaces/{w}/tap` with `{ driverId }` → 200 `{ stored: boolean, lapMs: number | null }`; 422 for an unknown driver; 429 past 120 taps per member per minute.

- [ ] **Step 1: Write the failing test**

`apps/timing/test/server/ingest.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let stranger;
let office;
let gate;
let spare;
let ana;

before(async () => {
  app = await startTiming({ clock, limits: { ingest: 5 } });
  const [owner, zed] = await Promise.all(['Ana', 'Zed'].map((n) => app.signUp(n)));
  office = app.club(owner, 'Office');
  app.club(zed, 'Elsewhere');
  member = await app.login(owner);
  stranger = await app.login(zed);
  const pair = async (name) => (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name })).json();
  gate = await pair('Gate');
  spare = await pair('Spare');
  ana = await (await app.api(member, 'POST', `/workspaces/${office.id}/drivers`, { name: 'Ana' })).json();
});
after(() => app.close());

const batch = { boot: 'b00tb00t', passings: [{ transponder: '0a', t: 1000 }, { transponder: '0A', t: 9000 }] };
const asDecoder = (decoder, token, body = batch, headers = {}) => fetch(`${app.base}/decoders/${decoder}/passings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
  body: JSON.stringify(body),
});
const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal((await res.json()).type, `${app.base}/problems/${name}`);
};

test('a decoder posts with its token; the same batch through the bridge is a duplicate', async () => {
  const net = await asDecoder(gate.id, gate.token);
  assert.equal(net.status, 200);
  assert.deepEqual(await net.json(), { stored: 2, duplicates: 0, through: 9000 });
  const serial = await app.api(member, 'POST', `/decoders/${gate.id}/passings`, batch);
  assert.deepEqual(await serial.json(), { stored: 0, duplicates: 2, through: 9000 });
  const snapshot = await (await app.api(member, 'GET', `/workspaces/${office.id}`)).json();
  assert.deepEqual(snapshot.crossings.map((c) => [c.transponder, c.lapMs, c.via]), [['0A', 8000, 'net'], ['0A', null, 'net']]);
  assert.deepEqual(snapshot.unknown, ['0A']);
});

test('wrong, foreign, malformed and revoked tokens are refused', async () => {
  await problemOf(await asDecoder(gate.id, 'x'.repeat(43)), 401, 'unauthorized');
  await problemOf(await asDecoder(gate.id, spare.token), 401, 'unauthorized');
  await problemOf(await asDecoder(gate.id, gate.token, batch, { authorization: 'Basic abc' }), 401, 'unauthorized');
  const temp = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, {})).json();
  assert.equal((await app.api(member, 'DELETE', `/workspaces/${office.id}/decoders/${temp.id}`)).status, 204);
  await problemOf(await asDecoder(temp.id, temp.token), 401, 'unauthorized');
});

test('the bridge path needs a member of the decoder\'s workspace, from the app', async () => {
  await problemOf(await app.api(null, 'POST', `/decoders/${gate.id}/passings`, batch), 401, 'unauthorized');
  await problemOf(await app.api(stranger, 'POST', `/decoders/${gate.id}/passings`, batch), 401, 'unauthorized');
  await problemOf(await app.api(member, 'POST', '/decoders/nope/passings', batch), 401, 'unauthorized');
  await problemOf(await app.api(member, 'POST', `/decoders/${gate.id}/passings`, batch, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), 403, 'forbidden');
});

test('bad batches are refused whole', async () => {
  await problemOf(await asDecoder(spare.id, spare.token, { boot: 'x', passings: [{ transponder: '0A', t: 1 }] }), 422, 'invalid-request');
  await problemOf(await asDecoder(spare.id, spare.token, { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1 }, { transponder: 'q', t: 2 }] }), 422, 'invalid-request');
  assert.equal(app.store.through(spare.id, 'b00tb00t'), null, 'nothing of a bad batch is stored');
  const text = await fetch(`${app.base}/decoders/${spare.id}/passings`, { method: 'POST', headers: { authorization: `Bearer ${spare.token}`, 'content-type': 'text/plain' }, body: 'hi' });
  await problemOf(text, 415, 'unsupported-media-type');
});

test('ingest is rate limited per decoder', async () => {
  // The limit is 5 per minute here; the spare decoder has used 3.
  assert.equal((await asDecoder(spare.id, spare.token)).status, 200);
  assert.equal((await asDecoder(spare.id, spare.token)).status, 200);
  const res = await asDecoder(spare.id, spare.token);
  await problemOf(res, 429, 'rate-limited');
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

test('tap entry times a driver by hand', async () => {
  const tap = () => app.api(member, 'POST', `/workspaces/${office.id}/tap`, { driverId: ana.id });
  assert.deepEqual(await (await tap()).json(), { stored: true, lapMs: null });
  clock.now += 8000;
  assert.deepEqual(await (await tap()).json(), { stored: true, lapMs: 8000 });
  assert.deepEqual(await (await tap()).json(), { stored: false, lapMs: null }, 'the same millisecond');
  await problemOf(await app.api(member, 'POST', `/workspaces/${office.id}/tap`, { driverId: 'nobody' }), 422, 'invalid-request');
  await problemOf(await app.api(stranger, 'POST', `/workspaces/${office.id}/tap`, { driverId: ana.id }), 404, 'not-found');
});
```

The "bad batches" test uses three of the spare decoder's five batches: the limiter is taken before the body is read, so bad bodies count too. Keep that order in `ingest.js` (limit first, then the body), so a flood of bad bodies is limited as well.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL with 404s from the static fallback (no route yet).

- [ ] **Step 3: Implement `server/ingest.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Passings in (spec §5). A decoder posts with its own token over Wi-Fi; the
// bridge tab posts the same passings with a member's session, from the
// cable. The engine keeps one copy. Tap entry is a passing by hand.
import { can } from '@tinylap/auth';
import { readBatch } from '@tinylap/timing';
import { NO_STORE, workspaceRoute } from './access.js';
import { withSession } from './auth.js';
import { rateLimited, readJson } from './body.js';
import { json, problem } from './responses.js';
import { tokenHash } from './setup.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

const postPassings = withSession(async (request, match) => {
  const decoderId = match[1];
  const refuse = (name, detail) => {
    request.req.resume();
    return problem(request, name, detail);
  };
  if (!request.store) return refuse('unavailable', 'Passings cannot be stored right now.');
  const header = request.req.headers.authorization;
  let decoder;
  let via;
  if (header !== undefined) {
    const token = BEARER.exec(header)?.[1];
    const found = token ? request.store.decoderByTokenHash(tokenHash(token)) : null;
    if (!found || found.id !== decoderId) return refuse('unauthorized', "Send this decoder's token as a Bearer token.");
    decoder = found;
    via = 'net';
  } else {
    decoder = request.store.decoder(decoderId);
    if (!request.session || !decoder || !can(request.session.claims, decoder.workspaceId, 'timing.run')) {
      return refuse('unauthorized', 'This decoder is not paired in one of your workspaces, or you are not logged in.');
    }
    if (!request.auth.bff.requireSameOrigin(request.req)) return refuse('forbidden', "Forward passings from the app's own pages.");
    via = 'serial';
  }
  const wait = request.limiters.ingest.take(decoderId);
  if (wait) {
    request.req.resume();
    return rateLimited(request, wait);
  }
  const { body, error } = await readJson(request);
  if (error) return error;
  const result = readBatch(body);
  if (!result.ok) return problem(request, 'invalid-request', result.error);
  return json(200, request.engine.ingest({ workspaceId: decoder.workspaceId, decoder: decoderId, via, batch: result.batch }), NO_STORE);
});

async function postTap(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  if (typeof body.driverId !== 'string' || !request.store.driver(request.workspaceId, body.driverId)) {
    return problem(request, 'invalid-request', '`driverId` must be a driver of this workspace.');
  }
  const wait = request.limiters.tap.take(request.userId);
  if (wait) return rateLimited(request, wait);
  const row = request.engine.tap(request.workspaceId, body.driverId);
  return json(200, { stored: row !== null, lapMs: row?.lapMs ?? null }, NO_STORE);
}

export const ingestRoutes = [
  { pattern: /^\/decoders\/([^/]+)\/passings$/, credentials: true, methods: { POST: postPassings } },
  { pattern: /^\/workspaces\/([^/]+)\/tap$/, credentials: true, methods: { POST: workspaceRoute('timing.run', postTap, { write: true }) } },
];
```

In `server/routes.js`, import `ingestRoutes` from `./ingest.js` and add `...ingestRoutes,` after `...setupRoutes,`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/timing
git commit -s -m "feat(timing-app): take passings from decoders and bridges, and taps"
```

---
### Task 14: Sessions API, live streams, watchers view, and the server's entry point

**Files:**
- Create: `apps/timing/server/control.js`, `apps/timing/server/stream.js`, `apps/timing/server/main.js`
- Modify: `apps/timing/server/routes.js`
- Test: `apps/timing/test/server/sse.js` (fixture), `apps/timing/test/server/control.test.js`, `apps/timing/test/server/stream.test.js`, `apps/timing/test/server/contract.test.js`, `apps/timing/test/server/main.test.js`

**Interfaces:**
- Consumes: `engine.start`, `abort`, `sessionDetail`, `snapshot`, `tick`; `publicSession`; `hub.subscribe`, `hub.lastId`, `hub.closeTagged` (rotation already calls it, Task 12).
- Produces:
  - `controlRoutes`: `POST /workspaces/{w}/sessions` `{ kind: 'qualifying' | 'race', roster: string[] (1–20 drivers), durationSeconds?: 10–3600 = 300, countdownSeconds?: 0–30 = 10 (race only) }` → 201 session, 409 `conflict`; `GET /workspaces/{w}/sessions?limit=1–50 (20)` → `{ sessions }`; `GET /workspaces/{w}/sessions/{id}` → `{ session, standings, crossings }`; `POST /workspaces/{w}/sessions/{id}/abort` → 200 session or 404.
  - `streamRoutes`: `GET /workspaces/{w}/live` (member), `GET /watch/{token}` (JSON snapshot for watchers), `GET /watch/{token}/live` (watcher stream, closed when the token is rotated). Every stream starts with `retry: 2000`, then the replay or a `snapshot` event whose `id` is the hub's last id, and sends `: beat` every 15 s.
  - An API fallback route: any other `/workspaces…`, `/decoders…`, `/watch…` path answers a `not-found` problem, not the static 404.
  - `server/main.js`: reads the environment, refuses to start without the full log-in configuration and `TINYLAP_PLANNER_URL`, ticks the engine every 250 ms.
  - Test fixture `events(res)` in `test/server/sse.js`: an async iterator of `{ id, type, data }`.

- [ ] **Step 1: Write the SSE fixture and the failing tests**

`apps/timing/test/server/sse.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Reads a text/event-stream response as { id, type, data } events. @param {Response} res */
export async function* events(res) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const fields = {};
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        fields[line.slice(0, colon)] = line.slice(colon + 1).trimStart();
      }
      if (fields.event) yield { id: Number(fields.id), type: fields.event, data: JSON.parse(fields.data) };
    }
  }
}

/** The next event of `type`, skipping others. */
export async function next(iterator, type) {
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) return null;
    if (!type || value.type === type) return value;
  }
}
```

`apps/timing/test/server/control.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let member;
let office;
let ana;
let ben;
const path = (rest) => `/workspaces/${office.id}/${rest}`;

before(async () => {
  app = await startTiming();
  const owner = await app.signUp('Ana');
  office = app.club(owner, 'Office');
  member = await app.login(owner);
  ana = await (await app.api(member, 'POST', path('drivers'), { name: 'Ana' })).json();
  ben = await (await app.api(member, 'POST', path('drivers'), { name: 'Ben' })).json();
});
after(() => app.close());

const problemOf = async (res, status, name) => {
  assert.equal(res.status, status);
  assert.equal((await res.json()).type, `${app.base}/problems/${name}`);
};

test('bad session requests say what is wrong', async () => {
  const bad = (body) => app.api(member, 'POST', path('sessions'), body);
  await problemOf(await bad({ kind: 'practice', roster: [ana.id] }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [] }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [ana.id, ana.id] }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: ['nobody'] }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [ana.id], durationSeconds: 5 }), 422, 'invalid-request');
  await problemOf(await bad({ kind: 'race', roster: [ana.id], countdownSeconds: 31 }), 422, 'invalid-request');
});

test('start, list, read and abort a race; one at a time', async () => {
  const res = await app.api(member, 'POST', path('sessions'), { kind: 'race', roster: [ana.id, ben.id], durationSeconds: 120, countdownSeconds: 5 });
  assert.equal(res.status, 201);
  const race = await res.json();
  assert.deepEqual([race.kind, race.state, race.roster, race.durationMs, race.closesAt - race.opensAt], ['race', 'countdown', [ana.id, ben.id], 120_000, 120_000]);
  assert.equal('workspaceId' in race, false);
  await problemOf(await app.api(member, 'POST', path('sessions'), { kind: 'qualifying', roster: [ana.id] }), 409, 'conflict');
  const { sessions } = await (await app.api(member, 'GET', path('sessions?limit=5'))).json();
  assert.equal(sessions[0].id, race.id);
  const detail = await (await app.api(member, 'GET', path(`sessions/${race.id}`))).json();
  assert.deepEqual(detail.standings.map((s) => s.driverId).sort(), [ana.id, ben.id].sort());
  assert.equal((await (await app.api(member, 'POST', path(`sessions/${race.id}/abort`))).json()).state, 'aborted');
  await problemOf(await app.api(member, 'POST', path(`sessions/${race.id}/abort`)), 404, 'not-found');
  await problemOf(await app.api(member, 'GET', path('sessions/nope')), 404, 'not-found');
});

test('qualifying ignores the countdown', async () => {
  const q = await (await app.api(member, 'POST', path('sessions'), { kind: 'qualifying', roster: [ana.id], countdownSeconds: 10 })).json();
  assert.deepEqual([q.state, q.durationMs], ['running', 300_000]);
  await app.api(member, 'POST', path(`sessions/${q.id}/abort`));
});
```

`apps/timing/test/server/stream.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';
import { events, next } from './sse.js';

const clock = { now: 1_000_000_000_000 };
let app;
let member;
let stranger;
let office;
let ana;
const path = (rest) => `/workspaces/${office.id}${rest}`;

before(async () => {
  app = await startTiming({ clock });
  const [owner, zed] = await Promise.all(['Ana', 'Zed'].map((n) => app.signUp(n)));
  office = app.club(owner, 'Office');
  member = await app.login(owner);
  stranger = await app.login(zed);
  ana = await (await app.api(member, 'POST', path('/drivers'), { name: 'Ana' })).json();
});
after(() => app.close());

const tap = async () => {
  clock.now += 8000;
  await app.api(member, 'POST', path('/tap'), { driverId: ana.id });
};

test('a member stream starts with a snapshot and carries crossings', async () => {
  const res = await app.api(member, 'GET', path('/live'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  const it = events(res);
  const first = await next(it);
  assert.equal(first.type, 'snapshot');
  assert.deepEqual(first.data.drivers.map((d) => d.name), ['Ana']);
  await tap();
  const crossing = await next(it, 'crossing');
  assert.equal(crossing.data.driverId, ana.id);
  await res.body.cancel();
});

test('a reconnect with Last-Event-ID gets only what it missed', async () => {
  const res = await app.api(member, 'GET', path('/live'));
  const it = events(res);
  const snapshot = await next(it);
  await res.body.cancel();
  await tap();
  const again = await app.api(member, 'GET', path('/live'), undefined, { 'last-event-id': String(snapshot.id) });
  const first = await next(events(again));
  assert.notEqual(first.type, 'snapshot');
  assert.ok(first.id > snapshot.id);
  await again.body.cancel();
});

test('live streams need a member', async () => {
  assert.equal((await app.api(null, 'GET', path('/live'))).status, 401);
  assert.equal((await app.api(stranger, 'GET', path('/live'))).status, 404);
});

test('watchers: a snapshot and a stream without setup, ended by rotating the link', async () => {
  const { token } = await (await app.api(member, 'POST', path('/watch-token'))).json();
  const snapshot = await (await fetch(`${app.base}/watch/${token}`)).json();
  assert.equal('unknown' in snapshot, false);
  const res = await fetch(`${app.base}/watch/${token}/live`);
  assert.equal(res.status, 200);
  const it = events(res);
  assert.equal((await next(it)).type, 'snapshot');
  await tap();
  const crossing = await next(it, 'crossing');
  assert.equal('transponder' in crossing.data, false);
  await app.api(member, 'POST', path('/watch-token'));
  assert.equal(await next(it), null, 'the old stream ends');
  assert.equal((await fetch(`${app.base}/watch/${token}`)).status, 404);
  assert.equal((await fetch(`${app.base}/watch/${token}/live`)).status, 404);
});

test('unknown API paths answer a problem', async () => {
  const res = await fetch(`${app.base}/workspaces/${office.id}/nothing`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
});
```

`apps/timing/test/server/contract.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The API description and the routes cannot drift apart: every documented
// operation has a route, and every route is documented.
import test from 'node:test';
import assert from 'node:assert/strict';
import openapi from '../../server/openapi.json' with { type: 'json' };
import { routes } from '../../server/routes.js';

const real = routes.filter((r) => !r.unknown);
const sample = (path) => path.replace(/\{[^}]+\}/g, 'x1');

test('every documented operation has a route', () => {
  for (const [path, item] of Object.entries(openapi.paths)) {
    const route = real.find((r) => r.pattern.test(sample(path)));
    assert.ok(route, `no route for ${path}`);
    for (const method of Object.keys(item)) assert.ok(route.methods[method.toUpperCase()], `${method.toUpperCase()} ${path}`);
  }
});

test('every route is documented', () => {
  const docs = Object.entries(openapi.paths).map(([path, item]) => [sample(path), item]);
  for (const route of real) {
    for (const method of Object.keys(route.methods)) {
      assert.ok(docs.some(([path, item]) => route.pattern.test(path) && item[method.toLowerCase()]), `undocumented ${method} ${route.pattern}`);
    }
  }
});
```

`apps/timing/test/server/main.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('../../server/main.js', import.meta.url));
const FULL = {
  TINYLAP_ISSUER: 'http://127.0.0.1:9', TINYLAP_CLIENT_ID: 'timing-dev', TINYLAP_CLIENT_SECRET: 'dev',
  TINYLAP_FEED_TOKEN: 'dev', TINYLAP_TOKEN_KEYS: `k1:${Buffer.alloc(32, 1).toString('base64')}`,
  TINYLAP_PLANNER_URL: 'http://127.0.0.1:9', PORT: '0',
};
const run = (env) => spawn(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN, '--dev'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

test('timing refuses to start without its configuration, and names what is missing', async () => {
  const partial = { ...FULL };
  delete partial.TINYLAP_PLANNER_URL;
  const child = run(partial);
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(err, /TINYLAP_PLANNER_URL/);
});

test('with its configuration it starts and stops cleanly on SIGTERM', async () => {
  const child = run(FULL);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.resume();
  while (!/timing on http:/.test(out)) await once(child.stdout, 'data');
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL (no routes for sessions, live, watch; no `main.js`).

- [ ] **Step 3: Implement `server/control.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control (spec §6, §8): start a qualifying or race, list and read
// sessions, abort. Practice is never started by hand.
import { NO_STORE, workspaceRoute } from './access.js';
import { readJson } from './body.js';
import { publicSession } from './engine.js';
import { json, problem } from './responses.js';

const KINDS = new Set(['qualifying', 'race']);
const MAX_ROSTER = 20;
const invalid = (request, detail) => problem(request, 'invalid-request', detail);
const notFound = (request) => problem(request, 'not-found', 'There is no such session in this workspace.');

/** An integer in [min, max], `fallback` when absent, or null. */
const intIn = (value, min, max, fallback) => {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
};

async function startSession(request) {
  const { body, error } = await readJson(request);
  if (error) return error;
  if (!KINDS.has(body.kind)) return invalid(request, '`kind` must be "qualifying" or "race".');
  const { roster } = body;
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > MAX_ROSTER) return invalid(request, `\`roster\` must list 1 to ${MAX_ROSTER} drivers.`);
  if (new Set(roster).size !== roster.length) return invalid(request, 'A driver can be on the roster only once.');
  if (!roster.every((id) => typeof id === 'string' && request.store.driver(request.workspaceId, id))) return invalid(request, 'Every roster entry must be a driver of this workspace.');
  const duration = intIn(body.durationSeconds, 10, 3600, 300);
  if (duration === null) return invalid(request, '`durationSeconds` must be a whole number from 10 to 3600.');
  const countdown = intIn(body.countdownSeconds, 0, 30, 10);
  if (countdown === null) return invalid(request, '`countdownSeconds` must be a whole number from 0 to 30.');
  const result = request.engine.start(request.workspaceId, {
    kind: body.kind, roster, durationMs: duration * 1000, countdownMs: body.kind === 'race' ? countdown * 1000 : 0,
  });
  if (result.error) return problem(request, 'conflict', 'A qualifying or race is already running here.');
  return json(201, publicSession(result.session), NO_STORE);
}

function listSessions(request) {
  const text = request.url.searchParams.get('limit');
  const limit = text === null ? 20 : Number(text);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return invalid(request, '`limit` must be from 1 to 50.');
  return json(200, { sessions: request.store.listSessions(request.workspaceId, limit).map(publicSession) }, NO_STORE);
}

function getSession(request, match) {
  const detail = request.engine.sessionDetail(request.workspaceId, match[2]);
  return detail ? json(200, detail, NO_STORE) : notFound(request);
}

function abortSession(request, match) {
  request.req.resume();
  const ended = request.engine.abort(request.workspaceId, match[2]);
  return ended ? json(200, publicSession(ended), NO_STORE) : problem(request, 'not-found', 'There is no running qualifying or race with this id.');
}

const path = (rest) => new RegExp(`^/workspaces/([^/]+)/${rest}$`);

export const controlRoutes = [
  { pattern: path('sessions'), credentials: true, methods: { GET: workspaceRoute('timing.run', listSessions), POST: workspaceRoute('timing.run', startSession, { write: true }) } },
  { pattern: path('sessions/([^/]+)'), credentials: true, methods: { GET: workspaceRoute('timing.run', getSession) } },
  { pattern: path('sessions/([^/]+)/abort'), credentials: true, methods: { POST: workspaceRoute('timing.run', abortSession, { write: true }) } },
];
```

- [ ] **Step 4: Implement `server/stream.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Server-Sent Events (spec §7) for members and for the watchers view. A
// stream starts with what the client missed (Last-Event-ID) or a snapshot.
// Watcher streams are tagged with their token, so rotating it ends them.
import { NO_STORE, workspaceRoute } from './access.js';
import { json, problem } from './responses.js';

export const HEARTBEAT_MS = 15_000;
const SSE_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
const WATCH_TOKEN = /^[A-Za-z0-9_-]{22}$/;

const lastEventIdOf = (req) => {
  const value = req.headers['last-event-id'];
  return typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : null;
};

/** @param {any} request @param {string} workspaceId @param {{ watcher: boolean, tag?: string }} options */
function eventStream(request, workspaceId, { watcher, tag }) {
  return {
    status: 200,
    headers: SSE_HEADERS,
    stream(req, res) {
      const write = ({ id, type, data }) => res.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      res.write('retry: 2000\n\n');
      const sub = request.hub.subscribe(workspaceId, { lastEventId: lastEventIdOf(req), watcher, tag, onClose: () => res.end() }, write);
      if (sub.replay === 'snapshot') write({ id: request.hub.lastId(), type: 'snapshot', data: request.engine.snapshot(workspaceId, { watcher }) });
      const beat = setInterval(() => res.write(': beat\n\n'), HEARTBEAT_MS);
      beat.unref();
      res.on('close', () => {
        clearInterval(beat);
        sub.unsubscribe();
      });
    },
  };
}

const watched = (request, token) => (WATCH_TOKEN.test(token) && request.store ? request.store.workspaceByWatchToken(token) : null);
const noWatch = (request) => problem(request, 'not-found', 'There is no such watchers link; ask for a new one.');

export const streamRoutes = [
  {
    pattern: /^\/workspaces\/([^/]+)\/live$/,
    credentials: true,
    methods: { GET: workspaceRoute('timing.run', (request) => eventStream(request, request.workspaceId, { watcher: false })) },
  },
  {
    pattern: /^\/watch\/([^/]+)$/,
    methods: {
      GET: (request, [, token]) => {
        const workspaceId = watched(request, token);
        return workspaceId ? json(200, request.engine.snapshot(workspaceId, { watcher: true }), NO_STORE) : noWatch(request);
      },
    },
  },
  {
    pattern: /^\/watch\/([^/]+)\/live$/,
    methods: {
      GET: (request, [, token]) => {
        const workspaceId = watched(request, token);
        return workspaceId ? eventStream(request, workspaceId, { watcher: true, tag: token }) : noWatch(request);
      },
    },
  },
];
```

- [ ] **Step 5: Wire the routes**

`server/routes.js` becomes:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every route, in matching order. The first pattern that matches wins.
import { authRoutes } from './auth.js';
import { controlRoutes } from './control.js';
import { discoveryRoutes } from './discovery.js';
import { ingestRoutes } from './ingest.js';
import { setupRoutes } from './setup.js';
import { streamRoutes } from './stream.js';
import { workspaceRoutes } from './workspace.js';

export const routes = [
  ...authRoutes,
  ...workspaceRoutes,
  ...setupRoutes,
  ...controlRoutes,
  ...ingestRoutes,
  ...streamRoutes,
  ...discoveryRoutes,
  // Anything else under the API answers a problem, not the static 404.
  { pattern: /^\/(?:workspaces|decoders|watch)(?:\/.*)?$/, credentials: true, unknown: true, methods: {} },
];
```

- [ ] **Step 6: Implement `server/main.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Production: node server/main.js (serves TINYLAP_ROOT, default /srv).
// Development: node server/main.js --dev (serves the source on :8100, with
// an in-memory database unless TINYLAP_DB says otherwise).
//
// Timing always needs log-in: TINYLAP_ISSUER (the accounts origin),
// TINYLAP_CLIENT_ID, TINYLAP_CLIENT_SECRET, TINYLAP_TOKEN_KEYS
// (`<id>:<base64 32 bytes>,…`, newest first), TINYLAP_FEED_TOKEN,
// TINYLAP_PUBLIC_URL (in dev it defaults to http://localhost:<port>), and
// TINYLAP_PLANNER_URL, the planner tracks are imported from.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKeys } from '@tinylap/auth';
import { createHandler } from './app.js';
import { createAuth } from './auth.js';
import { createEngine } from './engine.js';
import { startFeed } from './feed.js';
import { createHub } from './live.js';
import { openStore } from './store.js';

const env = process.env;
const dev = process.argv.includes('--dev');
const TICK_MS = 250;

/** Refuses to start: a half-configured server must not run. */
function refuse(message) {
  console.error(message);
  process.exit(1);
}

const port = Number(env.PORT ?? (dev ? 8100 : 8080));
const publicUrl = env.TINYLAP_PUBLIC_URL || (dev ? `http://localhost:${port}` : undefined);
const needed = {
  TINYLAP_ISSUER: env.TINYLAP_ISSUER, TINYLAP_CLIENT_ID: env.TINYLAP_CLIENT_ID, TINYLAP_CLIENT_SECRET: env.TINYLAP_CLIENT_SECRET,
  TINYLAP_TOKEN_KEYS: env.TINYLAP_TOKEN_KEYS, TINYLAP_FEED_TOKEN: env.TINYLAP_FEED_TOKEN, TINYLAP_PUBLIC_URL: publicUrl,
  TINYLAP_PLANNER_URL: env.TINYLAP_PLANNER_URL,
};
const missing = Object.keys(needed).filter((name) => !needed[name]);
if (missing.length) refuse(`Timing needs ${missing.join(', ')}. See "Self-hosting timing" in README.md.`);

let keys;
try {
  keys = parseKeys(env.TINYLAP_TOKEN_KEYS);
} catch (error) {
  refuse(`TINYLAP_TOKEN_KEYS: ${error.message}`);
}

let store;
try {
  store = openStore(env.TINYLAP_DB ?? (dev ? ':memory:' : '/data/timing.sqlite'));
} catch (error) {
  // Without its database timing can't record anything; better not to start.
  refuse(`database unavailable: ${error.message}`);
}

const hub = createHub();
const engine = createEngine({ store, hub });
let auth;
try {
  auth = createAuth({ issuer: env.TINYLAP_ISSUER, clientId: env.TINYLAP_CLIENT_ID, clientSecret: env.TINYLAP_CLIENT_SECRET, keys, publicUrl, sessions: store.sessions });
} catch (error) {
  refuse(`log-in: ${error.message}`);
}
const feed = startFeed({ issuer: env.TINYLAP_ISSUER, token: env.TINYLAP_FEED_TOKEN, store });
const ticker = setInterval(() => {
  try {
    engine.tick();
  } catch (error) {
    console.error(error);
  }
}, TICK_MS);

const handler = createHandler({
  store, hub, engine, auth,
  root: dev ? undefined : env.TINYLAP_ROOT ?? '/srv',
  appDir: resolve(fileURLToPath(new URL('..', import.meta.url))),
  publicUrl,
  plannerUrl: env.TINYLAP_PLANNER_URL,
  clientIpHeader: env.TINYLAP_CLIENT_IP_HEADER,
  build: env.TINYLAP_BUILD,
});

const host = dev ? '127.0.0.1' : '0.0.0.0';
const server = createServer(handler).listen(port, host, () => {
  console.log(`timing on http://${host}:${server.address().port}${dev ? ' (dev, no-store)' : ''}, log-in through ${env.TINYLAP_ISSUER}`);
});

// Stop ticking and accepting, end the open streams, close the database, leave.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    clearInterval(ticker);
    feed.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    // Event streams never go idle; close them too.
    server.closeAllConnections();
  });
}
```

- [ ] **Step 7: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/timing
git commit -s -m "feat(timing-app): run sessions, stream live events, serve the watchers view"
```

---
### Task 15: The decoder simulator

**Files:**
- Create: `tools/decoder-sim.js`
- Modify: `tools/package.json` (add `"dependencies": { "@tinylap/timing": "workspace:*" }`)
- Test: `tools/test/decoder-sim.test.js`

**Interfaces:**
- Consumes: `createSimulator`, `createReader`, `commands`, `MAX_BATCH` (`@tinylap/timing`).
- Produces (exported for the test; the file is also the CLI):
  - `carsOf(n)` → `n` cars with transponders `10`, `11`, … and lap times 7.5 s, 7.9 s, …
  - `createSender({ url, decoder, token, boot, fetch? })` → `{ add(passings), flush(): Promise<{ sent }>, pending }`. Keeps every passing until the server's `through` covers it.
  - `runSerial({ input, output, sim, clock })` → `{ tick(), stop() }`: answers commands read from `input`, and on each `tick()` writes the laps up to `clock()`.
- CLI:
  - `node tools/decoder-sim.js net --url <timing origin> --decoder <id> --token <token> [--cars 4]`: posts every second, like a decoder on Wi-Fi.
  - `node tools/decoder-sim.js serial [--cars 4]`: ZRound on stdin/stdout, like a decoder on USB, e.g. behind `socat -d -d pty,raw,echo=0,link=/tmp/decoder EXEC:"node tools/decoder-sim.js serial"` for ZRound or on Linux. (Chrome's Web Serial doesn't list ptys; the bridge has its own `?simulate` port, Task 18.)

- [ ] **Step 1: Write the failing test**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createSimulator } from '@tinylap/timing';
import { carsOf, createSender, runSerial } from '../decoder-sim.js';

test('cars get distinct transponders and lap times', () => {
  assert.deepEqual(carsOf(3), [{ transponder: '10', lapMs: 7500 }, { transponder: '11', lapMs: 7900 }, { transponder: '12', lapMs: 8300 }]);
});

test('the sender keeps passings until the server holds them', async () => {
  const posts = [];
  let through = 1000;
  let fail = false;
  const fetch = async (url, init) => {
    posts.push({ url, init });
    if (fail) return new Response('down', { status: 503 });
    return Response.json({ stored: 1, duplicates: 0, through });
  };
  const sender = createSender({ url: 'http://timing.test/', decoder: 'd1', token: 't'.repeat(43), boot: 'b00tb00t', fetch });
  sender.add([{ transponder: '10', t: 1000 }, { transponder: '10', t: 9000 }]);
  assert.deepEqual(await sender.flush(), { sent: 2 });
  assert.equal(posts[0].url, 'http://timing.test/decoders/d1/passings');
  assert.equal(posts[0].init.headers.authorization, `Bearer ${'t'.repeat(43)}`);
  assert.deepEqual(JSON.parse(posts[0].init.body), { boot: 'b00tb00t', passings: [{ transponder: '10', t: 1000 }, { transponder: '10', t: 9000 }] });
  assert.equal(sender.pending, 1, 'the server only holds up to 1000');
  fail = true;
  await assert.rejects(sender.flush(), /503/);
  assert.equal(sender.pending, 1);
  fail = false;
  through = 9000;
  await sender.flush();
  assert.equal(sender.pending, 0);
  assert.deepEqual(await sender.flush(), { sent: 0 });
});

const settle = () => new Promise((done) => setImmediate(done));

test('the serial mode answers commands and writes laps', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (d) => { text += d; });
  let now = 0;
  const sim = createSimulator({ cars: carsOf(1), jitterMs: 0, random: () => 0 });
  const serial = runSerial({ input, output, sim, clock: () => now });
  input.write('%TLHE');
  input.write('LLO&%C&');
  await settle();
  assert.match(text, new RegExp(`%TLID - ${sim.boot}&%A&`));
  now = 20_000;
  serial.tick();
  await settle();
  assert.match(text, /%L10,7D0&/, 'the first crossing at 2000 ms');
  assert.match(text, /%L10,251C&/, 'the next at 9500 ms');
  serial.stop();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm install && pnpm --filter @tinylap/tools test`
Expected: FAIL, `decoder-sim.js` does not exist.

- [ ] **Step 3: Implement `tools/decoder-sim.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pretends to be a TinyLap decoder, to try timing without hardware.
//   node tools/decoder-sim.js net --url http://localhost:8100 --decoder <id> --token <token> [--cars 4]
//     posts passings every second, like a decoder on Wi-Fi.
//   node tools/decoder-sim.js serial [--cars 4]
//     speaks ZRound (and %TL… commands) on stdin/stdout, like a decoder on USB:
//     socat -d -d pty,raw,echo=0,link=/tmp/decoder EXEC:"node tools/decoder-sim.js serial"
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MAX_BATCH, commands, createReader, createSimulator } from '@tinylap/timing';

/** @param {number} n */
export const carsOf = (n) => Array.from({ length: n }, (_, i) => ({ transponder: (0x10 + i).toString(16).toUpperCase(), lapMs: 7500 + i * 400 }));

/**
 * Posts passings in batches and keeps each until the server's `through`
 * covers it, as a decoder's outbox does (spec §5).
 * @param {{ url: string, decoder: string, token: string, boot: string, fetch?: typeof fetch }} options
 */
export function createSender({ url, decoder, token, boot, fetch: fetchImpl = fetch }) {
  /** @type {{ transponder: string, t: number }[]} */
  let outbox = [];
  const endpoint = `${url.replace(/\/$/, '')}/decoders/${decoder}/passings`;
  return {
    get pending() {
      return outbox.length;
    },
    /** @param {{ transponder: string, t: number }[]} passings */
    add(passings) {
      outbox.push(...passings);
    },
    async flush() {
      if (outbox.length === 0) return { sent: 0 };
      const batch = outbox.slice(0, MAX_BATCH);
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ boot, passings: batch }),
      });
      if (!res.ok) throw new Error(`timing answered ${res.status}: ${await res.text()}`);
      const { through } = await res.json();
      outbox = outbox.filter((p) => through === null || p.t > through);
      return { sent: batch.length };
    },
  };
}

/**
 * ZRound on a pair of text streams.
 * @param {{ input: NodeJS.ReadableStream, output: NodeJS.WritableStream, sim: ReturnType<typeof createSimulator>, clock: () => number }} options
 */
export function runSerial({ input, output, sim, clock }) {
  const reader = createReader();
  const onData = (chunk) => {
    for (const message of reader.push(String(chunk))) for (const line of sim.reply(message, clock())) output.write(line);
  };
  input.on('data', onData);
  return {
    tick() {
      for (const p of sim.advance(clock())) output.write(commands.lap(p.transponder, p.t));
    },
    stop() {
      input.off('data', onData);
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { url: { type: 'string' }, decoder: { type: 'string' }, token: { type: 'string' }, cars: { type: 'string', default: '4' } },
  });
  const sim = createSimulator({ cars: carsOf(Number(values.cars)), decoder: values.decoder ?? null, token: values.token ?? null });
  const started = Date.now();
  const clock = () => Date.now() - started;
  if (positionals[0] === 'net') {
    if (!values.url || !values.decoder || !values.token) {
      console.error('net needs --url, --decoder and --token (pair a decoder in Setup to get them).');
      process.exit(2);
    }
    const sender = createSender({ url: values.url, decoder: values.decoder, token: values.token, boot: sim.boot });
    console.error(`decoder ${values.decoder}, boot ${sim.boot}, ${values.cars} cars`);
    setInterval(async () => {
      sender.add(sim.advance(clock()));
      try {
        const { sent } = await sender.flush();
        if (sent) console.error(`sent ${sent}, ${sender.pending} waiting`);
      } catch (error) {
        console.error(`${error.message}; ${sender.pending} waiting`);
      }
    }, 1000);
  } else if (positionals[0] === 'serial') {
    const serial = runSerial({ input: process.stdin, output: process.stdout, sim, clock });
    setInterval(() => serial.tick(), 100);
  } else {
    console.error('usage: decoder-sim.js net --url <origin> --decoder <id> --token <token> [--cars n] | serial [--cars n]');
    process.exit(2);
  }
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @tinylap/tools test && pnpm --filter @tinylap/tools lint && pnpm --filter @tinylap/tools typecheck`
Expected: PASS.

- [ ] **Step 5: Try it against a dev server (manual)**

With accounts and timing running (Task 19 has the commands), pair a decoder in Setup, then:

Run: `node tools/decoder-sim.js net --url http://localhost:8100 --decoder <id> --token <token>`
Expected: `sent 1, 0 waiting` lines; four unknown cars appear on the board within ten seconds.

- [ ] **Step 6: Commit**

```bash
git add tools pnpm-lock.yaml
git commit -s -m "feat(tools): simulate a decoder over the network and over ZRound serial"
```

---
### Task 16: The browser app: shell, live board and watchers view

**Use the `frontend-design` skill for this task**, within palace-ui (read `palace-ui/SPEC.md` and `palace.css`; check what each `--p-*` token holds before using it) and `@tinylap/design`. The markup and CSS below are the structure and the minimum; the skill decides the finish. Keep palace's rules: no border-radius, hard offset shadows only, transitions no slower than 0.1 s.

**Files:**
- Modify: `apps/timing/index.html`, `apps/timing/css/app.css`, `apps/timing/js/main.js`, `apps/timing/package.json` (test script)
- Create: `apps/timing/js/dom.js`, `apps/timing/js/api.js`, `apps/timing/js/format.js`, `apps/timing/js/view.js`, `apps/timing/js/live.js`, `apps/timing/js/board.js`
- Test: `apps/timing/test/format.test.js`, `apps/timing/test/view.test.js`, `apps/timing/test/browser/browser.js` (fixture), `apps/timing/test/browser/board.test.js`

**Interfaces:**
- Consumes: the snapshot and event shapes from Tasks 9, 10, 12, 14; `/auth/me` (`{ loggedIn, available, user, workspaces: [{ id, role, name? }] }`).
- Produces:
  - `h(tag, attrs?, ...children)` (dom.js): builds elements; `class`, `on<event>`, booleans, other attributes; never parses HTML.
  - `api(method, path, body?)` → parsed JSON or `null` for 204; throws `ApiError` with `status` and `problem` (api.js).
  - `formatLap(ms)` → `'8.000'`, `'1:02.345'`, `'—'` for null; `formatClock(ms)` → `'4:59'` (format.js).
  - `createView()`, `applyEvent(view, type, data, clientNow?)`, `serverNow(view, clientNow?)`, `clockOf(session, now)` → `{ label, ms } | null`, `driverName(view, id)` (view.js). View: `{ skew, session, standings, crossings, drivers: Map, bests: Map, track, direction, unknown, results }`.
  - `connect(url, onEvent(type, data), onStatus('live' | 'reconnecting' | 'closed'))` → `close()` (live.js).
  - `mountBoard(root, ctx)` → `unmount()` (board.js). `ctx = { view, watcher, onChange(fn) → off(), workspaceId?, me?, api? }`.
  - `SCREENS` in main.js: `{ id, label, mount(root, ctx) → unmount }[]`; Tasks 17–18 add screens there.
  - Browser fixture `openBrowser()`, `pageAs(browser, app, who)` → `{ context, page, errors }` (`who` null for a logged-out page).

- [ ] **Step 1: Write the failing unit tests**

Change the `test` script in `apps/timing/package.json` to:

```json
"test": "node --disable-warning=ExperimentalWarning --test 'test/*.test.js' 'test/server/*.test.js'",
```

`apps/timing/test/format.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatLap } from '../js/format.js';

test('lap times to the millisecond, minutes past a minute', () => {
  assert.equal(formatLap(8000), '8.000');
  assert.equal(formatLap(12_345), '12.345');
  assert.equal(formatLap(62_345), '1:02.345');
  assert.equal(formatLap(null), '—');
  assert.equal(formatLap(undefined), '—');
});

test('the session clock counts whole seconds, rounded up, never negative', () => {
  assert.equal(formatClock(300_000), '5:00');
  assert.equal(formatClock(299_001), '5:00');
  assert.equal(formatClock(59_000), '0:59');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatClock(3_600_000), '60:00');
});
```

`apps/timing/test/view.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, clockOf, createView, driverName, serverNow } from '../js/view.js';

const practice = { id: 'p1', kind: 'practice', state: 'running', opensAt: 1000, closesAt: null, trackId: 't1' };
const snapshot = (fields = {}) => ({
  now: 50_000, track: { id: 't1', name: 'Office' }, direction: 'cw', session: practice, standings: [],
  crossings: [], drivers: [{ id: 'ana', name: 'Ana', colour: '#ff2d9b' }], bests: [{ driverId: 'ana', bestMs: 8000, at: 1 }], unknown: ['0C'], ...fields,
});

test('the snapshot sets everything, and the skew to the server clock', () => {
  const view = applyEvent(createView(), 'snapshot', snapshot(), 45_000);
  assert.equal(view.skew, 5000);
  assert.equal(serverNow(view, 46_000), 51_000);
  assert.equal(view.drivers.get('ana').name, 'Ana');
  assert.equal(view.bests.get('ana'), 8000);
  assert.deepEqual(view.unknown, ['0C']);
});

test('a screen whose clock is off still counts down with the server', () => {
  // The device is 7 s behind the server.
  const view = applyEvent(createView(), 'snapshot', snapshot({ now: 100_000 }), 93_000);
  const race = { id: 'r1', kind: 'race', state: 'countdown', opensAt: 110_000, closesAt: 410_000, now: 100_000 };
  applyEvent(view, 'session', race, 93_000);
  assert.deepEqual(clockOf(view.session, serverNow(view, 93_000)), { label: 'Starts in', ms: 10_000 });
});

test('crossings of the current session are kept newest first, and improve bests', () => {
  const view = applyEvent(createView(), 'snapshot', snapshot(), 50_000);
  applyEvent(view, 'crossing', { sessionId: 'p1', driverId: 'ana', lapMs: 7900, counts: true, via: 'net', at: 2 });
  applyEvent(view, 'crossing', { sessionId: 'p1', driverId: 'ana', lapMs: 7000, counts: true, via: 'tap', at: 3 });
  applyEvent(view, 'crossing', { sessionId: 'old', driverId: 'ana', lapMs: 1, counts: true, via: 'net', at: 4 });
  assert.deepEqual(view.crossings.map((c) => c.lapMs), [7000, 7900]);
  assert.equal(view.bests.get('ana'), 7900, 'tap laps are never bests');
});

test('a new session clears the board; standings and results apply to their session', () => {
  const view = applyEvent(createView(), 'snapshot', snapshot({ crossings: [{ sessionId: 'p1', lapMs: 8000 }] }), 50_000);
  applyEvent(view, 'session', { id: 'r1', kind: 'race', state: 'countdown', opensAt: 1, closesAt: 2, now: 50_000 });
  assert.deepEqual([view.session.id, view.crossings, view.standings], ['r1', [], []]);
  assert.equal('now' in view.session, false);
  applyEvent(view, 'standings', { sessionId: 'p1', standings: [{ driverId: 'x' }] });
  assert.deepEqual(view.standings, []);
  applyEvent(view, 'results', { sessionId: 'r1', standings: [{ driverId: 'ana' }] });
  assert.deepEqual(view.standings, [{ driverId: 'ana' }]);
});

test('drivers, track and setup events', () => {
  const view = applyEvent(createView(), 'snapshot', snapshot(), 50_000);
  applyEvent(view, 'drivers', [{ id: 'ben', name: 'Ben', colour: '#2d9bff' }]);
  assert.equal(driverName(view, 'ben'), 'Ben');
  assert.equal(driverName(view, 'ana'), 'former driver', 'a deleted driver keeps their laps');
  assert.equal(driverName(view, null), 'unknown car');
  applyEvent(view, 'track', { track: { id: 't2', name: 'Hall' }, direction: 'ccw', bests: [] });
  assert.deepEqual([view.track.name, view.direction, view.bests.size], ['Hall', 'ccw', 0]);
  applyEvent(view, 'setup', { unknown: [] });
  assert.deepEqual(view.unknown, []);
});

test('the clock for each state', () => {
  assert.equal(clockOf(null, 0), null);
  assert.deepEqual(clockOf(practice, 61_000), { label: 'Practice', ms: 60_000 });
  const race = { kind: 'race', opensAt: 10_000, closesAt: 310_000 };
  assert.deepEqual(clockOf({ ...race, state: 'running' }, 70_000), { label: 'Remaining', ms: 240_000 });
  assert.deepEqual(clockOf({ ...race, state: 'running' }, 400_000), { label: 'Remaining', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'finishing' }, 400_000), { label: 'Last lap', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'done' }, 400_000), { label: 'Finished', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'aborted' }, 400_000), { label: 'Aborted', ms: 0 });
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `js/format.js` does not exist.

- [ ] **Step 2: Implement `js/format.js`, `js/view.js`**

`js/format.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** A lap time: seconds with milliseconds, minutes past a minute. @param {number | null | undefined} ms */
export function formatLap(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 60_000) return (ms / 1000).toFixed(3);
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}:${((ms % 60_000) / 1000).toFixed(3).padStart(6, '0')}`;
}

/** A session clock: m:ss, whole seconds rounded up, never negative. @param {number} ms */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
```

`js/view.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's model, fed by the live stream (spec §7). Pure, so it is
// tested in Node. Clocks run on server time: the snapshot and every session
// event carry the server's `now`, and `skew` is how far the device is off.

const KEEP = 30;

export const createView = () => ({
  skew: 0, session: null, standings: [], crossings: [], drivers: new Map(), bests: new Map(),
  track: null, direction: 'ccw', unknown: [], results: null,
});

const byId = (drivers) => new Map(drivers.map((d) => [d.id, d]));
const bestsOf = (bests) => new Map(bests.map((b) => [b.driverId, b.bestMs]));

/** Applies one live event. Returns the view. */
export function applyEvent(view, type, data, clientNow = Date.now()) {
  switch (type) {
    case 'snapshot':
      Object.assign(view, {
        skew: data.now - clientNow, session: data.session, standings: data.standings, crossings: data.crossings,
        drivers: byId(data.drivers), bests: bestsOf(data.bests), track: data.track, direction: data.direction,
        unknown: data.unknown ?? [], results: null,
      });
      break;
    case 'session': {
      const { now, ...session } = data;
      view.skew = now - clientNow;
      if (view.session?.id !== session.id) {
        view.standings = [];
        view.crossings = [];
      }
      view.session = session;
      break;
    }
    case 'crossing': {
      if (data.sessionId !== view.session?.id) break;
      view.crossings = [data, ...view.crossings].slice(0, KEEP);
      const best = view.bests.get(data.driverId);
      if (data.counts && data.via !== 'tap' && data.driverId && data.lapMs !== null && (best === undefined || data.lapMs < best)) {
        view.bests.set(data.driverId, data.lapMs);
      }
      break;
    }
    case 'standings':
      if (data.sessionId === view.session?.id) view.standings = data.standings;
      break;
    case 'results':
      view.results = data;
      if (data.sessionId === view.session?.id) view.standings = data.standings;
      break;
    case 'drivers':
      view.drivers = byId(data);
      break;
    case 'track':
      view.track = data.track;
      view.direction = data.direction;
      view.bests = bestsOf(data.bests);
      break;
    case 'setup':
      view.unknown = data.unknown;
      break;
    default:
      break;
  }
  return view;
}

export const serverNow = (view, clientNow = Date.now()) => clientNow + view.skew;

/** What the session clock shows at server time `now`. */
export function clockOf(session, now) {
  if (!session) return null;
  if (session.state === 'countdown') return { label: 'Starts in', ms: session.opensAt - now };
  if (session.kind === 'practice') return { label: 'Practice', ms: now - session.opensAt };
  if (session.state === 'running') return { label: 'Remaining', ms: Math.max(0, session.closesAt - now) };
  if (session.state === 'finishing') return { label: 'Last lap', ms: 0 };
  return { label: session.state === 'aborted' ? 'Aborted' : 'Finished', ms: 0 };
}

/** A driver's name; laps of a deleted driver stay theirs. */
export const driverName = (view, id) => view.drivers.get(id)?.name ?? (id ? 'former driver' : 'unknown car');
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: the unit tests pass.

- [ ] **Step 3: Write `js/dom.js`, `js/api.js`, `js/live.js`**

`js/dom.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Builds DOM without ever parsing HTML: names and codes come from users.

/**
 * @param {string} tag @param {Record<string, any>} [attrs]
 * @param {...(Node | string | null | undefined | false | (Node | string | null | undefined | false)[])} children
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}
```

`js/api.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export class ApiError extends Error {
  /** @param {number} status @param {any} problem RFC 9457 body, or null */
  constructor(status, problem) {
    super(problem?.detail ?? `The server answered ${status}.`);
    this.status = status;
    this.problem = problem;
  }
}

/** A same-origin JSON call. @param {string} method @param {string} path @param {unknown} [body] */
export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
```

`js/live.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The live stream. EventSource reconnects by itself and sends Last-Event-ID,
// so the server replays what was missed (spec §7).
const TYPES = ['snapshot', 'session', 'crossing', 'standings', 'results', 'drivers', 'track', 'setup'];

/** @param {string} url @param {(type: string, data: any) => void} onEvent @param {(status: 'live' | 'reconnecting' | 'closed') => void} onStatus */
export function connect(url, onEvent, onStatus) {
  const source = new EventSource(url);
  for (const type of TYPES) source.addEventListener(type, (event) => onEvent(type, JSON.parse(/** @type {MessageEvent} */ (event).data)));
  source.addEventListener('open', () => onStatus('live'));
  source.addEventListener('error', () => onStatus(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting'));
  return () => source.close();
}
```

- [ ] **Step 4: Write `js/board.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The live board (spec §8): session and clock, standings, the last laps.
// One layout from a phone to the wall; the watchers view is the same board
// without setup hints.
import { h } from './dom.js';
import { formatClock, formatLap } from './format.js';
import { clockOf, driverName, serverNow } from './view.js';

const KIND = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
const DIRECTION = { cw: 'clockwise', ccw: 'anticlockwise' };

function driverChip(view, id) {
  const chip = h('span', { class: 'driver' }, driverName(view, id));
  const colour = view.drivers.get(id)?.colour;
  if (colour) chip.style.setProperty('--driver', colour);
  return chip;
}

function header(view, now) {
  const s = view.session;
  const clock = clockOf(s, now);
  const where = view.track ? `${view.track.name} · ${DIRECTION[view.direction]}` : 'No track set';
  return h('header', { class: 'board-head' },
    h('div', {},
      h('p', { class: 'eyebrow' }, where),
      h('h1', { class: 'board-title' }, s ? KIND[s.kind] : 'Waiting for the first car')),
    clock && h('div', { class: 'board-clock' },
      h('span', { class: 'stat-label board-clock-label' }, clock.label),
      h('span', { class: 'board-clock-time' }, formatClock(clock.ms))));
}

function table(view) {
  if (view.standings.length === 0) return h('p', { class: 'empty board-empty' }, 'No laps yet.');
  const race = view.session?.kind === 'race';
  const last = new Map();
  for (const c of view.crossings) if (c.lapMs !== null && c.driverId && !last.has(c.driverId)) last.set(c.driverId, c.lapMs);
  return h('table', { class: 'board-table' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'Pos'), h('th', { scope: 'col' }, 'Driver'), h('th', { scope: 'col', class: 'num' }, 'Laps'),
      h('th', { scope: 'col', class: 'num' }, 'Best'), h('th', { scope: 'col', class: 'num' }, 'Last'),
      race && h('th', { scope: 'col', class: 'num' }, 'Time'))),
    h('tbody', {}, view.standings.map((row) => h('tr', { class: row.finished ? 'is-finished' : null },
      h('td', { class: 'pos' }, String(row.position)),
      h('td', {}, driverChip(view, row.driverId)),
      h('td', { class: 'num' }, String(row.laps)),
      h('td', { class: 'num' }, formatLap(row.bestMs), row.bestMs !== null && view.bests.get(row.driverId) === row.bestMs ? h('span', { class: 'badge pb' }, 'PB') : null),
      h('td', { class: 'num' }, formatLap(last.get(row.driverId))),
      race && h('td', { class: 'num' }, formatLap(row.elapsedMs))))));
}

function feed(view) {
  const laps = view.crossings.filter((c) => c.lapMs !== null).slice(0, 12);
  return h('aside', { class: 'board-feed', 'aria-label': 'Last laps' },
    h('h2', { class: 'h3' }, 'Last laps'),
    laps.length === 0
      ? h('p', { class: 'empty' }, 'Laps show up here as cars cross the line.')
      : h('ol', { class: 'board-laps' }, laps.map((c) => h('li', {},
        driverChip(view, c.driverId),
        h('span', { class: 'num' }, formatLap(c.lapMs)),
        c.via === 'tap' ? h('span', { class: 'tag' }, 'tap') : null,
        !c.counts && c.driverId ? h('span', { class: 'tag' }, 'not counted') : null))));
}

/** Draws the board into `section`. */
export function renderBoard(section, view, now, { watcher = false } = {}) {
  const unknown = !watcher && view.unknown.length > 0
    ? h('p', { class: 'status status-warning board-unknown', role: 'status' },
      `Unknown ${view.unknown.length === 1 ? 'car' : 'cars'}: ${view.unknown.join(', ')}. `, h('a', { href: '#setup' }, 'Assign in Setup'))
    : null;
  section.replaceChildren(header(view, now), unknown ?? '', h('div', { class: 'board-main' }, table(view)), feed(view));
}

/** Mounts the board; it redraws on every change and ticks its clock. */
export function mountBoard(root, ctx) {
  const section = h('section', { class: 'board' });
  root.append(section);
  const draw = () => renderBoard(section, ctx.view, serverNow(ctx.view), { watcher: ctx.watcher });
  draw();
  const off = ctx.onChange(draw);
  const timer = setInterval(() => {
    const clock = clockOf(ctx.view.session, serverNow(ctx.view));
    const time = section.querySelector('.board-clock-time');
    if (clock && time) time.textContent = formatClock(clock.ms);
  }, 200);
  return () => {
    off();
    clearInterval(timer);
    section.remove();
  };
}
```

- [ ] **Step 5: Write `index.html`, `js/main.js`, `css/app.css`**

`index.html` body (replace `<body>…</body>`):

```html
<body>
  <nav class="navbar" id="nav" hidden>
    <span class="navbar-brand">TinyLap Timing</span>
    <div class="nav-tabs" id="tabs"></div>
    <div class="navbar-right">
      <select id="workspace" class="nav-select" aria-label="Workspace"></select>
      <span class="live-status" id="live-status" role="status"></span>
      <button type="button" class="btn btn-sm btn-outline" id="btn-big">Big screen</button>
      <form method="post" action="/auth/logout"><button type="submit" class="btn btn-sm btn-outline">Log out</button></form>
    </div>
  </nav>
  <main id="app"></main>
  <script type="module" src="./js/main.js"></script>
</body>
```

`js/main.js` (replaces the scaffold):

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The app: the watchers view for #watch=<token> (no log-in, the token never
// leaves the fragment), otherwise log-in, a workspace, and its screens.
import { api } from './api.js';
import { mountBoard } from './board.js';
import { h } from './dom.js';
import { connect } from './live.js';
import { applyEvent, createView } from './view.js';

/** The screens, by hash. */
export const SCREENS = [
  { id: 'board', label: 'Board', mount: mountBoard },
];

const app = document.querySelector('#app');
const nav = /** @type {HTMLElement} */ (document.querySelector('#nav'));
const status = document.querySelector('#live-status');
const STATUS = { live: 'Live', reconnecting: 'Reconnecting…', closed: 'Disconnected' };

const tryStorage = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/** A full-page message, with an optional link. */
function notice(title, text, link) {
  app.replaceChildren(h('section', { class: 'container-narrow stack-md notice' },
    h('h1', {}, title), h('p', { class: 'subtitle' }, text),
    link && h('a', { class: 'btn btn-primary', href: link.href }, link.label)));
}

/** A live view: events go into `view`, then every listener runs. */
function live(url, onStatus) {
  const view = createView();
  const listeners = new Set();
  const close = connect(url, (type, data) => {
    applyEvent(view, type, data);
    for (const fn of listeners) fn();
  }, onStatus);
  return { view, close, onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
}

function bigScreen() {
  document.body.classList.toggle('big');
  if (document.body.classList.contains('big')) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function watch(token) {
  document.body.classList.add('watching');
  const stream = live(`/watch/${encodeURIComponent(token)}/live`, (state) => {
    if (state === 'closed') notice('This watchers link no longer works', 'Ask someone at the track for a new one.');
  });
  mountBoard(app, { view: stream.view, watcher: true, onChange: stream.onChange });
}

function member(me) {
  const workspaces = me.workspaces;
  const asked = new URLSearchParams(location.search).get('w');
  const stored = tryStorage(() => localStorage.getItem('timing.workspace'));
  const workspaceId = [asked, stored].find((id) => workspaces.some((w) => w.id === id)) ?? workspaces[0].id;
  tryStorage(() => localStorage.setItem('timing.workspace', workspaceId));

  nav.hidden = false;
  const select = /** @type {HTMLSelectElement} */ (document.querySelector('#workspace'));
  select.replaceChildren(...workspaces.map((w) => h('option', { value: w.id, selected: w.id === workspaceId }, w.name ?? 'Workspace')));
  select.addEventListener('change', () => { location.search = `?w=${encodeURIComponent(select.value)}`; });
  document.querySelector('#btn-big').addEventListener('click', bigScreen);
  // Big screen hides the navbar; leaving full screen (Escape) leaves it.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) document.body.classList.remove('big');
  });

  const stream = live(`/workspaces/${encodeURIComponent(workspaceId)}/live`, (state) => { status.textContent = STATUS[state]; });
  const ctx = { workspaceId, me, view: stream.view, watcher: false, onChange: stream.onChange, api };
  const tabs = document.querySelector('#tabs');
  let unmount = () => {};
  const show = () => {
    const id = location.hash.slice(1);
    const screen = SCREENS.find((s) => s.id === id) ?? SCREENS[0];
    tabs.replaceChildren(...SCREENS.map((s) => h('a', { class: 'nav-tab', href: `#${s.id}`, 'aria-current': s === screen ? 'page' : null }, s.label)));
    unmount();
    app.replaceChildren();
    unmount = screen.mount(app, ctx);
  };
  window.addEventListener('hashchange', show);
  show();
}

async function start() {
  const token = new URLSearchParams(location.hash.slice(1)).get('watch');
  if (token) return watch(token);
  let me;
  try {
    me = await api('GET', '/auth/me');
  } catch {
    return notice("Timing can't be reached", 'Try again in a minute.');
  }
  if (!me.available) return notice('Log-in is not set up', 'This server has no TinyLap accounts to log in with.');
  const returnTo = location.pathname + location.search + location.hash;
  if (!me.loggedIn) return notice('TinyLap Timing', 'Log in to time laps on your track.', { href: `/auth/login?returnTo=${encodeURIComponent(returnTo)}`, label: 'Log in' });
  if (me.workspaces.length === 0) return notice('No workspace yet', 'Create a club in your TinyLap account first.', { href: me.accountUrl, label: 'Account' });
  member(me);
}

start();
```

`css/app.css` (the minimum structure; finish it with the `frontend-design` skill):

```css
/* SPDX-FileCopyrightText: 2026 The TinyLap contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later */

/* TinyLap Timing on top of palace-ui. Every colour, space and border comes
 * from a --p-* token; numbers are tabular so columns don't jitter as times
 * change. Body class `big` scales the board for a wall screen. */

body { margin: 0; min-height: 100dvh; background: var(--p-bg); }

.nav-tabs { display: flex; gap: var(--p-space-xs); }
.nav-tab { color: inherit; text-decoration: none; padding: var(--p-space-xs) var(--p-space-sm); }
.nav-tab[aria-current="page"] { box-shadow: inset 0 -3px 0 var(--p-accent-1); }
.live-status { font-size: 12px; text-transform: uppercase; }

.notice { padding-block: var(--p-space-2xl); }

.board {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
  gap: var(--p-space-lg);
  padding: var(--p-space-lg);
}
.board-head, .board-unknown { grid-column: 1 / -1; }
.board-head { display: flex; justify-content: space-between; align-items: end; gap: var(--p-space-md); flex-wrap: wrap; }
.board-title { margin: 0; text-transform: uppercase; font-size: clamp(1.5rem, 4vw, 3rem); }
.board-clock { display: grid; justify-items: end; }
.board-clock-time { font: 700 clamp(2.5rem, 9vw, 7rem) / 1 var(--p-font-mono); font-variant-numeric: tabular-nums; }

.board-table { width: 100%; border-collapse: collapse; background: var(--p-surface); border: var(--p-border-width) solid var(--p-text); }
.board-table th, .board-table td { padding: var(--p-space-sm) var(--p-space-md); text-align: left; border-bottom: 1px solid var(--p-border-light); }
.board-table .pos { font-weight: 700; }
.num { text-align: right; font-family: var(--p-font-mono); font-variant-numeric: tabular-nums; }
.is-finished td { color: var(--p-text-muted); }
.pb { margin-left: var(--p-space-xs); background: var(--p-accent-1); }

.driver::before {
  content: '';
  display: inline-block;
  width: 0.75em;
  height: 0.75em;
  margin-right: var(--p-space-xs);
  background: var(--driver, var(--p-text-faint));
  border: 1px solid var(--p-text);
}

.board-laps { list-style: none; margin: 0; padding: 0; }
.board-laps li { display: flex; gap: var(--p-space-sm); align-items: baseline; padding-block: var(--p-space-xs); border-bottom: 1px solid var(--p-border-light); }
.board-laps .num { margin-left: auto; }

body.big .navbar, body.watching .navbar { display: none; }
body.big .board { font-size: clamp(1rem, 2.4vw, 2.25rem); min-height: 100dvh; box-sizing: border-box; }

@media (max-width: 720px) {
  .board { grid-template-columns: 1fr; padding: var(--p-space-md); }
}
```

- [ ] **Step 6: Write the browser fixture and the failing browser test**

`apps/timing/test/browser/browser.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Google Chrome through playwright-core, as the planner's browser tests use
// it. A logged-in page gets the session cookie from a login made over HTTP
// (startTiming's login), so no passkey is needed here.
import { chromium } from 'playwright-core';
import { launchOptions } from '../../../accounts/playwright.config.js';

export const openBrowser = () => chromium.launch(launchOptions);

/** A page as `who` (a login from startTiming, or null), collecting script errors and CSP violations. */
export async function pageAs(browser, app, who, { viewport = { width: 1280, height: 800 } } = {}) {
  const context = await browser.newContext({ baseURL: app.base, viewport });
  if (who) {
    await context.addCookies([{ name: '__Host-tinylap-session', value: who.jar.cookies.get('__Host-tinylap-session'), url: `${app.base}/`, secure: true, httpOnly: true, sameSite: 'Lax' }]);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/status of 40[134]/.test(message.text())) errors.push(message.text());
  });
  return { context, page, errors };
}

/** Posts passings as a decoder. */
export const postPassings = (app, decoder, passings, boot = 'b00tb00t') => fetch(`${app.base}/decoders/${decoder.id}/passings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${decoder.token}` },
  body: JSON.stringify({ boot, passings }),
});
```

If Chrome refuses the `Secure` cookie on `http://127.0.0.1`, start the app's browser pages on `http://localhost:<port>` instead (the session is looked up by the cookie, and writes pass `requireSameOrigin` by `Sec-Fetch-Site: same-origin`).

`apps/timing/test/browser/board.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

let app;
let browser;
let member;
let office;
let decoder;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  const owner = await app.signUp('Ana');
  office = app.club(owner, 'Office');
  member = await app.login(owner);
  const ana = await (await app.api(member, 'POST', `/workspaces/${office.id}/drivers`, { name: 'Ana' })).json();
  await app.api(member, 'PUT', `/workspaces/${office.id}/transponders/10`, { driverId: ana.id });
  decoder = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name: 'Gate' })).json();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('the board shows laps as they arrive, and unknown cars', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/');
  await page.getByRole('heading', { name: 'Waiting for the first car' }).waitFor();
  await postPassings(app, decoder, [{ transponder: '10', t: 1000 }, { transponder: '10', t: 9000 }, { transponder: '4711', t: 9500 }]);
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  await page.locator('.board-table').getByText('Ana').waitFor();
  // Laps, Best, Last: the best cell holds the time and its PB badge.
  assert.match(await page.locator('.board-table td.num').nth(1).innerText(), /^8\.000\s*PB$/);
  await page.getByRole('status').filter({ hasText: 'Unknown car: 4711' }).waitFor();
  assert.deepEqual(errors, []);
});

test('watchers see the board without setup, until the link is rotated', async (t) => {
  const { token } = await (await app.api(member, 'POST', `/workspaces/${office.id}/watch-token`)).json();
  const { context, page, errors } = await pageAs(browser, app, null, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto(`/#watch=${token}`);
  await page.getByRole('heading', { name: 'Practice' }).waitFor();
  assert.equal(await page.locator('#nav').isVisible(), false);
  assert.equal(await page.getByText('4711').count(), 0, 'no transponder codes for watchers');
  await app.api(member, 'POST', `/workspaces/${office.id}/watch-token`);
  await page.getByRole('heading', { name: 'This watchers link no longer works' }).waitFor();
  assert.deepEqual(errors.filter((e) => !/EventSource|404/.test(e)), []);
});
```

- [ ] **Step 7: Run everything**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app test:browser`
Expected: PASS. Then look at the board yourself (Task 19's dev commands, or `SCREENSHOT_DIR` like the planner's browser tests) at phone width, laptop width and in big-screen mode.

- [ ] **Step 8: Lint, typecheck, commit**

```bash
pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck && pnpm --filter @tinylap/tools test
git add apps/timing
git commit -s -m "feat(timing-app): show the live board and the watchers view"
```

---
### Task 17: Race control, tap entry and setup screens

**Use the `frontend-design` skill for this task**, within palace-ui and `@tinylap/design`, as in Task 16. Tap tiles are for thumbs at the track: big, high-contrast, no hover-only affordances.

**Files:**
- Create: `apps/timing/js/control.js`, `apps/timing/js/tap.js`, `apps/timing/js/setup.js`
- Modify: `apps/timing/js/main.js` (`SCREENS`), `apps/timing/css/app.css`
- Test: `apps/timing/test/browser/screens.test.js`

**Interfaces:**
- Consumes: `h`, `api`/`ApiError`, `ctx` (Task 16), the routes of Tasks 12–14.
- Produces: `mountControl`, `mountTap`, `mountSetup` (each `(root, ctx) → unmount`), registered in `SCREENS` as `control` ("Race"), `tap` ("Tap"), `setup` ("Setup").
- Each screen redraws only when what it shows changes (a key over the relevant view fields), so typing in a form is never wiped by a passing car.

- [ ] **Step 1: Write the failing browser test**

`apps/timing/test/browser/screens.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { CLOSED, startPlannerStub } from '../server/planner-stub.js';
import { openBrowser, pageAs, postPassings } from './browser.js';

const clock = { now: Date.now() };
let app;
let planner;
let browser;
let member;
let office;
let decoder;

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ clock, plannerUrl: planner.url });
  browser = await openBrowser();
  const owner = await app.signUp('Ana');
  office = app.club(owner, 'Office');
  member = await app.login(owner);
  decoder = await (await app.api(member, 'POST', `/workspaces/${office.id}/decoders`, { name: 'Gate' })).json();
});
after(async () => {
  await browser?.close();
  await app?.close();
  await planner?.close();
});

test('setup: drivers, an unknown car, the track and the watchers link', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/#setup');
  await page.getByLabel('New driver').fill('Ana');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await page.getByLabel('New driver').fill('Ben');
  await page.getByRole('button', { name: 'Add driver' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Ben' }).waitFor();

  await postPassings(app, decoder, [{ transponder: '4711', t: 1000 }]);
  const row = page.getByRole('row').filter({ hasText: '4711' });
  await row.getByRole('combobox').selectOption({ label: 'Ben' });
  await page.waitForFunction(() => document.querySelector('tr.is-unknown') === null);
  assert.deepEqual(app.store.transponders(office.id).map((x) => x.code), ['4711']);
  assert.notEqual(app.store.transponders(office.id)[0].driverId, null);

  await page.getByLabel('Planner link').fill(`${planner.url}/layouts/${CLOSED}`);
  await page.getByLabel('Track name').fill('Office loop');
  await page.getByLabel('Direction').selectOption('cw');
  await page.getByRole('button', { name: 'Use this track' }).click();
  await page.getByText('Now: Office loop, clockwise.').waitFor();

  await page.getByRole('button', { name: 'Make a watchers link' }).click();
  const link = await page.getByLabel('Watchers link').inputValue();
  assert.match(link, /\/#watch=[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(errors, []);
});

test('race control starts and aborts a race', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/#control');
  await page.getByLabel('Race', { exact: true }).check();
  await page.getByLabel('Minutes').fill('2');
  await page.getByLabel('Countdown (seconds)').fill('0');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('heading', { name: 'Race' }).waitFor();
  await page.getByText('Remaining').waitFor();
  await page.goto('/#control');
  await page.getByRole('button', { name: 'Abort' }).click();
  await page.getByRole('button', { name: 'Start' }).waitFor();
  assert.deepEqual(errors, []);
});

test('tap entry records laps by hand', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member, { viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.goto('/#tap');
  const ana = page.getByRole('button', { name: 'Ana' });
  await ana.click();
  clock.now += 8000;
  await ana.click();
  await page.getByText('8.000').waitFor();
  await page.goto('/#board');
  await page.locator('.board-laps').getByText('tap').first().waitFor();
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tinylap/timing-app test:browser`
Expected: FAIL, the screens don't exist (`#setup` shows the board).

- [ ] **Step 3: Implement `js/control.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Race control (spec §8): start a qualifying or race for chosen drivers, or
// abort the one running. Practice needs no control; it is always on.
import { h } from './dom.js';

const ACTIVE = new Set(['countdown', 'running', 'finishing']);
const KIND = { qualifying: 'Qualifying', race: 'Race' };

export function mountControl(root, ctx) {
  const section = h('section', { class: 'container stack-lg screen' });
  root.append(section);
  const base = `/workspaces/${encodeURIComponent(ctx.workspaceId)}`;
  const errorBox = () => h('p', { class: 'status status-error', role: 'alert', hidden: true });
  const fail = (box, error) => {
    box.textContent = error.message;
    box.hidden = false;
  };

  function startForm() {
    const drivers = [...ctx.view.drivers.values()];
    if (drivers.length === 0) return h('div', { class: 'card stack-md' }, h('h1', {}, 'Race control'), h('p', { class: 'empty' }, 'Add drivers in Setup first. '), h('a', { href: '#setup' }, 'Setup'));
    const error = errorBox();
    const radio = (value, label, checked) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'kind', value, checked }), label);
    const form = h('form', { class: 'card stack-md' },
      h('h1', {}, 'Race control'),
      h('fieldset', { class: 'stack-sm' }, h('legend', {}, 'Session'), radio('race', 'Race', true), radio('qualifying', 'Qualifying', false)),
      h('fieldset', { class: 'stack-sm' }, h('legend', {}, 'Drivers'),
        drivers.map((d) => h('label', { class: 'choice' }, h('input', { type: 'checkbox', name: 'roster', value: d.id, checked: true }), d.name))),
      h('label', { class: 'field' }, 'Minutes', h('input', { type: 'number', name: 'minutes', value: '5', min: '1', max: '60', step: '1', required: true })),
      h('label', { class: 'field' }, 'Countdown (seconds)', h('input', { type: 'number', name: 'countdown', value: '10', min: '0', max: '30', step: '1', required: true })),
      error,
      h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, 'Start'));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await ctx.api('POST', `${base}/sessions`, {
          kind: data.get('kind'), roster: data.getAll('roster'),
          durationSeconds: Number(data.get('minutes')) * 60, countdownSeconds: Number(data.get('countdown')),
        });
        location.hash = '#board';
      } catch (caught) {
        fail(error, caught);
      }
    });
    return form;
  }

  function runningPanel(session) {
    const error = errorBox();
    const abort = h('button', { type: 'button', class: 'btn btn-danger btn-lg' }, 'Abort');
    abort.addEventListener('click', async () => {
      try {
        await ctx.api('POST', `${base}/sessions/${encodeURIComponent(session.id)}/abort`);
      } catch (caught) {
        fail(error, caught);
      }
    });
    return h('div', { class: 'card stack-md' },
      h('h1', {}, KIND[session.kind]),
      h('p', { class: 'subtitle' }, session.state === 'countdown' ? 'Counting down' : session.state === 'finishing' ? 'Finishing the last lap' : 'Running'),
      h('a', { class: 'btn btn-secondary', href: '#board' }, 'Show the board'),
      error, abort);
  }

  let key = '';
  const draw = () => {
    const s = ctx.view.session;
    const running = s && s.kind !== 'practice' && ACTIVE.has(s.state) ? s : null;
    const next = running ? `run:${running.id}:${running.state}` : `form:${[...ctx.view.drivers.keys()].join(',')}`;
    if (next === key) return;
    key = next;
    section.replaceChildren(running ? runningPanel(running) : startForm());
  };
  draw();
  const off = ctx.onChange(draw);
  return () => {
    off();
    section.remove();
  };
}
```

- [ ] **Step 4: Implement `js/tap.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tap entry (spec §8): a tile per driver; a tap is a passing. For racing
// before the decoder exists, or when it's down.
import { h } from './dom.js';
import { formatLap } from './format.js';

export function mountTap(root, ctx) {
  const section = h('section', { class: 'tap-screen' });
  root.append(section);
  const result = h('p', { class: 'tap-result', role: 'status' }, 'Tap a driver as their car crosses the line.');

  const tile = (driver) => {
    const button = h('button', { type: 'button', class: 'tap-tile' }, driver.name);
    button.style.setProperty('--driver', driver.colour);
    button.addEventListener('click', async () => {
      button.classList.add('is-tapped');
      setTimeout(() => button.classList.remove('is-tapped'), 150);
      try {
        const { stored, lapMs } = await ctx.api('POST', `/workspaces/${encodeURIComponent(ctx.workspaceId)}/tap`, { driverId: driver.id });
        result.textContent = !stored ? 'Too fast, tap again.' : lapMs === null ? `${driver.name}: started` : `${driver.name}: ${formatLap(lapMs)}`;
      } catch (error) {
        result.textContent = error.message;
      }
    });
    return button;
  };

  let key = null;
  const draw = () => {
    const drivers = [...ctx.view.drivers.values()];
    const next = drivers.map((d) => `${d.id}:${d.name}:${d.colour}`).join('|');
    if (next === key) return;
    key = next;
    section.replaceChildren(
      drivers.length ? h('div', { class: 'tap-grid' }, drivers.map(tile)) : h('p', { class: 'empty' }, 'Add drivers in Setup first.'),
      result);
  };
  draw();
  const off = ctx.onChange(draw);
  return () => {
    off();
    section.remove();
  };
}
```

- [ ] **Step 5: Implement `js/setup.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup (spec §8): the track, drivers, transponders, decoders and the
// watchers link. Deleting needs owner or admin, as the server enforces.
import { h } from './dom.js';

const DIRECTIONS = [['ccw', 'Anticlockwise'], ['cw', 'Clockwise']];

export function mountSetup(root, ctx) {
  const base = `/workspaces/${encodeURIComponent(ctx.workspaceId)}`;
  const role = ctx.me.workspaces.find((w) => w.id === ctx.workspaceId)?.role;
  const mayDelete = role === 'owner' || role === 'admin';
  const section = h('section', { class: 'container stack-xl screen' });
  root.append(section);
  const parts = { track: h('div'), drivers: h('div'), transponders: h('div'), decoders: h('div'), watch: h('div') };
  section.append(h('h1', {}, 'Setup'), ...Object.values(parts));

  /** Runs `call`; a failure shows in `box`. */
  const attempt = async (box, call) => {
    box.hidden = true;
    try {
      await call();
    } catch (error) {
      box.textContent = error.message;
      box.hidden = false;
    }
  };
  const errorBox = () => h('p', { class: 'status status-error', role: 'alert', hidden: true });
  const card = (title, ...children) => h('section', { class: 'card stack-md' }, h('h2', { class: 'h3' }, title), ...children);
  const field = (label, input) => h('label', { class: 'field' }, label, input);

  function drawTrack() {
    const error = errorBox();
    const link = h('input', { type: 'url', name: 'link', required: true, placeholder: 'https://…/layouts/…' });
    const name = h('input', { type: 'text', name: 'name', maxlength: '60', value: ctx.view.track?.name ?? '' });
    const direction = h('select', { name: 'direction' }, DIRECTIONS.map(([v, l]) => h('option', { value: v, selected: v === ctx.view.direction }, l)));
    const form = h('form', { class: 'stack-sm' }, field('Planner link', link), field('Track name', name), field('Direction', direction), error,
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Use this track'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      attempt(error, () => ctx.api('PUT', `${base}/track`, { link: link.value, name: name.value || undefined, direction: direction.value }));
    });
    parts.track.replaceChildren(card('Track',
      h('p', {}, ctx.view.track ? `Now: ${ctx.view.track.name}, ${ctx.view.direction === 'cw' ? 'clockwise' : 'anticlockwise'}.` : 'No track yet: paste a share link from the planner.'),
      form));
  }

  function drawDrivers() {
    const error = errorBox();
    const name = h('input', { type: 'text', name: 'name', maxlength: '60', required: true });
    const form = h('form', { class: 'inline-form' }, field('New driver', name), h('button', { type: 'submit', class: 'btn btn-primary' }, 'Add driver'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      attempt(error, async () => {
        await ctx.api('POST', `${base}/drivers`, { name: name.value });
        name.value = '';
      });
    });
    const item = (driver) => {
      const chip = h('span', { class: 'driver' }, driver.name);
      chip.style.setProperty('--driver', driver.colour);
      const rename = h('button', { type: 'button', class: 'btn btn-sm btn-outline' }, 'Rename');
      rename.addEventListener('click', () => {
        const next = prompt('New name', driver.name);
        if (next) attempt(error, () => ctx.api('PATCH', `${base}/drivers/${encodeURIComponent(driver.id)}`, { name: next }));
      });
      const remove = mayDelete && h('button', { type: 'button', class: 'btn btn-sm btn-danger' }, 'Delete');
      if (remove) remove.addEventListener('click', () => {
        if (confirm(`Delete ${driver.name}? Their laps stay, under "former driver".`)) attempt(error, () => ctx.api('DELETE', `${base}/drivers/${encodeURIComponent(driver.id)}`));
      });
      return h('li', { class: 'setup-row' }, chip, rename, remove);
    };
    parts.drivers.replaceChildren(card('Drivers', h('ul', { class: 'setup-list' }, [...ctx.view.drivers.values()].map(item)), form, error));
  }

  async function drawTransponders() {
    const error = errorBox();
    const { transponders } = await ctx.api('GET', `${base}/transponders`);
    const drivers = [...ctx.view.drivers.values()];
    const rows = transponders.map((t) => {
      const select = h('select', { 'aria-label': `Driver for ${t.code}` },
        h('option', { value: '', selected: t.driverId === null }, '— unassigned'),
        drivers.map((d) => h('option', { value: d.id, selected: d.id === t.driverId }, d.name)));
      select.addEventListener('change', () => attempt(error, () => ctx.api('PUT', `${base}/transponders/${t.code}`, { driverId: select.value || null })));
      return h('tr', { class: t.driverId === null ? 'is-unknown' : null }, h('td', { class: 'num' }, t.code), h('td', {}, select));
    });
    parts.transponders.replaceChildren(card('Transponders',
      rows.length ? h('table', { class: 'board-table' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Code'), h('th', { scope: 'col' }, 'Driver'))), h('tbody', {}, rows))
        : h('p', { class: 'empty' }, 'Transponders show up here when a car first crosses the line.'),
      error));
  }

  async function drawDecoders() {
    const error = errorBox();
    const { decoders } = await ctx.api('GET', `${base}/decoders`);
    const shown = h('div');
    const wifiOnly = h('button', { type: 'button', class: 'btn btn-outline' }, 'Pair without USB');
    wifiOnly.addEventListener('click', () => attempt(error, async () => {
      const decoder = await ctx.api('POST', `${base}/decoders`, { name: 'Decoder' });
      shown.replaceChildren(h('p', { class: 'status status-info' }, `Decoder ${decoder.id}, token ${decoder.token}. Shown once: copy it now.`));
      await drawDecoders();
    }));
    const item = (d) => {
      const remove = mayDelete && h('button', { type: 'button', class: 'btn btn-sm btn-danger' }, 'Unpair');
      if (remove) remove.addEventListener('click', () => {
        if (confirm(`Unpair ${d.name}? Its token stops working.`)) attempt(error, async () => { await ctx.api('DELETE', `${base}/decoders/${encodeURIComponent(d.id)}`); await drawDecoders(); });
      });
      return h('li', { class: 'setup-row' }, h('span', {}, d.name), h('span', { class: 'meta' }, d.lastSeenAt ? `seen ${new Date(d.lastSeenAt).toLocaleString()}` : 'never seen'), remove);
    };
    parts.decoders.replaceChildren(card('Decoders',
      h('ul', { class: 'setup-list' }, decoders.map(item)),
      h('p', {}, 'Pair a decoder over USB in ', h('a', { href: '#bridge' }, 'Bridge'), '.'),
      wifiOnly, shown, error));
  }

  async function drawWatch() {
    const error = errorBox();
    const { token } = await ctx.api('GET', `${base}/watch-token`);
    const url = token ? `${location.origin}/#watch=${token}` : '';
    const make = h('button', { type: 'button', class: 'btn btn-primary' }, token ? 'Make a new watchers link' : 'Make a watchers link');
    make.addEventListener('click', () => {
      if (token && !confirm('The old link stops working. Make a new one?')) return;
      attempt(error, async () => { await ctx.api('POST', `${base}/watch-token`); await drawWatch(); });
    });
    parts.watch.replaceChildren(card('Watchers link',
      h('p', {}, 'Anyone with this link sees the board, read-only, without logging in.'),
      token && field('Watchers link', h('input', { type: 'text', readonly: true, value: url })),
      make, error));
  }

  let keys = {};
  const draw = () => {
    const drivers = [...ctx.view.drivers.values()].map((d) => `${d.id}:${d.name}:${d.colour}`).join('|');
    const next = { track: `${ctx.view.track?.id}:${ctx.view.track?.name}:${ctx.view.direction}`, drivers, transponders: `${drivers}#${ctx.view.unknown.join(',')}` };
    if (next.track !== keys.track) drawTrack();
    if (next.drivers !== keys.drivers) drawDrivers();
    if (next.transponders !== keys.transponders) drawTransponders().catch(() => {});
    keys = next;
  };
  draw();
  drawDecoders().catch(() => {});
  drawWatch().catch(() => {});
  const off = ctx.onChange(draw);
  return () => {
    off();
    section.remove();
  };
}
```

- [ ] **Step 6: Register the screens and style them**

In `js/main.js`, import the three mounts and extend `SCREENS`:

```js
import { mountControl } from './control.js';
import { mountSetup } from './setup.js';
import { mountTap } from './tap.js';

export const SCREENS = [
  { id: 'board', label: 'Board', mount: mountBoard },
  { id: 'control', label: 'Race', mount: mountControl },
  { id: 'tap', label: 'Tap', mount: mountTap },
  { id: 'setup', label: 'Setup', mount: mountSetup },
];
```

Append to `css/app.css`:

```css
.screen { padding-block: var(--p-space-lg); }
.field { display: grid; gap: var(--p-space-xs); font-weight: 600; }
.choice { display: flex; gap: var(--p-space-sm); align-items: center; }
.inline-form { display: flex; gap: var(--p-space-sm); align-items: end; flex-wrap: wrap; }
.setup-list { list-style: none; margin: 0; padding: 0; }
.setup-row { display: flex; gap: var(--p-space-sm); align-items: center; padding-block: var(--p-space-xs); }
.setup-row .meta { color: var(--p-text-muted); font-size: 12px; margin-left: auto; }
tr.is-unknown td { background: var(--p-warning); }

.tap-screen { padding: var(--p-space-md); display: grid; gap: var(--p-space-md); }
.tap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--p-space-md); }
.tap-tile {
  min-height: 7rem;
  font: 700 1.5rem var(--p-font);
  text-transform: uppercase;
  background: var(--p-surface);
  border: var(--p-border-width) solid var(--p-text);
  box-shadow: inset 0 -0.5rem 0 var(--driver, var(--p-text-faint));
  touch-action: manipulation;
}
.tap-tile.is-tapped { background: var(--driver, var(--p-accent-1)); }
.tap-result { font: 700 1.25rem var(--p-font-mono); }
```

- [ ] **Step 7: Run everything**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app test:browser`
Expected: PASS.

- [ ] **Step 8: Lint, typecheck, commit**

```bash
pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck
git add apps/timing
git commit -s -m "feat(timing-app): add race control, tap entry and setup"
```

---
### Task 18: The bridge: Web Serial, outbox, pairing

**Use the `frontend-design` skill for the bridge screen**, within palace-ui and `@tinylap/design`.

**Files:**
- Create: `apps/timing/js/outbox.js`, `apps/timing/js/bridge.js`, `apps/timing/js/sim-port.js`, `apps/timing/js/bridge-view.js`
- Modify: `apps/timing/js/main.js` (`SCREENS`), `apps/timing/css/app.css`
- Test: `apps/timing/test/outbox.test.js`, `apps/timing/test/bridge.test.js`, `apps/timing/test/browser/bridge.test.js`

**Interfaces:**
- Consumes: `commands`, `createReader`, `nextLap`, `createSimulator`, `ZROUND_BAUD`, `MAX_BATCH` (`@tinylap/timing`); `POST /decoders/{id}/passings` with the member session; `POST /workspaces/{w}/decoders`.
- Produces:
  - Outbox (outbox.js): `memoryOutbox()` and `openOutbox(name?)` (IndexedDB, falling back to memory when IndexedDB is unavailable), both `{ add(passing), list(), count(), removeThrough(decoder, boot, t) }`, all async. A passing is `{ decoder, boot, transponder, t }`; adding the same one twice keeps one.
  - `Bridge` (bridge.js), an `EventTarget`: `new Bridge({ port, outbox, post(decoderId, batch) → { through }, helloMs? = 2000, retryMs? = 5000, replyMs? = 3000 })`; `start()`, `pair(decoderId, token, wifi?: { ssid, password })`, `flush()`, `close()`; properties `state` (`'idle' | 'connecting' | 'unpaired' | 'ready' | 'not-tinylap' | 'disconnected'`), `decoder`, `boot`, `online`, `lastError`; events `state`, `passing` (`detail: { decoder, boot, transponder, t, lapMs }`, the local preview), `outbox`, `online`.
  - `simulatedPort({ lapMs?, cars? })` (sim-port.js): a `SerialPort` look-alike (`open`, `close`, `readable`, `writable`, `getInfo`) driven by `createSimulator`. The bridge screen uses it for `?simulate` (laps of 8 s) and `?simulate=fast` (2 s).
  - `mountBridge(root, ctx)` (bridge-view.js). The `Bridge` lives at module level: leaving the screen keeps it forwarding.

- [ ] **Step 1: Write the failing unit tests**

`apps/timing/test/outbox.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryOutbox, openOutbox } from '../js/outbox.js';

const p = (t, transponder = '0A', boot = 'b00tb00t', decoder = 'd1') => ({ decoder, boot, transponder, t });

test('the memory outbox keeps one copy and drops up to a time per boot', async () => {
  const box = memoryOutbox();
  await box.add(p(1000));
  await box.add(p(1000));
  await box.add(p(9000));
  await box.add(p(500, '0B'));
  await box.add(p(100, '0A', 'otherboot'));
  assert.equal(await box.count(), 4);
  await box.removeThrough('d1', 'b00tb00t', 1000);
  assert.deepEqual((await box.list()).map((x) => [x.boot, x.transponder, x.t]), [['b00tb00t', '0A', 9000], ['otherboot', '0A', 100]]);
});

test('without IndexedDB the outbox falls back to memory', async () => {
  const box = await openOutbox('test');
  await box.add(p(1));
  assert.equal(await box.count(), 1);
});
```

`apps/timing/test/bridge.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, createReader, createSimulator } from '@tinylap/timing';
import { Bridge } from '../js/bridge.js';
import { memoryOutbox } from '../js/outbox.js';

/** A serial port whose other end is `sim` (or silence). */
function fakePort(sim) {
  let controller;
  const reader = createReader();
  const port = {
    readable: new ReadableStream({ start(c) { controller = c; } }),
    writable: new WritableStream({
      write(chunk) {
        if (!sim) return;
        for (const message of reader.push(new TextDecoder().decode(chunk))) {
          for (const line of sim.reply(message, 0)) controller.enqueue(new TextEncoder().encode(line));
        }
      },
    }),
    open: async () => {},
    close: async () => {},
  };
  return { port, send: (line) => controller.enqueue(new TextEncoder().encode(line)), end: () => controller.close() };
}

const until = async (fn) => {
  for (let i = 0; i < 200; i += 1) {
    if (await fn()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error('timed out');
};

test('an unpaired decoder is paired, then forwards passings', async () => {
  const sim = createSimulator({ cars: [] });
  const { port, send } = fakePort(sim);
  const posts = [];
  const outbox = memoryOutbox();
  const bridge = new Bridge({ port, outbox, post: async (decoder, batch) => { posts.push({ decoder, batch }); return { through: Math.max(...batch.passings.map((x) => x.t)) }; } });
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  await bridge.pair('dec_1', 't'.repeat(43), { ssid: 'Office', password: 'secret' });
  await until(() => bridge.state === 'ready');
  assert.equal(sim.decoder, 'dec_1');
  assert.equal(bridge.decoder, 'dec_1');

  const seen = [];
  bridge.addEventListener('passing', (event) => seen.push(event.detail));
  send(commands.lap('0A', 1000));
  send(commands.lap('0A', 9000));
  await until(async () => (await outbox.count()) === 0 && posts.length > 0 && seen.length === 2);
  assert.deepEqual(seen.map((x) => x.lapMs), [null, 8000], 'the local preview computes laps');
  assert.deepEqual(posts.flatMap((x) => x.batch.passings.map((y) => y.t)).sort((a, b) => a - b), [1000, 9000]);
  assert.ok(posts.every((x) => x.decoder === 'dec_1' && x.batch.boot === sim.boot));
  await bridge.close();
});

test('offline, passings wait in the outbox and go when the server is back', async () => {
  const sim = createSimulator({ cars: [], decoder: 'dec_1' });
  const { port, send } = fakePort(sim);
  let down = true;
  const outbox = memoryOutbox();
  const bridge = new Bridge({ port, outbox, retryMs: 10_000, post: async (_decoder, batch) => {
    if (down) throw new Error('offline');
    return { through: Math.max(...batch.passings.map((x) => x.t)) };
  } });
  await bridge.start();
  await until(() => bridge.state === 'ready');
  send(commands.lap('0A', 1000));
  await until(() => bridge.online === false);
  assert.equal(await outbox.count(), 1);
  assert.equal(bridge.lastError.message, 'offline');
  down = false;
  await bridge.flush();
  assert.equal(await outbox.count(), 0);
  assert.equal(bridge.online, true);
  await bridge.close();
});

test('a device that does not answer is not a TinyLap decoder; a lost port is disconnected', async () => {
  const silent = fakePort(null);
  const bridge = new Bridge({ port: silent.port, outbox: memoryOutbox(), post: async () => ({ through: null }), helloMs: 20 });
  await bridge.start();
  await until(() => bridge.state === 'not-tinylap');
  silent.end();
  await until(() => bridge.state === 'disconnected');
});
```

Run: `pnpm --filter @tinylap/timing-app test`
Expected: FAIL, `js/outbox.js` does not exist.

- [ ] **Step 2: Implement `js/outbox.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge's outbox (spec §5): passings read from the cable wait here until
// the server holds them, so an internet outage or a reload loses nothing.
// Keyed by the passing key, so the same passing is kept once.

const STORE = 'outbox';
const keyOf = (p) => `${p.decoder} ${p.boot} ${p.transponder} ${p.t}`;

export function memoryOutbox() {
  const items = new Map();
  return {
    async add(p) {
      items.set(keyOf(p), p);
    },
    async list() {
      return [...items.values()];
    },
    async count() {
      return items.size;
    },
    async removeThrough(decoder, boot, t) {
      for (const [key, p] of items) if (p.decoder === decoder && p.boot === boot && p.t <= t) items.delete(key);
    },
  };
}

/** Runs `fn` in a transaction; resolves with its request's result once committed. */
function inTransaction(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The IndexedDB outbox, or a memory one where IndexedDB is unavailable (private windows, Node). */
export async function openOutbox(name = 'tinylap-timing') {
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: ['decoder', 'boot', 'transponder', 't'] });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return memoryOutbox();
  }
  return {
    add: (p) => inTransaction(db, 'readwrite', (store) => store.put(p)).then(() => {}),
    list: () => inTransaction(db, 'readonly', (store) => store.getAll()),
    count: () => inTransaction(db, 'readonly', (store) => store.count()),
    // Every key starting [decoder, boot]: arrays sort after strings, so [d, b, []] ends the range.
    removeThrough: (decoder, boot, t) => inTransaction(db, 'readwrite', (store) => {
      const cursor = store.openCursor(IDBKeyRange.bound([decoder, boot], [decoder, boot, []]));
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return;
        if (at.value.t <= t) at.delete();
        at.continue();
      };
      return null;
    }),
  };
}
```

(`indexedDB` is not defined in Node, so `openOutbox` throws inside the `try` and falls back, which the second outbox test checks.)

- [ ] **Step 3: Implement `js/bridge.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge (spec §5): a decoder on USB, read with Web Serial, forwarded
// to the server with the member's session. It asks the decoder who it is
// (%TLHELLO&), so its passings carry the same key as the copies the decoder
// sends over Wi-Fi, pairs unpaired decoders, keeps an outbox while offline,
// and computes laps locally for an instant preview.
import { MAX_BATCH, ZROUND_BAUD, commands, createReader, nextLap } from '@tinylap/timing';

export class Bridge extends EventTarget {
  #replies = [];
  #helloTimer = null;
  #retryTimer = null;
  #flushing = null;
  #again = false;
  #writer = null;
  #reader = null;

  /**
   * @param {{ port: any, outbox: ReturnType<typeof import('./outbox.js').memoryOutbox>,
   *   post: (decoderId: string, batch: { boot: string, passings: { transponder: string, t: number }[] }) => Promise<{ through: number | null }>,
   *   helloMs?: number, retryMs?: number, replyMs?: number }} options
   */
  constructor({ port, outbox, post, helloMs = 2000, retryMs = 5000, replyMs = 3000 }) {
    super();
    Object.assign(this, { port, outbox, post, helloMs, retryMs, replyMs });
    this.state = 'idle';
    this.decoder = null;
    this.boot = null;
    this.online = true;
    this.lastError = null;
    /** Transponder → the mark its laps are measured from, for the preview. */
    this.references = new Map();
  }

  #set(state) {
    this.state = state;
    this.dispatchEvent(new Event('state'));
  }

  #setOnline(online, error = null) {
    this.lastError = error;
    if (this.online === online) return;
    this.online = online;
    this.dispatchEvent(new Event('online'));
  }

  async #write(line) {
    await this.#writer.write(new TextEncoder().encode(line));
  }

  async start() {
    await this.port.open({ baudRate: ZROUND_BAUD });
    this.#writer = this.port.writable.getWriter();
    void this.#read();
    await this.hello();
    void this.flush();
  }

  /** Asks the decoder who it is; no answer in time means it isn't a TinyLap decoder. */
  async hello() {
    this.#set('connecting');
    clearTimeout(this.#helloTimer);
    this.#helloTimer = setTimeout(() => {
      if (this.state === 'connecting') this.#set('not-tinylap');
    }, this.helloMs);
    await this.#write(commands.hello);
  }

  async #read() {
    const lines = createReader();
    const text = new TextDecoder();
    this.#reader = this.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.#reader.read();
        if (done) break;
        for (const message of lines.push(text.decode(value, { stream: true }))) await this.#handle(message);
      }
    } catch {
      // The port went away; answered below.
    } finally {
      this.#reader.releaseLock();
      clearTimeout(this.#helloTimer);
      this.#set('disconnected');
    }
  }

  async #handle(message) {
    if (message.type === 'hello') {
      clearTimeout(this.#helloTimer);
      if (message.boot !== this.boot) this.references.clear();
      this.decoder = message.decoder;
      this.boot = message.boot;
      this.#set(message.decoder ? 'ready' : 'unpaired');
      if (message.decoder) void this.flush();
    } else if (message.type === 'ok' || message.type === 'error') {
      this.#replies.shift()?.(message);
    } else if (message.type === 'lap' && this.state === 'ready') {
      const passing = { decoder: this.decoder, boot: this.boot, transponder: message.transponder, t: message.t };
      const step = nextLap(this.references.get(message.transponder) ?? null, { boot: this.boot, t: message.t });
      this.references.set(message.transponder, step.reference);
      await this.outbox.add(passing);
      this.dispatchEvent(new CustomEvent('passing', { detail: { ...passing, lapMs: step.kind === 'lap' ? step.ms : null } }));
      void this.flush();
    }
  }

  /** The decoder's next %TLOK& or %TLERR&, or a timeout. */
  #reply() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The decoder didn't answer.")), this.replyMs);
      this.#replies.push((message) => {
        clearTimeout(timer);
        if (message.type === 'ok') resolve(message);
        else reject(new Error(`The decoder said: ${message.text}`));
      });
    });
  }

  /** Stores the decoder's id and token on the board (and Wi-Fi, if given), then asks again who it is. */
  async pair(decoderId, token, wifi = null) {
    let reply = this.#reply();
    await this.#write(commands.pair(decoderId, token));
    await reply;
    if (wifi) {
      reply = this.#reply();
      await this.#write(commands.wifi(wifi.ssid, wifi.password));
      await reply;
    }
    await this.hello();
  }

  /** Sends the outbox, one decoder and boot at a time; retries later when the server can't be reached. */
  flush() {
    if (this.#flushing) {
      this.#again = true;
      return this.#flushing;
    }
    clearTimeout(this.#retryTimer);
    this.#flushing = (async () => {
      try {
        for (;;) {
          const items = await this.outbox.list();
          if (items.length === 0) break;
          const [first] = items;
          const group = items.filter((p) => p.decoder === first.decoder && p.boot === first.boot).sort((a, b) => a.t - b.t).slice(0, MAX_BATCH);
          const { through } = await this.post(first.decoder, { boot: first.boot, passings: group.map(({ transponder, t }) => ({ transponder, t })) });
          await this.outbox.removeThrough(first.decoder, first.boot, through ?? -1);
          this.#setOnline(true);
          this.dispatchEvent(new Event('outbox'));
          // The server stores what it is sent, so `through` covers the group; if not, stop rather than loop.
          if (through === null || through < group.at(-1).t) break;
        }
      } catch (error) {
        this.#setOnline(false, error);
        this.#retryTimer = setTimeout(() => void this.flush(), this.retryMs);
      } finally {
        this.#flushing = null;
        this.dispatchEvent(new Event('outbox'));
      }
      if (this.#again) {
        this.#again = false;
        await this.flush();
      }
    })();
    return this.#flushing;
  }

  async close() {
    clearTimeout(this.#retryTimer);
    clearTimeout(this.#helloTimer);
    await this.#reader?.cancel().catch(() => {});
    this.#writer?.releaseLock();
    await this.port.close().catch(() => {});
  }
}
```

- [ ] **Step 4: Implement `js/sim-port.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A SerialPort look-alike with a simulated TinyLap decoder at the other end,
// for trying the bridge without hardware (?simulate, ?simulate=fast).
import { commands, createReader, createSimulator } from '@tinylap/timing';

export function simulatedPort({ lapMs = 8000, cars = 3 } = {}) {
  const sim = createSimulator({ cars: Array.from({ length: cars }, (_, i) => ({ transponder: (0x20 + i).toString(16).toUpperCase(), lapMs: lapMs + i * 300 })) });
  const started = performance.now();
  const clock = () => Math.round(performance.now() - started);
  const lines = createReader();
  const encoder = new TextEncoder();
  let controller;
  let timer;
  const send = (line) => controller.enqueue(encoder.encode(line));
  return {
    readable: new ReadableStream({ start(c) { controller = c; }, cancel() { clearInterval(timer); } }),
    writable: new WritableStream({
      write(chunk) {
        for (const message of lines.push(new TextDecoder().decode(chunk))) for (const line of sim.reply(message, clock())) send(line);
      },
    }),
    async open() {
      timer = setInterval(() => {
        for (const p of sim.advance(clock())) send(commands.lap(p.transponder, p.t));
      }, 100);
    },
    async close() {
      clearInterval(timer);
    },
    getInfo: () => ({ simulated: true }),
  };
}
```

- [ ] **Step 5: Implement `js/bridge-view.js`**

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge screen (spec §8): connect the decoder on USB, pair it, watch
// the outbox and a local preview. The Bridge outlives the screen, so the
// board can be shown while it forwards.
import { Bridge } from './bridge.js';
import { h } from './dom.js';
import { formatLap } from './format.js';
import { openOutbox } from './outbox.js';
import { simulatedPort } from './sim-port.js';

/** @type {Bridge | null} */
let bridge = null;
const preview = [];

const simulate = () => new URLSearchParams(location.search).get('simulate');

async function connectPort(ctx) {
  const mode = simulate();
  const port = mode !== null ? simulatedPort({ lapMs: mode === 'fast' ? 2000 : 8000 }) : await navigator.serial.requestPort();
  bridge = new Bridge({
    port,
    outbox: await openOutbox(),
    post: (decoderId, batch) => ctx.api('POST', `/decoders/${encodeURIComponent(decoderId)}/passings`, batch),
  });
  bridge.addEventListener('passing', (event) => {
    preview.unshift(/** @type {CustomEvent} */ (event).detail);
    preview.length = Math.min(preview.length, 20);
  });
  window.addEventListener('beforeunload', (event) => {
    if (bridge && bridge.state === 'ready') event.preventDefault();
  });
  await bridge.start();
}

export function mountBridge(root, ctx) {
  const section = h('section', { class: 'container stack-lg screen' });
  root.append(section);
  const error = h('p', { class: 'status status-error', role: 'alert', hidden: true });
  const fail = (caught) => {
    error.textContent = caught.message;
    error.hidden = false;
  };

  const connectButton = (label) => {
    const button = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, label);
    button.addEventListener('click', () => connectPort(ctx).then(draw, fail));
    return button;
  };

  function pairForm() {
    const name = h('input', { type: 'text', name: 'name', value: 'Decoder', maxlength: '60', required: true });
    const ssid = h('input', { type: 'text', name: 'ssid', autocomplete: 'off' });
    const password = h('input', { type: 'password', name: 'password', autocomplete: 'off' });
    const form = h('form', { class: 'card stack-md' },
      h('h2', { class: 'h3' }, 'Pair this decoder'),
      h('p', {}, 'It gets its own token for this workspace. Wi-Fi is optional: with it, the decoder also sends passings over the internet when the cable is out.'),
      h('label', { class: 'field' }, 'Decoder name', name),
      h('label', { class: 'field' }, 'Wi-Fi name (optional)', ssid),
      h('label', { class: 'field' }, 'Wi-Fi password', password),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Pair'));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const decoder = await ctx.api('POST', `/workspaces/${encodeURIComponent(ctx.workspaceId)}/decoders`, { name: name.value });
        await bridge.pair(decoder.id, decoder.token, ssid.value ? { ssid: ssid.value, password: password.value } : null);
      } catch (caught) {
        fail(caught);
      }
    });
    return form;
  }

  function readyPanel() {
    const outbox = h('span', { class: 'num' }, '…');
    void bridge.outbox.count().then((n) => { outbox.textContent = String(n); });
    return h('div', { class: 'stack-md' },
      h('p', { class: `status ${bridge.online ? 'status-success' : 'status-warning'}`, role: 'status' },
        bridge.online ? `Forwarding from decoder ${bridge.decoder}` : `Offline: passings wait here. ${bridge.lastError?.message ?? ''}`),
      h('p', {}, 'Waiting to send: ', outbox),
      h('h2', { class: 'h3' }, 'Straight from the cable'),
      preview.length
        ? h('ol', { class: 'board-laps' }, preview.map((p) => h('li', {}, h('span', { class: 'num' }, p.transponder), h('span', { class: 'num' }, formatLap(p.lapMs)))))
        : h('p', { class: 'empty' }, 'Passings show up here the moment the decoder reports them.'));
  }

  function draw() {
    const supported = 'serial' in navigator || simulate() !== null;
    let body;
    if (!supported) body = h('p', { class: 'status status-warning' }, 'The bridge needs Chrome or Edge on a laptop: it uses Web Serial to read the decoder over USB.');
    else if (!bridge) body = h('div', { class: 'stack-md' }, h('p', {}, 'Plug the decoder in by USB, then connect. Keep this tab open while racing.'), connectButton('Connect decoder'));
    else if (bridge.state === 'connecting' || bridge.state === 'idle') body = h('p', { role: 'status' }, 'Talking to the decoder…');
    else if (bridge.state === 'not-tinylap') body = h('div', { class: 'stack-md' }, h('p', { class: 'status status-error' }, "This device doesn't answer like a TinyLap decoder."), connectButton('Try another port'));
    else if (bridge.state === 'unpaired') body = pairForm();
    else if (bridge.state === 'ready') body = readyPanel();
    else body = h('div', { class: 'stack-md' }, h('p', { class: 'status status-warning' }, 'Decoder disconnected.'), connectButton('Connect again'));
    section.replaceChildren(h('h1', {}, 'Bridge'), body, error);
  }

  draw();
  const events = ['state', 'passing', 'outbox', 'online'];
  let attached = null;
  const attach = () => {
    if (!bridge || attached === bridge) return;
    for (const type of events) bridge.addEventListener(type, draw);
    attached = bridge;
  };
  attach();
  const poll = setInterval(attach, 200);
  return () => {
    clearInterval(poll);
    if (attached) for (const type of events) attached.removeEventListener(type, draw);
    section.remove();
  };
}
```

- [ ] **Step 6: Register the screen**

In `js/main.js`, `import { mountBridge } from './bridge-view.js';` and append `{ id: 'bridge', label: 'Bridge', mount: mountBridge }` to `SCREENS`.

- [ ] **Step 7: Write the browser test**

`apps/timing/test/browser/bridge.test.js`:

```js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge end to end with the simulated port: connect, pair, forward;
// the passings reach the server and the board while the bridge keeps going.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;
let member;
let office;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
  const owner = await app.signUp('Ana');
  office = app.club(owner, 'Office');
  member = await app.login(owner);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test('connect, pair and forward through the bridge', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.goto('/?simulate=fast#bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor();
  await page.getByLabel('Decoder name').fill('Gate');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.getByText(/^Forwarding from decoder /).waitFor();
  const [gate] = app.store.decoders(office.id);
  assert.equal(gate.name, 'Gate');

  // A reload would end the bridge; a hash change keeps it.
  await page.evaluate(() => { location.hash = '#board'; });
  await page.getByRole('status').filter({ hasText: /Unknown cars?: / }).waitFor({ timeout: 20_000 });
  assert.notEqual(app.store.decoders(office.id)[0].lastSeenAt, null, 'every batch counts as the decoder being seen');
  const ws = app.engine.snapshot(office.id);
  assert.ok(ws.crossings.length > 0);
  assert.ok(ws.crossings.every((c) => c.via === 'serial'));
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 8: Run everything**

Run: `pnpm --filter @tinylap/timing-app test && pnpm --filter @tinylap/timing-app test:browser`
Expected: PASS.

- [ ] **Step 9: Try it with the browser (manual)**

With the dev servers running (Task 19), open `http://localhost:8100/?simulate=fast#bridge` in Chrome, connect, pair, switch to the board and watch three unknown cars appear; assign them in Setup. Stop your network (or the timing server) for a minute: the bridge says "Offline", the outbox grows, and the passings arrive when it's back.

- [ ] **Step 10: Lint, typecheck, commit**

```bash
pnpm --filter @tinylap/timing-app lint && pnpm --filter @tinylap/timing-app typecheck
git add apps/timing
git commit -s -m "feat(timing-app): bridge a USB decoder with Web Serial, pairing and an outbox"
```

---
### Task 19: Deployment, CI and documentation

**Files:**
- Create: `apps/timing/Dockerfile`, `apps/timing/fly.toml`, `apps/timing/README.md`, `docs/timing.md`
- Modify: `.github/workflows/ci.yml`, `README.md`, root `package.json` (a `dev:timing` script)

**Interfaces:**
- Consumes: everything above.
- Produces: a container that serves timing on port 8080; a CI that tests it, builds it, and deploys it to the Fly app `tinylap-timing` once the repo variable `TIMING_DEPLOY_ENABLED` is `true`; documents for self-hosters and decoder builders.

**Never run `fly`, `gh variable set` or anything that deploys or changes secrets yourself.** Those steps are the maintainer's, in `apps/timing/README.md`'s checklist. Ask before each.

- [ ] **Step 1: Dockerfile and fly.toml**

`apps/timing/Dockerfile`:

```dockerfile
# Built from the repository root:
#   docker build -f apps/timing/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) .
# As the planner's: one stage installs and assembles, the second runs the
# server with the assembled app in /srv and the server's modules from /repo.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@tinylap/timing-app..."
ARG GIT_SHA
RUN node tools/assemble.js apps/timing /out "$GIT_SHA"

FROM node:24-alpine
WORKDIR /repo
COPY --from=build /repo /repo
COPY --from=build /out /srv
# The volume is mounted here on Fly. The container runs as root because Fly
# mounts volumes root-owned.
RUN mkdir -p /data
ARG GIT_SHA
ENV NODE_ENV=production TINYLAP_BUILD=$GIT_SHA
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/timing/server/main.js"]
```

`apps/timing/fly.toml`:

```toml
# Single Node app, one region. SQLite on one volume means exactly one machine.
app = 'tinylap-timing'
primary_region = 'fra'

[build]

[env]
  TINYLAP_PUBLIC_URL = 'https://tinylap-timing.fly.dev'
  TINYLAP_CLIENT_IP_HEADER = 'Fly-Client-IP'
  TINYLAP_ISSUER = 'https://tinylap-accounts.fly.dev'
  TINYLAP_CLIENT_ID = 'timing'
  TINYLAP_PLANNER_URL = 'https://circuit30-planner.fly.dev'

# Create it once (apps/timing/README.md):
#   fly volumes create timing_data --app tinylap-timing --region fra --size 1
[mounts]
  source = 'timing_data'
  destination = '/data'

[http_service]
  internal_port = 8080
  force_https = true
  # Open event streams and decoder posts keep the machine up; when nobody
  # watches and nothing is posted it stops, and the next request wakes it.
  # A decoder buffers what it can't send during the second of cold start.
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = 'shared-cpu-1x'
  memory = '256mb'
```

Run: `docker build -f apps/timing/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t timing .`
Expected: builds. Then:

Run: `docker run --rm -p 8081:8080 timing`
Expected: exits 1 with "Timing needs TINYLAP_ISSUER, …" (the image refuses to start half configured).

- [ ] **Step 2: CI**

In `.github/workflows/ci.yml`:

1. In `check`, after `pnpm --filter @tinylap/accounts test:browser`, add:

```yaml
      - run: pnpm --filter @tinylap/timing-app test:browser
```

2. In `smoke`, after the accounts smoke, add a build and a start check (CI-only values; nothing is reachable, it only has to come up):

```yaml
      - run: docker build -f apps/timing/Dockerfile --build-arg GIT_SHA=${{ github.sha }} -t timing .
      - run: >
          docker run -d -p 8082:8080
          -e TINYLAP_ISSUER=http://localhost:4100 -e TINYLAP_CLIENT_ID=ci -e TINYLAP_CLIENT_SECRET=ci-only
          -e TINYLAP_FEED_TOKEN=ci-only -e TINYLAP_TOKEN_KEYS=ci:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
          -e TINYLAP_PUBLIC_URL=http://localhost:8082 -e TINYLAP_PLANNER_URL=http://localhost:8080
          timing
      - run: curl --silent --fail --retry 20 --retry-all-errors --retry-delay 1 http://localhost:8082/ > /dev/null
      - run: curl --silent --fail http://localhost:8082/openapi.json > /dev/null
```

3. In `deploy`'s `changed` step, next to the accounts line, add:

```bash
            grep -qE '^(apps/timing|packages|tools)/|^(pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml|\.dockerignore)$' <<< "$files" && timing=true
```

set `timing=true` in the fail-open branch too, and after the accounts gate add:

```bash
          # The Fly app does not exist until the maintainer has followed the
          # checklist in apps/timing/README.md, whose last step sets this.
          if [ "$timing" = true ] && [ "$TIMING_DEPLOY_ENABLED" = true ]; then
            echo "timing=true" >> "$GITHUB_OUTPUT"
          fi
```

with `TIMING_DEPLOY_ENABLED: ${{ vars.TIMING_DEPLOY_ENABLED }}` in that step's `env`. Extend the `setup-flyctl` condition with `|| steps.changed.outputs.timing == 'true'`, and add the deploy step:

```yaml
      - if: steps.changed.outputs.timing == 'true'
        run: >
          flyctl deploy . --remote-only
          --config apps/timing/fly.toml
          --dockerfile apps/timing/Dockerfile
          --build-arg GIT_SHA=${{ github.sha }}
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Update the comment at the top of the file: "deploys the planner, accounts and timing, each only if the push touched it (accounts and timing also only once their DEPLOY_ENABLED variable is set)."

- [ ] **Step 3: `apps/timing/README.md`: running it, and the maintainer's checklist**

```markdown
# TinyLap Timing

Lap timing for a workspace's track: decoders post passings over USB (through the bridge tab) and Wi-Fi, the server turns them into practice, qualifying and race results, and every screen shows them live. Design: `docs/superpowers/specs/2026-10-15-timing-core-design.md`. Decoder builders: `docs/timing.md`.

## Development

Timing always needs log-in. Run accounts, the planner and timing side by side:

    TINYLAP_CLIENTS='[{"clientId":"timing-dev","clientSecret":"dev","redirectUris":["http://localhost:8100/auth/callback"],"postLogoutRedirectUris":["http://localhost:8100/"],"resource":"http://localhost:8100"}]' \
      TINYLAP_FEED_TOKENS=dev pnpm --filter @tinylap/accounts dev
    pnpm dev                    # the planner, on http://localhost:8000
    TINYLAP_ISSUER=http://localhost:4100 TINYLAP_CLIENT_ID=timing-dev TINYLAP_CLIENT_SECRET=dev \
      TINYLAP_FEED_TOKEN=dev TINYLAP_TOKEN_KEYS=dev:$(openssl rand -base64 32) \
      TINYLAP_PLANNER_URL=http://localhost:8000 pnpm dev:timing

Open http://localhost:8100. Without hardware: Setup → "Pair without USB", then `node tools/decoder-sim.js net --url http://localhost:8100 --decoder <id> --token <token>`, or the bridge with a simulated decoder at http://localhost:8100/?simulate=fast#bridge.

Tests: `pnpm --filter @tinylap/timing-app test`; in Chrome, `pnpm --filter @tinylap/timing-app test:browser`.

## First deploy (maintainer)

1. Create the app and its volume: `fly apps create tinylap-timing`, then `fly volumes create timing_data --app tinylap-timing --region fra --size 1`.
2. Add timing as a client of accounts: rebuild `TINYLAP_CLIENTS` as in `apps/accounts/README.md` (first-deploy step 4) with a new entry `{ "clientId": "timing", "clientSecret": "<random>", "redirectUris": ["https://tinylap-timing.fly.dev/auth/callback"], "postLogoutRedirectUris": ["https://tinylap-timing.fly.dev/"], "resource": "https://tinylap-timing.fly.dev" }`, and add a new feed token to `TINYLAP_FEED_TOKENS`. Stage them: `fly secrets set --stage --app tinylap-accounts TINYLAP_CLIENTS="$CLIENTS" TINYLAP_FEED_TOKENS="$FEED_TOKENS"`.
3. Set timing's secrets: `fly secrets set --stage --app tinylap-timing TINYLAP_CLIENT_SECRET="<the same random>" TINYLAP_TOKEN_KEYS="1:$(openssl rand -base64 32)" TINYLAP_FEED_TOKEN="<the new feed token>"`. Keep all three in the password manager.
4. `fly secrets deploy --app tinylap-accounts`, then the first timing deploy from your machine: `flyctl deploy . --config apps/timing/fly.toml --dockerfile apps/timing/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD)`.
5. Log in at https://tinylap-timing.fly.dev and check the board loads.
6. Let CI deploy from now on: `gh variable set TIMING_DEPLOY_ENABLED --body true`.

Key rotation and backups work as for the planner (`apps/accounts/README.md`): `TINYLAP_TOKEN_KEYS` takes the new key first and the old ones after it; Fly snapshots the volume daily.
```

Root `package.json` scripts: add `"dev:timing": "pnpm --filter @tinylap/timing-app dev"`.

- [ ] **Step 4: `docs/timing.md`, for decoder builders**

```markdown
# Timing: passings, the ingest API and the ZRound extension

This is what a decoder needs to talk to TinyLap Timing. The design is in `docs/superpowers/specs/2026-10-15-timing-core-design.md`.

## A passing

`{ decoder, boot, transponder, t }`: the decoder's id (from pairing); a boot id, 8 to 32 base64url characters, chosen at random at every power-up **and** whenever the clock is reset (ZRound's `%I&`); the transponder code, upper-case hex; and `t`, whole milliseconds on the decoder's clock since that boot. The decoder stamps the time itself, so network delay never changes a lap.

The four together are the passing's key. Send the same passing over USB and over Wi-Fi and the server keeps one.

## Over USB: ZRound, plus four TinyLap commands

19200 baud, 8N1. The decoder speaks the ZRound Free LapCounter protocol (zround.com wiki, CC BY-SA), so it also works with ZRound:

| Direction | Message | Meaning |
| --- | --- | --- |
| PC → decoder | `%C&` | startup; answer `%A&` within 500 ms |
| PC → decoder | `%I&` | race start: clock to zero (start a new boot) |
| PC → decoder | `%F&` | race stop |
| decoder → PC | `%T<hex ms>&` | clock |
| decoder → PC | `%L<transponder hex>,<hex ms>&` | a passing |

TinyLap's own commands, which ZRound never sends (fields separated by one space):

| Direction | Message | Meaning |
| --- | --- | --- |
| PC → decoder | `%TLHELLO&` | who are you? |
| decoder → PC | `%TLID <decoder id or -> <boot>&` | `-` while unpaired |
| PC → decoder | `%TLPAIR <decoder id> <token>&` | store the id and the 43-character token; answer `%TLOK&` |
| PC → decoder | `%TLWIFI <base64url ssid> <base64url password>&` | store Wi-Fi; answer `%TLOK&` |
| decoder → PC | `%TLOK&`, `%TLERR <text>&` | done, or why not |

## Over Wi-Fi: the ingest API

    POST /decoders/<decoder id>/passings
    Authorization: Bearer <token>
    Content-Type: application/json

    { "boot": "x7Qm2LbV0aE", "passings": [{ "transponder": "4A1F", "t": 81234 }] }

At most 500 passings per batch, all of one boot. The answer is `{ "stored", "duplicates", "through" }`: `through` is the highest `t` of this boot the server holds. Keep every passing in an outbox until a `through` covers it; resending is always safe. `401` means the token is wrong or the decoder was unpaired: keep the outbox and stop sending until it is paired again. `429` comes with `Retry-After`. The whole API is described at `/openapi.json` and `/api` on any timing server.
```

- [ ] **Step 5: Root README**

In `README.md`, add to the app list:

```markdown
- `apps/timing`: lap timing for a workspace's track, live on every screen, from a decoder on USB or Wi-Fi.
```

and a short "Self-hosting timing" section after "Self-hosting accounts":

~~~markdown
## Self-hosting timing

`apps/timing` is one Node 24 process with a SQLite file. It needs accounts (or another OIDC provider, as for the planner) and a planner to import tracks from.

```sh
docker build -f apps/timing/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t tinylap-timing .
docker run -p 8080:8080 -v tinylap-timing:/data -e TINYLAP_PUBLIC_URL=https://timing.example \
  -e TINYLAP_ISSUER=https://accounts.example -e TINYLAP_CLIENT_ID=timing -e TINYLAP_CLIENT_SECRET=<random> \
  -e TINYLAP_TOKEN_KEYS=1:$(openssl rand -base64 32) -e TINYLAP_FEED_TOKEN=<random> \
  -e TINYLAP_PLANNER_URL=https://planner.example tinylap-timing
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on |
| `TINYLAP_DB` | `/data/timing.sqlite` | SQLite file |
| `TINYLAP_PUBLIC_URL` | required | The `https://` origin timing is served at |
| `TINYLAP_ISSUER`, `TINYLAP_CLIENT_ID`, `TINYLAP_CLIENT_SECRET` | required | Timing's client at accounts |
| `TINYLAP_TOKEN_KEYS` | required | Keys that seal stored tokens, as for the planner |
| `TINYLAP_FEED_TOKEN` | required | Bearer token for accounts' deletions feed |
| `TINYLAP_PLANNER_URL` | required | The planner tracks are imported from; timing fetches nothing else |
| `TINYLAP_CLIENT_IP_HEADER` | none | Header carrying the client IP behind a proxy |

It refuses to start unless all required variables are set. Decoders: [docs/timing.md](docs/timing.md).
~~~

- [ ] **Step 6: Check everything, then commit**

Run: `pnpm check && pnpm --filter @tinylap/timing-app test:browser`
Expected: PASS.

Run: `pnpm dlx reuse lint` (or the CI `reuse` job)
Expected: compliant; every new file is covered by `REUSE.toml`'s path annotations.

```bash
git add apps/timing docs/timing.md README.md package.json .github/workflows/ci.yml
git commit -s -m "build(timing-app): containerise, test in CI, deploy behind TIMING_DEPLOY_ENABLED, and document"
```

---

## After the plan

- Ask the maintainer before the first deploy (`apps/timing/README.md`); nothing here deploys by itself until `TIMING_DEPLOY_ENABLED` is set.
- Later specs, in order: heats and finals; the challenge ladder; the ESP32 decoder firmware and hardware against `docs/timing.md`.
