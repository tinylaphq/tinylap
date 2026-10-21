# Decoders and simulators: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The USB bridge accepts any ZRound decoder: a plain one is chosen in the browser and gets browser-made boots, and TinyLap's `%TL…` commands are an enhancement. It also accepts an EasyLap over WebHID, through a Robitronic reader. Simulators for all three run in CI.

**Architecture:**
- The bridge is split into three layers:
  - a **transport**: `public/link/serial.js`, or `public/link/hid.js` with the CP2110 setup;
  - a **protocol reader**: `public/link/zround.js`, or `public/link/robitronic.js` over `packages/timing/robitronic.js`;
  - the **session**, which is today's `Bridge` in `public/bridge.js`, widened. It runs the handshake, decides the kind (`tinylap`, `zround`, `easylap`), makes the boots, holds passings until the identity is known, and keeps the outbox, posting and preview as they are.
- `tl-bridge` (`public/elements/bridge.js`) gets two pickers and a server-rendered choose form. It remembers device → decoder in `public/devices.js`.
- Simulators are device models in `public/sim/models/`, behind a fake serial port and a fake HIDDevice.

**Tech Stack:** plain ES modules, checked by tsc `--checkJs` and eslint. Tests use node:test, and playwright-core for the browser tests. WebHID and Web Serial in Chrome.

**Spec:** `docs/superpowers/specs/2026-10-21-decoders-and-simulators.md` (committed in be8b383 on `feat/decoders-and-simulators`). The spec is the authority. Its section and test ids (§2.4, D1–D14, E3c, E4d, E6c, C1, I3, R1 and so on) are used below.

## Global Constraints

- **Branch:** `feat/decoders-and-simulators` (checked out). Never push to or merge into `main`.
- **Logs:** `LOGS=/tmp/tinylap-decoders` (outside the repository); run `mkdir -p "$LOGS"` first. Every test run writes its whole output to `$LOGS/<name>.log`, then prints the exit code and the tail. When a run fails, read the log; don't rerun only to grep it.
- **Single test files**, from the repo root:

  ```sh
  # a Node or server test of the app
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test test/<path>.test.js > "$LOGS/<name>.log" 2>&1; echo "exit $?"; tail -n 30 "$LOGS/<name>.log"
  # a browser test of the app
  pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test --test-concurrency=1 --test-timeout=60000 test/browser/<file>.test.js > "$LOGS/<file>.log" 2>&1; echo "exit $?"; tail -n 40 "$LOGS/<file>.log"
  # a test of packages/timing
  pnpm --filter @tinylap/timing exec node --test test/<file>.test.js > "$LOGS/<file>.log" 2>&1; echo "exit $?"; tail -n 30 "$LOGS/<file>.log"
  ```

- **Before each commit, the checks** (global rule: tests, eslint and type checks on the affected packages). All four run from the repo root and must be green:

  ```sh
  pnpm turbo run test lint typecheck --filter=@tinylap/timing-app --filter=@tinylap/timing > "$LOGS/checks.log" 2>&1; echo "exit $?"; tail -n 30 "$LOGS/checks.log"
  pnpm --filter @tinylap/timing-app test:browser > "$LOGS/browser.log" 2>&1; echo "exit $?"; tail -n 40 "$LOGS/browser.log"
  pnpm test:e2e > "$LOGS/e2e.log" 2>&1; echo "exit $?"; tail -n 30 "$LOGS/e2e.log"
  pipx run reuse lint > "$LOGS/reuse.log" 2>&1; echo "exit $?"; tail -n 5 "$LOGS/reuse.log"
  ```

- **Commits:**
  - conventional, lower case, signed off: `git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "…"`;
  - no `Co-Authored-By`, no "Generated with", and no mention of an AI tool in any commit, PR, tag or release note.
- **Licences:** every new file under `apps/timing/` starts with

  ```js
  // SPDX-FileCopyrightText: 2026 The TinyLap contributors
  //
  // SPDX-License-Identifier: AGPL-3.0-or-later
  ```

  Every new file under `packages/timing/` uses `MPL-2.0` in the same header.
- **AGENTS.md:**
  - every UI is palace-ui plus `@tinylap/design`, with palace classes only (`card-static`, `stack-md`, `status`, `field`, `btn`, `btn-primary`, `btn-secondary`, `btn-lg`), plus the app's own `field-hint` (`apps/timing/public/app.css:338`); fields come from `server/views/form-parts.js` (`textField`, `selectField`); no new visual language;
  - `tl-*` elements use the light DOM, start in `connectedCallback` and stop in `disconnectedCallback`;
  - **no markup built in script.** The element shows and hides server sections and sets `textContent`, `hidden`, `disabled` and `value`. It may remove an `<option>` the server rendered. It never creates elements.
- **UI tasks use the `frontend-design` skill** (CLAUDE.local.md). Tasks 10–14 touch the bridge page, and each says so again. Their implementers load the skill before they edit a view, an element or the page's copy, and check the page at 390×844 and 1280×800.
- **Copy:**
  - the glossary applies: "Sign in", "club", "personal space"; never "workspace", "log in" or "publish" in anything people read. `test/server/glossary.test.js` guards it, and it runs in the checks;
  - the strings are exactly the spec's (§4.1, §4.2, §3.2). Copy them from this plan, which repeats them verbatim.
- **Defaults** (spec §2.4): `openDelayMs = 0`, `synMs = 500`, `handshakeMs = 6000`, `spacingMs = 300`, `helloMs = 2500`, `startMs = 6000`, `listenMs = 60_000`, `retryMs = 5000`, `replyMs = 3000`. There are two more, named in the spec but not as options: `helloEveryMs = 700` and `listenSynMs = 2000`. One is new: `flushWaitMs = 10_000`, how long a late `%TLID` waits for the flush in flight. The decoder-list GET gives up after 3 s (`AbortSignal.timeout(3000)`). `tl-bridge` passes `openDelayMs: 1500` for a real serial port.
- **No API change.** The one server change is a page-only read query and its index (§3.2).

## Review Focus

The spec implies these inputs, but no spec test exercises them. Each line is pinned by a test in the task named.

1. **A real serial port that errors mid-read** (cable pulled hard, the read rejects rather than ending) must end in `disconnected`, not in an unhandled rejection. Test in Task 5.
2. **Bytes that aren't valid UTF-8, or a stray `%` with no `&`, during the ZRound handshake** must yield `noise` or nothing, and must never decide the kind. Test in Task 5.
3. **"Use this decoder" clicked twice quickly** must make one decoder, not two: the submit is disabled while a choice runs. Test in Task 12.
4. **A choice made after the device was unplugged** (the member was still on the choose screen) must not show "Forwarding": `assign()` rejects on a disconnected bridge. Test in Task 7.
5. **An EasyLap unplugged while forwarding** must show "Decoder disconnected." with the lost-crossings note. Test in Task 13.

---

### Task 1: The Robitronic frames (`packages/timing/robitronic.js`)

**Files:**
- Create: `packages/timing/robitronic.js`, `packages/timing/test/robitronic.test.js`
- Modify: `packages/timing/index.js` (one export line), `packages/timing/types.d.ts` (append types)

**Interfaces:**
- Produces:
  - `crc8(bytes: Uint8Array): number`;
  - `parseFrame(bytes: Uint8Array): RobitronicMessage | null`;
  - `createFrameReader(): { push(chunk: Uint8Array): RobitronicItem[], readonly mismatches: number }`;
  - `frames: { start: Uint8Array, reset: Uint8Array, heartbeat(t: number, tail?: number[]): Uint8Array, passing(id: number, t: number, hits: number, strength: number): Uint8Array }`;
  - `ID_BYTES = 4`.
  - Types `RobitronicMessage`, `RobitronicItem` and `DecoderEvent` in `types.d.ts`.

- [ ] **Step 1: Write the failing tests** (spec §6.1, units 1–11):

```js
// packages/timing/test/robitronic.test.js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameReader, crc8, frames, parseFrame } from '../index.js';

/** "0D BD 84" → bytes. */
const hex = (s) => Uint8Array.from(s.split(' '), (x) => parseInt(x, 16));
const concat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
/** The frames a reader yields, without its checksum notes. */
const messages = (items) => items.filter((x) => x.type !== 'noise');

test('1a. crc8 gives the checksum byte of the four published frames', () => {
  for (const s of ['0D BD 84 1E 08 00 00 E7 36 00 00 55 F9', '0B 5C 83 9B 3A 00 00 14 D0 01 02', '03 B9 01', '03 B0 02']) {
    const bytes = hex(s);
    assert.equal(crc8(bytes), bytes[1], s);
  }
});

test('1b. the encoders build the two frames the research note generated, and the two commands', () => {
  assert.deepEqual(frames.heartbeat(0), hex('0B 58 83 00 00 00 00 14 D0 01 02'));
  assert.deepEqual(frames.passing(0x123456, 12345, 12, 200), hex('0D D9 84 56 34 12 00 39 30 00 00 0C C8'));
  assert.deepEqual(frames.start, hex('03 B9 01'));
  assert.deepEqual(frames.reset, hex('03 B0 02'));
});

test('2. the published passing, and the generated one', () => {
  assert.deepEqual(parseFrame(hex('0D BD 84 1E 08 00 00 E7 36 00 00 55 F9')),
    { type: 'passing', id: 0x081e, transponder: '81E', t: 14055, hits: 0x55, strength: 0xf9, checksumOk: true });
  assert.deepEqual(parseFrame(hex('0D D9 84 56 34 12 00 39 30 00 00 0C C8')),
    { type: 'passing', id: 0x123456, transponder: '123456', t: 12345, hits: 12, strength: 200, checksumOk: true });
});

test('3. the published heartbeat', () => {
  assert.deepEqual(parseFrame(hex('0B 5C 83 9B 3A 00 00 14 D0 01 02')), { type: 'heartbeat', t: 15003, tail: [0x14, 0xd0, 0x01, 0x02], checksumOk: true });
});

test('4. the fourth byte of a number shifts by 24', () => {
  // The public parsers' `<< 32` is `<< 0` in JavaScript: it reads t = 1 and the id 0x34567A. `<< 16` reads 65536.
  const m = parseFrame(frames.passing(0x12345678, 0x01000000, 1, 1));
  assert.equal(m.transponder, '12345678');
  assert.equal(m.t, 16777216);
});

test('5. the encoders round-trip through the reader', () => {
  const reader = createFrameReader();
  assert.deepEqual(reader.push(concat(frames.passing(0x0a1b2c, 2000, 9, 180), frames.heartbeat(2100))), [
    { type: 'passing', id: 0x0a1b2c, transponder: 'A1B2C', t: 2000, hits: 9, strength: 180, checksumOk: true },
    { type: 'heartbeat', t: 2100, tail: [0x14, 0xd0, 0x01, 0x02], checksumOk: true },
  ]);
});

test('6. split at every byte, or whole, the stream yields the same three frames', () => {
  const stream = concat(hex('FF FF 01'), frames.heartbeat(15003), [0x00], frames.passing(0x081e, 14055, 0x55, 0xf9), frames.passing(0x123456, 12345, 12, 200));
  const whole = createFrameReader().push(stream);
  assert.deepEqual(whole.map((x) => x.type), ['heartbeat', 'passing', 'passing']);
  for (let cut = 1; cut < stream.length; cut += 1) {
    const reader = createFrameReader();
    assert.deepEqual([...reader.push(stream.subarray(0, cut)), ...reader.push(stream.subarray(cut))], whole, `cut at ${cut}`);
  }
});

test('7. a frame cut in the middle, then a whole frame: the whole frame is read', () => {
  const reader = createFrameReader();
  const cut = frames.passing(0x123456, 12345, 12, 200).subarray(0, 6);
  assert.deepEqual(messages(reader.push(concat(cut, frames.heartbeat(500)))), [{ type: 'heartbeat', t: 500, tail: [0x14, 0xd0, 0x01, 0x02], checksumOk: true }]);
});

test('8. a frame with a wrong checksum is not yielded, a note is, and the next frame reads', () => {
  const reader = createFrameReader();
  const bad = frames.heartbeat(100);
  bad[1] ^= 0xff;
  const items = reader.push(concat(bad, frames.heartbeat(200)));
  assert.deepEqual(items.filter((x) => x.type === 'noise').map((x) => x.detail), ['checksum']);
  assert.deepEqual(messages(items).map((x) => x.t), [200]);
  assert.equal(reader.mismatches, 1);
});

test('9. a false sync at the start yields nothing, and the first real frame reads', () => {
  const reader = createFrameReader();
  const fake = hex('0D 00 84 11 11 11 11 11 11 11 11 11 11');
  assert.notEqual(crc8(fake), 0x00, 'the fake frame fails its checksum');
  assert.deepEqual(messages(reader.push(concat(fake, frames.heartbeat(300)))).map((x) => x.t), [300]);
});

test('10. past 256 bytes of junk, the next frame still reads', () => {
  const reader = createFrameReader();
  reader.push(new Uint8Array(300).fill(0x0d));
  assert.deepEqual(messages(reader.push(frames.heartbeat(400))).map((x) => x.t), [400]);
});

test('11. parseFrame on a length and type it does not know is null', () => {
  assert.equal(parseFrame(hex('05 00 99 00 00')), null);
});
```

- [ ] **Step 2: Run it; expect FAIL** (`crc8` is not exported):

  `pnpm --filter @tinylap/timing exec node --test test/robitronic.test.js > "$LOGS/robitronic.log" 2>&1; echo "exit $?"; tail -n 30 "$LOGS/robitronic.log"`

- [ ] **Step 3: Implement**

```js
// packages/timing/robitronic.js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The Robitronic binary protocol an EasyLap speaks (decoders spec §2.5):
// frames of [length, checksum, type, payload…], numbers little-endian, no
// delimiter. Points the research marks low-confidence (the CRC, the id width,
// the heartbeat interval, clock start and rollover) need a real-device
// capture; the code below is written so each is one constant or unused.

/** @import { RobitronicItem, RobitronicMessage } from './types.js' */

/** Frame type → its length. Only these pairs start a frame. */
const KNOWN = new Map([[0x83, 0x0b], [0x84, 0x0d]]);
/** How many bytes of a passing are the transponder id: 4 (lappr, RicinoNext), or 2 (FlipSide). Needs a real-device capture. */
export const ID_BYTES = 4;

/** CRC-8, poly 0x07, init 0xDE, not reflected, no final XOR, over the frame with byte 1 read as 0 (derived; needs a capture). @param {Uint8Array} bytes */
export function crc8(bytes) {
  let crc = 0xde;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= i === 1 ? 0 : bytes[i];
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** A little-endian u32. The fourth byte shifts by 24: the public parsers' `<< 32` is a no-op in JavaScript. */
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** One frame; null for a length and type it doesn't know. @param {Uint8Array} bytes @returns {RobitronicMessage | null} */
export function parseFrame(bytes) {
  const [len, ck, type] = bytes;
  if (KNOWN.get(type) !== len || bytes.length < len) return null;
  const checksumOk = crc8(bytes.subarray(0, len)) === ck;
  if (type === 0x83) return { type: 'heartbeat', t: u32(bytes, 3), tail: [...bytes.subarray(7, 11)], checksumOk };
  const id = ID_BYTES === 4 ? u32(bytes, 3) : bytes[3] | (bytes[4] << 8);
  return { type: 'passing', id, transponder: id.toString(16).toUpperCase(), t: u32(bytes, 7), hits: bytes[11], strength: bytes[12], checksumOk };
}

/**
 * Splits a byte stream into frames. A frame starts only at a known (length,
 * type) pair; anything else drops one byte. A frame whose checksum fails is
 * never yielded: the reader notes it, counts it, and resyncs one byte on.
 * The scan never keeps more than one incomplete frame (at most 12 bytes), so
 * the buffer stays far below the spec's 256-byte cap.
 */
export function createFrameReader() {
  let buffer = new Uint8Array(0);
  let mismatches = 0;
  return {
    get mismatches() {
      return mismatches;
    },
    /** @param {Uint8Array} chunk @returns {RobitronicItem[]} */
    push(chunk) {
      const all = new Uint8Array(buffer.length + chunk.length);
      all.set(buffer);
      all.set(chunk, buffer.length);
      /** @type {RobitronicItem[]} */
      const out = [];
      let i = 0;
      while (all.length - i >= 3) {
        const len = KNOWN.get(all[i + 2]);
        if (len === undefined || all[i] !== len) {
          i += 1;
          continue;
        }
        if (all.length - i < len) break;
        const frame = all.slice(i, i + len);
        const message = /** @type {RobitronicMessage} */ (parseFrame(frame));
        if (message.checksumOk) {
          out.push(message);
          i += len;
        } else {
          mismatches += 1;
          out.push({ type: 'noise', detail: 'checksum', bytes: frame });
          i += 1;
        }
      }
      buffer = all.slice(i);
      return out;
    },
  };
}

/** @param {number} n */
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
/** Fills in the checksum byte. @param {Uint8Array} bytes */
const seal = (bytes) => {
  bytes[1] = crc8(bytes);
  return bytes;
};

/** Frames, ready to send: the two host commands, and encoders for the simulator. */
export const frames = Object.freeze({
  start: Uint8Array.of(0x03, 0xb9, 0x01),
  reset: Uint8Array.of(0x03, 0xb0, 0x02),
  /** @param {number} t @param {number[]} [tail] */
  heartbeat: (t, tail = [0x14, 0xd0, 0x01, 0x02]) => seal(Uint8Array.of(0x0b, 0, 0x83, ...le32(t), ...tail)),
  /** @param {number} id @param {number} t @param {number} hits @param {number} strength */
  passing: (id, t, hits, strength) => seal(Uint8Array.of(0x0d, 0, 0x84, ...le32(id), ...le32(t), hits, strength)),
});
```

Append to `packages/timing/index.js`: `export * from './robitronic.js';`

Append to `packages/timing/types.d.ts`:

```ts
/** A Robitronic frame, as robitronic.js reads it (decoders spec §2.5). */
export type RobitronicMessage =
  | { type: 'passing'; id: number; transponder: string; t: number; hits: number; strength: number; checksumOk: boolean }
  | { type: 'heartbeat'; t: number; tail: number[]; checksumOk: boolean };

/** What a frame reader yields: a good frame, or a note that one failed its checksum. */
export type RobitronicItem = RobitronicMessage | { type: 'noise'; detail: 'checksum'; bytes: Uint8Array };

/** What the bridge's session sees, from either protocol reader (decoders spec §2.3). */
export type DecoderEvent =
  | { type: 'identity'; decoder: string | null; boot: string }
  | { type: 'alive' }
  | { type: 'clock'; t: number }
  | { type: 'reset' }
  | { type: 'passing'; transponder: string; t: number; hits?: number; strength?: number }
  | { type: 'ok' }
  | { type: 'error'; text: string }
  | { type: 'noise'; detail: string };
```

- [ ] **Step 4: Run it; expect PASS** (same command).
- [ ] **Step 5: Checks, then commit**

```bash
git add packages/timing/robitronic.js packages/timing/test/robitronic.test.js packages/timing/index.js packages/timing/types.d.ts
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing): read and write robitronic frames"
```

---

### Task 2: `%I&` as a command, and the shared track

**Files:**
- Modify: `packages/timing/zround.js:105-122` (`commands`), `packages/timing/simulator.js:19-49`, `packages/timing/test/simulator.test.js`, `packages/timing/test/zround.test.js:33-41`

**Interfaces:**
- Produces:
  - `commands.reset === '%I&'`;
  - `createTrack({ cars: { id: number, lapMs: number }[], jitterMs?: number, random?: () => number, noise?: { double?: number, miss?: number, garbage?: number, random?: () => number } }) → { advance(until: number): { id: number, t: number, hits: number, strength: number }[], reset(now: number): void }`.
- `createSimulator`'s API and outputs are unchanged.

- [ ] **Step 1: Write the failing tests**

In `packages/timing/test/zround.test.js`, inside "commands round-trip" (`:33-41`), add `assert.deepEqual(parseMessage(body(commands.reset)), { type: 'reset' });`.

Append to `packages/timing/test/simulator.test.js` (and add `createTrack` to its import):

```js
test('the track gives the same crossings as the simulator, for the same random', () => {
  const cars = [{ transponder: '0A', lapMs: 8000 }, { transponder: '0B', lapMs: 9000 }];
  const sim = createSimulator({ cars, jitterMs: 100, random: seeded() });
  const track = createTrack({ cars: cars.map((c, i) => ({ id: i, lapMs: c.lapMs })), jitterMs: 100, random: seeded() });
  assert.deepEqual(track.advance(60_000).map((c) => [cars[c.id].transponder, c.t]), sim.advance(60_000).map((p) => [p.transponder, p.t]));
});

test('noise: a double read comes 50 to 300 ms later, and a miss drops the crossing', () => {
  const cars = [{ id: 7, lapMs: 5000 }];
  const doubled = createTrack({ cars, jitterMs: 0, random: () => 0.5, noise: { double: 1, random: () => 0.5 } }).advance(20_000);
  for (let i = 0; i < doubled.length; i += 2) {
    const gap = doubled[i + 1].t - doubled[i].t;
    assert.ok(gap >= 50 && gap <= 300, `gap ${gap}`);
  }
  assert.deepEqual(createTrack({ cars, jitterMs: 0, random: () => 0.5, noise: { miss: 1, random: () => 0.5 } }).advance(20_000), []);
  for (const c of createTrack({ cars, random: () => 0.5 }).advance(20_000)) {
    assert.ok(c.hits >= 5 && c.hits <= 60 && c.strength >= 100 && c.strength <= 255);
  }
});
```

