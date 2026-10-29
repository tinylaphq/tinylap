# The bridge and the TinyLap decoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bridge forwards the decoder's `%TLLOG` lines to the server's log, reads on after a non-fatal serial error, drives a simulated TinyLap decoder that behaves as the firmware does, and checks Wi-Fi lengths in bytes before pairing.

**Architecture:** One `parseLog` and one `wifiError` in `packages/timing`, pinned to the firmware by two new sections of `zround-vectors.json`. Log lines ride in the existing ingest body as `logs`; the bridge keeps them in memory (not the outbox) and the server writes one JSON line each through `request.log`. The serial transport takes a new reader while `port.readable` isn't null and yields `null` at each gap, which resets the ZRound reader.

**Tech Stack:** Node 24 `node:test`, plain ES modules with JSDoc types (`tsc` checks them), Web Serial, Playwright browser tests, PlatformIO `native` env with Unity and ArduinoJson 7.4.3.

**Spec:** `docs/superpowers/specs/2026-10-28-bridge-tinylap-decoder-design.md`

## Global Constraints

- Package checks are three separate commands: `pnpm --filter <pkg> test`, then `pnpm --filter <pkg> lint`, then `pnpm --filter <pkg> typecheck`. Packages here: `@tinylap/timing` (packages/timing), `@tinylap/timing-app` (apps/timing), `@tinylap/tools` (tools). Firmware host tests: `pio test -e native` in `firmware/tinylap-decoder`.
- Browser tests: `caffeinate -dims pnpm --filter @tinylap/timing-app test:browser` (or one file: `pnpm --filter @tinylap/timing-app exec node --disable-warning=ExperimentalWarning --test --test-timeout=60000 test/browser/bridge.test.js`). Save the full output of a failing run to a file. New browser tests go in existing files and start no new browser.
- Commits: conventional, `git commit -s`, author email `1009814+jostsg@users.noreply.github.com` (check `git config user.email`; else `git -c user.email=1009814+jostsg@users.noreply.github.com commit -s …`). No AI attribution of any kind: no `Co-Authored-By`, no "Generated with".
- No agent uploads to a board, opens a real serial port, pushes, or merges.
- Task 6 touches UI (the pairing form): its implementer uses the `frontend-design` skill. UI is palace-ui plus `@tinylap/design` (`--tl-*` tokens), web platform first, enhancements are `tl-*` custom elements in the light DOM; no markup built in script that the server renders.
- Repo docs say how things work only: no people's names, no who-did-what, no dated events, no links to private docs.
- No change to what the firmware does (`firmware/**/src`, `lib`); only its native tests grow.
- No `setSignals`, no DTR or RTS changes anywhere (spec §6).
- No `maxlength` or `minlength` on the Wi-Fi fields in `views/bridge.js`.
- Exact values, from the spec: kind `[a-z]{1,16}`; key `[a-z][a-z0-9.]{0,31}`; value 0–32 characters of printable ASCII `!`–`~` except `%`, `&`, `=`, `"`, `\`; at most 48 fields, no key twice; the line `%`…`&` at most 512 bytes; 64 lines and 32 KiB of entries per batch; an entry at most 510 bytes; 600 lines per decoder per minute on the server; 256 lines held in the bridge; `logMaxWaitMs` = 10 s; `MAX_FAILURES_IN_A_ROW` = 20; Wi-Fi name 1–32 bytes, password empty, 8–63 bytes or 64 hex digits.

## Review Focus

1. **Lines of an earlier boot after a reboot** (their passings all sent, the new boot's passings flowing) must still go out, in a logs-only batch when the timer fires, never riding in the new boot's batches or sticking in the queue: Task 3's `lines of an earlier boot go logs-only, not with the new boot`.
2. **A Wi-Fi password marked invalid, then the Wi-Fi name cleared** must let Pair through: a stale custom validity would block the form's own submit forever. Task 6's `clearing the Wi-Fi name clears the password's message`.
3. **An entry measured in characters, not bytes:** 255 `é` (510 bytes) passes `readBatch`, 256 `é` (512 bytes) is refused, and `parseLog` rejects any non-ASCII line: Task 1's `log entries are measured in UTF-8 bytes`.
4. **A logs-only batch for a boot the server holds no passings of** answers `{ stored: 0, duplicates: 0, through: null }`, and the bridge takes that as sent, not as an error: Task 2's `a logs-only batch of a new boot answers through null` and Task 3's `a logs-only answer with through null drops the lines`.
5. **A `tick` at the very `now` of an `%I&`** must send no clock and no crossing of the old boot: Task 5's `a tick at the reset's now sends nothing of the old boot`.

---

### Task 1: The shared parser, limits and vectors

**Files:**
- Modify: `packages/timing/zround.js` (`parseLog`, `LOG_LINE_BYTES`, `parseMessage`'s `TLLOG` branch, `wifiError`, `WIFI_NAME_BYTES`, `WIFI_PASSWORD_BYTES`)
- Modify: `packages/timing/passing.js` (`readBatch`, `MAX_LOG_LINES`, `MAX_LOG_BYTES`, `MAX_LOG_ENTRY_BYTES`)
- Modify: `packages/timing/types.d.ts`
- Modify: `packages/timing/test/zround-vectors.json` (`logLines`, `wifi`), `packages/timing/test/zround.test.js`, `packages/timing/test/passing.test.js`

**Interfaces:**
- Produces (all exported through `index.js`):
  - `parseLog(text: string): { kind: string, fields: [string, string][] } | null`, where `text` is what follows `TLLOG ` up to `&`.
  - `LOG_LINE_BYTES = 512`; `MAX_LOG_LINES = 64`; `MAX_LOG_BYTES = 32 * 1024`; `MAX_LOG_ENTRY_BYTES = 510`.
  - `parseMessage('TLLOG <rest>')` → `{ type: 'log', line: rest }` when `parseLog(rest)` succeeds, else `unknown`.
  - `wifiError(ssid: string, password: string): 'Wi-Fi name too long' | 'Wi-Fi password length' | null`.
  - `WIFI_NAME_BYTES = Object.freeze({ min: 1, max: 32 })`, `WIFI_PASSWORD_BYTES = Object.freeze({ min: 8, max: 63 })`.
  - `readBatch` returns `batch: { boot, passings, logs: string[] }` (`logs` always an array, `[]` when absent).
  - Types: `ZroundMessage` gains `{ type: 'log'; line: string }`; `DecoderEvent` gains `{ type: 'log'; line: string; boot: boolean }`; `Batch` gains `logs: string[]`.

- [ ] **Step 1: Write the vectors.** In `zround-vectors.json`, `logLines`: `[{ "line": "%TLLOG …&", "log": { "kind": "…", "fields": [["k", "v"], …] } | null }]`.
  - Valid, exactly as `firmware/tinylap-decoder/test/test_diag` asserts or builds them: `%TLLOG boot reason=poweron fw=v0.1.0-3-gabc&`; the `panic` boot line with `prev.<key>=1…18`; the `stat` line of `test_stat_line` (`up=600`, counters 1…18, `heap=200000`); the longest `stat` and `boot` lines of `test_lines_fit` (every counter `4294967295`, `up=` and `heap=` `4294967295`, `reason=brownout`, `fw=` 32 `x`); `%TLLOG pass id=2A t=1F74 first=1F40 last=1FA8 frames=9&`; the three `event what=… id=2A t=1F40` lines; `%TLLOG event what=overflow t=10&`; `%TLLOG boot reason=a_b fw=v1__x_y&`. Build the long ones with a throwaway Node snippet that follows `test_diag`'s key order (`kKeys`), not committed.
  - Valid at the bound: `%TLLOG stat` + ` aa=`…` am=` (13 keys) each with 32 `x` + ` b=` with 29 `x` + `&` (512 bytes); a value of exactly 32 characters.
  - `null`: a space inside a value (`reason=power on`); a 33-character value; a `"` in a value; a repeated key; `%TLLOG BOOT reason=x&`; the 512-byte line with a 30th `x` in `b=` (513 bytes).
  - `wifi`: `[{ "ssid": "<base64url of the bytes>", "password": "<base64url>", "reply": "%TLOK&" | "%TLERR Wi-Fi name too long&" | "%TLERR Wi-Fi password length&" }]`, with `test_session`'s `test_wifi_bounds` cases (`""`/`password`; 33 `s`; `net`/7 `p`; `net`/64 `g`; `net`/``; `net`/8 `p`; `net`/63 `p`; 32 `s`/64 `a`; `net`/32 `A` + 32 `0`), plus 16 `é` with an empty password (OK), 16 `é` + `a` (name too long), `net` with 63 `a` + `g` (password length), `net` with `0123456789abcdef` ×4 (OK). Every entry valid UTF-8.