- [ ] **Step 2: Run both files; expect FAIL** (`createTrack` isn't exported, and `commands.reset` is undefined).
- [ ] **Step 3: Implement**

In `packages/timing/zround.js` `commands`, after `ack`:

```js
  /** Race start: the decoder's clock to zero. A plain ZRound decoder streams only after it (decoders spec §2.4). */
  reset: '%I&',
```

In `packages/timing/simulator.js`, add `createTrack` and make `createSimulator` use it. The calls to `random` keep their order, so seeded runs stay the same; hits, strength and noise draw from `noise.random`, never from `random`.

```js
/**
 * Cars that cross the line at about their lap time (decoders spec §5.1). Each
 * crossing carries the hits and strength a decoder reports with it.
 * @param {{ cars: { id: number, lapMs: number }[], jitterMs?: number, random?: () => number,
 *   noise?: { double?: number, miss?: number, garbage?: number, random?: () => number } }} options
 */
export function createTrack({ cars, jitterMs = 150, random = Math.random, noise = {} }) {
  const chance = noise.random ?? Math.random;
  /** Each car's next crossing in decoder time. The first comes within one lap. */
  const next = cars.map((car) => ({ ...car, at: 2000 + random() * car.lapMs }));
  const jitter = () => (random() * 2 - 1) * jitterMs;
  /** @type {{ id: number, t: number, hits: number, strength: number }[]} */
  let doubles = [];
  return {
    /** The crossings up to decoder time `until`, in time order. @param {number} until */
    advance(until) {
      /** @type {{ id: number, t: number, hits: number, strength: number }[]} */
      const out = [];
      for (;;) {
        let first = -1;
        for (let i = 0; i < next.length; i += 1) if (first === -1 || next[i].at < next[first].at) first = i;
        if (first === -1 || next[first].at > until) break;
        const car = next[first];
        const crossing = { id: car.id, t: Math.round(car.at), hits: 5 + Math.floor(chance() * 56), strength: 100 + Math.floor(chance() * 156) };
        car.at += Math.max(car.lapMs + jitter(), 1);
        if (noise.miss && chance() < noise.miss) continue;
        out.push(crossing);
        if (noise.double && chance() < noise.double) doubles.push({ ...crossing, t: crossing.t + 50 + Math.floor(chance() * 251) });
      }
      const due = doubles.filter((d) => d.t <= until);
      doubles = doubles.filter((d) => d.t > until);
      return [...out, ...due].sort((a, b) => a.t - b.t);
    },
    /** The clock went to zero at `now`. @param {number} now */
    reset(now) {
      for (const car of next) car.at -= now;
      doubles = doubles.map((d) => ({ ...d, t: d.t - now }));
    },
  };
}
```

In `createSimulator`, replace `next`, `jitter` and the body of `advance` (`simulator.js:23-49`) with:

```js
  const track = createTrack({ cars: cars.map((car, i) => ({ id: i, lapMs: car.lapMs })), jitterMs, random });
```

```js
    advance(until) {
      return track.advance(until).map((c) => ({ transponder: cars[c.id].transponder, t: c.t }));
    },
```

In `reply`, case `'reset'`, replace `for (const car of next) car.at -= now;` with `track.reset(now);`.

- [ ] **Step 4: Run all of `packages/timing`; expect PASS:** `pnpm --filter @tinylap/timing test > "$LOGS/timing.log" 2>&1; echo "exit $?"; tail -n 30 "$LOGS/timing.log"`. The existing simulator tests pass unchanged.
- [ ] **Step 5: Checks, then commit**

```bash
git add packages/timing/zround.js packages/timing/simulator.js packages/timing/test/simulator.test.js packages/timing/test/zround.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing): a shared track for simulators, and the zround race start command"
```

---

### Task 3: Device models and the `?simulate` registry

**Files:**
- Create: `apps/timing/public/sim/models/tinylap.js`, `apps/timing/public/sim/models/zround.js`, `apps/timing/public/sim/models/easylap.js`, `apps/timing/public/sim/models.js`, `apps/timing/test/sim.test.js`

**Interfaces:**
- Consumes: `createTrack`, `commands`, `frames`, `createSimulator`, `createReader` from `@tinylap/timing` (Tasks 1–2).
- Produces:
  - a model is `{ transport: 'serial' | 'hid', info, start(now): Uint8Array[], tick(now): Uint8Array[], write(bytes: Uint8Array, now: number): Uint8Array[] }`. `now` is ms since the device opened;
  - `tinylapModel({ lapMs = 8000, cars = 3, random?, decoder = null })` → model plus `sim` (the `createSimulator` object);
  - `zroundModel({ lapMs = 8000, cars = 3, waitsForStart = true, ignoresStarts = 0, bootMs = 1500, ackMs = 100, acks = 21, clockEveryMs = 1000, noise = {}, random? })` → model plus a `running` getter;
  - `easylapModel({ lapMs = 8000, cars = 3, heartbeatMs = 250, waitsForStart = false, corrupt = false, noise = {}, random? })`;
  - `MODELS` and `simulation(search: string): null | { name: 'tinylap' | 'zround' | 'easylap', transport: 'serial' | 'hid', lapMs: number }`.
- The spec's model options are `waitsForStart` and `bootMs`. The others (`ignoresStarts`, `ackMs`, `acks`, `clockEveryMs`, `heartbeatMs`, `corrupt`, `decoder`) are test knobs, with defaults that follow the spec's §5.2 table.

- [ ] **Step 1: Write the failing tests**

```js
// apps/timing/test/sim.test.js
// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameReader, frames } from '@tinylap/timing';
import { simulation } from '../public/sim/models.js';
import { easylapModel } from '../public/sim/models/easylap.js';
import { tinylapModel } from '../public/sim/models/tinylap.js';
import { zroundModel } from '../public/sim/models/zround.js';

const enc = (s) => new TextEncoder().encode(s);
const text = (chunks) => chunks.map((c) => new TextDecoder().decode(c)).join('');

test('?simulate picks a model and a lap time (spec §5.4)', () => {
  assert.equal(simulation(''), null);
  assert.deepEqual(simulation('?simulate'), { name: 'tinylap', transport: 'serial', lapMs: 8000 });
  assert.deepEqual(simulation('?simulate=tinylap'), { name: 'tinylap', transport: 'serial', lapMs: 8000 });
  assert.deepEqual(simulation('?simulate=fast'), { name: 'tinylap', transport: 'serial', lapMs: 2000 });
  assert.deepEqual(simulation('?simulate=zround&speed=fast'), { name: 'zround', transport: 'serial', lapMs: 2000 });
  assert.deepEqual(simulation('?simulate=easylap'), { name: 'easylap', transport: 'hid', lapMs: 8000 });
  const warn = console.warn;
  const said = [];
  console.warn = (m) => said.push(m);
  try {
    assert.deepEqual(simulation('?simulate=amb'), { name: 'tinylap', transport: 'serial', lapMs: 8000 });
  } finally {
    console.warn = warn;
  }
  assert.match(said[0], /tinylap, zround, easylap/);
});

test('the TinyLap model answers as today\'s simulated decoder', () => {
  const model = tinylapModel({ cars: 0 });
  assert.equal(text(model.write(enc('%C&'), 0)), '%A&');
  assert.equal(text(model.write(enc('%TLHELLO&'), 0)), `%TLID - ${model.sim.boot}&`);
});

test('the ZRound model reads like RiCino: only the last 3-byte chunk of a burst counts', () => {
  const together = zroundModel({ cars: 0, bootMs: 0, ackMs: 10, acks: 2 });
  together.write(enc('%C&%TLHELLO&'), 0);
  assert.equal(text(together.tick(10)), '', 'the burst ended on "LO&"');
  const apart = zroundModel({ cars: 0, bootMs: 0, ackMs: 10, acks: 2 });
  apart.write(enc('%C&'), 0);
  assert.equal(text(apart.tick(10)), '%A&');
  assert.equal(text(apart.tick(20)), '%A&');
});

test('the ZRound model loses what comes in its boot time, and is silent until %I&', () => {
  const model = zroundModel({ cars: 1, lapMs: 500, bootMs: 100, ackMs: 1, acks: 1, clockEveryMs: 100 });
  model.write(enc('%C&'), 50);
  assert.equal(text(model.tick(60)), '', 'lost while it boots');
  model.write(enc('%C&'), 200);
  assert.equal(text(model.tick(210)), '%A&');
  assert.equal(text(model.tick(5000)), '', 'nothing before %I&');
  model.write(enc('%I&'), 5000);
  model.tick(5010);
  assert.equal(model.running, true);
  assert.match(text(model.tick(8000)), /%T64&[\s\S]*%L30,/);
});

test('the ZRound model ignores as many %I& as it is told to', () => {
  const model = zroundModel({ cars: 0, bootMs: 0, ignoresStarts: 1 });
  model.write(enc('%I&'), 0);
  model.tick(1);
  assert.equal(model.running, false);
  model.write(enc('%I&'), 2);
  model.tick(3);
  assert.equal(model.running, true);
});

test('the EasyLap model sends heartbeats and passings, answers a start with 00, and can spoil its checksums', () => {
  const model = easylapModel({ cars: 1, lapMs: 500, heartbeatMs: 250 });
  const reader = createFrameReader();
  const items = reader.push(Uint8Array.from(model.tick(3000).flatMap((f) => [...f])));
  assert.ok(items.some((x) => x.type === 'heartbeat') && items.some((x) => x.type === 'passing' && /^A1B2C$/.test(x.transponder)));
  assert.deepEqual(model.write(frames.start, 3000).map((x) => [...x]), [[0x00]]);
  const waiting = easylapModel({ cars: 0, waitsForStart: true });
  assert.deepEqual(waiting.tick(1000), []);
  const bad = createFrameReader();
  bad.push(Uint8Array.from(easylapModel({ cars: 0, corrupt: true }).tick(1000).flatMap((f) => [...f])));
  assert.ok(bad.mismatches > 0);
});
```

- [ ] **Step 2: Run it; expect FAIL** (the modules don't exist): `test/sim.test.js`.
- [ ] **Step 3: Implement**

```js
// apps/timing/public/sim/models/tinylap.js
// (AGPL header)

// A simulated TinyLap decoder (decoders spec §5.2): the replies of
// createSimulator, and a %L…& per crossing, as sim-port.js gave until now.
import { commands, createReader, createSimulator } from '@tinylap/timing';

const encode = (line) => new TextEncoder().encode(line);

/** @param {{ lapMs?: number, cars?: number, random?: () => number, decoder?: string | null }} [options] */
export function tinylapModel({ lapMs = 8000, cars = 3, random, decoder = null } = {}) {
  const sim = createSimulator({ cars: Array.from({ length: cars }, (_, i) => ({ transponder: (0x20 + i).toString(16).toUpperCase(), lapMs: lapMs + i * 300 })), random, decoder });
  const lines = createReader();
  const text = new TextDecoder();
  return {
    transport: /** @type {const} */ ('serial'),
    // The ids of pid.codes' test product: every simulated decoder is the same device.
    info: { usbVendorId: 0x1209, usbProductId: 0x0001, simulated: true },
    sim,
    start: () => [],
    /** @param {number} now */
    tick: (now) => sim.advance(now).map((p) => encode(commands.lap(p.transponder, p.t))),
    /** @param {Uint8Array} bytes @param {number} now */
    write: (bytes, now) => lines.push(text.decode(bytes, { stream: true })).flatMap((m) => sim.reply(m, now)).map(encode),
  };
}
```

```js
// apps/timing/public/sim/models/zround.js
// (AGPL header)

// A plain ZRound decoder, read the way RiCino reads (decoders spec §5.2,
// ricino-receiver.ino:45-206): bytes that come in its boot time are lost;
// its input is read in bursts, and only the last 3-byte chunk of each burst
// counts; it answers %C& with a run of %A&, reading nothing meanwhile; and
// it sends nothing until %I&, which zeroes its clock. It ignores %TL….
import { commands, createTrack } from '@tinylap/timing';

const encode = (line) => new TextEncoder().encode(line);
/** @param {number} n */
const hex = (n) => n.toString(16).toUpperCase();

/**
 * @param {{ lapMs?: number, cars?: number, waitsForStart?: boolean, ignoresStarts?: number, bootMs?: number,
 *   ackMs?: number, acks?: number, clockEveryMs?: number, noise?: { double?: number, miss?: number, garbage?: number, random?: () => number },
 *   random?: () => number }} [options]
 */
export function zroundModel({ lapMs = 8000, cars = 3, waitsForStart = true, ignoresStarts = 0, bootMs = 1500, ackMs = 100, acks = 21, clockEveryMs = 1000, noise = {}, random } = {}) {
  const roster = Array.from({ length: cars }, (_, i) => ({ id: 0x30 + i, lapMs: lapMs + i * 300 }));
  const chance = noise.random ?? Math.random;
  const text = new TextDecoder();
  let track = createTrack({ cars: roster, noise, random });
  let running = !waitsForStart;
  let zero = 0;
  let nextClock = clockEveryMs;
  let starts = 0;
  let input = '';
  let deafUntil = 0;
  /** @type {{ at: number, bytes: Uint8Array }[]} */
  let queue = [];
  /** @param {number} now */
  const due = (now) => {
    const ready = queue.filter((q) => q.at <= now).map((q) => q.bytes);
    queue = queue.filter((q) => q.at > now);
    return ready;
  };
  /** One burst: everything waiting, of which only the last whole 3-byte chunk counts. @param {number} now */
  const read = (now) => {
    const whole = Math.floor(input.length / 3) * 3;
    const command = whole ? input.slice(whole - 3, whole) : '';
    input = input.slice(whole);
    if (command === commands.startup) {
      for (let i = 0; i < acks; i += 1) queue.push({ at: now + i * ackMs, bytes: encode(commands.ack) });
      deafUntil = now + acks * ackMs;
    } else if (command === commands.reset && !running) {
      starts += 1;
      if (starts > ignoresStarts) {
        running = true;
        zero = now;
        nextClock = clockEveryMs;
        track = createTrack({ cars: roster, noise, random });
      }
    } else if (command === '%F&') {
      running = false;
    }
  };
  return {
    transport: /** @type {const} */ ('serial'),
    // An FTDI chip, as on many hobby decoders.
    info: { usbVendorId: 0x0403, usbProductId: 0x6001, simulated: true },
    get running() {
      return running;
    },
    start: () => [],
    /** @param {Uint8Array} bytes @param {number} now */
    write(bytes, now) {
      if (now >= bootMs) input += text.decode(bytes, { stream: true });
      return [];
    },
    /** @param {number} now */
    tick(now) {
      if (input && now >= deafUntil) read(now);
      const out = due(now);
      if (running) {
        const t = now - zero;
        for (; nextClock <= t; nextClock += clockEveryMs) out.push(encode(commands.clock(nextClock)));
        for (const c of track.advance(t)) {
          out.push(encode(commands.lap(hex(c.id), c.t)));
          if (noise.garbage && chance() < noise.garbage) out.push(encode('x!7 '));
        }
      }
      return out;
    },
  };
}
```

```js
// apps/timing/public/sim/models/easylap.js
// (AGPL header)

// A simulated EasyLap (decoders spec §5.2): from UART enable, a heartbeat
// every heartbeatMs and a passing per crossing, in Robitronic frames. It
// answers a start (03 B9 01) with 00 and zeroes its clock; a reset (03 B0 02)
// zeroes it too. `corrupt` spoils every checksum, for D13.
import { createTrack, frames } from '@tinylap/timing';

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * @param {{ lapMs?: number, cars?: number, heartbeatMs?: number, waitsForStart?: boolean, corrupt?: boolean,
 *   noise?: { double?: number, miss?: number, random?: () => number }, random?: () => number }} [options]
 */
export function easylapModel({ lapMs = 8000, cars = 3, heartbeatMs = 250, waitsForStart = false, corrupt = false, noise = {}, random } = {}) {
  const roster = Array.from({ length: cars }, (_, i) => ({ id: 0x0a1b2c + i, lapMs: lapMs + i * 300 }));
  const tail = [0x14, 0xd0, 0x01, 0x03];
  let track = createTrack({ cars: roster, noise, random });
  let running = !waitsForStart;
  let zero = 0;
  let nextBeat = 0;
  /** @param {Uint8Array} frame */
  const spoil = (frame) => {
    if (corrupt) frame[1] ^= 0xff;
    return frame;
  };
  /** @param {number} now */
  const restart = (now) => {
    running = true;
    zero = now;
    nextBeat = 0;
    track = createTrack({ cars: roster, noise, random });
  };
  return {
    transport: /** @type {const} */ ('hid'),
    info: { vendorId: 0x10c4, productId: 0x86b9, productName: 'EasyLap USB' },
    start: () => [],
    /** @param {Uint8Array} bytes @param {number} now */
    write(bytes, now) {
      if (same(bytes, frames.start)) {
        restart(now);
        return [Uint8Array.of(0x00)];
      }
      if (same(bytes, frames.reset)) restart(now);
      return [];
    },
    /** @param {number} now */
    tick(now) {
      if (!running) return [];
      const t = now - zero;
      /** @type {Uint8Array[]} */
      const out = [];
      for (; nextBeat <= t; nextBeat += heartbeatMs) out.push(spoil(frames.heartbeat(nextBeat, tail)));
      for (const c of track.advance(t)) out.push(spoil(frames.passing(c.id, c.t, c.hits, c.strength)));
      return out;
    },
  };
}
```

```js
// apps/timing/public/sim/models.js
// (AGPL header)

// The simulated decoders a bridge page can use (decoders spec §5.4):
// ?simulate=tinylap|zround|easylap, ?simulate and ?simulate=fast for TinyLap,
// and &speed=fast for a 2 s lap. A later model (AMB, say) is one more entry.
import { easylapModel } from './models/easylap.js';
import { tinylapModel } from './models/tinylap.js';
import { zroundModel } from './models/zround.js';

export const MODELS = Object.freeze({
  tinylap: { transport: /** @type {const} */ ('serial'), create: tinylapModel },
  zround: { transport: /** @type {const} */ ('serial'), create: zroundModel },
  easylap: { transport: /** @type {const} */ ('hid'), create: easylapModel },
});

/** What the page's ?simulate asks for, or null without it. @param {string} search */
export function simulation(search) {
  const params = new URLSearchParams(search);
  const value = params.get('simulate');
  if (value === null) return null;
  let name = value === '' || value === 'fast' ? 'tinylap' : value;
  if (!Object.hasOwn(MODELS, name)) {
    console.warn(`There is no simulated decoder "${value}". The known ones are ${Object.keys(MODELS).join(', ')}.`);
    name = 'tinylap';
  }
  const fast = value === 'fast' || params.get('speed') === 'fast';
  return { name: /** @type {keyof typeof MODELS} */ (name), transport: MODELS[name].transport, lapMs: fast ? 2000 : 8000 };
}
```

- [ ] **Step 4: Run it; expect PASS.**
- [ ] **Step 5: Checks, then commit**

```bash
git add apps/timing/public/sim apps/timing/test/sim.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): simulated tinylap, zround and easylap decoders"
```

---

### Task 4: The fake transports, and `sim-port.js` on top of them

**Files:**
- Create: `apps/timing/public/sim/serial-port.js`, `apps/timing/public/sim/hid-device.js`
- Modify: `apps/timing/public/sim/models.js` (add `simulatedDevice`), `apps/timing/public/sim-port.js` (whole file), `apps/timing/test/sim.test.js` (append)

**Interfaces:**
- Consumes: the models of Task 3.
- Produces:
  - `fakeSerialPort(model, { tickMs = 100 })`: a SerialPort look-alike (`readable`, `writable`, `open`, `close`, `getInfo`). It adds two test hooks: `send(bytes)` (bytes from the device's side) and `unplug()`;
  - `fakeHidDevice(model, { hid = null, tickMs = 100, seed = 1, failOpen = false })`: an HIDDevice look-alike (`vendorId`, `productId`, `productName`, `opened`, `open`, `close`, `sendFeatureReport`, `sendReport`, `inputreport` events). Its test hooks are `log` (feature reports as `[id, ...bytes]`), `writes` (output reports), `send(bytes)` and `unplug()`;
  - `simulatedDevice(sim, { hid })` → a fresh `fakeSerialPort` or `fakeHidDevice` for the `simulation()` result;
  - `simulatedPort({ lapMs, cars })` stays, as `fakeSerialPort(tinylapModel(…))`.

- [ ] **Step 1: Write the failing tests** (append to `test/sim.test.js`; add the imports `fakeSerialPort`, `fakeHidDevice`, `simulatedPort`):

```js
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

test('the fake serial port streams what its model sends and hands it what is written', async () => {
  const port = fakeSerialPort(tinylapModel({ cars: 0 }), { tickMs: 5 });
  await port.open();
  const reader = port.readable.getReader();
  const writer = port.writable.getWriter();
  await writer.write(enc('%C&'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), '%A&');
  port.send(enc('%T1F4&'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), '%T1F4&');
  port.unplug();
  assert.equal((await reader.read()).done, true);
  await port.close();
});

test('sim-port.js is the TinyLap model on the fake serial port', () => {
  assert.deepEqual(simulatedPort().getInfo(), { usbVendorId: 0x1209, usbProductId: 0x0001, simulated: true });
});

test('the fake HID device needs the CP2110 config and enable, reports in 1 to 63 bytes, and checks report ids', async () => {
  const hid = new EventTarget();
  const device = fakeHidDevice(easylapModel({ cars: 0, heartbeatMs: 5 }), { hid, tickMs: 5 });
  const reports = [];
  device.addEventListener('inputreport', (e) => reports.push(e));
  await device.open();
  await assert.rejects(device.sendReport(3, frames.start), /UART is off/);
  await device.sendFeatureReport(0x50, Uint8Array.of(0, 0, 0x96, 0, 0, 0, 2, 0));
  await device.sendFeatureReport(0x41, Uint8Array.of(1));
  await wait(30);
  assert.equal(reports.length, 0, 'nothing with a wrong UART config');
  await device.sendFeatureReport(0x50, Uint8Array.of(0, 0, 0x96, 0, 0, 0, 3, 0));
  await device.sendFeatureReport(0x41, Uint8Array.of(1));
  await wait(50);
  assert.ok(reports.length > 0);
  assert.ok(reports.every((r) => r.reportId >= 1 && r.reportId <= 63 && (r.data.byteLength === r.reportId || r.data.byteLength === 63)));
  assert.ok(reports.some((r) => r.data.byteLength === 63) && reports.some((r) => r.data.byteLength === r.reportId), 'padded and exact reports');
  await assert.rejects(device.sendReport(4, frames.start), /number of bytes/);
  await device.sendReport(3, frames.start);
  assert.deepEqual(device.writes, [[3, 0xb9, 1]]);
  const gone = [];
  hid.addEventListener('disconnect', (e) => gone.push(e.device));
  device.unplug();
  assert.deepEqual(gone, [device]);
  await device.close();
});

test('the fake HID device can refuse to open', async () => {
  const device = fakeHidDevice(easylapModel(), { failOpen: true });
  await assert.rejects(device.open(), (e) => e.name === 'NotAllowedError');
});
```

- [ ] **Step 2: Run it; expect FAIL.**
- [ ] **Step 3: Implement**

```js
// apps/timing/public/sim/serial-port.js
// (AGPL header)

// A SerialPort look-alike with a device model at the other end (decoders
// spec §5.3). Its streams have a JS sink and source, as sim-port.js's always
// had, so the browser tests' stream-counting init scripts keep working.

/** @param {any} model @param {{ tickMs?: number }} [options] */
export function fakeSerialPort(model, { tickMs = 100 } = {}) {
  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let controller;
  let timer = null;
  let openedAt = performance.now();
  const clock = () => Math.round(performance.now() - openedAt);
  /** @param {Uint8Array[]} chunks */
  const send = (chunks) => {
    for (const chunk of chunks) {
      try {
        controller.enqueue(chunk);
      } catch {
        // Unplugged or cancelled: the bytes go nowhere, as on a real cable.
      }
    }
  };
  return {
    readable: new ReadableStream({ start(c) { controller = c; }, cancel() { clearInterval(timer); } }),
    writable: new WritableStream({ write(chunk) { send(model.write(chunk, clock())); } }),
    async open() {
      openedAt = performance.now();
      send(model.start(0));
      timer = setInterval(() => send(model.tick(clock())), tickMs);
    },
    async close() {
      clearInterval(timer);
    },
    getInfo: () => model.info,
    /** Bytes from the device's side, for tests. @param {Uint8Array} bytes */
    send: (bytes) => send([bytes]),
    unplug() {
      clearInterval(timer);
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    },
  };
}
```

```js
// apps/timing/public/sim/hid-device.js
// (AGPL header)

// An HIDDevice look-alike: a CP2110 in front of a device model (decoders spec
// §5.3, research §1.1). Nothing flows before feature report 0x50 with the
// EasyLap's UART config and 0x41 [01]; 0x41 [00] stops it. Output reports
// must carry their length as the report id. Bytes go out in input reports of
// 1 to 63 bytes, split and merged at random (seeded), their data alternately
// exact and padded to 63, as a real CP2110's may be.

const UART_CONFIG = [0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0x03, 0x00].join();
/** @param {number} seed */
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
/** @param {BufferSource} data */
const bytesOf = (data) => (ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data)).slice();

/** @param {any} model @param {{ hid?: EventTarget | null, tickMs?: number, seed?: number, failOpen?: boolean }} [options] */
export function fakeHidDevice(model, { hid = null, tickMs = 100, seed = 1, failOpen = false } = {}) {
  const random = seeded(seed);
  const device = /** @type {any} */ (new EventTarget());
  let configured = false;
  let enabled = false;
  let timer = null;
  let openedAt = 0;
  let padded = false;
  const clock = () => Math.round(performance.now() - openedAt);
  /** @param {Uint8Array} chunk */
  const report = (chunk) => {
    const data = new Uint8Array(padded ? 63 : chunk.length);
    data.set(chunk);
    padded = !padded;
    device.dispatchEvent(Object.assign(new Event('inputreport'), { device, reportId: chunk.length, data: new DataView(data.buffer) }));
  };
  /** @param {Uint8Array[]} chunks */
  const emit = (chunks) => {
    if (!enabled) return;
    const all = Uint8Array.from(chunks.flatMap((c) => [...c]));
    for (let at = 0; at < all.length;) {
      const n = Math.min(all.length - at, 1 + Math.floor(random() * 63));
      report(all.subarray(at, at + n));
      at += n;
    }
  };
  const stop = () => {
    enabled = false;
    clearInterval(timer);
  };
  return Object.assign(device, {
    vendorId: model.info.vendorId,
    productId: model.info.productId,
    productName: model.info.productName,
    opened: false,
    /** Feature reports, as [id, ...bytes]. */
    log: [],
    /** Output reports' bytes. */
    writes: [],
    async open() {
      if (failOpen) throw new DOMException('Permission to open the device was denied.', 'NotAllowedError');
      device.opened = true;
    },
    async close() {
      stop();
      device.opened = false;
    },
    /** @param {number} id @param {BufferSource} data */
    async sendFeatureReport(id, data) {
      const bytes = bytesOf(data);
      device.log.push([id, ...bytes]);
      if (id === 0x50) configured = [...bytes].join() === UART_CONFIG;
      if (id === 0x41 && bytes[0] === 0) stop();
      if (id === 0x41 && bytes[0] === 1 && configured && !enabled) {
        enabled = true;
        openedAt = performance.now();
        emit(model.start(0));
        timer = setInterval(() => emit(model.tick(clock())), tickMs);
      }
    },
    /** @param {number} n @param {BufferSource} data */
    async sendReport(n, data) {
      const bytes = bytesOf(data);
      if (!enabled) throw new DOMException('The UART is off.', 'InvalidStateError');
      if (n !== bytes.length) throw new DOMException('The report id must be the number of bytes.', 'DataError');
      device.writes.push([...bytes]);
      emit(model.write(bytes, clock()));
    },
    /** Bytes from the device's side, for tests. @param {Uint8Array} bytes */
    send: (bytes) => emit([bytes]),
    unplug() {
      stop();
      hid?.dispatchEvent(Object.assign(new Event('disconnect'), { device }));
    },
  });
}
```

Append to `apps/timing/public/sim/models.js`:

```js
import { fakeHidDevice } from './hid-device.js';
import { fakeSerialPort } from './serial-port.js';

/**
 * A fresh simulated device for one pick (spec §5.4): every pick is a new device, so an unplug and
 * Connect again is one too. @param {{ name: keyof typeof MODELS, transport: 'serial' | 'hid', lapMs: number }} sim
 * @param {{ hid?: EventTarget }} [options]
 */
export function simulatedDevice(sim, { hid } = {}) {
  const model = MODELS[sim.name].create({ lapMs: sim.lapMs });
  return sim.transport === 'serial' ? fakeSerialPort(model) : fakeHidDevice(model, { hid });
}
```

(Put the two imports at the top of the file with the others.)

Replace `apps/timing/public/sim-port.js` below its header with:

```js
// A SerialPort look-alike with a simulated TinyLap decoder at the other end,
// for trying the bridge without hardware (?simulate, ?simulate=fast), and for
// the browser tests that build one themselves. It is the TinyLap model on the
// fake serial port (decoders spec §5).
import { tinylapModel } from './sim/models/tinylap.js';
import { fakeSerialPort } from './sim/serial-port.js';

/** @param {{ lapMs?: number, cars?: number }} [options] */
export function simulatedPort({ lapMs = 8000, cars = 3 } = {}) {
  return fakeSerialPort(tinylapModel({ lapMs, cars }));
}
```

- [ ] **Step 4: Run `test/sim.test.js`; expect PASS.** Then run `test/browser/bridge.test.js` and `bridge-element.test.js`; expect PASS unchanged (they still use `sim-port.js`).
- [ ] **Step 5: Checks, then commit**

```bash
git add apps/timing/public/sim apps/timing/public/sim-port.js apps/timing/test/sim.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): fake serial port and hid device for simulated decoders"
```

---

### Task 5: The link layer: transports and protocol readers

**Files:**
- Create: `apps/timing/public/link/serial.js`, `apps/timing/public/link/hid.js`, `apps/timing/public/link/zround.js`, `apps/timing/public/link/robitronic.js`, `apps/timing/test/link.test.js`

**Interfaces:**
- Consumes: `fakeHidDevice`, `fakeSerialPort` (Task 4); `createReader`, `ZROUND_BAUD`, `createFrameReader` (Task 1).
- Produces:
  - a transport is `{ device: string, open({ baudRate }): Promise<void>, bytes(): AsyncIterable<Uint8Array>, write(bytes): Promise<void>, close(): Promise<void> }`. `open` takes the protocol's baud rate; HID ignores it;
  - `serialTransport(port)` also has `port`. `device` is `serial:<vid>:<pid>`, from `getInfo()`;
  - `hidTransport(device, { hid = globalThis.navigator?.hid })`, and `EASYLAP_FILTER = { vendorId: 0x10c4, productId: 0x86b9 }`. `device` is `hid:<vid>:<pid>`;
  - `zroundProtocol() → { kind: 'zround', baudRate: 19200, push(bytes): DecoderEvent[] }`;
  - `robitronicProtocol() → { kind: 'robitronic', baudRate: 38400, push(bytes): DecoderEvent[], readonly mismatches: number }`.
- The serial transport takes its reader and writer in `open()`, and `close()` cancels the reader at most once, even when called twice. Task 7 relies on both (E3b).

- [ ] **Step 1: Write the failing tests**

```js
// apps/timing/test/link.test.js
// (AGPL header)

import test from 'node:test';
import assert from 'node:assert/strict';
import { frames } from '@tinylap/timing';
import { EASYLAP_FILTER, hidTransport } from '../public/link/hid.js';
import { robitronicProtocol } from '../public/link/robitronic.js';
import { serialTransport } from '../public/link/serial.js';
import { zroundProtocol } from '../public/link/zround.js';
import { fakeHidDevice } from '../public/sim/hid-device.js';
import { easylapModel } from '../public/sim/models/easylap.js';

const enc = (s) => new TextEncoder().encode(s);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const silentModel = { transport: 'hid', info: { vendorId: 0x10c4, productId: 0x86b9, productName: 'EasyLap USB' }, start: () => [], tick: () => [], write: () => [] };

test('the HID transport configures the CP2110, then enables its UART, in that order', async () => {
  const hid = new EventTarget();
  const device = fakeHidDevice(silentModel, { hid });
  const transport = hidTransport(device, { hid });
  assert.equal(transport.device, 'hid:4292:34489');
  assert.deepEqual(EASYLAP_FILTER, { vendorId: 0x10c4, productId: 0x86b9 });
  await transport.open({ baudRate: 38400 });
  assert.deepEqual(device.log, [[0x50, 0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0x03, 0x00], [0x41, 0x01]]);
  await transport.write(frames.start);
  assert.deepEqual(device.writes, [[0x03, 0xb9, 0x01]], 'sendReport(3, …)');
  await transport.close();
  assert.deepEqual(device.log.at(-1), [0x41, 0x00]);
});

test('the HID transport reads the first reportId bytes, padded or not, and ends on its own disconnect only', async () => {
  const hid = new EventTarget();
  const device = fakeHidDevice(silentModel, { hid });
  const transport = hidTransport(device, { hid });
  await transport.open({ baudRate: 38400 });
  const read = (async () => { const got = []; for await (const b of transport.bytes()) got.push(...b); return got; })();
  device.send(Uint8Array.of(1, 2, 3)); // exact
  device.send(Uint8Array.of(4, 5)); // padded to 63
  hid.dispatchEvent(Object.assign(new Event('disconnect'), { device: {} }));
  await wait(10);
  device.unplug();
  assert.deepEqual(await read, [1, 2, 3, 4, 5]);
});

test('the HID transport throws when the device can\'t be opened', async () => {
  const transport = hidTransport(fakeHidDevice(silentModel, { failOpen: true }), { hid: new EventTarget() });
  await assert.rejects(transport.open({ baudRate: 38400 }), (e) => e.name === 'NotAllowedError');
});

/** A port that records its baud rate, with a readable the test controls. */
function recordingPort({ fail = false } = {}) {
  let controller;
  const opened = [];
  return {
    opened,
    controller: () => controller,
    port: {
      readable: new ReadableStream({ start(c) { controller = c; } }),
      writable: new WritableStream({ write() {} }),
      open: async (options) => { opened.push(options); },
      close: async () => {},
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
    },
    fail,
  };
}

test('the serial transport opens at the protocol\'s baud rate and names the USB chip', async () => {
  const { port, opened } = recordingPort();
  const transport = serialTransport(port);
  assert.equal(transport.device, 'serial:6790:29987');
  await transport.open({ baudRate: zroundProtocol().baudRate });
  assert.deepEqual(opened, [{ baudRate: 19200 }]);
  await transport.close();
  await transport.close();
});

test('Review focus 1: a serial read that rejects ends the bytes, not in an unhandled rejection', async () => {
  const rig = recordingPort();
  const transport = serialTransport(rig.port);
  await transport.open({ baudRate: 19200 });
  const read = (async () => { for await (const _ of transport.bytes()) { /* none */ } return 'ended'; })();
  rig.controller().error(new Error('device lost'));
  assert.equal(await read, 'ended');
});

test('the ZRound reader maps every message to a session event, alive first', () => {
  const zround = zroundProtocol();
  assert.deepEqual(zround.push(enc('%A&%T1F4&%L0A,3E8&%TLID dec_1 b00tb00t&%TLOK&%TLERR no&%I&%Q&')), [
    { type: 'alive' },
    { type: 'alive' }, { type: 'clock', t: 500 },
    { type: 'alive' }, { type: 'passing', transponder: '0A', t: 1000 },
    { type: 'identity', decoder: 'dec_1', boot: 'b00tb00t' },
    { type: 'ok' },
    { type: 'error', text: 'no' },
    { type: 'reset' },
    { type: 'noise', detail: 'Q' },
  ]);
});

test('Review focus 2: bytes that aren\'t UTF-8, or a % with no &, never make a ZRound decoder alive', () => {
  const zround = zroundProtocol();
  const events = [...zround.push(Uint8Array.of(0xff, 0xfe, 0x25, 0xc3)), ...zround.push(enc('%%x'))];
  assert.equal(events.some((e) => e.type === 'alive'), false);
});

test('the Robitronic reader yields alive only for a good frame, and counts the bad ones', () => {
  const robitronic = robitronicProtocol();
  const bad = frames.heartbeat(10);
  bad[1] ^= 0xff;
  const warn = console.warn;
  const said = [];
  console.warn = (m) => said.push(m);
  try {
    assert.deepEqual(robitronic.push(bad), [{ type: 'noise', detail: 'checksum' }]);
    robitronic.push(bad);
  } finally {
    console.warn = warn;
  }
  assert.equal(said.length, 1, 'warned once');
  assert.match(said[0], /0B [0-9A-F]{2} 83/);
  assert.equal(robitronic.mismatches, 2);
  assert.deepEqual(robitronic.push(Uint8Array.from([...frames.heartbeat(20), ...frames.passing(0x123456, 12345, 12, 200)])), [
    { type: 'alive' }, { type: 'clock', t: 20 },
    { type: 'alive' }, { type: 'passing', transponder: '123456', t: 12345, hits: 12, strength: 200 },
  ]);
});
```

- [ ] **Step 2: Run it; expect FAIL.**
- [ ] **Step 3: Implement**

```js
// apps/timing/public/link/serial.js
// (AGPL header)

// A decoder on Web Serial (decoders spec §2.3): bytes in, bytes out. Its
// device name is the USB chip's ids, which Web Serial shows; it has no serial
// number, so two decoders on the same chip look alike (spec §3.2).

/** @param {any} port a SerialPort, or a look-alike */
export function serialTransport(port) {
  const { usbVendorId, usbProductId } = port.getInfo?.() ?? {};
  let reader = null;
  let writer = null;
  let cancelled = false;
  return {
    device: `serial:${usbVendorId ?? ''}:${usbProductId ?? ''}`,
    port,
    /** @param {{ baudRate: number }} options */
    async open({ baudRate }) {
      await port.open({ baudRate });
      writer = port.writable.getWriter();
      reader = port.readable.getReader();
    },
    async *bytes() {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          yield value;
        }
      } catch {
        // The port went away; the session says so.
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Already released.
        }
        try {
          writer?.releaseLock();
        } catch {
          // Already released.
        }
      }
    },
    /** @param {Uint8Array} bytes */
    write: (bytes) => writer.write(bytes),
    /** Cancels the reader once, however often it is called (E3b counts cancels). */
    async close() {
      if (reader && !cancelled) {
        cancelled = true;
        await reader.cancel().catch(() => {});
      }
      try {
        writer?.releaseLock();
      } catch {
        // Already released.
      }
      await port.close().catch(() => {});
    },
  };
}
```

```js
// apps/timing/public/link/hid.js
// (AGPL header)

// An EasyLap on WebHID (decoders spec §2.6, research §1.1): a CP2110
// HID-to-UART bridge. Open sets the UART to 38400 8N1 with feature report
// 0x50 and enables it with 0x41 [01]; input reports carry `reportId` data
// bytes; output report n carries n bytes; close disables the UART.

export const EASYLAP_FILTER = Object.freeze({ vendorId: 0x10c4, productId: 0x86b9 });
const UART_38400_8N1 = Uint8Array.of(0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0x03, 0x00);

/** @param {any} device an HIDDevice, or a look-alike @param {{ hid?: EventTarget }} [options] the source of `disconnect` events */
export function hidTransport(device, { hid = /** @type {any} */ (globalThis.navigator)?.hid } = {}) {
  /** @type {Uint8Array[]} */
  const queue = [];
  let wake = null;
  let ended = false;
  let closed = false;
  const end = () => {
    ended = true;
    wake?.();
  };
  /** @param {any} event */
  const onReport = (event) => {
    const n = Math.min(event.reportId, event.data.byteLength);
    queue.push(new Uint8Array(event.data.buffer, event.data.byteOffset, n).slice());
    wake?.();
  };
  /** @param {any} event */
  const onDisconnect = (event) => {
    if (event.device === device) end();
  };
  return {
    device: `hid:${device.vendorId}:${device.productId}`,
    async open() {
      if (!device.opened) await device.open();
      device.addEventListener('inputreport', onReport);
      hid?.addEventListener('disconnect', onDisconnect);
      await device.sendFeatureReport(0x50, UART_38400_8N1);
      await device.sendFeatureReport(0x41, Uint8Array.of(0x01));
    },
    async *bytes() {
      for (;;) {
        while (queue.length) yield queue.shift();
        if (ended) return;
        await new Promise((resolve) => { wake = resolve; });
        wake = null;
      }
    },
    /** One output report: its id is its length (not length + 1, pycp2110's bug). @param {Uint8Array} bytes */
    write: (bytes) => device.sendReport(bytes.length, bytes),
    async close() {
      if (closed) return;
      closed = true;
      end();
      device.removeEventListener('inputreport', onReport);
      hid?.removeEventListener('disconnect', onDisconnect);
      await device.sendFeatureReport(0x41, Uint8Array.of(0x00)).catch(() => {});
      await device.close().catch(() => {});
    },
  };
}
```

```js
// apps/timing/public/link/zround.js
// (AGPL header)

// The ZRound reader (decoders spec §2.3): text messages, TinyLap's %TL…
// included, as session events. A clock, a lap or an ack says the device
// speaks ZRound ("alive"); %TLID says it is a TinyLap decoder ("identity").
import { ZROUND_BAUD, createReader } from '@tinylap/timing';

/** @import { DecoderEvent, ZroundMessage } from '@tinylap/timing/types' */

/** @param {ZroundMessage} m @returns {DecoderEvent[]} */
function eventsOf(m) {
  switch (m.type) {
    case 'ack': return [{ type: 'alive' }];
    case 'clock': return [{ type: 'alive' }, { type: 'clock', t: m.t }];
    case 'lap': return [{ type: 'alive' }, { type: 'passing', transponder: m.transponder, t: m.t }];
    case 'hello': return [{ type: 'identity', decoder: m.decoder, boot: m.boot }];
    case 'reset': return [{ type: 'reset' }];
    case 'ok': return [{ type: 'ok' }];
    case 'error': return [{ type: 'error', text: m.text }];
    case 'unknown': return [{ type: 'noise', detail: m.raw }];
    default: return [];
  }
}

export function zroundProtocol() {
  const lines = createReader();
  const text = new TextDecoder();
  return {
    kind: /** @type {const} */ ('zround'),
    baudRate: ZROUND_BAUD,
    /** @param {Uint8Array} bytes */
    push: (bytes) => lines.push(text.decode(bytes, { stream: true })).flatMap(eventsOf),
  };
}
```

```js
// apps/timing/public/link/robitronic.js
// (AGPL header)

// The Robitronic reader (decoders spec §2.5): frames as session events. Only
// a frame whose checksum is right counts: it says the device speaks the
// protocol ("alive"). A bad one is noted, counted and logged once, never used.
import { createFrameReader } from '@tinylap/timing';

/** @import { DecoderEvent } from '@tinylap/timing/types' */

/** @param {Uint8Array} bytes */
const hex = (bytes) => [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

export function robitronicProtocol() {
  const reader = createFrameReader();
  let warned = false;
  return {
    kind: /** @type {const} */ ('robitronic'),
    baudRate: 38400,
    get mismatches() {
      return reader.mismatches;
    },
    /** @param {Uint8Array} bytes @returns {DecoderEvent[]} */
    push(bytes) {
      /** @type {DecoderEvent[]} */
      const out = [];
      for (const item of reader.push(bytes)) {
        if (item.type === 'noise') {
          if (!warned) {
            warned = true;
            console.warn(`An EasyLap frame failed its checksum, so it was skipped: ${hex(item.bytes)}. Please report this device.`);
          }
          out.push({ type: 'noise', detail: 'checksum' });
        } else if (item.type === 'heartbeat') {
          out.push({ type: 'alive' }, { type: 'clock', t: item.t });
        } else {
          out.push({ type: 'alive' }, { type: 'passing', transponder: item.transponder, t: item.t, hits: item.hits, strength: item.strength });
        }
      }
      return out;
    },
  };
}
```

- [ ] **Step 4: Run it; expect PASS.**
- [ ] **Step 5: Checks, then commit**

```bash
git add apps/timing/public/link apps/timing/test/link.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): serial and hid transports, zround and robitronic readers"
```

---

### Task 6: `Bridge` on the link, with no change in behaviour

The spec's migration step 1 (§7). `Bridge` reads through a transport and a protocol reader. `new Bridge({ port, … })` stays as a shorthand. The states, writes and timing don't change, so every existing test stays green and unchanged.

**Files:**
- Modify: `apps/timing/public/bridge.js:5-142`, `:207-215` (`sendOutbox` at `:217-275` stays untouched)

**Interfaces:**
- Consumes: `serialTransport`, `zroundProtocol` (Task 5).
- Produces:
  - `new Bridge({ link?: { transport, protocol }, port?, outbox, post, helloMs?, retryMs?, replyMs? })`;
  - new fields: `transport`, `protocol`, `device`, and `port` (the shorthand's port, or `null`).

- [ ] **Step 1: The tests are the existing ones.** Run them first, so the baseline is known:
  - `test/bridge.test.js`;
  - `test/browser/bridge.test.js`;
  - `test/browser/bridge-element.test.js`.

  Expect PASS.
- [ ] **Step 2: Change `bridge.js`**
  - The import becomes `import { MAX_BATCH, commands, nextLap } from '@tinylap/timing';`, plus `import { serialTransport } from './link/serial.js';` and `import { zroundProtocol } from './link/zround.js';`.
  - Add the module constant `const encode = (line) => new TextEncoder().encode(line);`.
  - Remove the fields `#writer` and `#reader`.
  - Replace the constructor:

```js
  /**
   * @param {{ link?: { transport: any, protocol: any } | null, port?: any, outbox: ReturnType<typeof import('./outbox.js').memoryOutbox>,
   *   post: (decoderId: string, batch: { boot: string, passings: { transponder: string, t: number }[] }) => Promise<{ through: number | null }>,
   *   helloMs?: number, retryMs?: number, replyMs?: number }} options
   */
  constructor({ link = null, port = null, outbox, post, helloMs = 2000, retryMs = 5000, replyMs = 3000 }) {
    super();
    const { transport, protocol } = link ?? { transport: serialTransport(port), protocol: zroundProtocol() };
    Object.assign(this, { transport, protocol, port, outbox, post, helloMs, retryMs, replyMs });
    this.device = transport.device;
    // (the rest of today's constructor body, from `this.state = 'idle';` on, unchanged)
  }
```

  - Replace `#write`, `start`, `#read` and the first lines of `#handle`:

```js
  /** @param {Uint8Array} bytes */
  async #write(bytes) {
    await this.transport.write(bytes);
  }

  async start() {
    await this.transport.open({ baudRate: this.protocol.baudRate });
    void this.#read();
    await this.hello();
    void this.flush();
  }

  async #read() {
    try {
      for await (const bytes of this.transport.bytes()) {
        for (const event of this.protocol.push(bytes)) {
          try {
            await this.#handle(event);
          } catch (error) {
            // A handler failure (say the outbox can't store) is not a lost port: say so and keep reading.
            this.#setOnline(false, error);
          }
        }
      }
    } finally {
      clearTimeout(this.#helloTimer);
      if (!this.#closed) this.#set('disconnected');
    }
  }
```

  - In `#handle`:
    - `message.type === 'hello'` becomes `'identity'`;
    - `'lap'` becomes `'passing'`;
    - `this.#write(commands.hello)` in `hello()` becomes `this.#write(encode(commands.hello))`;
    - `pair()` writes `encode(commands.pair(…))` and `encode(commands.wifi(…))`.
  - Replace `close()`:

```js
  async close() {
    this.#closed = true;
    clearTimeout(this.#retryTimer);
    clearTimeout(this.#helloTimer);
    await this.transport.close();
  }
```

  - Update the header comment (`:5-9`): the bridge reads a decoder through a transport and a protocol reader (decoders spec §2), and the rest of it stays.
- [ ] **Step 3: Run the three files again; expect PASS, unchanged.**
- [ ] **Step 4: Checks, then commit**

```bash
git add apps/timing/public/bridge.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "refactor(timing-app): the bridge reads through a transport and a protocol reader"
```

---

### Task 7: The session: handshake, kinds, boots, held passings, race start, late `%TLID`

This is the heart of the change: spec §2.4 for ZRound and TinyLap. EasyLap's own paths come in Task 8.

**Files:**
- Modify:
  - `apps/timing/public/bridge.js` (the whole `Bridge` class; `sendOutbox` stays);
  - `apps/timing/test/bridge.test.js:85-92` (the one adapted test);
  - `apps/timing/test/browser/bridge-element.test.js:211-240` (E3b, adapted, see Step 6);
  - `apps/timing/public/elements/bridge.js:64-70`, `:267` (the `not-tinylap` text and close go)
- Create: `apps/timing/test/bridge-session.test.js` (the new Node tests of spec §6.1 for the session. They live in their own file, next to `bridge.test.js`, whose existing tests stay as they are.)

**Interfaces:**
- Consumes: `fakeSerialPort` (Task 4); `tinylapModel` and `zroundModel` (Task 3); `commands.reset` (Task 2).
- Produces:
  - `new Bridge({ link?, port?, outbox, post, openDelayMs = 0, synMs = 500, handshakeMs = 6000, spacingMs = 300, helloMs = 2500, helloEveryMs = 700, startMs = 6000, listenSynMs = 2000, listenMs = 60_000, flushWaitMs = 10_000, retryMs = 5000, replyMs = 3000 })`;
  - `bridge.kind: 'tinylap' | 'zround' | 'easylap' | null`;
  - `bridge.state` adds `'listening'` and `'choose'` and drops `'not-tinylap'`;
  - `bridge.assign(decoderId): Promise<void>`;
  - an `identity-changed` event on a late `%TLID`;
  - `pair()` rejects with "This decoder can't be paired over the cable." for `zround` and `easylap`.

- [ ] **Step 1: Write the failing tests**

```js
// apps/timing/test/bridge-session.test.js
// (AGPL header)

// The bridge's session (decoders spec §2.4, §6.1): the handshake, the kinds,
// the boots, held passings, the race start and a late %TLID. Times are
// scaled down; the defaults test pins the real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOT_ID, commands } from '@tinylap/timing';
import { Bridge } from '../public/bridge.js';
import { serialTransport } from '../public/link/serial.js';
import { zroundProtocol } from '../public/link/zround.js';
import { memoryOutbox } from '../public/outbox.js';
import { fakeSerialPort } from '../public/sim/serial-port.js';
import { tinylapModel } from '../public/sim/models/tinylap.js';
import { zroundModel } from '../public/sim/models/zround.js';

const FAST = { synMs: 20, handshakeMs: 300, spacingMs: 20, helloMs: 120, helloEveryMs: 40, startMs: 150, listenSynMs: 40, listenMs: 2000 };
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (fn, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await fn()) return;
    await wait(5);
  }
  throw new Error('timed out');
};

/**
 * A serial port whose other end is `model` (m25). `writes` records each host write as
 * { text, at, boot } (the session's boot at that moment); `drop(text)` swallows a write.
 */
function modelPort(model, { drop = () => false } = {}) {
  const writes = [];
  let bridge = null;
  const spy = { ...model, write(bytes, now) {
    const text = new TextDecoder().decode(bytes);
    writes.push({ text, at: performance.now(), boot: bridge?.boot ?? null });
    return drop(text) ? [] : model.write(bytes, now);
  } };
  const port = fakeSerialPort(spy, { tickMs: 10 });
  return { port, writes, say: (line) => port.send(new TextEncoder().encode(line)), watch: (b) => { bridge = b; return b; } };
}
const silent = () => ({ transport: 'serial', info: {}, start: () => [], tick: () => [], write: () => [] });
const plain = (options = {}) => zroundModel({ cars: 0, bootMs: 0, ackMs: 5, acks: 3, ...options });
const count = (writes, text) => writes.filter((w) => w.text === text).length;
function posting() {
  const posts = [];
  return { posts, post: async (decoder, batch) => { posts.push({ decoder, ...batch }); return { through: Math.max(...batch.passings.map((p) => p.t)) }; } };
}
function bridgeOn(rig, options = {}) {
  const { posts, post } = posting();
  const bridge = rig.watch(new Bridge({ port: rig.port, outbox: options.outbox ?? memoryOutbox(), post: options.post ?? post, ...FAST, ...options }));
  const states = [];
  bridge.addEventListener('state', () => states.push(bridge.state));
  return { bridge, posts, states };
}
const sent = (posts) => posts.flatMap((p) => p.passings.map((x) => ({ decoder: p.decoder, boot: p.boot, ...x })));

test('the defaults are the spec\'s', () => {
  const b = new Bridge({ port: fakeSerialPort(silent()), outbox: memoryOutbox(), post: async () => ({ through: null }) });
  assert.deepEqual(
    [b.openDelayMs, b.synMs, b.handshakeMs, b.spacingMs, b.helloMs, b.helloEveryMs, b.startMs, b.listenSynMs, b.listenMs, b.flushWaitMs, b.retryMs, b.replyMs],
    [0, 500, 6000, 300, 2500, 700, 6000, 2000, 60_000, 10_000, 5000, 3000],
  );
});

test('the TinyLap handshake: %C& first, %TLHELLO& once, spaced after the answer, and never choose, listening or %I&', async () => {
  const rig = modelPort(tinylapModel({ cars: 0 }));
  const { bridge, states } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  await wait(200);
  assert.equal(rig.writes[0].text, commands.startup);
  const hello = rig.writes.findIndex((w) => w.text === commands.hello);
  const lastSyn = rig.writes.slice(0, hello).filter((w) => w.text === commands.startup).at(-1);
  assert.ok(rig.writes[hello].at - lastSyn.at >= FAST.spacingMs - 2, 'spaced from the last %C&');
  assert.equal(count(rig.writes, commands.hello), 1, 'the hello repeats stop at the first %TLID');
  assert.equal(count(rig.writes, commands.reset), 0);
  assert.equal(bridge.kind, 'tinylap');
  assert.ok(!states.includes('choose') && !states.includes('listening'));
  await bridge.close();
});

test('open delay and retry: a decoder that boots for 50 ms gets its %C& after the delay, or on a retry', async () => {
  const delayed = modelPort(plain({ bootMs: 50 }));
  const one = bridgeOn(delayed, { openDelayMs: 60 });
  await one.bridge.start();
  await until(() => one.bridge.state === 'choose');
  assert.equal(count(delayed.writes, commands.startup), 1);
  await one.bridge.close();
  const eager = modelPort(plain({ bootMs: 50 }));
  const two = bridgeOn(eager, { openDelayMs: 0 });
  await two.bridge.start();
  await until(() => two.bridge.state === 'choose');
  assert.ok(count(eager.writes, commands.startup) >= 2, 'the first was lost, a retry was answered');
  await two.bridge.close();
});

test('a plain ZRound decoder that waits for race start: choose, one %I& after the boot, then it forwards as the chosen decoder', async () => {
  const model = plain({ clockEveryMs: 50 });
  const rig = modelPort(model);
  const { bridge, posts } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'choose');
  assert.equal(bridge.kind, 'zround');
  await until(() => model.running);
  const start = rig.writes.find((w) => w.text === commands.reset);
  const lastHello = rig.writes.filter((w) => w.text === commands.hello).at(-1);
  assert.ok(start.at - lastHello.at >= FAST.spacingMs - 2, '%I& is spaced from the last hello');
  assert.match(start.boot, BOOT_ID, 'the boot was made before the write');
  await wait(400);
  assert.equal(count(rig.writes, commands.reset), 1);
  const writesAfterStart = rig.writes.length;
  await bridge.assign('dec_9');
  assert.equal(bridge.state, 'ready');
  rig.say(commands.lap('0A', 1000));
  rig.say(commands.lap('0A', 9000));
  await until(() => sent(posts).length === 2);
  assert.ok(sent(posts).every((p) => p.decoder === 'dec_9' && p.boot === bridge.boot && BOOT_ID.test(p.boot)));
  assert.equal(sent(posts)[0].boot, start.boot, 'the boot made right before %I& is the one the passings carry');
  await wait(200);
  assert.equal(rig.writes.length, writesAfterStart, 'nothing more is written to a running plain decoder');
  assert.ok(!rig.writes.some((w) => /^%TLPAIR|^%TLWIFI|^%F&/.test(w.text)));
  await assert.rejects(bridge.pair('dec_1', 't'.repeat(43)), /can't be paired over the cable/);
  await bridge.close();
});

test('%I& is retried with a new boot each time; after the last one the state stays choose, and its boot stays', async () => {
  const twice = modelPort(plain({ ignoresStarts: 1, clockEveryMs: 50 }));
  const a = bridgeOn(twice);
  await a.bridge.start();
  await until(() => count(twice.writes, commands.reset) === 2);
  const [first, second] = twice.writes.filter((w) => w.text === commands.reset);
  assert.notEqual(first.boot, second.boot);
  assert.ok(second.at - first.at >= FAST.startMs - 5);
  await a.bridge.close();

  const deaf = modelPort(plain({ ignoresStarts: 3 }));
  const b = bridgeOn(deaf);
  await b.bridge.start();
  await until(() => count(deaf.writes, commands.reset) === 3);
  await wait(FAST.startMs * 3);
  assert.equal(count(deaf.writes, commands.reset), 3);
  assert.ok(!b.states.includes('listening'));
  assert.equal(b.bridge.state, 'choose');
  const lastBoot = deaf.writes.filter((w) => w.text === commands.reset).at(-1).boot;
  const writes = deaf.writes.length;
  await b.bridge.assign('dec_9');
  deaf.say(commands.lap('0A', 1000));
  await until(() => sent(b.posts).length === 1);
  assert.equal(sent(b.posts)[0].boot, lastBoot);
  assert.equal(deaf.writes.length, writes, 'nothing after the last %I&');
  await b.bridge.close();
});

test('a quiet running decoder, whose first clock comes after a while but before startMs, gets one %I&', async () => {
  // Scaled: RiCino's first clock at 5 s against startMs 6 s (spec §2.4, R1).
  const rig = modelPort(plain({ clockEveryMs: 120 }));
  const { bridge } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'choose');
  await wait(FAST.startMs * 3);
  assert.equal(count(rig.writes, commands.reset), 1);
  await bridge.close();
});

test('the listening retry stops after listenMs', async () => {
  const rig = modelPort(silent());
  const { bridge } = bridgeOn(rig, { synMs: 10, handshakeMs: 40, listenSynMs: 20, listenMs: 200 });
  await bridge.start();
  await until(() => bridge.state === 'listening');
  await wait(250);
  const n = count(rig.writes, commands.startup);
  const h = count(rig.writes, commands.hello);
  await wait(200);
  assert.equal(count(rig.writes, commands.startup), n);
  assert.equal(count(rig.writes, commands.hello), h, 'the listening hellos stop too');
  assert.ok(n > 3 && h >= 1);
  await bridge.close();
});

test('a TinyLap firmware that ignores %C& is asked %TLHELLO& once listening, and ends unpaired', async () => {
  const hellosOnly = { transport: 'serial', info: {}, start: () => [], tick: () => [],
    write: (bytes) => (new TextDecoder().decode(bytes) === commands.hello ? [new TextEncoder().encode(commands.id(null, 'b00tb00t'))] : []) };
  const rig = modelPort(hellosOnly);
  const { bridge, states } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  assert.equal(bridge.kind, 'tinylap');
  assert.ok(states.includes('listening'));
  assert.ok(rig.writes.findIndex((w) => w.text === commands.hello) > rig.writes.findIndex((w) => w.text === commands.startup));
  await bridge.close();
});

test('a free-running plain decoder gets no %I&', async () => {
  const rig = modelPort(plain({ waitsForStart: false, clockEveryMs: 30 }));
  const { bridge } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'choose');
  await wait(400);
  assert.equal(count(rig.writes, commands.reset), 0);
  await bridge.close();
});

test('held passings: before the kind and in choose they wait, each with its boot, and go in order after assign', async () => {
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge, posts } = bridgeOn(rig);
  await bridge.start();
  await wait(5);
  rig.say(commands.lap('0A', 1000)); // before any boot: it takes the first one (F1)
  await until(() => bridge.state === 'choose');
  rig.say(commands.lap('0A', 9000));
  rig.say(commands.clock(5000));
  rig.say(commands.clock(100)); // a clock back during choose: a new boot
  rig.say(commands.lap('0A', 300));
  await wait(50);
  assert.equal(sent(posts).length, 0, 'nothing before assign');
  await bridge.assign('dec_9');
  await until(() => sent(posts).length === 3);
  const byT = Object.fromEntries(sent(posts).map((p) => [p.t, p.boot]));
  assert.equal(byT[1000], byT[9000]);
  assert.notEqual(byT[9000], byT[300]);
  assert.equal(byT[300], bridge.boot);
  await bridge.close();
});

test('held passings: close before assign posts nothing', async () => {
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge, posts } = bridgeOn(rig);
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  await bridge.close();
  await wait(100);
  assert.equal(posts.length, 0);
});

test('one chain: a live passing during assign lands after the held ones', async () => {
  const inner = memoryOutbox();
  const order = [];
  const outbox = { ...inner, add: async (p) => { await wait(2); order.push(p.t); return inner.add(p); } };
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge } = bridgeOn(rig, { outbox });
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  for (let t = 2000; t <= 20_000; t += 1000) rig.say(commands.lap('0A', t));
  await wait(50);
  const assigning = bridge.assign('dec_9');
  rig.say(commands.lap('0A', 99_000));
  await assigning;
  await until(() => order.length === 21);
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  assert.equal(order.at(-1), 99_000);
  await bridge.close();
});

test('once TinyLap, always TinyLap: a lost re-hello repeats until answered, and its passings wait for the new boot', async () => {
  const model = tinylapModel({ cars: 0, decoder: 'dec_1' });
  let swallow = 0;
  const rig = modelPort(model, { drop: (text) => text === commands.hello && swallow-- > 0 });
  const { bridge, posts, states } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'ready');
  swallow = 2;
  rig.say(commands.clock(5000));
  rig.say(commands.clock(9000));
  model.sim.reply({ type: 'reset' }, 9000); // the reset's own %TLID got lost
  rig.say(commands.clock(100));
  await until(() => bridge.state === 'connecting');
  rig.say(commands.lap('0A', 500));
  await until(() => bridge.state === 'ready' && bridge.boot === model.sim.boot);
  await until(() => sent(posts).length === 1);
  assert.deepEqual(sent(posts)[0], { decoder: 'dec_1', boot: model.sim.boot, transponder: '0A', t: 500 });
  assert.equal(bridge.kind, 'tinylap');
  assert.ok(!states.includes('choose'));
  assert.ok(count(rig.writes, commands.hello) >= 4);
  await bridge.close();
});

test('a late %TLID: after the flush in flight, the browser-stamped passings leave the outbox, and none is re-stamped', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const posts = [];
  const post = async (decoder, batch) => { posts.push({ decoder, ...batch }); await gate; return { through: null }; };
  const outbox = memoryOutbox();
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge } = bridgeOn(rig, { outbox, post });
  const changed = [];
  bridge.addEventListener('identity-changed', () => changed.push(true));
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  await bridge.assign('dec_9');
  rig.say(commands.lap('0A', 9000));
  await until(async () => (await outbox.count()) === 2 && posts.length === 1);
  rig.say('%TLID dec_1 b00tb00t&');
  await wait(50);
  assert.equal(await outbox.count(), 2, 'nothing leaves while the flush is in flight');
  release();
  await until(() => bridge.kind === 'tinylap' && bridge.state === 'ready');
  assert.equal(posts.length, 2);
  assert.ok(posts[1].passings.some((p) => p.t === 9000), 'the flush in flight finished first, 9000 included');
  assert.equal(await outbox.count(), 0);
  assert.ok(!(await outbox.list()).some((p) => p.decoder === 'dec_1'));
  assert.deepEqual(changed, [true]);
  await bridge.close();
});

test('a late %TLID gives up on a flush that hangs, after flushWaitMs', async () => {
  const outbox = memoryOutbox();
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge } = bridgeOn(rig, { outbox, post: () => new Promise(() => {}), flushWaitMs: 50 });
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  await bridge.assign('dec_9');
  await wait(20);
  rig.say('%TLID dec_1 b00tb00t&');
  await until(() => bridge.kind === 'tinylap' && bridge.state === 'ready', 1000);
  assert.equal(await outbox.count(), 0);
  await bridge.close();
});

test('boots for a plain decoder: a new one on %I& from it, on a clock back, and on a passing more than 1.5 s back', async () => {
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge } = bridgeOn(rig);
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  await bridge.assign('dec_9');
  const boots = [bridge.boot];
  const step = async (...lines) => { for (const l of lines) rig.say(l); await wait(30); boots.push(bridge.boot); };
  await step('%I&');
  assert.equal(bridge.references.size, 0);
  await step(commands.clock(5000), commands.clock(100));
  await step(commands.lap('0A', 10_000), commands.lap('0B', 8000));
  await step(commands.lap('0A', 20_000), commands.lap('0B', 19_000));
  assert.equal(new Set(boots.slice(0, 4)).size, 4, 'a new boot each time');
  assert.equal(boots[4], boots[3], 'not for 1 s back');
  await bridge.close();
});

test('a reconnect is a new boot', async () => {
  const boots = [];
  for (let i = 0; i < 2; i += 1) {
    const rig = modelPort(plain({ clockEveryMs: 50 }));
    const { bridge } = bridgeOn(rig);
    await bridge.start();
    await until(() => bridge.state === 'choose');
    boots.push(bridge.boot);
    await bridge.close();
  }
  assert.notEqual(boots[0], boots[1]);
});

test('no write after close', async () => {
  const rig = modelPort(silent());
  // Count calls to the transport's write itself: after close() the serial writer is released, so a write that got
  // through would be rejected before it reached the model, and rig.writes alone couldn't tell.
  const transport = serialTransport(rig.port);
  let calls = 0;
  const counted = { ...transport, write: (bytes) => { calls += 1; return transport.write(bytes); } };
  const bridge = new Bridge({ link: { transport: counted, protocol: zroundProtocol() }, outbox: memoryOutbox(), post: async () => ({ through: null }), ...FAST, synMs: 10, replyMs: 20 });
  await bridge.start();
  await until(() => calls >= 1);
  await bridge.close();
  const n = calls;
  await wait(100);
  // pair() is the one path that writes without a timer.
  await bridge.pair('dec_1', 't'.repeat(43)).catch(() => {});
  assert.equal(calls, n);
});

test('Review focus 4: a choice made after the device was unplugged is refused', async () => {
  const rig = modelPort(plain({ clockEveryMs: 50 }));
  const { bridge } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'choose');
  rig.port.unplug();
  await until(() => bridge.state === 'disconnected');
  await assert.rejects(bridge.assign('dec_9'), /disconnected/);
  assert.equal(bridge.state, 'disconnected');
});
```

In `test/bridge.test.js`, replace the test at `:85-92` (spec §6.1, adapted consciously: `not-tinylap` no longer exists):

```js
test('a device that says nothing is listening, not an error; a lost port is disconnected', async () => {
  const silent = fakePort(null);
  const bridge = new Bridge({ port: silent.port, outbox: memoryOutbox(), post: async () => ({ through: null }), handshakeMs: 20 });
  await bridge.start();
  await until(() => bridge.state === 'listening');
  assert.equal(bridge.lastError, null);
  silent.end();
  await until(() => bridge.state === 'disconnected');
});
```

- [ ] **Step 2: Run both files; expect FAIL** (no `listening`, no `assign`, no `kind`).
- [ ] **Step 3: Implement.** Replace the `Bridge` class in `public/bridge.js` (everything above `/** The answers that mean these passings will never be taken …` at `:217`) with:

```js
// The bridge (spec §5; decoders spec §2.4): a decoder on USB, read through a
// transport (Web Serial, or WebHID for an EasyLap) and a protocol reader
// (ZRound with TinyLap's %TL… commands, or Robitronic), forwarded to the
// server with the member's session.
// - The handshake: %C& until the decoder answers, then %TLHELLO&, spaced so
//   RiCino-style firmware reads both, and retried.
// - A TinyLap decoder says who it is (%TLID): its id and its boot.
// - A plain ZRound decoder (or an EasyLap, Task 8) can't: the member chooses
//   which decoder it is (assign), and the bridge makes its boots. A plain
//   decoder that doesn't stream gets %I&, its race start.
// - Passings wait in memory until the identity is known, then in an outbox
//   until the server holds them. Laps are computed locally for the preview.
// - Decoder events, timers and assign() run on one chain, in order.
import { MAX_BATCH, MIN_LAP_MS, commands, nextLap, passingKey, randomBoot } from '@tinylap/timing';
import { serialTransport } from './link/serial.js';
import { zroundProtocol } from './link/zround.js';

const encode = (line) => new TextEncoder().encode(line);
/** At most this many passings wait for the decoder's identity, oldest dropped first (spec §2.4). */
const HELD_MAX = 500;
/** %TLHELLO& at most this often in the handshake, and %I& at most this often (spec §2.4). */
const HELLOS = 3;
const STARTS = 3;
const BROWSER_ASSIGNED = new Set(['zround', 'easylap']);

/** @typedef {{ boot: string | null, transponder: string, t: number, hits?: number, strength?: number }} Held */

export class Bridge extends EventTarget {
  #replies = [];
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  #timers = new Set();
  #retryTimer = null;
  #flushing = null;
  #again = false;
  #closed = false;
  /** The one chain every decoder event, timer and assign() runs on (spec §2.4, R3). */
  #serial = Promise.resolve();
  #openedAt = 0;
  #lastWrite = -Infinity;
  /** The device answered something in its protocol. */
  #heard = false;
  /** The decoder sent a clock or a passing. */
  #streaming = false;
  #hellos = 0;
  #starts = 0;
  /** The last clock the decoder sent. @type {number | null} */
  #clock = null;
  /** The latest passing time of this boot, for a browser-assigned decoder (rule 4). @type {number | null} */
  #latest = null;
  /** Passings waiting for the decoder's identity. @type {Held[]} */
  #held = [];
  /** Keys of the passings this connection stamped with a browser-assigned id. */
  #stamped = new Set();
  /** @type {any} */ transport;
  /** @type {any} */ protocol;
  /** @type {any} */ port;
  /** @type {ReturnType<typeof import('./outbox.js').memoryOutbox>} */ outbox;
  /** @type {(decoderId: string, batch: any) => Promise<{ through: number | null }>} */ post;

  /**
   * @param {{ link?: { transport: any, protocol: any } | null, port?: any, outbox: ReturnType<typeof import('./outbox.js').memoryOutbox>,
   *   post: (decoderId: string, batch: { boot: string, passings: { transponder: string, t: number }[] }) => Promise<{ through: number | null }>,
   *   openDelayMs?: number, synMs?: number, handshakeMs?: number, spacingMs?: number, helloMs?: number, helloEveryMs?: number,
   *   startMs?: number, listenSynMs?: number, listenMs?: number, flushWaitMs?: number, retryMs?: number, replyMs?: number }} options
   */
  constructor({ link = null, port = null, outbox, post, openDelayMs = 0, synMs = 500, handshakeMs = 6000, spacingMs = 300, helloMs = 2500,
    helloEveryMs = 700, startMs = 6000, listenSynMs = 2000, listenMs = 60_000, flushWaitMs = 10_000, retryMs = 5000, replyMs = 3000 }) {
    super();
    const { transport, protocol } = link ?? { transport: serialTransport(port), protocol: zroundProtocol() };
    Object.assign(this, { transport, protocol, port, outbox, post, openDelayMs, synMs, handshakeMs, spacingMs, helloMs, helloEveryMs, startMs, listenSynMs, listenMs, flushWaitMs, retryMs, replyMs });
    this.device = transport.device;
    this.state = 'idle';
    /** @type {'tinylap' | 'zround' | 'easylap' | null} */
    this.kind = null;
    this.decoder = null;
    this.boot = null;
    this.online = true;
    this.lastError = null;
    /** How many passings the last refusal (lastError) dropped from the outbox. */
    this.dropped = 0;
    /** How many passings the last flush held back: for a club this sign-in has no access to (a 403). */
    this.blocked = 0;
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

  /** Runs fn after everything before it on the one chain; the result is fn's. @template T @param {() => T | Promise<T>} fn @returns {Promise<T>} */
  #chain(fn) {
    const run = this.#serial.then(fn);
    this.#serial = run.catch(() => {});
    return run;
  }

  /** @param {number} ms @param {() => unknown} fn */
  #later(ms, fn) {
    const id = setTimeout(() => {
      this.#timers.delete(id);
      if (!this.#closed) this.#chain(fn).catch((error) => this.#setOnline(false, error));
    }, ms);
    this.#timers.add(id);
  }

  #stopTimers() {
    for (const id of this.#timers) clearTimeout(id);
    this.#timers.clear();
  }

  /** Nothing is written after close (I13), nor once the port is gone: a queued item would only throw. @param {Uint8Array} bytes */
  async #write(bytes) {
    if (this.#closed || this.state === 'disconnected') return;
    this.#lastWrite = performance.now();
    await this.transport.write(bytes);
  }

  /** How long until spacingMs has passed since the last write. */
  #spaced() {
    return Math.max(0, this.#lastWrite + this.spacingMs - performance.now());
  }

  async start() {
    await this.transport.open({ baudRate: this.protocol.baudRate });
    if (this.#closed) {
      await this.transport.close();
      return;
    }
    this.#openedAt = performance.now();
    void this.#read();
    this.#set('connecting');
    if (this.openDelayMs) await new Promise((done) => setTimeout(done, this.openDelayMs));
    if (this.#closed) return;
    this.#later(this.handshakeMs, () => this.#enterListening());
    await this.#chain(() => this.#syn());
    void this.flush();
  }

  /** %C& until the decoder answers; while listening, every listenSynMs with a %TLHELLO& after it, until listenMs after open (spec §2.4, R1, R7). */
  async #syn() {
    if (this.#heard || this.kind) return;
    if (performance.now() - this.#openedAt >= this.listenMs) return;
    await this.#write(encode(commands.startup));
    if (this.state === 'listening') this.#later(this.spacingMs, () => this.#listenHello());
    this.#later(this.state === 'listening' ? this.listenSynMs : this.synMs, () => this.#syn());
  }

  /** No answer within handshakeMs: listening, with a %TLHELLO& for TinyLap firmware that ignores %C&, as today's bridge asked at once. */
  #enterListening() {
    if (this.#heard || this.kind) return;
    this.#set('listening');
    this.#later(this.#spaced(), () => this.#listenHello());
  }

  /** One %TLHELLO& while listening, until listenMs after open. A %TLID makes the decoder TinyLap; RiCino ignores it. */
  async #listenHello() {
    if (this.#heard || this.kind || performance.now() - this.#openedAt >= this.listenMs) return;
    await this.#write(encode(commands.hello));
  }

  /** Asks a TinyLap decoder who it is, again every helloMs until it answers (I5). Also after pairing. */
  async hello() {
    this.#set('connecting');
    this.#later(this.helloMs, () => {
      if (this.state === 'connecting' && this.kind === 'tinylap') return this.hello();
    });
    await this.#write(encode(commands.hello));
  }

  async #read() {
    try {
      for await (const bytes of this.transport.bytes()) {
        for (const event of this.protocol.push(bytes)) {
          try {
            await this.#chain(() => this.#handle(event));
          } catch (error) {
            // A handler failure (say the outbox can't store) is not a lost port: say so and keep reading.
            this.#setOnline(false, error);
          }
        }
      }
    } finally {
      this.#stopTimers();
      if (!this.#closed) this.#set('disconnected');
    }
  }

  /** @param {import('@tinylap/timing/types').DecoderEvent} event */
  async #handle(event) {
    switch (event.type) {
      case 'alive': return this.#alive();
      case 'identity': return this.#identity(event);
      case 'clock': return this.#onClock(event.t);
      case 'reset':
        if (this.kind !== 'tinylap' && this.boot) this.#newBoot();
        return undefined;
      case 'passing': return this.#onPassing(event);
      case 'ok':
      case 'error':
        this.#replies.shift()?.(event);
        return undefined;
      default: return undefined;
    }
  }

  #alive() {
    if (this.#heard) return;
    this.#heard = true;
    if (this.kind) return;
    if (this.state === 'listening') this.#set('connecting');
    this.#later(this.#spaced(), () => this.#sendHello());
  }

  /** Up to HELLOS hellos, helloEveryMs apart, stopping at the first %TLID (R7). The first opens the window. */
  async #sendHello() {
    if (this.kind || this.#hellos >= HELLOS) return;
    this.#hellos += 1;
    if (this.#hellos === 1) this.#later(this.helloMs, () => this.#windowOver());
    if (this.#hellos < HELLOS) this.#later(this.helloEveryMs, () => this.#sendHello());
    await this.#write(encode(commands.hello));
  }

  #windowOver() {
    if (this.kind) return;
    this.#decide('zround');
    if (!this.#streaming) this.#later(this.#spaced(), () => this.#raceStart());
  }

  /** @param {'zround' | 'easylap'} kind */
  #decide(kind) {
    this.kind = kind;
    this.#newBoot();
    this.#set('choose');
  }

  /** %I& to a plain decoder that doesn't stream, up to STARTS times, startMs apart, each after a new boot (C1, R1). */
  async #raceStart() {
    if (this.#streaming || this.#starts >= STARTS || this.kind !== 'zround') return;
    this.#starts += 1;
    this.#newBoot();
    await this.#write(encode(commands.reset));
    if (this.#starts < STARTS) this.#later(this.startMs, () => this.#later(this.#spaced(), () => this.#raceStart()));
  }

  /** @param {{ decoder: string | null, boot: string }} identity */
  async #identity({ decoder, boot }) {
    if (this.kind === 'zround') await this.#dropBrowserStamped();
    this.kind = 'tinylap';
    if (boot !== this.boot) {
      this.references.clear();
      this.#clock = null;
    }
    this.decoder = decoder;
    this.boot = boot;
    for (const p of this.#held) p.boot ??= boot;
    this.#set(decoder ? 'ready' : 'unpaired');
    if (!decoder) {
      this.#held = [];
      return;
    }
    await this.#stampHeld();
    void this.flush();
  }

  /**
   * A late %TLID (I6, R4, F2): once the flush in flight is done, the passings this connection stamped with the browser's id
   * leave the outbox, unsent, and the held ones go too. Nothing is re-stamped. The wait is bounded by flushWaitMs: a post
   * that hangs must not stall every decoder event behind it on the chain.
   */
  async #dropBrowserStamped() {
    let timer;
    await Promise.race([this.#flushing, new Promise((done) => { timer = setTimeout(done, this.flushWaitMs); })]);
    clearTimeout(timer);
    const mine = (await this.outbox.list()).filter((p) => this.#stamped.has(passingKey(p)));
    await this.outbox.remove(mine);
    this.#stamped.clear();
    this.#held = [];
    this.dispatchEvent(new Event('identity-changed'));
  }

  /** @param {number} t */
  async #onClock(t) {
    this.#streaming = true;
    const back = this.#clock !== null && t < this.#clock;
    this.#clock = t;
    if (!back) return;
    // A clock that went back means the decoder rebooted (power, %I&) with the port open.
    if (this.kind === 'tinylap') {
      await this.hello();
    } else if (this.boot) {
      this.#newBoot();
      this.#clock = t;
    }
  }

  /** @param {{ transponder: string, t: number, hits?: number, strength?: number }} passing */
  async #onPassing({ transponder, t, hits, strength }) {
    this.#streaming = true;
    if (this.kind !== 'tinylap' && this.boot) {
      if (this.#latest !== null && t < this.#latest - MIN_LAP_MS) this.#newBoot();
      this.#latest = Math.max(this.#latest ?? t, t);
    }
    /** @type {Held} */
    const held = { boot: this.kind === 'tinylap' && this.state !== 'ready' ? null : this.boot, transponder, t, hits, strength };
    if (this.state === 'ready') return this.#stamp(held);
    if (this.kind === 'tinylap' && this.state === 'unpaired') return undefined;
    this.#held.push(held);
    if (this.#held.length > HELD_MAX) this.#held.shift();
    return undefined;
  }

  /** A browser-made boot (spec §2.4, rules 1–4). A passing held before any boot takes the first one (F1). */
  #newBoot() {
    this.boot = randomBoot();
    this.references.clear();
    this.#clock = null;
    this.#latest = null;
    for (const p of this.#held) p.boot ??= this.boot;
  }

  /** @param {Held} held */
  async #stamp({ boot, transponder, t, hits, strength }) {
    const passing = { decoder: this.decoder, boot, transponder, t };
    const step = nextLap(this.references.get(transponder) ?? null, { boot, t });
    this.references.set(transponder, step.reference);
    await this.outbox.add(passing);
    if (BROWSER_ASSIGNED.has(this.kind)) this.#stamped.add(passingKey(passing));
    this.dispatchEvent(new CustomEvent('passing', { detail: { ...passing, lapMs: step.kind === 'lap' ? step.ms : null, hits, strength } }));
    void this.flush();
  }

  async #stampHeld() {
    const held = this.#held;
    this.#held = [];
    for (const p of held) await this.#stamp(p);
  }

  /** The browser's choice of decoder for a plain ZRound decoder or an EasyLap (spec §3.2). Writes nothing to the device. @param {string} decoderId */
  assign(decoderId) {
    return this.#chain(async () => {
      if (this.#closed || this.state === 'disconnected') throw new Error('The decoder is disconnected. Connect it again.');
      if (!BROWSER_ASSIGNED.has(this.kind)) throw new Error('This decoder says who it is; it is paired, not chosen.');
      this.decoder = decoderId;
      this.#set('ready');
      await this.#stampHeld();
      void this.flush();
    });
  }

  /** The decoder's next %TLOK& or %TLERR&, or a timeout. */
  #reply() {
    // (today's body, unchanged)
  }

  /** Stores the decoder's id and token on the board (and Wi-Fi, if given), then asks again who it is. */
  async pair(decoderId, token, wifi = null) {
    if (BROWSER_ASSIGNED.has(this.kind)) throw new Error("This decoder can't be paired over the cable.");
    let reply = this.#reply();
    await this.#write(encode(commands.pair(decoderId, token)));
    await reply;
    if (wifi) {
      reply = this.#reply();
      await this.#write(encode(commands.wifi(wifi.ssid, wifi.password)));
      await reply;
    }
    await this.hello();
  }

  /** Sends the outbox; retries later when the server can't be reached. */
  flush() {
    // (today's body, unchanged)
  }

  async close() {
    this.#closed = true;
    clearTimeout(this.#retryTimer);
    this.#stopTimers();
    this.#held = [];
    await this.transport.close();
  }
}
```

Copy `#reply()` and `flush()` verbatim from today's `bridge.js:145-160` and `:176-205`; only their place in the class moves. The `#reply` resolver reads `message.type` and `message.text`, which the `ok` and `error` events carry. `MAX_BATCH` is still imported for `sendOutbox`.

In `public/elements/bridge.js`, remove `'not-tinylap': …` from `STATE_TEXT` (`:67`) and the line `if (next.state === 'not-tinylap') void next.close();` (`:267`). The `listening` and `choose` states show no section until Tasks 10–12.

- [ ] **Step 4: Run `test/bridge-session.test.js` and `test/bridge.test.js`; expect PASS.** The other 14 tests of `bridge.test.js` pass unchanged. `:239` stays valid: the kind is undecided on its silent port, so `pair()` writes.
- [ ] **Step 5: Adapt E3b, consciously.** No write follows a `close()` now (I13), so a removal during the start ends with no write at all. COUNT counts a port as opened on its first write, so `opened` is now 0. The removal still cancels the reader once (the transport takes its reader in `open`, Task 5).
  - In `test/browser/bridge-element.test.js:229-240`, the expectations become:

    ```js
    assert.equal(state.opened, 0, 'no write at all: nothing is written after close');
    assert.equal(state.cancelled, 1, 'the port it opened is closed');
    assert.deepEqual(state.atRemoval, ['connecting']);
    assert.deepEqual(state.now, ['connecting'], 'nothing changed after the removal');
    ```

  - Drop the `late` assertion: with no writes there is nothing to compare.
  - Rename the test to `'E3b: a removal during the start writes nothing and closes the port it opened'`.

  Run both browser bridge files; expect PASS.
- [ ] **Step 6: Checks, then commit**

```bash
git add apps/timing/public/bridge.js apps/timing/public/elements/bridge.js apps/timing/test/bridge-session.test.js apps/timing/test/bridge.test.js apps/timing/test/browser/bridge-element.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): plain zround decoders, a retried handshake, and browser-made boots"
```

---

### Task 8: The session for an EasyLap

**Files:**
- Modify: `apps/timing/public/bridge.js` (`start`, `#alive`, `#handle`'s `noise` case, a `mismatches` getter, `#robitronicStart`), `apps/timing/test/bridge-session.test.js` (append)

**Interfaces:**
- Consumes: `hidTransport`, `robitronicProtocol` (Task 5); `fakeHidDevice` (Task 4); `easylapModel` (Task 3); `frames` (Task 1).
- Produces:
  - `bridge.mismatches: number`;
  - a `noise` event on each checksum mismatch;
  - `kind === 'easylap'`.

- [ ] **Step 1: Write the failing tests** (append; add the imports `frames` from `@tinylap/timing`, `hidTransport`, `robitronicProtocol`, `fakeHidDevice` and `easylapModel`):

```js
function hidRig(model, options = {}) {
  const hid = new EventTarget();
  const device = fakeHidDevice(model, { hid, tickMs: 10 });
  const { posts, post } = posting();
  const bridge = new Bridge({ link: { transport: hidTransport(device, { hid }), protocol: robitronicProtocol() }, outbox: memoryOutbox(), post, ...FAST, ...options });
  return { device, bridge, posts };
}

test('an EasyLap: easylap on the first good heartbeat, then it forwards as the chosen decoder, and a heartbeat back is a new boot', async () => {
  const { device, bridge, posts } = hidRig(easylapModel({ cars: 0, heartbeatMs: 20 }));
  await bridge.start();
  await until(() => bridge.state === 'choose');
  assert.equal(bridge.kind, 'easylap');
  await bridge.assign('dec_9');
  device.send(frames.passing(0x123456, 12345, 12, 200));
  await until(() => sent(posts).length === 1);
  assert.deepEqual(sent(posts)[0], { decoder: 'dec_9', boot: bridge.boot, transponder: '123456', t: 12345 });
  const before = bridge.boot;
  device.send(frames.heartbeat(1));
  await until(() => bridge.boot !== before);
  assert.deepEqual(device.writes, [], 'nothing is written while frames come');
  await bridge.close();
});

test('an EasyLap frame that fails its checksum never makes a boot and never posts', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { device, bridge, posts } = hidRig(easylapModel({ cars: 0, heartbeatMs: 20 }));
    const noise = [];
    bridge.addEventListener('noise', () => noise.push(true));
    await bridge.start();
    await until(() => bridge.state === 'choose');
    await bridge.assign('dec_9');
    const before = bridge.boot;
    const back = frames.heartbeat(1);
    back[1] ^= 0xff;
    const passing = frames.passing(0x123456, 99_999, 1, 1);
    passing[1] ^= 0xff;
    device.send(back);
    device.send(passing);
    await wait(100);
    assert.equal(bridge.boot, before);
    assert.equal(posts.length, 0);
    assert.ok(bridge.mismatches >= 2 && noise.length >= 2);
    await bridge.close();
  } finally {
    console.warn = warn;
  }
});

test('an EasyLap that waits for a start gets 03 B9 01 after handshakeMs, then forwards; a silent one gets three, then listening', async () => {
  const waiting = hidRig(easylapModel({ cars: 0, waitsForStart: true, heartbeatMs: 20 }), { handshakeMs: 50 });
  await waiting.bridge.start();
  await until(() => waiting.bridge.state === 'choose');
  assert.deepEqual(waiting.device.writes, [[0x03, 0xb9, 0x01]]);
  await waiting.bridge.close();
  const quiet = { transport: 'hid', info: { vendorId: 0x10c4, productId: 0x86b9 }, start: () => [], tick: () => [], write: () => [] };
  const silentLap = hidRig(quiet, { handshakeMs: 50 });
  await silentLap.bridge.start();
  await until(() => silentLap.bridge.state === 'listening', 4000);
  await wait(600);
  assert.equal(silentLap.device.writes.length, 3);
  await silentLap.bridge.close();
});

test('heartbeats are never held: 600 of them during choose drop no passing', async () => {
  const { device, bridge, posts } = hidRig(easylapModel({ cars: 0, heartbeatMs: 1 }));
  await bridge.start();
  await until(() => bridge.state === 'choose');
  device.send(frames.passing(0x0a1b2c, 50_000, 9, 180));
  await wait(800);
  await bridge.assign('dec_9');
  await until(() => sent(posts).length === 1);
  assert.equal(sent(posts)[0].transponder, 'A1B2C');
  await bridge.close();
});
```

- [ ] **Step 2: Run it; expect FAIL** (the kind stays `null`).
- [ ] **Step 3: Implement** in `public/bridge.js`:
  - Add the module constant `import { … , frames } from '@tinylap/timing';` (extend the import), and `const ROBITRONIC_START_EVERY_MS = 500;`.
  - Add the getter `get mismatches() { return this.protocol.mismatches ?? 0; }`.
  - In `start()`, replace the two lines `this.#later(this.handshakeMs, () => this.#enterListening());` and `await this.#chain(() => this.#syn());` with:

```js
    if (this.protocol.kind === 'robitronic') {
      // The EasyLap streams once its UART is on; a start is only a fallback (spec §2.4).
      this.#later(this.handshakeMs, () => this.#robitronicStart(0));
    } else {
      this.#later(this.handshakeMs, () => this.#enterListening());
      await this.#chain(() => this.#syn());
    }
```

  - In `#alive()`, after `this.#heard = true;`, add `if (this.protocol.kind === 'robitronic') return this.#decide('easylap');` (and make `#alive` return `undefined` elsewhere).
  - In `#handle`, add before `default`:

```js
      case 'noise':
        if (event.detail === 'checksum') this.dispatchEvent(new Event('noise'));
        return undefined;
```

  - Add:

```js
  /**
   * The Robitronic start, only if no good frame came within handshakeMs: up to three, 500 ms apart, as
   * FlipSide sends it, then listening (spec §2.4). While the kind is undecided nothing is held, since
   * a passing needs a good frame, which decides the kind first; so no boot is made for this write.
   * @param {number} sentSoFar
   */
  async #robitronicStart(sentSoFar) {
    if (this.kind) return;
    if (sentSoFar === STARTS) {
      this.#set('listening');
      return;
    }
    await this.#write(frames.start);
    this.#later(ROBITRONIC_START_EVERY_MS, () => this.#robitronicStart(sentSoFar + 1));
  }
```

  - Extend the header comment's EasyLap line ("or an EasyLap, Task 8") to: "…or an EasyLap, which streams once its UART is on and gets a start only as a fallback".
- [ ] **Step 4: Run `test/bridge-session.test.js` and `test/bridge.test.js`; expect PASS.**
- [ ] **Step 5: Checks, then commit**

```bash
git add apps/timing/public/bridge.js apps/timing/test/bridge-session.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): easylap sessions, with a checksum that is never bypassed"
```

---

### Task 9: The remembered choice (`public/devices.js`)

**Files:**
- Create: `apps/timing/public/devices.js`, `apps/timing/test/devices.test.js`

**Interfaces:**
- Produces:
  - `openDevices(name = 'tinylap-bridge-devices') → Promise<{ recall(workspace, device): Promise<string | null>, remember(workspace, device, decoder): Promise<void>, forget(workspace, device): Promise<void> }>`. It is IndexedDB, store `devices`, keyed `[workspace, device]` → `{ decoder }`, with a memory fallback;
  - `memoryDevices()`, with the same shape.

- [ ] **Step 1: Write the failing tests**

```js
// apps/timing/test/devices.test.js
// (AGPL header)

import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryDevices, openDevices } from '../public/devices.js';

test('remember, recall and forget a device\'s decoder, per club or personal space', async () => {
  const devices = memoryDevices();
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), null);
  await devices.remember('w1', 'serial:1027:24577', 'dec_1');
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), 'dec_1');
  assert.equal(await devices.recall('w2', 'serial:1027:24577'), null);
  await devices.remember('w1', 'serial:1027:24577', 'dec_2');
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), 'dec_2');
  await devices.forget('w1', 'serial:1027:24577');
  assert.equal(await devices.recall('w1', 'serial:1027:24577'), null);
});

test('without IndexedDB the devices fall back to memory', async () => {
  const devices = await openDevices('test');
  await devices.remember('w1', 'hid:4292:34489', 'dec_1');
  assert.equal(await devices.recall('w1', 'hid:4292:34489'), 'dec_1');
});
```

  The IndexedDB record shape, `{ decoder }` and nothing more, is checked in the browser by D1 (Task 12).
- [ ] **Step 2: Run it; expect FAIL.**
- [ ] **Step 3: Implement**

```js
// apps/timing/public/devices.js
// (AGPL header)

// Which decoder a device was chosen as, in this browser (decoders spec §3.2).
// A device is its USB chip, not the decoder, so this only suggests: the
// bridge asks the member to confirm on every connect. It keeps the choice
// alone, `{ decoder }`, never a boot or a clock (owner's decision).

const STORE = 'devices';

export function memoryDevices() {
  const items = new Map();
  const key = (workspace, device) => `${workspace} ${device}`;
  return {
    /** @param {string} workspace @param {string} device @returns {Promise<string | null>} */
    async recall(workspace, device) {
      return items.get(key(workspace, device))?.decoder ?? null;
    },
    /** @param {string} workspace @param {string} device @param {string} decoder */
    async remember(workspace, device, decoder) {
      items.set(key(workspace, device), { decoder });
    },
    /** @param {string} workspace @param {string} device */
    async forget(workspace, device) {
      items.delete(key(workspace, device));
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

/** The IndexedDB devices, or memory ones where IndexedDB is unavailable (private windows, Node). */
export async function openDevices(name = 'tinylap-bridge-devices') {
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return memoryDevices();
  }
  return {
    recall: (workspace, device) => inTransaction(db, 'readonly', (store) => store.get([workspace, device])).then((r) => r?.decoder ?? null),
    remember: (workspace, device, decoder) => inTransaction(db, 'readwrite', (store) => store.put({ decoder }, [workspace, device])).then(() => {}),
    forget: (workspace, device) => inTransaction(db, 'readwrite', (store) => store.delete([workspace, device])).then(() => {}),
  };
}
```

- [ ] **Step 4: Run it; expect PASS.**
- [ ] **Step 5: Checks, then commit**

```bash
git add apps/timing/public/devices.js apps/timing/test/devices.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): remember which decoder a device was chosen as"
```

---

### Task 10: The server's bridge page: two Connect buttons, listening, choose, the gap note

**UI task: use the `frontend-design` skill** before editing the view, and check the page at 390×844 and 1280×800. The look stays palace-ui plus `@tinylap/design`. There is no new CSS unless the two inline buttons need a gap. If they do, it goes in `app.css`, or upstream in palace-ui if it is generic.

**Files:**
- Modify:
  - `apps/timing/server/store.js:42` (the index), `:147-153` (the query), `:281` (the method);
  - `apps/timing/server/bridge-pages.js:12-15`;
  - `apps/timing/server/views/bridge.js:18-83`;
  - `apps/timing/server/views/form-parts.js:31-40` (`selectField` gains `hint` and per-option `dataName`);
  - `apps/timing/test/server/bridge-pages.test.js`

**Interfaces:**
- Produces:
  - `store.choosableDecoders(ws)`: today's `decoders(ws)` without the decoders that have any passing `via = 'net'`;
  - `bridgePage(request, importMap, decoders)`;
  - the markup hooks `tl-bridge` uses:
    - `[data-bridge-connect="serial"|"hid"|"last"]`, `[data-bridge-missing="serial"|"hid"]`;
    - `[data-bridge-listening]`, `[data-bridge-unreadable]`;
    - `[data-bridge-choose]` (a form), `[data-bridge-choose-heading]`, `[data-bridge-kind][data-where]`;
    - `#bridge-choose` (a select, its options with `data-name`), `#bridge-choose-name`;
    - `[data-bridge-gap]`.

- [ ] **Step 1: Write the failing tests** in `test/server/bridge-pages.test.js`:
  - In the first test:
    - `:25`'s list becomes `['unsupported', 'connect', 'connecting', 'listening', 'unpaired', 'choose', 'ready', 'disconnected']`;
    - add `assert.doesNotMatch(body, /not-tinylap/);`;
    - `:26` stays (`Chrome or Edge`), and add `assert.match(body, /The bridge needs Chrome or Edge on a laptop, with JavaScript on: it reads the decoder over USB with Web Serial, or an EasyLap with WebHID\./);`. `:24` and `:36` stay as they are.
  - Append:

```js
test('two Connect buttons, the serial one first; the missing-API notes hidden; the choose form with its own name field', async () => {
  const body = await (await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  const serial = body.indexOf('data-bridge-connect="serial"');
  const hid = body.indexOf('data-bridge-connect="hid"');
  assert.ok(serial > 0 && hid > serial, 'Connect decoder comes first');
  assert.ok(body.indexOf('data-bridge-connect') === serial, 'and is the first [data-bridge-connect] of all');
  assert.match(body, />Connect decoder<\/button>/);
  assert.match(body, />Connect EasyLap<\/button>/);
  assert.match(body, /<p>An EasyLap\? Use Connect EasyLap: it doesn't show up in the decoder list\.<\/p>/);
  assert.match(body, /<p class="status status-warning" data-bridge-missing="serial" hidden>This browser can't reach USB decoders, only an EasyLap\.<\/p>/);
  assert.match(body, /<p class="status status-warning" data-bridge-missing="hid" hidden>This browser can't reach an EasyLap, only other USB decoders\.<\/p>/);
  assert.equal(body.match(/data-bridge-connect="last"/g).length, 2, 'Try another device and Connect again');
  assert.match(body, /<label for="bridge-choose-name">Name for the new decoder<\/label>/);
  assert.equal(body.match(/>Decoder name</g).length, 1, 'exactly one "Decoder name" label');
  assert.match(body, /<h2 class="h3" data-bridge-choose-heading>Which decoder is this\?<\/h2>/);
  assert.match(body, /<p data-bridge-kind data-where="your personal space"><\/p>/);
  assert.match(body, /If it comes unplugged, crossings until you connect again are lost, and each car's lap starts over\./);
  assert.match(body, /Choose an existing decoder only if it is this same device\. A decoder that another laptop uses needs its own\./);
  assert.match(body, /<button type="submit" class="btn btn-primary">Use this decoder<\/button>/);
  assert.match(body, /<p class="status status-warning" data-bridge-listening>Connected, but nothing has come from this device yet\.<\/p>/);
  assert.match(body, /<p class="status status-warning" data-bridge-unreadable hidden>Data is coming, but it can't be read\. Report this device\.<\/p>/);
  assert.match(body, /<p>A decoder answers within a few seconds\. If this is the wrong device, try another\.<\/p>/);
  assert.match(body, /<p data-bridge-gap hidden>Crossings while it is unplugged are lost, and each car's lap starts over when you connect again\.<\/p>/);
});

test('the choose list: the club\'s decoders, escaped, "A new decoder" last; none that sends over Wi-Fi', async () => {
  const me = await (await app.api(member, 'GET', '/auth/me')).json();
  const space = me.workspaces[0].id;
  const gate = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Gate <1>' })).json();
  const wifi = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Over Wi-Fi' })).json();
  const res = await fetch(`${app.base}/decoders/${wifi.id}/passings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${wifi.token}` }, body: JSON.stringify({ boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1000 }] }) });
  assert.equal(res.status, 200);
  const body = await (await app.api(member, 'GET', '/personal/bridge', undefined, { accept: 'text/html' })).text();
  const select = /<select id="bridge-choose" name="decoder"[^>]*>([\s\S]*?)<\/select>/.exec(body)[1];
  assert.match(select, new RegExp(`<option value="${gate.id}" data-name="Gate &lt;1&gt;">Gate &lt;1&gt;</option>`));
  assert.doesNotMatch(select, /Over Wi-Fi/);
  assert.match(select, /<option value="" selected>A new decoder<\/option>\s*$/);
  assert.match(body, /<select id="bridge-choose" name="decoder" aria-describedby="bridge-choose-hint">/);
});
```

  Add a store test in `test/server/store.test.js`: `choosableDecoders` drops a decoder with a `via: 'net'` passing and keeps one with only `via: 'serial'` passings. Follow that file's pattern for making a store, and use `store.addDecoder` and `store.insertPassing`.
- [ ] **Step 2: Run both files; expect FAIL.**
- [ ] **Step 3: Implement**

`server/store.js`:
- After `CREATE INDEX IF NOT EXISTS passing_workspace …` (`:42`), add:

  ```sql
  CREATE INDEX IF NOT EXISTS passing_net ON passing (workspace_id, via, decoder_id);
  ```

- Add to the prepared statements, after `decoders:` (`:147`):

  ```js
  netDecoders: q("SELECT DISTINCT decoder_id FROM passing WHERE workspace_id = ? AND via = 'net'"),
  ```

- Add after `decoders:` (`:281`):

```js
    /** The decoders a plain ZRound decoder or an EasyLap may be chosen as: none that sends over Wi-Fi (decoders spec §3.2, I7). */
    choosableDecoders(ws) {
      const net = new Set(s.netDecoders.all(ws).map((r) => String(r.decoder_id)));
      return s.decoders.all(ws).filter((r) => !net.has(String(r.id))).map((r) => ({ id: String(r.id), name: String(r.name), createdAt: Number(r.created_at), lastSeenAt: num(r.last_seen_at) }));
    },
```

`server/bridge-pages.js` `showBridge`: `bridgePage(request, map, request.store.choosableDecoders(request.workspaceId))`.

`server/views/bridge.js`: replace `connect` and the body of `bridgePage` from `<div id="bridge" …` to its closing `</div>` (the rest of the page stays):

```js
/** @param {string} label @param {'serial' | 'hid' | 'last'} which @param {string} [style] */
const connect = (label, which, style = 'btn-primary') => html`<button type="button" class="btn ${style} btn-lg" data-bridge-connect="${which}">${label}</button>`;

/** @param {any} request @param {{ tag: unknown }} importMap @param {{ id: string, name: string }[]} [decoders] the decoders a device may be chosen as */
export function bridgePage(request, importMap, decoders = []) {
  const base = request.space.base;
  const where = request.space.kind === 'personal' ? 'your personal space' : 'this club';
  return layout(request, {
    title: 'Bridge',
    screen: 'bridge',
    importMap: importMap.tag,
    scripts: ['elements/bridge.js'],
    body: html`<div class="container stack-lg screen">
  <h1>Bridge</h1>
  <tl-bridge>
  <div id="bridge" data-workspace="${request.workspaceId}">
    <p class="visually-hidden" role="status" data-bridge-live></p>
    <p class="status status-warning" data-bridge-earlier hidden></p>
    <template data-bridge-sign-in><a href="/auth/login?${new URLSearchParams({ returnTo: `${base}/bridge` })}">Sign in again</a> to send them.</template>
    <section data-bridge-state="unsupported" class="card-static stack-md">
      <p>The bridge needs Chrome or Edge on a laptop, with JavaScript on: it reads the decoder over USB with Web Serial, or an EasyLap with WebHID.</p>
      <p>Timing still works without it: the decoder can send its passings over Wi-Fi (<a href="${base}/setup">Pair over Wi-Fi only</a> on Setup), and you can <a href="${base}/tap">tap laps by hand</a>.</p>
    </section>
    <section data-bridge-state="connect" hidden class="card-static stack-md">
      <p>Plug the decoder in by USB, then connect. Keep this tab open while racing; the board runs in any other tab or screen.</p>
      <p>${connect('Connect decoder', 'serial')} ${connect('Connect EasyLap', 'hid', 'btn-secondary')}</p>
      <p>An EasyLap? Use Connect EasyLap: it doesn't show up in the decoder list.</p>
      <p class="status status-warning" data-bridge-missing="serial" hidden>This browser can't reach USB decoders, only an EasyLap.</p>
      <p class="status status-warning" data-bridge-missing="hid" hidden>This browser can't reach an EasyLap, only other USB decoders.</p>
    </section>
    <section data-bridge-state="connecting" hidden class="card-static"><p>Talking to the decoder…</p></section>
    <section data-bridge-state="listening" hidden class="card-static stack-md">
      <p class="status status-warning" data-bridge-listening>Connected, but nothing has come from this device yet.</p>
      <p class="status status-warning" data-bridge-unreadable hidden>Data is coming, but it can't be read. Report this device.</p>
      <p>A decoder answers within a few seconds. If this is the wrong device, try another.</p>
      ${connect('Try another device', 'last')}
    </section>
    <section data-bridge-state="unpaired" hidden class="card-static stack-md">
      <!-- (today's unpaired section, unchanged: views/bridge.js:49-58) -->
    </section>
    <section data-bridge-state="choose" hidden class="card-static stack-md">
      <h2 class="h3" data-bridge-choose-heading>Which decoder is this?</h2>
      <p data-bridge-kind data-where="${where}"></p>
      <p>If it comes unplugged, crossings until you connect again are lost, and each car's lap starts over.</p>
      <form data-bridge-choose class="stack-sm">
        ${selectField({ label: 'Decoder', name: 'decoder', id: 'bridge-choose', value: '',
          hint: 'Choose an existing decoder only if it is this same device. A decoder that another laptop uses needs its own.',
          options: [...decoders.map((d) => ({ value: d.id, label: d.name, dataName: d.name })), { value: '', label: 'A new decoder' }] })}
        ${textField({ label: 'Name for the new decoder', name: 'name', id: 'bridge-choose-name', maxlength: 60 })}
        <button type="submit" class="btn btn-primary">Use this decoder</button>
      </form>
    </section>
    <section data-bridge-state="ready" hidden class="stack-md">
      <!-- (today's ready section, unchanged: views/bridge.js:60-72) -->
    </section>
    <section data-bridge-state="disconnected" hidden class="card-static stack-md">
      <p class="status status-warning">Decoder disconnected.</p>
      <p data-bridge-gap hidden>Crossings while it is unplugged are lost, and each car's lap starts over when you connect again.</p>
      ${connect('Connect again', 'last')}
    </section>
    <p class="status status-error" role="alert" data-bridge-error hidden></p>
  </div>
  </tl-bridge>
</div>`,
  });
}
```

Import `selectField` and `textField` from `./form-parts.js`. In `server/views/form-parts.js`, `selectField` gains a `hint` (rendered and described as `textField` does) and an optional `dataName` per option:

```js
export function selectField({ label, name, options, value = '', error = null, labelHidden = false, hint = null, id }) {
  const message = errorFor(error, name);
  const described = [message ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ');
  return html`<div class="field">
  <label for="${id}"${labelHidden ? html` class="visually-hidden"` : null}>${label}</label>
  <select id="${id}" name="${name}"${message ? html` aria-invalid="true"` : null}${described ? html` aria-describedby="${described}"` : null}>
    ${options.map((o) => html`<option value="${o.value}"${o.dataName === undefined ? null : html` data-name="${o.dataName}"`}${o.value === value ? html` selected` : null}>${o.label}</option>`)}
  </select>${hint ? html`<p class="field-hint" id="${id}-hint">${hint}</p>` : null}
  ${message ? html`<p class="field-error" id="${id}-error">${message}</p>` : null}
</div>`;
}
```

The hint sits on the `</select>` line, so for every existing caller (no hint, no `dataName`: `views/setup.js:28`, `:70`) the output is byte for byte today's. Pin it **before** changing `selectField`: add to `test/views.test.js` a test that renders today's `selectField({ id: 'x', label: 'Direction', name: 'direction', options: [{ value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Counter-clockwise' }], value: 'cw' })` and one with `error: { field: 'direction', message: 'Pick one.' }`. Each asserts `String(…)` equals the exact string today's code produces: run it once, copy the output into the test as a literal, and check that it passes. After the change, both must still pass unchanged.

Keep today's `unpaired` and `ready` sections byte for byte; the comments above only stand in for them in this plan. The `not-tinylap` section is gone. Update the header comment (`:5-7`): the server renders every state, for both pickers; without JavaScript, or without Web Serial and WebHID, the page says what the bridge needs.

- [ ] **Step 4: Run `bridge-pages.test.js`, `store.test.js`, `glossary.test.js`, `csp.test.js`, `test/views.test.js` and the setup page tests; expect PASS.** Then run the browser bridge files. `bridge.test.js:41` and `:50` still match `/needs Chrome or Edge/`. The step-three E-tests still click the first `[data-bridge-connect]`, which is Connect decoder.
- [ ] **Step 5: Look at the page.** Use the `frontend-design` skill. Open `/personal/bridge?simulate=fast` at 390×844 and 1280×800. The two buttons wrap cleanly with no horizontal scroll. The notes read as palace status lines. If the two inline buttons need a gap, add one rule in `app.css` next to the bridge rules, with palace spacing tokens only.
- [ ] **Step 6: Checks, then commit**

```bash
git add apps/timing/server apps/timing/test/server apps/timing/public/app.css
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): the bridge page offers an easylap, a choose form, and says what a replug costs"
```

---

### Task 11: `tl-bridge`: two pickers, `?simulate` models, listening, the gap note

**UI task: use the `frontend-design` skill.** The element shows server sections and sets text, `hidden` and `disabled` only; it never builds markup.

**Files:**
- Modify: `apps/timing/public/elements/bridge.js` (imports and module constants `:21-27`, `deviceOf` `:54-62`, `STATE_TEXT` `:64-70`, `pickPort` `:72-81`, the Run typedef `:83-93`, `start` `:102-114`, `reset` `:128-138`, `handleEvent` `:140-160`, `show` `:201-206`, `connect` `:256-287`, `pair` `:338`), `apps/timing/test/browser/bridge.test.js:50-59`
- Create: `apps/timing/test/browser/decoders.test.js`

**Interfaces:**
- Consumes:
  - `serialTransport`, `hidTransport`, `EASYLAP_FILTER`, `zroundProtocol`, `robitronicProtocol` (Task 5);
  - `simulation`, `simulatedDevice` (Tasks 3–4);
  - `Bridge` with `link`, `openDelayMs`, `kind`, `mismatches`, and the `noise` event (Tasks 7–8);
  - the markup of Task 10.
- Produces: `connect(run, which: 'serial' | 'hid' | 'last')`, and `run.transport`. Task 12 extends `connect` and the Run.

- [ ] **Step 1: Write the failing browser tests**

In `test/browser/bridge.test.js:53`, the init script becomes `delete Navigator.prototype.serial; delete Navigator.prototype.hid;`, and the test is renamed `'without Web Serial or WebHID, the notice stays and no button is offered'`.

```js
// apps/timing/test/browser/decoders.test.js
// (AGPL header)

// Plain ZRound decoders and EasyLaps on the bridge page (decoders spec §6.2, D1–D14).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from '../server/helpers.js';
import { openBrowser, pageAs } from './browser.js';

let app;
let browser;

before(async () => {
  app = await startTiming();
  browser = await openBrowser();
});
after(async () => {
  await browser?.close();
  await app?.close();
});

/** A member of their own, so each test starts with an empty personal space. */
async function fresh(t, options = {}) {
  const member = await app.login(await app.signUp('Ana'));
  const space = (await (await app.api(member, 'GET', '/auth/me')).json()).workspaces[0].id;
  const who = await pageAs(browser, app, member, options);
  t.after(() => who.context.close());
  return { ...who, member, space };
}

/** navigator.hid with one device to pick, built in the page from the fake HID device and the EasyLap model. */
const HID = (options) => {
  const hid = new EventTarget();
  /** @type {any} */ (window).__picks = 0;
  Object.defineProperty(navigator, 'hid', {
    configurable: true,
    value: Object.assign(hid, {
      requestDevice: async () => {
        /** @type {any} */ (window).__picks += 1;
        if (options.none) return [];
        const { fakeHidDevice } = await import('/public/sim/hid-device.js');
        const { easylapModel } = await import('/public/sim/models/easylap.js');
        const device = fakeHidDevice(easylapModel({ lapMs: 2000, corrupt: Boolean(options.corrupt) }), { hid, failOpen: Boolean(options.failOpen) });
        /** @type {any} */ (window).__device = device;
        return [device];
      },
    }),
  });
};

/** navigator.serial whose picks are silent ports, counted in window.__picks. */
const SILENT_SERIAL = () => {
  /** @type {any} */ (window).__picks = 0;
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: { requestPort: async () => {
      /** @type {any} */ (window).__picks += 1;
      return { readable: new ReadableStream(), writable: new WritableStream(), open: async () => {}, close: async () => {}, getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }) };
    } },
  });
};

test('with WebHID only, just Connect EasyLap is offered, and the note says USB decoders can\'t be reached', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(() => { delete Navigator.prototype.serial; });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), false);
  assert.equal(await page.getByText("This browser can't reach USB decoders, only an EasyLap.").isVisible(), true);
  assert.equal(await page.getByText("This browser can't reach an EasyLap, only other USB decoders.").isVisible(), false);
  assert.deepEqual(errors, []);
});

test('D7: a device that says nothing is listening, not an error, and Try another device opens one picker', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(SILENT_SERIAL);
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByText('Connected, but nothing has come from this device yet.').waitFor({ timeout: 20_000 });
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: 'Try another device' }).click();
  await page.waitForFunction(() => /** @type {any} */ (window).__picks === 2);
  assert.deepEqual(errors, []);
});

test('D8: under ?simulate=easylap, Connect decoder opens nothing and shows no error', async (t) => {
  const { page, errors } = await fresh(t);
  await page.goto('/personal/bridge?simulate=easylap');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), true);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(errors, []);
});

test('D11: a closed HID picker is no error, and Connect stays', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(HID, { none: true });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.waitForFunction(() => /** @type {any} */ (window).__picks === 1);
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Connect EasyLap' }).isVisible(), true);
  assert.deepEqual(errors, []);
});

test('D12: an EasyLap that can\'t be opened shows the error as an alert, and Connect stays', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(HID, { failOpen: true });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('alert').filter({ hasText: /denied/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect EasyLap' }).isVisible(), true);
});

test('D13: an EasyLap whose frames all fail the checksum says its data can\'t be read', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(HID, { corrupt: true });
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByText("Data is coming, but it can't be read. Report this device.").waitFor({ timeout: 20_000 });
  assert.equal(await page.getByText('Connected, but nothing has come from this device yet.').isVisible(), false);
});
```

(D13's page logs a `console.warn`, not an error, so `errors` stays clean. The test doesn't assert on it.)

- [ ] **Step 2: Run both files; expect FAIL.**
- [ ] **Step 3: Implement** in `public/elements/bridge.js`:
  - **Imports and constants**, replacing `:21-27`:

```js
import { Bridge, sendOutbox } from '../bridge.js';
import { formatLap } from '../format.js';
import { EASYLAP_FILTER, hidTransport } from '../link/hid.js';
import { robitronicProtocol } from '../link/robitronic.js';
import { serialTransport } from '../link/serial.js';
import { zroundProtocol } from '../link/zround.js';
import { openOutbox } from '../outbox.js';
import { simulatedDevice, simulation } from '../sim/models.js';

const sim = simulation(location.search);
/** Where simulated EasyLaps report a disconnect. */
const simHid = new EventTarget();
const has = { serial: 'serial' in navigator, hid: 'hid' in navigator };
const supported = has.serial || has.hid || sim !== null;
/** Opening a serial port resets an Arduino-based decoder: give it this long (decoders spec §2.4, C2). */
const SERIAL_OPEN_DELAY_MS = 1500;
const BROWSER_ASSIGNED = new Set(['zround', 'easylap']);
```

  - **Remove `deviceOf`** (`:54-62`). Its comment moves to the Run typedef: a device is its USB chip.
  - **`STATE_TEXT`:**

```js
const STATE_TEXT = {
  connect: 'Ready to connect.',
  connecting: 'Talking to the decoder.',
  listening: 'Connected. Nothing from the device yet.',
  unpaired: 'The decoder is not paired yet.',
  choose: 'Choose which decoder this is.',
  disconnected: 'Decoder disconnected.',
};
```

  - **`pickPort` becomes `pick`:**

```js
/**
 * The picker for `which`; closing it is a choice, not an error (decoders spec §5.4). Under ?simulate,
 * the model's own transport gets a fresh simulated device, and the other acts as a closed picker.
 * @param {'serial' | 'hid'} which
 */
async function pick(which) {
  if (sim) {
    if (sim.transport !== which) return null;
    const device = simulatedDevice(sim, { hid: simHid });
    return which === 'serial' ? serialTransport(device) : hidTransport(device, { hid: simHid });
  }
  try {
    if (which === 'serial') return serialTransport(await /** @type {any} */ (navigator).serial.requestPort());
    const [device] = await /** @type {any} */ (navigator).hid.requestDevice({ filters: [EASYLAP_FILTER] });
    return device ? hidTransport(device) : null;
  } catch (caught) {
    if (/** @type {any} */ (caught)?.name === 'NotFoundError') return null;
    throw caught;
  }
}
```

  - **The Run typedef** gains `transport: 'serial' | 'hid' | null`, the last transport, for "Connect again". In `start()`, the run literal gains `transport: null`. After `this.reset(run);` add:

```js
    for (const which of /** @type {const} */ (['serial', 'hid'])) {
      const missing = !sim && !has[which];
      this.$(run, `[data-bridge-connect="${which}"]`).hidden = missing;
      this.$(run, `[data-bridge-missing="${which}"]`).hidden = !missing;
    }
```

  - **`reset(run)`** gains, at its end:

```js
    for (const which of ['serial', 'hid']) {
      this.$(run, `[data-bridge-connect="${which}"]`).hidden = false;
      this.$(run, `[data-bridge-missing="${which}"]`).hidden = true;
    }
    this.$(run, '[data-bridge-listening]').hidden = false;
    this.$(run, '[data-bridge-unreadable]').hidden = true;
    this.$(run, '[data-bridge-gap]').hidden = true;
```

  - **`handleEvent`, click branch:** `this.connect(run, /** @type {any} */ (button).dataset.bridgeConnect || 'serial').then(…)`, with the same handlers as today.
  - **`show(run, state)`** becomes:

```js
  show(run, state) {
    for (const section of /** @type {NodeListOf<HTMLElement>} */ (run.root.querySelectorAll('[data-bridge-state]'))) section.hidden = section.dataset.bridgeState !== state;
    if (state === 'listening') this.unreadable(run);
    if (state === 'disconnected') this.$(run, '[data-bridge-gap]').hidden = !BROWSER_ASSIGNED.has(run.bridge?.kind);
    if (state === 'ready') this.update(run);
    else this.announce(run, STATE_TEXT[state] ?? '');
  }

  /** In listening: say so when data comes but fails its checksum (R8). @param {Run} run */
  unreadable(run) {
    const bad = (run.bridge?.mismatches ?? 0) > 0;
    this.$(run, '[data-bridge-listening]').hidden = bad;
    this.$(run, '[data-bridge-unreadable]').hidden = !bad;
  }
```

  - **`connect(run, which)`:**

```js
  /** @param {Run} run @param {'serial' | 'hid' | 'last'} which */
  async connect(run, which) {
    const chosen = which === 'last' ? run.transport ?? 'serial' : which;
    const transport = await pick(chosen);
    if (run !== this.run) return;
    if (!transport) return;
    run.transport = chosen;
    if (run.made && run.made.device !== transport.device) this.forget(run);
    await run.bridge?.close();
    const outbox = await openOutbox();
    if (run !== this.run) return;
    const protocol = chosen === 'hid' ? robitronicProtocol() : zroundProtocol();
    const next = new Bridge({ link: { transport, protocol }, outbox, post, openDelayMs: sim || chosen === 'hid' ? 0 : SERIAL_OPEN_DELAY_MS });
    next.addEventListener('state', () => {
      if (run.bridge === next) this.show(run, next.state === 'idle' ? 'connecting' : next.state);
    });
    next.addEventListener('noise', () => {
      if (run.bridge === next && next.state === 'listening') this.unreadable(run);
    });
    // (the outbox, online and passing listeners, run.bridge = next, this.show(run, 'connecting') and the try/catch: unchanged)
  }
```

  - **`pair`:** `run.made = { ...made, device: run.bridge.device };` (was `deviceOf(run.bridge.port)`).
  - **The header comment:** "Web Serial ↔ the server" becomes "Web Serial or WebHID ↔ the server", and "Without #bridge, or without Web Serial and ?simulate" becomes "Without #bridge, or without Web Serial, WebHID and ?simulate".
- [ ] **Step 4: Run `decoders.test.js`, `bridge.test.js` and `bridge-element.test.js` (browser); expect PASS.** The replug tests of `bridge.test.js:265-284` now pay a 1.5 s open delay (they use the real path), which their default timeouts cover.
- [ ] **Step 5: Look at the page.** Use the `frontend-design` skill: check the listening and disconnected sections at 390×844 and 1280×800, with the gap note shown.
- [ ] **Step 6: Checks, then commit**

```bash
git add apps/timing/public/elements/bridge.js apps/timing/test/browser/decoders.test.js apps/timing/test/browser/bridge.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): connect a decoder or an easylap, and listen to a quiet one"
```

---

### Task 12: `tl-bridge`: the choose form, the remembered choice, "in use", and the run guards

**UI task: use the `frontend-design` skill.** The heading, the kind sentence and the option texts are set as `textContent`. Options are removed, never built.

**"In use" and the server's time** (spec §2.4, §3.2, R5). "Seen in the last 2 minutes" is measured against the GET answer's `Date` header, never the laptop's clock. The GET goes through `fetch` itself rather than `api()`, so the headers are at hand, with `AbortSignal.timeout(3000)`: a GET that hangs (a captive portal, a stalled server) is given up after 3 s and handled as a failed one (F3), so Connect never waits on it. No API change.

**D4's reach** (spec D4, R6). With one GET per connect, D4 covers a decoder removed *before* Connect: its option goes. A decoder removed after this connect's GET can't be seen on this connect; the submit's "That decoder was removed. Choose another." check stays as a safeguard, and such a decoder's passings 404 and are dropped, as for any removed decoder (§3.3).

**Files:**
- Modify: `apps/timing/public/elements/bridge.js` (imports, Run, `start`, `reset`, `handleEvent` submit branch, `connect`, new `fillChoose`, `resetChoose`, `choose`), `apps/timing/test/browser/decoders.test.js` (append), `apps/timing/test/browser/bridge-element.test.js` (append E3c, E4d, E6c)

**Interfaces:**
- Consumes: `openDevices` (Task 9); `bridge.assign`, `bridge.device`, `bridge.kind`, the `identity-changed` event (Task 7); the choose markup (Task 10).
- Produces: the Run gains `list: { decoders: { id, name, lastSeenAt }[], serverNow: number | null } | null`, `remembered: string | null` and `devices`.

- [ ] **Step 1: Write the failing browser tests.** Append to `decoders.test.js`:

```js
/** Captures the newest readable's controller, so window.__unplug() pulls the cable (as bridge.test.js:229-235). */
const UNPLUG = () => {
  const R = window.ReadableStream;
  window.ReadableStream = class extends R {
    constructor(source, ...rest) {
      super(source && { ...source, start: (c) => { /** @type {any} */ (window).__unplug = () => c.close(); return source.start?.(c); } }, ...rest);
    }
  };
};

/** Requests to the decoder and workspace APIs, from now on. */
function apiRequests(page) {
  const seen = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (/^\/(decoders|workspaces)\//.test(pathname)) seen.push(`${r.method()} ${pathname}`);
  });
  return seen;
}

const ZROUND = '/personal/bridge?simulate=zround&speed=fast';
/** The simulated plain decoder's device key: its FTDI chip. */
const ZROUND_DEVICE = 'serial:1027:24577';

/** Connects the simulated plain decoder and waits for the choose form. */
async function toChoose(page, heading = 'Which decoder is this?') {
  await page.getByRole('button', { name: /^Connect (decoder|again)$/ }).first().click();
  await page.getByRole('heading', { name: heading }).waitFor({ timeout: 30_000 });
}

/** Seeds this browser's remembered choice through its module. */
const remember = (page, space, decoder) => page.evaluate(async ([w, d, id]) => {
  const { openDevices } = await import('/public/devices.js');
  await (await openDevices()).remember(w, d, id);
}, [space, ZROUND_DEVICE, decoder]);

const decoderNamed = (space, name) => app.store.decoders(space).find((d) => d.name === name);

test('D1: a plain ZRound decoder is chosen as a new decoder and forwards; the browser keeps only { decoder }', async (t) => {
  const { page, errors, space } = await fresh(t);
  await page.goto(ZROUND);
  await toChoose(page);
  assert.equal(await page.locator('[data-bridge-kind]').innerText(), "This decoder speaks plain ZRound, so it can't keep a pairing. This browser remembers which decoder it is for your personal space.");
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.locator('[data-bridge-preview] li').first().waitFor({ timeout: 30_000 });
  assert.deepEqual(app.store.decoders(space).map((d) => d.name), ['Gate']);
  assert.ok(app.engine.snapshot(space).crossings.length > 0);
  const records = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('tinylap-bridge-devices');
    open.onsuccess = () => { const all = open.result.transaction('devices').objectStore('devices').getAll(); all.onsuccess = () => resolve(all.result); all.onerror = () => reject(all.error); };
    open.onerror = () => reject(open.error);
  }));
  assert.deepEqual(records, [{ decoder: decoderNamed(space, 'Gate').id }]);
  assert.deepEqual(errors, []);
});

test('D2: a remembered decoder is confirmed, not forwarded silently', async (t) => {
  const { page, errors, space } = await fresh(t);
  await page.addInitScript(UNPLUG);
  await page.goto(ZROUND);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  await page.evaluate(() => /** @type {any} */ (window).__unplug());
  await page.getByRole('button', { name: 'Connect again' }).waitFor();
  const seen = apiRequests(page);
  await toChoose(page, 'Is this Gate?');
  const gate = decoderNamed(space, 'Gate');
  assert.equal(await page.locator('#bridge-choose').inputValue(), gate.id);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Use this decoder');
  await page.waitForTimeout(500);
  assert.deepEqual(seen.filter((r) => r.endsWith('/passings')), [], 'nothing is posted before the click');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  assert.deepEqual(seen.filter((r) => r.startsWith('POST /workspaces/')), []);
  assert.deepEqual(errors, []);
});

test('D3: a remembered decoder removed on the server is not offered, and gets no passing', async (t) => {
  const { page, member, space } = await fresh(t);
  await page.addInitScript(UNPLUG);
  await page.goto(ZROUND);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Gate', { exact: true }).first().waitFor();
  const gate = decoderNamed(space, 'Gate');
  await page.locator('[data-bridge-outbox]', { hasText: /^0$/ }).waitFor({ timeout: 30_000 });
  assert.equal((await app.api(member, 'DELETE', `/workspaces/${space}/decoders/${gate.id}`)).status, 204);
  await page.evaluate(() => /** @type {any} */ (window).__unplug());
  const seen = apiRequests(page);
  await toChoose(page);
  assert.equal(await page.locator(`#bridge-choose option[value="${gate.id}"]`).count(), 0);
  await page.waitForTimeout(500);
  assert.deepEqual(seen.filter((r) => r === `POST /decoders/${gate.id}/passings`), []);
});

// D4 covers a decoder removed before Connect only (see the note at the top of this task).
test('D4: an existing decoder can be chosen without making one; one removed before Connect is not offered', async (t) => {
  const { page, member, space } = await fresh(t);
  const old = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Old' })).json();
  const gone = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name: 'Gone' })).json();
  await page.goto(ZROUND);
  await app.api(member, 'DELETE', `/workspaces/${space}/decoders/${gone.id}`);
  const seen = apiRequests(page);
  await toChoose(page);
  assert.equal(await page.locator(`#bridge-choose option[value="${gone.id}"]`).count(), 0, 'its option goes');
  await page.locator('#bridge-choose').selectOption(old.id);
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Old', { exact: true }).first().waitFor();
  assert.deepEqual(seen.filter((r) => r.startsWith('POST /workspaces/')), []);
});

/** Makes "Busy" and "Mine", both seen just now over the cable, and remembers "Mine" for the simulated device. */
async function busyAndMine(page, member, space) {
  const make = async (name) => {
    const d = await (await app.api(member, 'POST', `/workspaces/${space}/decoders`, { name })).json();
    assert.equal((await app.api(member, 'POST', `/decoders/${d.id}/passings`, { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1000 }] })).status, 200);
    return d;
  };
  const busy = await make('Busy');
  const mine = await make('Mine');
  await page.goto(ZROUND);
  await remember(page, space, mine.id);
  await page.reload();
  return { busy, mine };
}

test('D5: a decoder seen in the last 2 minutes is in use, by the server\'s clock; the remembered one says so but stays enabled', async (t) => {
  const { page, member, space } = await fresh(t);
  await page.addInitScript(() => { const real = Date.now; Date.now = () => real() + 600_000; });
  const { busy, mine } = await busyAndMine(page, member, space);
  await toChoose(page, 'Is this Mine?');
  const option = (id) => page.locator(`#bridge-choose option[value="${id}"]`);
  assert.equal(await option(busy.id).innerText(), 'Busy (in use)');
  assert.equal(await option(busy.id).isDisabled(), true);
  assert.equal(await option(mine.id).innerText(), 'Mine (in use)');
  assert.equal(await option(mine.id).isDisabled(), false);
  assert.equal(await page.locator('#bridge-choose').inputValue(), mine.id);
});

test('D14: when the connect GET fails, the options stay as rendered, the remembered one is preselected, and the choice still works', async (t) => {
  const { page, member, space } = await fresh(t);
  const { busy, mine } = await busyAndMine(page, member, space);
  await page.route('**/workspaces/*/decoders', (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{"status":503,"detail":"Down."}' }) : route.continue()));
  const seen = apiRequests(page);
  await toChoose(page, 'Is this Mine?');
  const option = (id) => page.locator(`#bridge-choose option[value="${id}"]`);
  assert.equal(await option(busy.id).innerText(), 'Busy');
  assert.equal(await option(busy.id).isDisabled(), false);
  assert.equal(await page.locator('#bridge-choose').inputValue(), mine.id);
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Mine', { exact: true }).first().waitFor();
  assert.deepEqual(seen.filter((r) => r.startsWith('POST /workspaces/')), []);
});

test('D14b: a connect GET that never answers is given up after 3 s, as a failed one', async (t) => {
  const { page, member, space } = await fresh(t);
  const { mine } = await busyAndMine(page, member, space);
  await page.route('**/workspaces/*/decoders', (route) => (route.request().method() === 'GET' ? new Promise(() => {}) : route.continue()));
  await toChoose(page, 'Is this Mine?');
  assert.equal(await page.locator('#bridge-choose').inputValue(), mine.id);
  // A TinyLap decoder still reaches its pairing form: the 3 s cap plus its handshake.
  await page.goto('/personal/bridge?simulate=fast');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Pair this decoder' }).waitFor({ timeout: 8000 });
});

test('D9: a replug says what it costs, and the passings after it carry a new boot', async (t) => {
  const { page, space } = await fresh(t);
  await page.addInitScript(UNPLUG);
  const boots = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/passings')) boots.push(JSON.parse(r.postData() ?? '{}').boot);
  });
  await page.goto(ZROUND);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Gate');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.locator('[data-bridge-preview] li').first().waitFor({ timeout: 30_000 });
  const starts = () => app.engine.snapshot(space).crossings.filter((c) => c.lapMs === null).length;
  const startsBefore = starts();
  await page.evaluate(() => /** @type {any} */ (window).__unplug());
  await page.getByText("Crossings while it is unplugged are lost, and each car's lap starts over when you connect again.").waitFor();
  const before = new Set(boots);
  await toChoose(page, 'Is this Gate?');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-bridge-preview] li').length > n, await page.locator('[data-bridge-preview] li').count(), { timeout: 30_000 });
  await page.waitForTimeout(1000);
  assert.ok(boots.some((b) => !before.has(b)), 'a new boot after the replug');
  assert.ok(starts() > startsBefore, 'each car starts over');
});