- [ ] **Step 2: Write the failing tests.** In `zround.test.js`:

```js
test('vectors: log lines', () => {
  for (const { line, log } of vectors.logLines) {
    const body = line.slice(1, -1);
    const rest = body.slice('TLLOG '.length);
    if (log) {
      assert.deepEqual(parseMessage(body), { type: 'log', line: rest }, line);
      assert.deepEqual(parseLog(rest), log, line);
    } else {
      assert.equal(parseMessage(body).type, 'unknown', line);
      assert.equal(parseLog(rest), null, line);
    }
  }
});
test('vectors: Wi-Fi lengths', () => {
  for (const { ssid, password, reply } of vectors.wifi) {
    const m = parseMessage(`TLWIFI ${ssid} ${password}`);
    assert.equal(m.type, 'wifi');
    const error = wifiError(m.ssid, m.password);
    assert.equal(error ? commands.error(error) : commands.ok, reply, `${m.ssid} / ${m.password}`);
  }
});
test('log lines are ASCII only', () => {
  assert.equal(parseLog('boot fw=vé'), null);
  assert.equal(parseLog('stat up=1  heap=2'), null, 'two spaces');
  assert.equal(parseLog('stat up=1 '), null, 'a trailing space');
  assert.equal(parseLog(`stat ${Array.from({ length: 49 }, (_, i) => `k${i}=1`).join(' ')}`), null, '49 fields');
  assert.notEqual(parseLog(`stat ${Array.from({ length: 48 }, (_, i) => `k${i}=1`).join(' ')}`), null, '48 fields');
  assert.deepEqual(parseLog('stat up='), { kind: 'stat', fields: [['up', '']] });
});
```

  In `passing.test.js`, extend `a bad batch says what is wrong` and add:

```js
test('a logs-only batch is read', () => {
  assert.deepEqual(readBatch({ boot: 'b00tb00t', passings: [], logs: ['stat up=10'] }),
    { ok: true, batch: { boot: 'b00tb00t', passings: [], logs: ['stat up=10'] } });
});
test('log entries are measured in UTF-8 bytes', () => {   // Review Focus 3
  assert.equal(readBatch({ boot: 'b00tb00t', passings: [], logs: ['é'.repeat(255)] }).ok, true);
  assert.equal(readBatch({ boot: 'b00tb00t', passings: [], logs: ['é'.repeat(256)] }).ok, false);
});
// in 'a bad batch says what is wrong':
bad({ boot: 'b00tb00t', passings: [] }, /non-empty/);
bad({ boot: 'b00tb00t', passings: [], logs: [] }, /non-empty/);
bad({ boot: 'b00tb00t', passings: [], logs: Array(65).fill('x') }, /at most 64/);
bad({ boot: 'b00tb00t', passings: [], logs: ['x'.repeat(511)] }, /logs\[0\]/);
bad({ boot: 'b00tb00t', passings: [], logs: Array(65).fill('x'.repeat(510)) }, /32 KiB/);   // the byte budget is checked before the count
bad({ boot: 'b00tb00t', passings: [], logs: [1] }, /array of strings/);
bad({ boot: 'b00tb00t', passings: [], logs: 'x' }, /array of strings/);
```

  The existing `a valid batch is read and normalised` expects `logs: []` in the batch. Within the other two limits the 32 KiB budget can't bind (64 × 510 = 32,640 bytes), so it is checked before them, which lets the test above reach it.