test('D10: noise (double reads and garbage) makes no page error, and laps still show', async (t) => {
  const { page, errors } = await fresh(t);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => {
      const { fakeSerialPort } = await import('/public/sim/serial-port.js');
      const { zroundModel } = await import('/public/sim/models/zround.js');
      return fakeSerialPort(zroundModel({ lapMs: 2000, noise: { double: 0.5, garbage: 0.5 } }));
    } } });
  });
  await page.goto('/personal/bridge');
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Noisy');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.locator('[data-bridge-preview] li', { has: page.locator('.bridge-code + .num') }).first().waitFor({ timeout: 40_000 });
  assert.deepEqual(errors, []);
});

test('Review focus 3: "Use this decoder" clicked twice makes one decoder', async (t) => {
  const { page, space } = await fresh(t);
  await page.goto(ZROUND);
  await toChoose(page);
  await page.getByLabel('Name for the new decoder').fill('Once');
  await page.getByRole('button', { name: 'Use this decoder' }).dblclick();
  await page.getByText('Forwarding from Once', { exact: true }).first().waitFor();
  assert.deepEqual(app.store.decoders(space).map((d) => d.name), ['Once']);
});
```

In `bridge-element.test.js`, `before` becomes `app = await startTiming({ limits: { pair: 100 } });`: its one member already pairs 10 decoders, the hourly limit (`server/app.js:8`), so E4d's and E6c's POSTs would get a 429. Then append (the file has `COUNT`, `shownIn` and `apiRequests`):

```js
test('E3c: a removal while the decoder-list GET is held opens nothing', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  await page.addInitScript(COUNT);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/workspaces/*/decoders', async (route) => { if (route.request().method() === 'GET') await held; await route.continue(); });
  await page.goto('/personal/bridge?simulate=zround&speed=fast');
  await page.getByRole('button', { name: 'Connect decoder' }).waitFor();
  await page.evaluate(() => {
    const el = document.querySelector('tl-bridge');
    window.__el = el;
    /** @type {HTMLElement} */ (el.querySelector('[data-bridge-connect]')).click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__el.remove());
  release();
  await page.waitForTimeout(1000);
  assert.equal((await counts(page)).opened, 0);
  assert.deepEqual(await page.evaluate(`(${shownIn})(window.__el)`), ['connect']);
  assert.deepEqual(errors, []);
});

test('E4d: a move puts the choose form back as the server rendered it', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  const busy = await (await app.api(member, 'POST', `/workspaces/${personal}/decoders`, { name: 'Busy' })).json();
  await app.api(member, 'POST', `/decoders/${busy.id}/passings`, { boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1000 }] });
  await page.goto('/personal/bridge?simulate=zround&speed=fast');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(`#bridge-choose option[value="${busy.id}"]`).isDisabled(), true);
  await page.evaluate(() => document.querySelector('main .container').append(document.querySelector('tl-bridge')));
  await page.getByRole('button', { name: 'Connect decoder' }).waitFor();
  const form = await page.evaluate(() => ({
    heading: document.querySelector('[data-bridge-choose-heading]').textContent,
    options: [...document.querySelectorAll('#bridge-choose option')].map((o) => [o.textContent, /** @type {HTMLOptionElement} */ (o).disabled, o.getAttribute('data-name')]),
    value: /** @type {HTMLSelectElement} */ (document.querySelector('#bridge-choose')).value,
  }));
  assert.equal(form.heading, 'Which decoder is this?');
  assert.ok(form.options.every(([text, disabled, name]) => !disabled && (name === null || text === name)));
  assert.equal(form.value, '');
  assert.deepEqual(errors, []);
});

test('E6c: a choose POST that lands after a move writes nothing: no remember, no assign', async (t) => {
  const { context, page, errors } = await pageAs(browser, app, member);
  t.after(() => context.close());
  let release;
  let reached;
  const held = new Promise((resolve) => { release = resolve; });
  const posted = new Promise((resolve) => { reached = resolve; });
  await page.route('**/workspaces/*/decoders', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    reached();
    return held.then(() => route.continue());
  });
  await page.goto('/personal/bridge?simulate=zround&speed=fast');
  await page.getByRole('button', { name: 'Connect decoder' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 30_000 });
  await page.getByLabel('Name for the new decoder').fill('Late plain');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await posted;
  await page.evaluate(() => document.querySelector('main .container').append(document.querySelector('tl-bridge')));
  const finished = page.waitForEvent('requestfinished', (r) => r.method() === 'POST');
  release();
  const request = await finished;
  assert.equal((await request.response()).status(), 201, 'the held POST made the decoder');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('button', { name: 'Connect decoder' }).isVisible(), true);
  assert.equal(await page.getByText('Forwarding from Late plain').count(), 0);
  const remembered = await page.evaluate(async (w) => (await (await import('/public/devices.js')).openDevices()).recall(w, 'serial:1027:24577'), personal);
  assert.equal(remembered, null);
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 2: Run both files; expect FAIL** (there is no choose flow yet).
- [ ] **Step 3: Implement** in `public/elements/bridge.js`:
  - Imports: add `import { openDevices } from '../devices.js';`. Constants: add