- [ ] **Step 3:** `pnpm --filter @tinylap/timing test`. Expected: FAIL (`parseLog` and `wifiError` are not exported; `logs` unknown).
- [ ] **Step 4: Implement.**
  - `parseLog`: split on `' '`; the first part is the kind (`/^[a-z]{1,16}$/`), each other part one `key=value` split at its first `=`, key `/^[a-z][a-z0-9.]{0,31}$/`, value `/^[!#$'-<>-[\]-~]{0,32}$/` (printable ASCII without `"`, `%`, `&`, `=`, `\`), at most 48 fields, no key twice, and `text.length + 8 <= LOG_LINE_BYTES` (every accepted character is one byte).
  - `wifiError`: byte counts with `TextEncoder`; the password passes when empty, 8–63 bytes, or `/^[0-9A-Fa-f]{64}$/`.
  - `readBatch`, in this order: `boot`; `logs`, when present, an array of strings; their total bytes; their count; each entry; then `passings` must be an array, empty only when `logs` has lines . Texts: `` `logs` must be an array of strings. ``, `The log lines are over 32 KiB together.` (`MAX_LOG_BYTES`), `A batch holds at most 64 log lines.` (`MAX_LOG_LINES`), `` `logs[i]` is over 510 bytes. `` (`MAX_LOG_ENTRY_BYTES`), `` `passings` must be a non-empty array, unless `logs` has lines. ``. Bytes with `TextEncoder`, which counts as `Buffer.byteLength` does, since the package runs in browsers too.
- [ ] **Step 5:** The three package checks for `@tinylap/timing`; then `pio test -e native` in `firmware/tinylap-decoder` (`test_zround` reads the file and must ignore the new sections). Expected: PASS.
- [ ] **Step 6: Commit** `feat(timing): read %TLLOG lines and Wi-Fi lengths, shared with the firmware`

### Task 2: The server writes decoder logs

**Files:**
- Modify: `apps/timing/server/ingest.js`, `apps/timing/server/app.js`, `apps/timing/server/openapi.json`
- Test: `apps/timing/test/server/ingest.test.js` (`contract.test.js` runs unchanged)

**Interfaces:**
- Consumes: Task 1's `readBatch` (`batch.logs`), `parseLog`.
- Produces:
  - `request.log: ((line: string) => void) | null` in the request context (the same function that writes request lines; `null` for `log: false`).
  - `LIMITS.logs = 600` and a `logs` limiter (`rateLimiter({ limit: limits.logs, windowMs: 60_000, now })`); `createHandler`'s `limits` option takes `logs?`.
  - The lines `{"type":"decoder-log","decoder","boot","via","kind","fields"}` and `{"type":"decoder-log-skipped","decoder","boot","unreadable","limited","denied"}`, with `fields` an object in the line's order.

- [ ] **Step 1: Write the failing tests.** `before` starts the app with `limits: { ingest: 5, logs: 4, pair: 50 }` (each log test pairs its own decoder; the default of 10 pairings an hour would run out) and `log: (line) => logged.push({ line, through: … })`, recording for each JSON line `app.store.through(decoder, boot)` at the moment it is written; `decoderLogs()` parses the lines that start with `{`. The new tests go after `ingest is rate limited per decoder`, whose count assumes `spare` has used 3 batches in this minute; the test that moves `clock.now` puts it back in `t.after`.

```js
test('each log line is one JSON line, after the passings, with no workspace', …);
  // POST { boot, passings: [{ transponder: '0A', t: 1000 }], logs: ['pass id=1F t=1E0A first=1DE2 last=1E32 frames=8'] } with a token:
  // deepEqual { type: 'decoder-log', decoder: id, boot: 'b00tb00t', via: 'net', kind: 'pass',
  //   fields: { id: '1F', t: '1E0A', first: '1DE2', last: '1E32', frames: '8' } };
  // Object.keys(fields) in the line's order; no key holds the workspace id; recorded through === 1000
test('through the bridge the lines say via serial', …);
test('a bad line is skipped and counted, and the passings are still stored', …);
  // logs: ['stat up=1', 'BAD', 'stat x="y"'] -> 200, stored 1; one decoder-log, then
  // { type: 'decoder-log-skipped', decoder, boot, unreadable: 2, limited: 0, denied: 0 }
test('a line with a secret-looking key is skipped as denied', …);
  // each of token=, password=, psk=, ssid= -> denied counted, nothing of the value in any logged line
test('past 4 lines a minute the rest are skipped as limited', …);
  // 6 lines -> 4 written, limited: 2; clock.now += 60_000 -> lines are written again
test('a logs-only batch answers through and updates last_seen_at', …);
  // after a passing at 1000 in boot b00tb00t, clock.now += 1000, then { passings: [], logs: ['stat up=1'] } -> { stored: 0, duplicates: 0, through: 1000 };
  // app.store.decoders(office.id).find((d) => d.id === id).lastSeenAt === the new clock.now
test('a logs-only batch of a new boot answers through null', …);   // Review Focus 4: { stored: 0, duplicates: 0, through: null }
test('no log line on a 401, a 403 or a 404', …);
test('a body the bridge never sends is a 422 and logs nothing', …);   // 65 lines; a 511-byte entry
```

- [ ] **Step 2:** `pnpm --filter @tinylap/timing-app test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `app.js`: `log` moves into `context` as `log` (still used for the request line). `ingest.js`: `writeDecoderLogs(request, { decoder: string, boot: string, via: 'net' | 'serial', lines: string[] }): void`, called after `engine.ingest` returns; returns at once when `request.log` is null. Per line, in order: `parseLog` (else `unreadable`), the deny list `DENIED_KEYS = new Set(['token', 'password', 'psk', 'ssid'])` on any key (else `denied`), `request.limiters.logs.take(decoder)` (else `limited`), then `request.log(JSON.stringify(…))`. One `decoder-log-skipped` line when any count is non-zero.
- [ ] **Step 4: `openapi.json`.** The passings route: summary `Post a batch of passings, and decoder logs, of one boot`; the description says `logs` holds `%TLLOG` lines without `%TLLOG ` and `&`, written to the server's log and not stored, and that `passings` may then be empty; the 422 says which body errors refuse the batch (no passings and no logs, more than 64 lines, an entry over 510 bytes, over 32 KiB of entries, `logs` not an array of strings) and that a bad log line doesn't; a request body schema with `boot`, `passings` (`maxItems` 500, items `transponder`, `t`) and `logs` (`maxItems` 64, string items).
- [ ] **Step 5:** The three checks for `@tinylap/timing-app`. Expected: PASS, `contract.test.js` included.
- [ ] **Step 6: Commit** `feat(timing): write decoder logs from the passings body to the server's log`

### Task 3: The bridge forwards log lines

**Files:**
- Modify: `apps/timing/public/link/zround.js`, `apps/timing/public/bridge.js`
- Test: `apps/timing/test/link.test.js`, `apps/timing/test/bridge.test.js` (sending, answers), `apps/timing/test/bridge-session.test.js` (holding, the boot rule, the defaults)

**Interfaces:**
- Consumes: Task 1's `MAX_LOG_LINES`, `MAX_LOG_BYTES`, the `log` message.
- Produces:
  - `eventsOf` for `log`: `[{ type: 'alive' }, { type: 'log', line, boot: line.startsWith('boot ') }]`. A `%TLLOG boot …` that `parseLog` rejects stays `{ type: 'noise', detail: raw }`; the bridge knows it by `detail.startsWith('TLLOG boot ')`.
  - `Bridge` option `logMaxWaitMs = 10_000`; `LOGS_MAX = 256` in `bridge.js`.
  - `type LogEntry = { decoder: string | null, boot: string | null, line: string }` (both null while held).
  - `sendOutbox(outbox, post, onSent = () => {}, { lines = [], alone = false } = {}): Promise<{ refusal, dropped, forbidden, blocked, sentLines: LogEntry[] }>`; a thrown error carries `sentLines` beside `dropped`, `refusal`, `blocked`. `sentLines` holds the entries the flush is done with: sent, or dropped by the answer table of spec §2.6.
  - `post(decoderId, { boot, passings, logs? })`: `logs` only when non-empty.
  - `Bridge.flush({ alone = false } = {})`.

- [ ] **Step 1: Write the failing tests.** `bridge-session.test.js`'s `posting()` changes to answer `through: batch.passings.length ? Math.max(…) : null` (today `Math.max()` of nothing is `-Infinity`) and to record `logs`; `bridge.test.js` gets the same helper, as its inline `post`s don't have one.

```js
// link.test.js
test('a %TLLOG yields alive, then log, with boot set by the prefix', …);   // 'boot reason=x' -> boot true; 'stat up=1' -> false
// bridge.test.js, sending
test('lines go with the next batch of passings for their boot', …);
test('a pass line rides on the next passing\'s batch, not a post of its own', …);
  // %L, then %TLLOG pass, then %L -> 2 posts, every one with passings.length > 0, the second's logs = ['pass …']
test('with no passings, one logs-only batch after logMaxWaitMs; a second line does not restart the timer', …);
  // logMaxWaitMs: 100; lines at 0 and 60 ms -> one post { passings: [], logs: [both] } before 150 ms
test('at most 64 lines per batch', …);   // 70 lines -> 64, then 6 (the 32 KiB bound can't bind: 64 × 510 bytes is under it)
test('lines of an earlier boot go logs-only, not with the new boot', …);   // Review Focus 1
// bridge.test.js, answers
test('lines are dropped on 401, 403, 404, 413 and 422, and kept on 429, 5xx and network errors', …);
test('a thrown error\'s sentLines are not sent again', …);   // two groups, the second 5xx: the first group's lines go once
test('a logs-only 422 or 5xx sets no refusal, dropped, blocked or lastError, and leaves online alone', …);
test('a logs-only answer with through null drops the lines', …);   // Review Focus 4
test('after close(), nothing is sent and no timer is left', …);
test('a logs-only post that never answers does not hold up the next passing', …);   // the post hangs; the next %L still fires `passing` and is posted
test('after a 403 the timer re-posts nothing', …);   // a 403 on the batch with lines: lines dropped, no logs-only post and no second passings post after logMaxWaitMs
test('stamped lines go out after the port is lost, with the next flush of passings', …);   // a 5xx keeps passings and lines; unplug; the retry carries both
// bridge-session.test.js, holding and dropping
test('lines are held in connecting and stamped by the next %TLID', …);
test('lines are dropped while unpaired, for a plain ZRound decoder, on #decide and on a late %TLID', …);
test('at most 256 lines are held, the oldest dropped first', …);   // 300 in connecting, then %TLID dec_1 -> the posted logs are the last 256
// bridge-session.test.js, the boot rule
test('a boot line straight after its boot-changing %TLID starts no hello()', …);
test('a boot line after anything else calls hello(), and the passings after it wait for the new boot', …);
test('a boot line parseLog rejects still triggers the rule', …);   // '%TLLOG boot reason=x fw=a"b&'
```

  `the defaults are the spec's` asserts `logMaxWaitMs === 10_000`.

- [ ] **Step 2:** `pnpm --filter @tinylap/timing-app test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `Bridge` keeps `#logs: LogEntry[]` and `#bootChanged`: `#handle` sets it to `boot !== this.boot` on an `identity` (before `#identity` runs) and to `false` after any other event except `alive`.
  - `#onLog`: for `tinylap` in `ready`, a boot line with `#bootChanged` false calls `hello()` first. Then it queues `{ decoder, boot, line }` in `ready`, drops the line when `unpaired` or browser-assigned, and else holds it with null decoder and boot. Past `LOGS_MAX` the oldest is shifted.
  - `#identity` stamps held lines (or drops them when `decoder` is null). `#decide` and `#dropBrowserStamped` drop them. `close()` empties `#logs`.
  - The first line queued with no timer running starts `#logTimer = this.#later(this.logMaxWaitMs, () => { void this.flush({ alone: true }); })`. The `void` matters: `#later` runs on the chain, and awaiting a POST there would stall every decoder event behind it. Cancelling clears it and deletes it from `#timers`, as `hello()` does with `#helloTimer`. After a flush, the timer is cancelled when no stamped line is left, and started again only when a 429, 5xx or network answer kept lines.
  - **403 and the timer.** A 403 drops the lines it carried and, in the logs-only phase, the remaining lines of that decoder too (they go in `sentLines`; spec §2.6 drops lines on a 403). So a refused decoder has no line left to re-arm the timer. An `alone` flush also posts passing groups only of decoders that have queued lines, so a timer flush never re-posts another decoder's refused passings.
  - `flush` passes the stamped entries to `sendOutbox` and removes `sentLines` (by identity) from `#logs`, on success and on a thrown error. An `alone` request during a flush in flight is remembered for the rerun.
  - `sendOutbox`: each group takes up to 64 queued lines (32 KiB) of its own decoder and boot, in queue order. Only when the loop ran out of groups and `alone` is set, the rest go in logs-only batches per decoder and boot; a decoder a 403 skipped gets none, and its lines are dropped. Neither 32 KiB bound in the bridge can bind (`parseLog` caps an entry at 504 bytes), so the 64-line count is what splits batches. A logs-only answer never calls `onSent`, never sets `refusal`, `dropped` or `blocked`, and never throws. On 429, 5xx or a network error it stops and keeps the lines.
- [ ] **Step 4:** The three checks for `@tinylap/timing-app`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(timing): the bridge forwards the decoder's %TLLOG lines`

### Task 4: The serial transport reads on after a non-fatal error

**Files:**
- Modify: `apps/timing/public/link/serial.js`, `apps/timing/public/link/zround.js`, `packages/timing/zround.js` (`createReader().reset`), `apps/timing/public/bridge.js` (`#read`), `apps/timing/public/sim/serial-port.js`
- Test: `apps/timing/test/link.test.js`, `apps/timing/test/bridge.test.js`, `packages/timing/test/zround.test.js`

**Interfaces:**
- Produces:
  - `serialTransport(port)`: `bytes(): AsyncGenerator<Uint8Array | null>`, ending as spec §3.2 sketches; `errors: Record<string, number>` (a plain object created with the transport and changed in place); `MAX_FAILURES_IN_A_ROW = 20`. `close()` sets `closed` before it cancels the current reader, once.
  - `createReader()` gains `reset(): void` (`pending = ''`).
  - `zroundProtocol()` gains `reset(): void`: a fresh `createReader()` and a fresh `TextDecoder`.
  - `Bridge#read`: on `null` it calls `this.protocol.reset?.()` and reads on.
  - `fakeSerialPort(model)` gains `glitch(name: string): void`: it errors the current readable with `new DOMException('', name)` and hands out a new one. `readable` becomes a getter for the current stream. A copy made by spreading the port (the browser tests' `SERIAL` init script does `{ ...port, getInfo }`) keeps the first stream, so `glitch` is for unit tests only.
  - `bytes()` never branches on the error's name: `port.readable` alone decides whether reading goes on.

- [ ] **Step 1: Write the failing tests.** `recordingPort` gains `rig.fail(name, { fatal = false } = {})`: it errors the current stream, then hands out a new readable (only the readable side), or `null` when `fatal`. It also gains `rig.end()`: the stream closes without `close()`.

```js
for (const name of ['BreakError', 'FramingError', 'ParityError', 'BufferOverrunError'])
  test(`a ${name} reads on, with one null between the bytes`, …);   // [1], fail, [2] -> [Uint8Array[1], null, Uint8Array[2]]
test('a NetworkError, with readable then null, ends bytes()', …);
test('a stream that ends without close() ends bytes() once and takes no new reader', …);
test('21 errors in a row end bytes(); bytes between errors reset the count', …);   // 20 -> 20 nulls, still reading; 21st ends
test('a close between two readers takes no third, and cancels once', …);
test('a close during a read after an error leaves the port closed and re-openable', …);
test('errors counts by name and survives { ...transport }', …);   // { ...t }.errors === t.errors; counts { FramingError: 2 }
test('the ZRound protocol joins no half %L across a gap', …);
  // push('%L2A,1F'), reset(), push('00&%T2000&') -> no passing; a clock of 0x2000
// zround.test.js
test('reset drops the pending text', …);
// bridge-session.test.js (modelPort is on fakeSerialPort; bridge.test.js's fakePort has no glitch)
test('a non-fatal error mid-line in a TinyLap session leaves it ready, and the next passing is forwarded', …);   // rig.port.glitch('FramingError')
```

  The existing `a serial read that rejects ends the bytes, not in an unhandled rejection` changes: it errors the stream while `readable` stays non-null, which now reads on (a `null`, then a new reader). It becomes `rig.fail('UnknownError', { fatal: true })`, so `readable` is null and `bytes()` ends with nothing yielded. The unplug tests pass unchanged (`a device that says nothing is listening, not an error; a lost port is disconnected`; the two unplug tests in `bridge-session.test.js`).
- [ ] **Step 2:** `pnpm --filter @tinylap/timing test`, `pnpm --filter @tinylap/timing-app test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** as spec §3.2–3.3. `fakeSerialPort.unplug()` closes the current stream as today; `readable` stays non-null after an unplug, so `done` must end `bytes()`.
- [ ] **Step 4:** The three checks for `@tinylap/timing` and for `@tinylap/timing-app`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(timing): the bridge reads on after a break, framing, parity or overrun error`

### Task 5: The simulated TinyLap decoder behaves as the firmware does

**Files:**
- Modify: `packages/timing/simulator.js`, `packages/timing/test/simulator.test.js`
- Modify: `apps/timing/public/sim/models/tinylap.js`, `apps/timing/test/sim.test.js`, `apps/timing/test/bridge-session.test.js`, `apps/timing/test/bridge.test.js`
- Modify: `tools/decoder-sim.js`, `tools/test/decoder-sim.test.js`
- Modify: `apps/timing/test/browser/bridge.test.js` (the log reaches the server)

**Interfaces:**
- Consumes: Task 1's `wifiError`; Tasks 2 and 3 for the browser test.
- Produces:
  - `createSimulator({ cars, jitterMs, random, decoder, token, uptimeMs = 0 })` with `start(now): string[]`, `tick(now): string[]`, `reply(message, now): string[]` and `advance(now): { transponder, t }[]`, all on one monotonic `now`. The boot starts at `-uptimeMs` from construction.
  - `start(now)`: `[%TLID …&, '%TLLOG boot reason=poweron fw=sim&']`; a new boot, and the power-up for `stat` and `up=`.
  - `tick(now)`: per millisecond, `%L` then its `%TLLOG pass id=<id> t=<t> first=<t−40> last=<t+40> frames=8&` (hex as `%L`), then `%T`, then `stat`. `%T3E8&` first, then one per whole second of the boot, caught up. `%TLLOG stat up=<s> batches=0 … pass=<passings since power-up> … suppressed=0 heap=200000&` every 10 s from power-up, with the 18 counters in `docs/timing.md`'s order.
  - `reply(reset, now)`: a new boot at `now`, `[%TLID …&, '%TLLOG boot reason=reset fw=sim&']`; the `stat` timer runs on. `reply(wifi)`: `commands.error(wifiError(…))` or `commands.ok`.
  - `tinylapModel({ …, resetOnOpen = true, uptimeMs = 60_000 })`: `start: (now) => resetOnOpen ? sim.start(now).map(encode) : []`, `tick: (now) => sim.tick(now).map(encode)` (the fake port enqueues bytes).
  - The `%T` and `stat` schedules start at construction (or `start`): seconds and `stat`s before that are never caught up. A model with `uptimeMs` 60 000 sends its first `%T` at boot time 61 000, which is `now` 1000.
  - `runSerial`: writes `sim.start(clock())`'s lines when it starts, then `sim.tick(clock())`'s.

- [ ] **Step 1: Write the failing tests.**

```js
// simulator.test.js
test('start gives %TLID, then %TLLOG boot', …);   // [`%TLID - ${sim.boot}&`, '%TLLOG boot reason=poweron fw=sim&']
test('%T3E8& comes first, then one a second, caught up after a late tick', …);   // start(0); tick(999) -> []; tick(3500) -> %T3E8&, %T7D0&, %TBB8&
test('a %L comes before a %T of the same millisecond, with its pass line after it', …);
test('stat every 10 s from power-up, not reset by %I&', …);   // start(0); reply(reset, 4000); tick(10_000) has stat up=10
test('%I& gives %TLID, a reset boot line, a clock from zero and no early crossings', …);
  // reply(reset, 30_000) after advance(30_000); advance(40_000) -> every t <= 10_000
test('a tick at the reset\'s now sends nothing of the old boot', …);   // Review Focus 5: reply(reset, 5000); tick(5000) -> []
test('%TLWIFI answers through the wifi vectors', …);
// the existing reset test passes a monotonic now: reply(reset, 30_000), then advance(40_000)
// sim.test.js
test('the TinyLap model resets on open, or runs on for uptimeMs', …);
  // resetOnOpen true: start(0) is the two power-up lines; false: start(0) is [], tick(999) is [], tick(1000) is ['%TEE48&'] only
// decoder-sim.test.js: 'the serial mode answers commands and writes laps' also asserts the power-up lines come first
// bridge-session.test.js
test('a %TLID before %C&: the bridge never sends %C&, ends unpaired, then pairs', …);   // openDelayMs: 50, as the real 1.5 s delay does; with 0, start() writes %C& before the read delivers %TLID
test('a reboot with the port open: the passings after it carry the new boot, none the old, and no hello() loop starts', …);
test('the same reboot with its %TLID dropped: the boot line asks again', …);
```

  In `browser/bridge.test.js`, `before` starts the app with `log: (line) => logged.push(line)`. `connect, pair and forward with the simulated decoder` then waits (20 s) for a `decoder-log` line of kind `pass` and one of kind `stat`. TinyLap tests that count `/passings` posts filter on `passings.length > 0` (spec §7.5).
- [ ] **Step 2:** `pnpm --filter @tinylap/timing test`, `pnpm --filter @tinylap/timing-app test`, `pnpm --filter @tinylap/tools test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `advance` and `tick` share the track and the `pass=` count.
- [ ] **Step 4: Change the existing tests this breaks**, each for the reason given:
  - `bridge.test.js` `an unpaired decoder is paired, then forwards passings`: the password `'secret'` is 6 bytes, which the simulator now refuses; use `'secret12'`.
  - `simulator.test.js` `the simulator answers hello, pairing, Wi-Fi and a ZRound startup`: `{ ssid: 'x', password: 'y' }` now answers `%TLERR Wi-Fi password length&`; drop that assertion (the vectors test covers Wi-Fi).
  - `simulator.test.js` `a ZRound reset starts a new boot …`: the reply gains `'%TLLOG boot reason=reset fw=sim&'`, and `now` becomes monotonic (`reply(reset, 30_000)`, `advance(40_000)`).
  - `bridge-session.test.js` `the TinyLap handshake: %C& first, …`: a `%TLID` at open would skip `%C&`; `resetOnOpen: false`.
  - `bridge-session.test.js` `once TinyLap, always TinyLap: …`, `hello() keeps one retry: …`, `hello(): a retry timer that fired behind a newer hello() …`: they inject clocks by hand and count hellos; the model's own `%T`s would add clock-backs. They use `{ ...tinylapModel({ …, resetOnOpen: false }), tick: () => [] }`.
  - `sim.test.js` `the fake serial port streams what its model sends …`: it reads `%A&` first; same silent model with `resetOnOpen: false`.
  - `bridge.test.js` `a decoder that reboots with the port open …` stays as it is: it already passes one monotonic clock.
  - `fakeSerialPort` resets its clock origin on every `open()`, so `now` restarts on a re-open of the same port object. Every caller makes a fresh port per pick, so this is noted in a comment, not changed.
- [ ] **Step 5:** The three checks for `@tinylap/timing`, `@tinylap/timing-app` and `@tinylap/tools`; then the browser suite. Expected: PASS.
- [ ] **Step 6: Commit** `feat(timing): the simulated TinyLap decoder sends what the firmware sends`

### Task 6: The pairing form checks Wi-Fi lengths in bytes

The implementer uses the `frontend-design` skill: the form is palace-ui plus `@tinylap/design`, the messages show through the browser's own constraint validation, and no markup is built in script.

**Files:**
- Modify: `apps/timing/public/bridge.js` (`pair`, `#reply`, `WifiRefusedError`), `apps/timing/public/elements/bridge.js` (`pair`, an `input` listener)
- Test: `apps/timing/test/bridge.test.js`, `apps/timing/test/browser/bridge.test.js`

**Interfaces:**
- Consumes: Task 1's `wifiError`.
- Produces:
  - `export class WifiRefusedError extends Error`, with `name = 'WifiRefusedError'` and `reason: string` (the decoder's `%TLERR` text). `#reply`'s rejection error carries `reason`.
  - `Bridge.pair(decoderId, token, wifi)`: once `%TLPAIR` is answered `%TLOK&`, it calls `hello()` whatever `%TLWIFI` answers. Then it rejects with `WifiRefusedError` on a `%TLERR`, or with `WifiUnconfirmedError` (`name = 'WifiUnconfirmedError'`) when `%TLWIFI` gets no answer.
  - `tl-bridge` adds and removes an `input` listener in `start`/`stop`. Any input in the pair form clears the custom validity of both Wi-Fi fields.

- [ ] **Step 1: Write the failing tests.**

```js
// bridge.test.js
test('a decoder that refuses Wi-Fi after %TLOK& for the pairing ends ready, and pair rejects with the refusal', …);
  // a model answering %TLOK& to %TLPAIR and %TLERR Wi-Fi password length& to %TLWIFI:
  // rejects (e) => e instanceof WifiRefusedError && e.reason === 'Wi-Fi password length'; bridge.state === 'ready'
// browser/bridge.test.js
test('a Wi-Fi name of 17 é is reported in bytes, before anything is created or sent', …);
  // validationMessage === 'A Wi-Fi name is at most 32 bytes. This one is 34: letters like é take 2, emoji 4.';
  // decoders count unchanged; no %TLPAIR written (the WritableStream recording init script)
test('a pasted 33-character name is reported, not truncated', …);   // field value keeps 33 characters
test('a 7-character password and 64 characters not all hex are reported', …);
  // 'A Wi-Fi password is 8 to 63 bytes, or 64 hex digits. This one is 7 bytes.'
  // 'A Wi-Fi password is 8 to 63 bytes, or 64 hex digits. This one is 64 characters, but not all hex digits.'
test('a password with no Wi-Fi name pairs; 64 hex digits and an empty password pair', …);
test('editing the field clears the message', …);
test('clearing the Wi-Fi name clears the password\'s message', …);   // Review Focus 2: then Pair reaches 'Forwarding from …'
test('a refusal after pairing says the decoder is paired', …);
// bridge.test.js
test('a Wi-Fi timeout after %TLOK& ends ready, and pair rejects with WifiUnconfirmedError', …);   // a model that never answers %TLWIFI
  // the init script rewrites the %TLWIFI write's password to 'pass':
  // alert 'The decoder is paired, but it refused the Wi-Fi settings: Wi-Fi password length.'
```

- [ ] **Step 2:** `pnpm --filter @tinylap/timing-app test`, then the browser file. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `tl-bridge`'s `pair`, before `submit.disabled = true` (an early return must not leave Pair disabled) and only when the trimmed Wi-Fi name is non-empty, `wifiError(ssid, password)` picks the field. `setCustomValidity` gets one of the texts above, with the byte count from `TextEncoder`; the not-all-hex text applies when `password.length === 64` (characters); any other wrong length gets the bytes text. Then `reportValidity()` and return. On `WifiRefusedError`: `run.made = null`, the name field editable again, and `this.fail(run, new Error(`The decoder is paired, but it refused the Wi-Fi settings: ${caught.reason}.`))`. On `WifiUnconfirmedError`, the same, with the text `The decoder is paired, but it didn't confirm the Wi-Fi settings. Its passings still reach TinyLap over this cable.` `views/bridge.js` stays without `maxlength` and `minlength` on the Wi-Fi fields.
- [ ] **Step 4:** The three checks for `@tinylap/timing-app`; then the browser suite. Expected: PASS.
- [ ] **Step 5: Commit** `fix(timing): the pair form checks Wi-Fi lengths in bytes, as the decoder does`

### Task 7: The firmware's native tests read the new vectors

**Files:**
- Modify: `firmware/tinylap-decoder/test/test_diag/test_main.cpp`, `firmware/tinylap-decoder/test/test_session/test_main.cpp`

**Interfaces:**
- Consumes: Task 1's `logLines` and `wifi` sections, through `VECTORS_PATH` and ArduinoJson, as `test_zround` loads them (a `test_vectors_load` that runs first).

- [ ] **Step 1: Write the tests.**
  - `test_diag`: `test_lines_are_vectors`. It rebuilds every line the suite asserts or builds (`test_boot_line` both, `test_stat_line`, `test_lines_fit` both, `test_pass_line`, the four event lines, `test_no_bad_characters`) and asserts that `logLines` has an entry with that exact `line` and a non-null `log`.
  - `test_session`: `test_wifi_vectors`. On a started `Rig`, for each `wifi` entry, `expectReply(a, "%TLWIFI " + ssid + " " + password + "&", reply)` with the base64url strings as they are. `test_wifi_bounds` stays for its store-failure case.
- [ ] **Step 2:** `pio test -e native` in `firmware/tinylap-decoder`. Expected: PASS (Task 1 built the vectors from these lines). A failure means a vector differs from the firmware: fix the vector, not the firmware, and rerun `pnpm --filter @tinylap/timing test`.
- [ ] **Step 3: Commit** `test(firmware): the diag lines and Wi-Fi checks run the shared vectors`

### Task 8: Docs

**Files:**
- Modify: `docs/timing.md`

- [ ] **Step 1:** In "Over Wi-Fi: the ingest API", add the `logs` array, and that `passings` may then be empty. Give the 64-line, 32 KiB and 512-byte limits. Say that lines are written to the server's log, not stored, and that a bad line is skipped, not refused.
- [ ] **Step 2:** In "Diagnostics", say where the lines go: the bridge forwards them, and the server writes one JSON line each, with the fields of spec §2.5. Add the line rules of spec §2.1, and that a `boot` line follows its `%TLID` directly, which the bridge relies on.
- [ ] **Step 3:** In "The handshake", say that the bridge reads on after a break, framing, parity or overrun error and drops the message the error cut.
- [ ] **Step 4:** `pnpm check`. Expected: PASS (no test reads `docs/*.md`; read the sections over against spec §8).
- [ ] **Step 5: Commit** `docs: decoder logs, the ingest body's logs and serial errors`

---

## Self-review

- **Spec coverage:** §2.1 → Task 1, 7; §2.2, §2.4, §2.6 → Task 3; §2.3, §2.5 → Task 1 (`readBatch`), 2; §3 → Task 4; §4 → Task 5; §5 → Task 1 (`wifiError`), 6, 7; §6 → Global Constraints; §7.5 → Task 5; §8 → Task 2 (`openapi.json`), 8. Each test that §7 lists is named in its task.
- **Types:** `LogEntry`, `sentLines`, `flush({ alone })`, `WifiRefusedError.reason` and `DecoderEvent` `log` are used under the same names in every task.
- **Departure from spec §7.1:** none left; the 32 KiB test is reached by checking the byte budget before the count (Task 1).
- **Proportion:** signatures, test names and assertions; no function bodies except the vector loops and the value regex.