```js
/** A decoder seen this recently, by the server's clock, is in use elsewhere (decoders spec §3.2, I7). */
const IN_USE_MS = 2 * 60_000;
/** What a decoder without its own pairing is, in the choose form (decoders spec §4.2). */
const KIND_TEXT = {
  zround: (where) => `This decoder speaks plain ZRound, so it can't keep a pairing. This browser remembers which decoder it is for ${where}.`,
  easylap: (where) => `An EasyLap can't keep a pairing. This browser remembers which decoder it is for ${where}.`,
};

/** The decoder-list GET gives up after this long, as a failed one (F3). */
const LIST_TIMEOUT_MS = 3000;

/**
 * The club's decoders and the server's time from the answer's Date header, or null when they can't be
 * fetched in time (decoders spec §2.4, R6, F3). serverNow is null without a readable Date header: then
 * nothing is marked in use.
 * @param {HTMLElement} root
 */
async function decoderList(root) {
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(root.dataset.workspace ?? '')}/decoders`, {
      credentials: 'same-origin', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const { decoders } = await res.json();
    const date = Date.parse(res.headers.get('date') ?? '');
    return { decoders, serverNow: Number.isNaN(date) ? null : date };
  } catch {
    return null;
  }
}
```

  - The Run typedef and the literal in `start()` gain `list: null, remembered: null, devices: null`.
  - `reset(run)` gains `this.resetChoose(run);`, and add:

```js
  /** Puts the choose form back as the server rendered it (R6). Removed options stay removed: their decoder is gone. @param {Run} run */
  resetChoose(run) {
    const form = /** @type {HTMLFormElement} */ (this.$(run, '[data-bridge-choose]'));
    this.$(run, '[data-bridge-choose-heading]').textContent = 'Which decoder is this?';
    const select = /** @type {HTMLSelectElement} */ (form.elements.namedItem('decoder'));
    for (const option of select.options) {
      option.disabled = false;
      if (option.value) option.textContent = option.dataset.name ?? option.textContent;
    }
    select.value = '';
    /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]')).disabled = false;
  }
```

  - `handleEvent`, submit branch: after the `[data-bridge-pair]` case, add

```js
      else if (form instanceof HTMLFormElement && form.matches('[data-bridge-choose]') && this.contains(form)) {
        event.preventDefault();
        void this.choose(run, form);
      }
```

  - In `connect`, replace `const outbox = await openOutbox(); if (run !== this.run) return;` with:

```js
    const [outbox, devices, list] = await Promise.all([openOutbox(), openDevices(), decoderList(run.root)]);
    if (run !== this.run) return;
    const remembered = await devices.recall(run.workspaceId, transport.device);
    if (run !== this.run) return;
    Object.assign(run, { devices, list, remembered });
```

  - In `connect`, the `state` listener becomes:

```js
    next.addEventListener('state', () => {
      if (run.bridge !== next) return;
      const state = next.state === 'idle' ? 'connecting' : next.state;
      if (state === 'choose') this.fillChoose(run);
      this.show(run, state);
      if (state === 'choose' && this.$(run, '#bridge-choose').value) /** @type {HTMLElement} */ (this.$(run, '[data-bridge-choose] button[type="submit"]')).focus();
    });
    next.addEventListener('identity-changed', () => {
      if (run === this.run) void run.devices.forget(run.workspaceId, next.device);
    });
```

  - Add `fillChoose` and `choose`:

```js
  /** Fills the choose form for this connect (decoders spec §3.2). @param {Run} run */
  fillChoose(run) {
    // A second connect in the same run starts from the server's form, not the last connect's marks.
    this.resetChoose(run);
    const form = /** @type {HTMLFormElement} */ (this.$(run, '[data-bridge-choose]'));
    const select = /** @type {HTMLSelectElement} */ (form.elements.namedItem('decoder'));
    const kind = this.$(run, '[data-bridge-kind]');
    kind.textContent = KIND_TEXT[run.bridge.kind](kind.dataset.where ?? 'this club');
    const { list } = run;
    if (list) {
      for (const option of [...select.options]) {
        if (!option.value) continue;
        const found = list.decoders.find((d) => d.id === option.value);
        if (!found) {
          option.remove();
          continue;
        }
        const inUse = list.serverNow !== null && found.lastSeenAt !== null && list.serverNow - found.lastSeenAt < IN_USE_MS;
        option.textContent = inUse ? `${option.dataset.name} (in use)` : option.dataset.name;
        option.disabled = inUse && option.value !== run.remembered;
      }
    }
    const known = Boolean(run.remembered) && [...select.options].some((o) => o.value === run.remembered);
    if (run.remembered && !known && list) void run.devices.forget(run.workspaceId, run.bridge.device);
    select.value = known ? run.remembered : '';
    this.$(run, '[data-bridge-choose-heading]').textContent = known ? `Is this ${select.selectedOptions[0].dataset.name}?` : 'Which decoder is this?';
  }

  /** "Use this decoder": an existing decoder, or a new one made on the server, then remembered and assigned. @param {Run} run @param {HTMLFormElement} form */
  async choose(run, form) {
    const bridge = run.bridge;
    if (!bridge) return;
    const select = /** @type {HTMLSelectElement} */ (form.elements.namedItem('decoder'));
    const name = String(/** @type {HTMLInputElement} */ (form.elements.namedItem('name')).value).trim();
    const submit = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    if (submit.disabled) return;
    if (!select.value && !name) {
      this.fail(run, new Error('A decoder name is 1 to 60 characters.'));
      return;
    }
    submit.disabled = true;
    try {
      let id = select.value;
      if (id) {
        // Defence in depth: fillChoose already removed what the connect's list no longer has.
        if (run.list && !run.list.decoders.some((d) => d.id === id)) {
          select.selectedOptions[0].remove();
          select.value = '';
          throw new Error('That decoder was removed. Choose another.');
        }
        run.names.set(id, select.selectedOptions[0].dataset.name ?? id);
      } else {
        const made = await api('POST', `/workspaces/${encodeURIComponent(run.workspaceId)}/decoders`, { name });
        if (run !== this.run) return;
        id = made.id;
        run.names.set(id, made.name);
      }
      await run.devices.remember(run.workspaceId, bridge.device, id);
      if (run !== this.run || run.bridge !== bridge) return;
      await bridge.assign(id);
      if (run === this.run) this.ok(run);
    } catch (caught) {
      if (run === this.run) this.fail(run, caught);
    } finally {
      // After a move the new run shares this button; its reset enabled it.
      if (run === this.run) submit.disabled = false;
    }
  }
```

  - The header comment gains a line on the choose form: a plain ZRound decoder or an EasyLap is chosen on every connect, and the browser remembers only which decoder a device was.
- [ ] **Step 4: Run `decoders.test.js` and `bridge-element.test.js`; expect PASS.** Then run all of `test:browser`.
- [ ] **Step 5: Look at the page.** Use the `frontend-design` skill: check the choose screen at 390×844 and 1280×800, with an "(in use)" option and the heading "Is this Gate?". The select and the hint read as palace fields. Focus is visible on "Use this decoder".
- [ ] **Step 6: Checks, then commit**

```bash
git add apps/timing/public/elements/bridge.js apps/timing/test/browser/decoders.test.js apps/timing/test/browser/bridge-element.test.js
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "feat(timing-app): choose which decoder a plain zround decoder or an easylap is"
```

---

### Task 13: EasyLap end to end, and `docs/timing.md`

**UI task: use the `frontend-design` skill** to check the EasyLap flow on the page.

**Files:**
- Modify: `apps/timing/test/browser/decoders.test.js` (append), `docs/timing.md`

**Interfaces:**
- Consumes: everything above. This task adds tests and docs; it should need no code change. If a test fails, fix the code in the task that owns it, and say so in the commit.

- [ ] **Step 1: Write the tests** (append to `decoders.test.js`):

```js
test('D6a: an EasyLap (?simulate=easylap) is chosen and forwards, with its 24-bit codes as hex', async (t) => {
  const { page, errors } = await fresh(t);
  await page.goto('/personal/bridge?simulate=easylap&speed=fast');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('[data-bridge-kind]').innerText(), "An EasyLap can't keep a pairing. This browser remembers which decoder it is for your personal space.");
  await page.getByLabel('Name for the new decoder').fill('Lap box');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Lap box', { exact: true }).first().waitFor();
  const code = page.locator('[data-bridge-preview] li .bridge-code').first();
  await code.waitFor({ timeout: 30_000 });
  assert.match(await code.innerText(), /^A1B2[CDE]$/);
  assert.deepEqual(errors, []);
});

test('D6b: the CP2110 is configured, then enabled, and a removal disables its UART', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(HID, {});
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  assert.deepEqual(await page.evaluate(() => /** @type {any} */ (window).__device.log.slice(0, 2)), [[0x50, 0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0x03, 0x00], [0x41, 0x01]]);
  await page.evaluate(() => document.querySelector('tl-bridge').remove());
  await page.waitForFunction(() => JSON.stringify(/** @type {any} */ (window).__device.log.at(-1)) === '[65,0]');
});

test('Review focus 5: an EasyLap unplugged while forwarding says so, with what a replug costs', async (t) => {
  const { page } = await fresh(t);
  await page.addInitScript(HID, {});
  await page.goto('/personal/bridge');
  await page.getByRole('button', { name: 'Connect EasyLap' }).click();
  await page.getByRole('heading', { name: 'Which decoder is this?' }).waitFor({ timeout: 20_000 });
  await page.getByLabel('Name for the new decoder').fill('Lap box');
  await page.getByRole('button', { name: 'Use this decoder' }).click();
  await page.getByText('Forwarding from Lap box', { exact: true }).first().waitFor();
  await page.evaluate(() => /** @type {any} */ (window).__device.unplug());
  await page.getByText('Decoder disconnected.').waitFor();
  assert.equal(await page.getByText("Crossings while it is unplugged are lost, and each car's lap starts over when you connect again.").isVisible(), true);
});
```

- [ ] **Step 2: Run `decoders.test.js`; expect PASS.** If one fails, fix the code in the task that owns it.
- [ ] **Step 3: Update `docs/timing.md`.** Add after "Over USB: ZRound, plus four TinyLap commands" (`:11-33`), keeping the existing tables:

```markdown
### The handshake

The bridge opens the port, waits 1.5 s (opening it resets Arduino-based decoders), and sends `%C&` every 500 ms until something in ZRound comes back. Then it sends `%TLHELLO&`, 300 ms after its last write, up to three times 700 ms apart. A `%TLID` makes it a TinyLap decoder for the rest of the connection. Every command is a multiple of 3 bytes, so firmware that reads 3 bytes at a time (RiCino) still sees each one whole.

### Plain ZRound decoders

A decoder that speaks ZRound but doesn't answer `%TLHELLO&` within 2.5 s is a plain ZRound decoder. It works fully over USB:

- The member says which decoder it is on the Bridge page, on every connect. The browser remembers the last choice for that USB chip and asks to confirm it.
- The bridge makes its boots: one at every connect, and a new one when its clock goes back, when it reports `%I&`, or when a passing comes more than 1.5 s before the latest one.
- If it sends nothing after the handshake, the bridge sends `%I&` (race start), up to three times 6 s apart, each after a new boot. Once the decoder sends a clock or a passing, the bridge writes nothing more to it.

A replug costs every car its current lap, and crossings while it is unplugged are lost.

## Over WebHID: an EasyLap (preview)

An EasyLap is a Silicon Labs CP2110 HID-to-UART bridge (`10C4:86B9`) in front of a decoder that speaks Robitronic binary at 38400 8N1:

- The bridge sets the UART with feature report `0x50` (`00 00 96 00 00 00 03 00`) and enables it with `0x41 01`.
- Frames are `[length, checksum, type, payload…]`, little-endian:
  - `0x84` is a passing: id u32, time in ms u32, hits, strength;
  - `0x83` is a heartbeat: time in ms u32 and four bytes.
- The transponder code is the id in upper-case hex.
- A frame whose CRC-8 (poly `0x07`, init `0xDE`, byte 1 read as 0) is wrong is skipped.
- The choice and the boots work as for a plain ZRound decoder. The bridge sends `03 B9 01` (start) only if no frame comes within 6 s.

Until a capture from a real device confirms the checksum and the id bytes, this support is a preview.

On Linux, WebHID needs a udev rule that lets your user open the device's hidraw node, and Web Serial needs the `dialout` group.
```

  Then change the ZRound section's last paragraph (`:33`): "If a `%T…&` clock comes in lower than the one before, the bridge sends `%TLHELLO&` again until the decoder answers, in case that `%TLID` got lost."
- [ ] **Step 4: Look at the EasyLap flow on the page** with the `frontend-design` skill (`?simulate=easylap&speed=fast`, 390×844 and 1280×800).
- [ ] **Step 5: Checks, then commit**

```bash
git add apps/timing/test/browser/decoders.test.js docs/timing.md
git -c user.email=1009814+jostsg@users.noreply.github.com commit -s -m "docs: plain zround decoders and the easylap, and their end-to-end tests"
```

---

### Task 14: The mutation pass, and the final checks

**UI task: use the `frontend-design` skill** for the final visual check.

**Files:** none changed for good. Each mutation is made, run against its catching test, and reverted.

- [ ] **Step 1: The mutation table** (spec §6.3). For each row:
  1. make the change;
  2. run the catching test file (the commands are in Global Constraints) and confirm it **fails**;
  3. `git checkout -- <file>` to revert it.

  Record each result in `$LOGS/mutations.txt` as `<row> — caught by <test> — FAIL as expected`. A mutation that no test catches is a gap: add the missing test to the owning task's file, and commit it as `test(timing-app): …`.

| # | Mutation (file) | Catching test |
|---|---|---|
| 1 | `<< 24` → `<< 32`, then `<< 16`, in `u32` (`packages/timing/robitronic.js`) | robitronic unit 4 |
| 2 | `ID_BYTES = 2` | robitronic unit 2 |
| 3 | resync `i += len` on a bad checksum; then no resync (`break`) | robitronic units 6, 7, 9 |
| 4 | push a bad-checksum frame to `out` | robitronic unit 8; the EasyLap checksum session test |
| 5 | CRC init `0x00`; then hash byte 1 too | robitronic unit 1 |
| 6 | `transponder` lower case; then `padStart(8, '0')` | robitronic unit 2 |
| 7 | `sendReport(bytes.length + 1, …)` (`public/link/hid.js`) | link: "configures the CP2110…"; the fake device rejects |
| 8 | enable (`0x41`) before config (`0x50`); then drop config | link test; D6b |
| 9 | `n = event.data.byteLength` | link: "reads the first reportId bytes" |
| 10 | drop `sendFeatureReport(0x41, [0])` in `close` | link test; D6b |
| 11 | `onDisconnect` ends on any device | link: "ends on its own disconnect only" |
| 12 | `listening` closes the port, or calls `#setOnline(false, …)` | adapted `bridge.test.js:85`; D7 |
| 13 | write `%TLHELLO&` right after `%C&` (no spacing); then no `%C&` retry | TinyLap handshake test; open-delay test; D1 |
| 14 | `#decide('zround')` on the first `alive` | TinyLap handshake test (no `choose`) |
| 15 | no `#raceStart`; `%I&` before `#newBoot`; `%I&` to TinyLap; `%I&` to a streaming decoder | waiting-for-start test (no `%I&`; the posted boot is `start.boot`); `%I&`-retried test, deaf case (the posted boot is the last `%I&`'s); TinyLap handshake test; free-running test |
| 16 | `#identity` ignored when `kind === 'zround'`; or a TinyLap re-hello falls back to `#windowOver` | late-`%TLID` test; once-TinyLap test |
| 17 | `#dropBrowserStamped` re-stamps, or skips the wait for `this.#flushing` | late-`%TLID` test (the outbox still holds 2 before `release()`; two posts after, the second with 9000) |
| 18 | `#set('listening')` after the last `%I&`; a write after streaming | `%I&` retried test; quiet-decoder test |
| 19 | `startMs` default 3000 | defaults test |
| 20 | `#syn` ignores `listenMs`; `#sendHello` ignores `this.kind` | listening-retry test; TinyLap handshake test (hello once) |
| 21 | hold clocks in `#held`; stamp held passings with `this.boot` at `assign()` time | held-passings tests |
| 22 | `assign()` outside `#chain` | one-chain test |
| 23 | `pair()` rejects while `kind === null` | `bridge.test.js:239` |
| 24 | no `#newBoot` on `reset`, clock back or passing back; then `MIN_LAP_MS` → `500` | ZRound boots test |
| 25 | reuse the boot across a connect (keep `boot` in `devices.js`) | reconnect test; D9 |
| 26 | `#write` without the `#closed` check | no-write-after-close test (`pair()` after `close()` writes nothing) |
| 27 | `fillChoose` preselects the remembered decoder and calls `assign` | D2 |
| 28 | `fillChoose` keeps options missing from the list | D3, D4 |
| 29 | `choosableDecoders` returns all decoders; `IN_USE_MS = 0` | `bridge-pages.test.js`; D5 |
| 30 | the remembered option exempt from "(in use)" | D5 |
| 31 | `choose` keeps the token, or POSTs for an existing choice | D4; `devices.test.js` |
| 32 | the missing-API rule hides `last` buttons, or never hides | WebHID-only test |
| 33 | drop the run guard after `decoderList`; after the choose POST | E3c; E6c |
| 34 | `resetChoose` not called from `reset` | E4d |
| 35 | `simulation('?simulate=fast')` → 8000 ms | every existing browser test (timeouts) |
| 36 | `choose` without `submit.disabled = true` | Review focus 3 (one decoder after a double click) |
| 37 | `assign()` without the disconnected check | Review focus 4 |
| 38 | no `%TLHELLO&` in `listening` (`#enterListening` without `#listenHello`) | the TinyLap-ignores-`%C&` test |
| 39 | `decoderList` without `AbortSignal.timeout` | D14b |
| 40 | `#dropBrowserStamped` waits for the flush without `flushWaitMs` | the hanging-flush test |
| 41 | in-use from `Date.now()`, not the `Date` header | D5 (the page's `Date.now` is moved 10 minutes ahead) |

  Covered by review only, as the spec says: the 500-passing cap on held passings, and the `console.warn` on the first checksum mismatch.
- [ ] **Step 2: Run every check** (Global Constraints, all four), from a clean tree.
- [ ] **Step 3: The final visual pass,** with the `frontend-design` skill, at 390×844 and 1280×800:
  - the Connect section, with both buttons, and with each missing-API note (delete `serial` or `hid` in DevTools);
  - listening, and listening for unreadable data;
  - choose, with "Is this Gate?", an "(in use)" option and an error under it;
  - ready;
  - disconnected, with the gap note.

  Nothing may scroll sideways, and focus must be visible.
- [ ] **Step 4: Commit any test added in Step 1** (if none, nothing to commit). Leave the branch for review; don't push or open a PR unless asked.
