# The bridge and the TinyLap decoder: design

This builds on the decoder spec, `2026-10-26-decoder-firmware-design.md`. Its §11 lists what the bridge needs before the real board is used with it on the track ("The bridge follow-up"), and this spec covers those items. Paths are relative to the repository root.

Two marks are used:
- **(guess)**: behaviour that is assumed, not measured, or intent read from the code. The open guesses are collected in §9.
- **(board)**: what the board session (decoder spec §11, checklist items 1 and 2) has to settle.

## 1. What changes, and what doesn't

| Item (decoder spec §11) | Where | Section |
| --- | --- | --- |
| `%TLLOG` is read, forwarded, and written to the server's log | `packages/timing/zround.js` and `passing.js`; `apps/timing/public/link/zround.js` and `bridge.js`; `apps/timing/server/ingest.js` and `app.js` | §2 |
| The serial transport reads on after a non-fatal error | `apps/timing/public/link/serial.js`, `link/zround.js`, `bridge.js` | §3 |
| The simulated TinyLap decoder behaves as the firmware does | `packages/timing/simulator.js`, `apps/timing/public/sim/models/tinylap.js`, `tools/decoder-sim.js` | §4 |
| The pairing form checks Wi-Fi lengths in bytes | `apps/timing/public/elements/bridge.js`, `bridge.js` `pair`, `packages/timing/zround.js` | §5 |
| `setSignals` on open | nothing in this work | §6 |

Not in scope:

- **Wi-Fi delivery from the decoder.** The ingest body is shaped so a decoder can later send the same logs over Wi-Fi (§2.3).
- **Storing logs.** The server writes them to stdout and keeps none of them (decoder spec §6.1).
- **Changes to what the firmware does.** Its native tests do grow: they read the new shared vectors (§2.1, §5.2).
- **Known gaps, left as they are:**
  - A Wi-Fi password is silently ignored when no Wi-Fi name is given.
  - The Wi-Fi name is trimmed, though a Wi-Fi name may start or end with a space.
  - The firmware's command reader on the board doesn't restart after a serial receive error (§3.4).

Everything here goes in one pull request, with browser tests and a timing deploy, as decoder spec §11 asks. The pairing form is a UI change, so whoever implements it uses the `frontend-design` skill (`CLAUDE.local.md`).

## 2. `%TLLOG`

### 2.1 Reading it (`packages/timing`)

`zround.js` gets a new function, `parseLog(text)`. It reads the part of the message after `TLLOG `: a kind, then `key=value` fields separated by single spaces. It returns `{ kind, fields }` or `null`. `fields` is an array of `[key, value]` pairs, in the order they came.

`parseMessage` uses it:
- `TLLOG <rest>`, where `parseLog(rest)` succeeds, becomes `{ type: 'log', line: rest }`.
- Any other `TLLOG` message stays `unknown`.

The server uses the same function (§2.5), so the bridge and the server can't disagree about what a log line is.

The rules follow the firmware (decoder spec §6.1, `firmware/tinylap-decoder/lib/tinylap/diag.cpp`), made exact:

| Part | Rule | Why |
| --- | --- | --- |
| kind | `[a-z]{1,16}` | `boot`, `stat`, `pass` and `event` today; a new kind needs no server change |
| key | `[a-z][a-z0-9.]{0,31}` | the longest today are `prev.suppressed` and `prev.rej.parity`, 15 characters each. A key never looks like an array index, so a JSON object keeps the order |
| value | 0–32 characters, printable ASCII (`!`–`~`) except `%`, `&`, `=`, `"` and `\` | `fw=` is cut to 32 (`kFwMax`, `src/main.cpp`). Counters have at most 10 digits, times at most 8 hex digits. Without `"` and `\`, a JSON string is the line plus its two quotes, so its size is known in advance (§2.4) |
| fields | at most 48, no key twice | a `boot` line with `prev.` has 20 fields, a `stat` line 20 |
| the line, `%` to `&` | at most 512 bytes, counted as UTF-8 bytes (the line is ASCII, so this is also its length) | the firmware stays under 512 (`test_diag` `test_lines_fit`); the bridge's reader cuts at 1024 |

Values stay strings: hex times stay hex and counts stay decimal. The server doesn't know what any key means, so a new counter needs no deploy.

Type changes:
- `ZroundMessage` in `types.d.ts` gets `{ type: 'log'; line: string }`.
- `DecoderEvent` gets `{ type: 'log'; line: string; boot: boolean }`, where `boot` is true when the line starts `boot ` (§2.2).
- In `link/zround.js`, a `log` message yields `alive`, then `log`. A `%TLLOG` is a message in the decoder's protocol, so, like a clock, it ends the `%C&` retries.

**Shared vectors.** `packages/timing/test/zround-vectors.json` gets a `logLines` section. Each entry is a line and what `parseLog` returns for it:
- The lines `test/test_diag` builds, exactly as it asserts them (for example `%TLLOG pass id=2A t=1F74 first=1F40 last=1FA8 frames=9&`). This includes the longest `stat` and `boot` lines from `test_lines_fit`.
- Lines that must come back `null`: a space inside a value, a 33-character value, a `"` in a value, a repeated key, a kind in capitals, a 513-byte line.

Both sides run the section:
- `zround.test.js` runs every entry through `parseMessage`.
- `test_diag` checks that every line it builds is a valid entry in the section, so if `diag.cpp`'s output changes, the vectors must change too, and `parseLog` runs on the new lines.

This is a test change only. A change to the vectors file already starts the `firmware` CI job.

### 2.2 In the bridge: which boot a line belongs to

A `%TLLOG` line doesn't name its boot. The bridge stamps it with the boot it believes is current, under the same rules it uses for a passing (`bridge.js` `#onPassing`):

| The bridge, when the line comes | What happens to the line |
| --- | --- |
| `ready` (a TinyLap decoder, paired) | stamped with `decoder` and `boot`, and queued to send (§2.4) |
| `connecting` or `listening` (the kind isn't known yet, or a `hello()` is waiting after a boot change) | held without a boot, then stamped by the next `%TLID`, as held passings are |
| `unpaired` | dropped: there is no decoder to post it under |
| the kind is decided as `zround` or `easylap` (`#decide`), or a late `%TLID` drops the passings the browser stamped (`#dropBrowserStamped`) | held lines are dropped with the held passings |
| a plain ZRound decoder or an EasyLap | dropped. Those decoders don't send `%TLLOG`, and their boots are the browser's |

At most 256 lines are held and queued together, and the oldest go first (§2.4). Once the port is lost (`disconnected`), the lines already stamped still go out with the outbox's next flush, as the passings do. `close()` drops them.

**A `boot` line is a boot change.** The firmware writes `%TLLOG boot …&` straight after every `%TLID` that starts a boot (`src/main.cpp` `onBoot`), in the same loop pass and before it reads any input. So a `boot` line that doesn't follow its own `%TLID` means that `%TLID` was lost, most likely in the serial noise of a reset (§3).

The rule, for `kind === 'tinylap'` and `state === 'ready'` only:
- The bridge remembers whether the last protocol message it read was a `%TLID` that changed the boot.
- `alive` is an event, not a message, so it doesn't count.
- A `boot` line that comes after anything else makes the bridge call `hello()`, as it does when a clock goes back. That moves it to `connecting`, so the line itself and the passings that follow wait for the new boot.
- A line counts as a `boot` line by its prefix `boot `, even if `parseLog` rejects the rest of it. So a malformed `fw=` can't switch the rule off.

Why only in `ready`:
- Before the kind is known, `#alive` already starts the hellos.
- While unpaired, `hello()` would hide the pair form the member is typing in, and unpaired passings are dropped anyway.

Without this rule, the passings in the first second after a reboot, before `%T3E8&` shows the clock went back, would be stamped with the old boot.

The rule requires a boot *change* rather than just any `%TLID`. Consider a board that reboots within a second of answering a `%TLHELLO&`, and loses the new `%TLID`. The last `%TLID` the bridge read is then the old one, which changed nothing, so the `boot` line still triggers the rule.

**A known gap.** A `%TLLOG` from a decoder already decided as plain ZRound proves it is a TinyLap decoder whose `%TLID` replies were all lost. The bridge doesn't ask it again. `docs/timing.md` promises that a plain decoder gets no further writes once it streams. Also, losing every reply to three hellos is far less likely than losing one `%TLID` at a reset.

### 2.3 To the server: in the passings body

**Decision: the lines go in the existing ingest body**, as `logs` beside `passings`:

    POST /decoders/<decoder id>/passings
    { "boot": "x7Qm2LbV0aE",
      "passings": [{ "transponder": "2A", "t": 8052 }],
      "logs": ["pass id=1F t=1E0A first=1DE2 last=1E32 frames=8", "stat up=600 batches=…"] }

Each entry is the text after `%TLLOG ` and before `&`.

Why this, rather than a separate `POST /decoders/<id>/logs`:

- **A log line belongs to a decoder and a boot**, and the batch already names both.
- **The rules are already there.** The line needs the passings route's auth (a token, or a session with the same-origin check and `timing.run` on the club) and its rate limit. A second route would copy them.
- **A Wi-Fi decoder can later send one request for both**, as decoder spec §6.1 expects ("once Wi-Fi delivery exists, the decoder posts them itself").

What it costs, and how that is contained:

- **`passings` may be empty when `logs` is not.** `readBatch` refuses a body that has neither. A logs-only batch goes through `engine.ingest` like any other batch. With no passings, that stores nothing, updates the decoder's `last_seen_at` (`touchDecoder`) and answers `{ stored: 0, duplicates: 0, through }` (engine.js `ingest`). So a decoder that is connected, with no cars on the track, shows as in use on the choose form (decoders spec D5), which is what it is.
- **A bad log line must never cost a passing.** The bridge drops a whole batch for good on a 422 (`sendOutbox`, `FINAL`). So the server skips and counts a line it can't read; it doesn't refuse it (§2.5). A 422 comes only for a body the bridge never sends:
  - `logs` is not an array of strings;
  - it has more than 64 entries;
  - an entry is over 510 bytes, measured with `Buffer.byteLength`;
  - the entries together are over 32 KiB.
- **The answer stays as it is:** `{ stored, duplicates, through }`. The bridge doesn't need to know what was logged; the tests read the log (§7).

### 2.4 Limits, and when lines are sent

| Limit | Value | Reason |
| --- | --- | --- |
| Lines per batch | 64, and at most 32 KiB of entries | 32 KiB of lines plus 500 worst-case passings (about 27.5 KB) fits under the 64 KiB body limit (`body.js` `MAX_BODY`). Values contain no `"` or `\`, so no line grows when it is escaped |
| Bytes per line | 512 for the line, 510 for the entry (§2.1) | the firmware's bound |
| Lines per decoder per minute, on the server | 600; past that they are skipped and counted | the firmware's own limits give at most about 210 a minute: 6 `stat`, 120 `event` (20 per 10 s; the rest are only counted, as `suppressed=`), one `pass` per passing (eight cars at a lap every 6 s is 80), and one `boot` per boot. Enforced by a new `logs` limiter in `app.js`, beside `ingest`, `tap` and `pair`, taken once per line |
| Batches per decoder per minute | 600, unchanged | the `ingest` limiter. A logs-only batch counts as one batch |
| Lines held or queued in the bridge | 256, oldest dropped first | about a minute of the worst case above |

**The sending rule: lines never cause a post of their own while passings are being sent.**

- **When passings flow,** queued lines go with the next batch of passings for their boot. The firmware writes a `pass` line after the `%L` it explains (`src/main.cpp`: `onPassing`, then `observer.flush`). By the time the line arrives, the passing has usually been posted already. So a `pass` line goes with the *next* passing's batch. In a busy session that is a fraction of a second later, and a post per passing doesn't become two.
- **When no passings flow,** say an idle decoder sending its `stat` every 10 s, the first line queued starts a timer of `logMaxWaitMs` = 10 s. Lines queued after it don't restart the timer.
  - When the timer fires, the bridge flushes with logs-only batches allowed.
  - If a batch of passings carries every queued line first, the timer is cancelled.
  - The timer runs through `#later`, so `close()` and a lost port clear it.
- **The cost:** a logs-only batch at most every 10 s per connected decoder, 6 a minute against the limit of 600.
- **Why not post on each line:** the batch limit would then be reached about twice as early in a busy practice (20 cars on 4 s laps is 300 passings a minute).
- **Why not wait for each `pass` line** before posting its passing: that would delay every passing for a diagnostic.

### 2.5 The server

In `ingest.js`, after auth, the rate limit and `readBatch`:

1. `engine.ingest`, as today, also when `passings` is empty (§2.3).
2. Then, for each line, in order: `parseLog`, the deny list, the `logs` limiter, and one JSON line through the handler's `log` function.

`log` is a closure in `createHandler` (`app.js`) today, which writes the request lines with `console.log`. It moves into the request context as `request.log`:
- When it is null (`log: false`, as every server test helper sets it), decoder-log lines are dropped.
- Tests pass a function that captures them.

The lines are written after the passings are stored. If the store fails with a 5xx, the bridge retries, and the retry writes the lines once.

The line:

    {"type":"decoder-log","decoder":"dec_1","boot":"x7Qm2LbV0aE","via":"serial","kind":"pass","fields":{"id":"1F","t":"1E0A","first":"1DE2","last":"1E32","frames":"8"}}

| Field | Content |
| --- | --- |
| `type` | `decoder-log`, so a log search finds these lines among the request lines |
| `decoder`, `boot` | from the route and the batch. Together they identify the source |
| `via` | `serial` (the bridge, with a session) or `net` (the decoder's token), as for passings |
| `kind`, `fields` | from `parseLog`; `fields` is an object, in the line's order |

There is no workspace in the line: the decoder id leads to it, and personal data stays out of the log. Fly.io stamps the time, so the line doesn't repeat it.

**Skipped lines.** A line is not written when it can't be read, when it is over the minute's limit, or when it holds a key on the deny list. If any line in a batch was skipped, one more line gives the counts and nothing of the content:

    {"type":"decoder-log-skipped","decoder":…,"boot":…,"unreadable":2,"limited":0,"denied":0}

**Privacy.** The guarantee is in what is sent:
- The firmware never writes the token or the Wi-Fi credentials in a `%TLLOG` line.
- The bridge forwards only messages that parse as `log`. It writes `%TLPAIR` and `%TLWIFI` only to the cable. A copy of either echoed back on the line parses as `pair` or `wifi`, never as `log`.
- The server never sees the Wi-Fi credentials at all (§5.1).
- The server logs no client address, as today (`app.js`).

Two checks catch a future mistake; neither is a guarantee:
- A line with the key `token`, `password`, `psk` or `ssid` is skipped as `denied`.
- A value is at most 32 characters. A secret split across two values would still pass both checks.

The server stores no log line. A logs-only batch writes only `last_seen_at`.

### 2.6 Delivery: in memory, not in the outbox

**Decision: lines are best-effort, held in the `Bridge` instance's memory**, not in the IndexedDB outbox.

- **The outbox doesn't fit them.** It is keyed by the passing key and drained by `through`. A log line has neither: two identical `stat` lines can happen, and the server has no `through` to answer for them.
- **Losing one costs little.** Counters run from power-up and never reset (decoder spec §6.1), so the next `stat` line carries everything a lost one had. A lost `pass` or `event` line loses one detail, not a lap.
- **A reload, a close or another tab loses the queue.** That is acceptable for diagnostics, and a line never outlives the connection that read it.

`sendOutbox` takes a fourth, optional argument, `{ lines, alone }`. `lines` is the queue (`{ decoder, boot, line }[]`); `alone` says whether logs-only batches are allowed (§2.4). It works like this:

- Each group of passings carries up to 64 lines (32 KiB) of its own decoder and boot.
- Only when the group loop ran out of groups, and `alone` is set, do the remaining lines go in logs-only batches. After a `through` that doesn't cover the group (the loop's `break`), and after a thrown error, the remaining lines stay queued for the next flush.
- It returns `sentLines`, and a thrown error carries `sentLines` too, alongside `dropped`, `refusal` and `blocked`. So lines that earlier groups carried in the same flush are not sent twice.
- The page's "earlier passings" flush (`elements/bridge.js`) passes no lines.

What each answer does to the lines:

| Answer | Lines it carried | Passings, in a batch that also carried passings |
| --- | --- | --- |
| 2xx | dropped: sent | as today |
| 401, 403, 404, 422 | dropped: a new sign-in may send the passings, but the lines aren't worth keeping for one | as today |
| 413 | dropped, so the retry sends the passings without them. With the byte limit of §2.4 this shouldn't happen | kept, as today |
| 429, 5xx, network error | kept for the next flush, within the 256 bound. A rare duplicate in the log after a 5xx is acceptable | kept, as today |

**A logs-only batch is invisible to the page.**
- Its answer never sets `refusal`, `dropped`, `blocked` or `lastError`, never calls `onSent`, and never changes `online`.
- So a 422 on lines can't show "0 passings were refused", and a server that can't be reached while no passing waits doesn't turn the bridge offline.
- The next batch of passings reports the server's state, as today.

## 3. The serial transport: non-fatal errors

### 3.1 What Web Serial does

Web Serial ends a read with a `DOMException` in either case. What `port.readable` does next tells the two apart (Web Serial spec, "readable"):

| Error | Name | Fatal | After it |
| --- | --- | --- | --- |
| A break on the line | `BreakError` | no | `port.readable` is a new stream |
| A framing error (wrong baud rate, noise, a reset's ROM output at 115200) | `FramingError` | no | a new stream |
| A parity error | `ParityError` | no | a new stream |
| The OS's input buffer overran | `BufferOverrunError` | no | a new stream |
| The device was unplugged or lost | `NetworkError` | yes | `port.readable` is `null` |
| Any other OS error | `UnknownError`, among others | yes | `null` |

Bytes in flight when the error happened are lost. A non-fatal read error is assumed to leave `port.writable` alone **(guess, from the Web Serial spec; (board))**.

### 3.2 The loop

**Decision: `port.readable` decides whether reading goes on, not the error's name.** The transport takes a new reader while `port.readable` isn't null and the transport isn't closed. The error's name is only counted. This is the Web Serial spec's own pattern, and it is still right for an error name Chrome adds later.

    async *bytes() {
      try {
        while (port.readable && !closed) {
          reader = port.readable.getReader();
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) return;          // closed, or the stream ended: either way, the end
              failures = 0;
              yield value;
            }
          } catch (error) {
            errors[error?.name ?? 'Error'] = (errors[error?.name ?? 'Error'] ?? 0) + 1;
            if (closed || ++failures > MAX_FAILURES_IN_A_ROW) return;
            yield null;                  // a break: bytes were lost here
          } finally {
            try { reader.releaseLock(); } catch { /* close() released it */ }
          }
        }
      } finally {
        try { writer?.releaseLock(); } catch { /* already released */ }
      }
    }

- **`done` ends `bytes()`, always.** That covers a close, and a stream that ended without one, which counts as a lost device. A loop that took a new reader after `done` would spin forever on a stream that stays closed, such as `fakeSerialPort` after `unplug()`.
- **`close()` sets `closed` before it cancels the current reader**, so a close between two readers never takes a third one. `close()` cancels whichever reader is current, once, as the existing "cancels the reader once" tests check.
- **A guard against a port that only errors:** `failures` counts rejected reads in a row, and any read that delivers bytes resets it. After 20 (`MAX_FAILURES_IN_A_ROW`), the transport ends as for a lost device. 20 is a **(guess) (board)**: a reset's ROM output at 115200 baud should cause a few framing errors, not many.
- **`errors` is a plain object, created with the transport and changed in place**, not a getter. `elements/bridge.js` wraps the transport with a spread (`{ ...transport, close }`), and a spread would copy a getter's value once. `closed` stays inside the closure for the same reason.

### 3.3 The break reaches the reader

After a non-fatal error, the ZRound reader must not join the text from before the gap to the text after it. `createReader` keeps `pending` and restarts only at the last `%` before an `&`. If it isn't told about the gap, it can splice two half messages into a valid one.

Take `%L2A,1F74&%T2000&`, with `74&%T20` lost: the reader holds `%L2A,1F`, gets `00&`, and reads a lap of `2A` at 0x1F00. A lap like that is stored for good, and every later real passing of that car is then flagged `backwards` for the rest of the boot. Reading on after an error makes this possible for the first time; today the session ends instead.

So:
- `bytes()` yields `null` once after each non-fatal error, as in the sketch above.
- `Bridge#read`, on `null`, calls `this.protocol.reset?.()` and reads on.
- `zroundProtocol` gets `reset()`. It starts a fresh `createReader()` and a fresh `TextDecoder`, which drops the pending text and any half UTF-8 character.
- `createReader` gets `reset()` for this; it sets `pending = ''`.
- The HID transport never yields `null`, so the Robitronic protocol needs no `reset`.

The session itself doesn't see the error. The next message after the gap is read whole; the one cut by it is lost, as on any noisy line. Nothing tells the member, and `transport.errors` is there for tests.

The bridge doesn't report its own serial errors to the server. The decoder counts its own side (`rxdrop=` in `stat`).

### 3.4 Not mirrored on the board

The firmware's reader takes PC → decoder commands. On a receive error the firmware counts `rxdrop` but doesn't reset its reader. A splice there yields a valid command only if both halves fit a command's exact grammar, such as `%TLPAIR` with a 43-character token, which is far less likely than a spliced `%L`. That is firmware behaviour, so it is out of scope here and listed in §1.

## 4. The simulated TinyLap decoder

### 4.1 What it sends, against the firmware

Today, `tinylapModel` sends nothing when the port opens, no `%T` and no `%TLLOG`, and `createSimulator` answers every `%TLWIFI` with `%TLOK&`. The firmware (`lib/tinylap/session.cpp`, `src/main.cpp`) differs on each.

| Behaviour | Firmware | Simulator after this change |
| --- | --- | --- |
| At power-up | `%TLID <decoder or -> <boot>&`, then `%TLLOG boot reason=poweron fw=<build>&` | `start(now)`: the same two lines, with `fw=sim` |
| `%T` | every whole second of the boot, the first `%T3E8&`; missed seconds are caught up (`Session::tick`) | `tick(now)`: the same, from the boot's start |
| `%L` | one per passing, the id in upper-case hex | as today |
| `%TLLOG pass` | after the `%L` it explains | after each `%L`: `id=`, `t=`, `first=` and `last=` (the stamp ± 40 ms), `frames=8` |
| `%TLLOG stat` | every 10 s from power-up, with `up=` the seconds since power-up; `%I&` resets neither (`esp_timer`, not the boot's start) | every 10 s from `start()`, not reset by `%I&`. `pass=` counts the passings, the other counters are 0, and `heap=200000` |
| `%TLLOG event` | for crossings that made no passing | none: the simulated track makes no such crossings |
| `%C&` | `%A&` | as today |
| `%TLHELLO&` | `%TLID …&` | as today |
| `%TLPAIR` (as `parseMessage` reads it) | stores the pairing, then `%TLOK&` | as today |
| `%TLWIFI` | `%TLERR Wi-Fi name too long&` unless the Wi-Fi name is 1–32 bytes; `%TLERR Wi-Fi password length&` unless the password is empty, 8–63 bytes, or 64 hex digits; otherwise `%TLOK&` | the same, through `wifiError` (§5.2) |
| `%I&` | a new boot: `%TLID …&`, then `%TLLOG boot reason=reset fw=…&`; the clock starts from zero and open crossings are dropped | the same. The boot starts at `now`, so the cars' times and the clock restart together |
| `%F&` and anything else | nothing | as today |

Within one `tick`, lines come in time order. When a `%L` (with its `pass` line) and a `%T` fall on the same millisecond, the `%L` comes first, as in the firmware's `loop()`.

### 4.2 The API

| Member | What it does |
| --- | --- |
| `createSimulator({ …, uptimeMs = 0 })` | A boot exists from construction, so `boot` can be read at once. Its start is at `now = -uptimeMs`: the decoder has been running that long |
| `start(now)` | Power-up at `now`: a new boot, which also restarts the `stat` timer and `up=`. Returns the power-up lines |
| `tick(now)` | The `%T`, `%L` and `%TLLOG` lines due up to `now` |
| `reply(message, now)` | The answer, as today. `%I&` starts a new boot at `now` |
| `advance(now)` | Kept for `tools/decoder-sim.js net`, which posts passings and never resets the board. It takes the same `now` as the others and returns passings stamped on the boot's clock |

`now` is one monotonic clock across all of these: time since whatever origin the caller picked, never a boot's clock. Today the callers pass the time since the port opened (`sim/serial-port.js` `clock()`) to `advance`, which expects the boot's clock, so after an `%I&` the crossings come early by the time of the reset. Moving the boot's clock inside the simulator fixes that, in all three callers:
- `tinylapModel`;
- `tools/decoder-sim.js serial`, whose `runSerial` writes `start(clock())`'s lines when it starts, then writes `tick`'s;
- `tools/decoder-sim.js net`, which needs no `start`, since the boot from construction is the one it posts under.

`tinylapModel` takes `resetOnOpen`, which defaults to `true`:
- **`true`:** the board resets when the port opens, so `start(0)` runs at open. That is the usual behaviour of an ESP32 dev board **(guess) (board)**.
- **`false`:** the model is a board that has been running for `uptimeMs` (default 60 000). It sends nothing at open, and its next `%T` comes at the boot's next whole second. The handshake tests that pin `%C&` first (`bridge-session.test.js`, "the TinyLap handshake") use `false`. With `true`, the bridge hears `%TLID` before it has written anything, and never sends `%C&`.

Tests that change with this:
- `simulator.test.js`: the reset test passes a monotonic `now` (for example `reply(reset, 30_000)`, then `advance(40_000)`), and the passings after it are stamped from the new boot's zero.
- `tools/test/decoder-sim.test.js`: "the serial mode answers commands and writes laps". Its patterns still match, because `start`'s lines come before the `%TLID - …&%A&` it looks for, and `%T` lines come between the `%L`s. The test gets an assertion for the power-up lines.
- `bridge.test.js` "a decoder that reboots with the port open": already passes one monotonic clock (`reply(reset, 9000)` after clocks up to 9000), so it is unchanged.

## 5. The pairing form: Wi-Fi lengths in bytes

### 5.1 The problem, and where the check belongs

The decoder counts the bytes of the UTF-8 text (`session.cpp`: `size()` on the decoded strings):

| Field | Accepted | Refused with |
| --- | --- | --- |
| Wi-Fi name | 1–32 bytes | `Wi-Fi name too long` |
| Wi-Fi password | empty (an open network), 8–63 bytes, or exactly 64 hex digits (either case) | `Wi-Fi password length` |

What goes wrong today:
- `Bridge.pair` sends `%TLPAIR`, waits for `%TLOK&`, and only then sends `%TLWIFI`.
- When the decoder refuses the Wi-Fi settings, it is left paired, while the bridge stays `unpaired` and `elements/bridge.js` says to press Pair again.
- Pressing it fails the same way. A member with a Wi-Fi name of 17 accented letters, or a 7-character password, is stuck.

**The check is in the browser, in `tl-bridge`.** The pair form isn't a server round trip and can't be one:
- It posts to the server only to create the decoder.
- The Wi-Fi credentials go from the page to the board over USB. The server never sees them, and that stays so.
- AGENTS.md's 303/422 rule is for forms the server answers. This one exists only where Web Serial does, as part of an enhancement.

### 5.2 How

**One definition.** `packages/timing/zround.js` exports:
- `WIFI_NAME_BYTES` (1–32) and `WIFI_PASSWORD_BYTES` (8–63);
- `wifiError(ssid, password)`, which returns the firmware's text (`'Wi-Fi name too long'` or `'Wi-Fi password length'`), or `null`.

`createSimulator` (§4) and `tl-bridge` both use it.

**Shared vectors.** `zround-vectors.json` gets a `wifi` section. Each entry is a Wi-Fi name and a password, as base64url of their bytes, with the reply expected.
- The entries are `test/test_session`'s cases, plus:
  - 16 `é` (32 bytes), and 16 `é` plus an `a` (33 bytes);
  - a 64-character password with one digit that isn't hex;
  - 64 hex digits in lower case.
- Every entry is valid UTF-8, because `parseMessage` reads invalid UTF-8 as `unknown`, while the C++ checks bytes.
- `zround.test.js` runs them through `wifiError` and `createSimulator`.
- `test_session` runs them through `Session`, which builds the `%TLWIFI` line and compares the reply.

**The markup doesn't limit the length.** The server-rendered Wi-Fi fields (`views/bridge.js`) get no `maxlength`. `maxlength` truncates pasted text without a word:
- a pasted 33-character Wi-Fi name would become a different, 32-character one;
- a pasted 65-character hex string would become a valid 64-digit key.

Both would then fail on the network, which is worse than the problem being fixed. There is no `minlength` either: a password is ignored when no Wi-Fi name is given, and `minlength` would block Pair for it.

**The check, in `tl-bridge`'s `pair`, before anything is sent:**
- It runs before the decoder is created on the server.
- It applies only when a Wi-Fi name is given, as today's code sends Wi-Fi settings only then.
- It computes `wifiError` on the values it would send (the name trimmed, as today).
- On an error, it calls `setCustomValidity` on the field concerned, then `reportValidity()`, and returns.
- An `input` listener on `tl-bridge` clears the field's custom validity.
- The browser shows the text the same way it shows the name field's `required` message, so no markup is built in script.

**What the member reads:**
- Wi-Fi name: "A Wi-Fi name is at most 32 bytes. This one is 34: letters like é take 2, emoji 4."
- Wi-Fi password: "A Wi-Fi password is 8 to 63 bytes, or 64 hex digits. This one is 66 bytes."
- A 64-character password that isn't all hex: "This one is 64 characters, but not all hex digits."

**When the decoder still refuses**, after the pairing was stored (a store failure, or the check and the firmware disagreeing):
- `Bridge.pair` calls `hello()` once `%TLPAIR` is answered, whatever `%TLWIFI` answers. The bridge then reaches `ready`, and a paired board never leaves it in `unpaired`.
- `Bridge.pair` then rejects with an error that marks the Wi-Fi refusal.
- `tl-bridge` clears `run.made` and says: "The decoder is paired, but it refused the Wi-Fi settings: Wi-Fi password length."
- Wi-Fi can't be sent again from the bridge in this case, since the pair form is gone once the decoder is paired. That costs nothing today, because the firmware doesn't use Wi-Fi yet.

## 6. `setSignals` on open

**Decision: `setSignals` is not part of this work.** Neither is any setting of DTR or RTS. The board measurement (decoder spec §11, checklist item 2) has to decide **(board)**:

1. Whether opening the port from Chrome on macOS resets the board, and whether closing it does.
2. Whether the board ends in its ROM's download mode (`waiting for download`) after open or close, because GPIO 0 is low as EN rises.
3. Which line states Chrome leaves after `open()`, and whether one `setSignals({ dataTerminalReady, requestToSend })` call changes both lines at the same moment **(guess)**.
4. If a fix is needed, how the bridge knows it is talking to this board before it opens the port.

On point 4: USB chip ids can't tell this board from an Arduino-based ZRound decoder. ESP32 dev boards use a CP2102 (`10c4:ea60`) or a CH340 (`1a86:7523`), and Arduino Nano clones use the CH340 too. The repository's own test port is a CH340. An Arduino-based decoder relies on the DTR reset the bridge already waits for, so it must not be sent signals meant for the ESP32. A fix would have to go by something the bridge has learned, such as a device remembered as a TinyLap decoder, or `kind === 'tinylap'` from an earlier connection. That is for the follow-up, once the measurement is in.

A reset on open is harmless either way: a new boot, `%TLID`, and the bridge waits 1.5 s before writing (`SERIAL_OPEN_DELAY_MS`). `resetOnOpen` (§4) models it.

## 7. Tests

### 7.1 `%TLLOG`

Unit:
- `zround.test.js`: the `logLines` vectors; `parseMessage` gives `log` or `unknown`.
- `link.test.js`: a `log` message yields `alive`, then `log`, with `boot` set by the prefix.
- `passing.test.js` (`readBatch`):
  - a logs-only batch is read;
  - refused: both arrays empty, 65 lines, a 511-byte entry, more than 32 KiB of entries, entries that aren't strings.
- Firmware `test_diag`: its lines are valid entries of the `logLines` vectors.

Server (`test/server/ingest.test.js`, with `log` captured):
- one JSON line per log line: decoder, boot, `via`, kind, and `fields` in order; no workspace;
- the lines are written after the passings;
- a bad line is skipped and counted, and the passings are still stored;
- the per-minute limit; a denied key;
- the same through a token (`via: net`) and a session (`via: serial`);
- a logs-only batch answers `through` and updates `last_seen_at`;
- no log line on a 401, a 403 or a 404.

`contract.test.js` runs against the updated `openapi.json`.

Bridge (`apps/timing/test/bridge*.test.js`):
- Sending:
  - lines go with the next batch of passings for their boot;
  - a `pass` line rides on the next passing's batch, not a post of its own;
  - with no passings, one logs-only batch after `logMaxWaitMs`, and a second line doesn't restart the timer;
  - at most 64 lines (32 KiB) per batch.
- Holding and dropping:
  - lines are held in `connecting` and stamped by the next `%TLID`;
  - they are dropped while unpaired, for a plain ZRound decoder, on `#decide` and on a late `%TLID`;
  - at most 256, the oldest dropped first.
- The `boot` line rule:
  - a `boot` line straight after its boot-changing `%TLID` starts no `hello()`;
  - one without it calls `hello()`, and the passings after it wait for the new boot;
  - a `boot` line `parseLog` rejects still triggers the rule.
- Answers:
  - lines are dropped on 401, 403, 404, 413 and 422, and kept on 429, 5xx and network errors;
  - a thrown error's `sentLines` aren't sent again;
  - a logs-only 422 or 5xx sets no `refusal`, `dropped`, `blocked` or `lastError`, and leaves `online` alone;
  - after `close()`, nothing is sent and no timer is left.

Browser: the simulated decoder's `stat` and `pass` lines reach the test server's log.

### 7.2 Serial errors

`link.test.js`. The existing `recordingPort` learns to error its stream and then hand out a new one.
- Each of the four non-fatal names reads on: bytes before and after the error arrive, with one `null` between them.
- `NetworkError`, with `readable` then `null`, ends `bytes()`.
- A stream that ends without `close()` ends `bytes()` once, and takes no new reader.
- 21 errors in a row end `bytes()`; bytes between errors reset the count.
- A close between two readers takes no third, and cancels once.
- A close during a read after an error leaves the port closed and re-openable.
- `errors` counts by name and survives `{ ...transport }`.
- The ZRound protocol: the bytes of half a `%L` before the error, then the rest of a message after it, yield no lap.

Bridge: a non-fatal error mid-line in a TinyLap session leaves it `ready`, and the next passing is forwarded. The existing unplug tests still end `disconnected` (bridge.test.js "a lost port is disconnected"; bridge-session.test.js, the two unplug tests).

### 7.3 Simulator

Unit:
- `simulator.test.js`:
  - `start` gives `%TLID`, then `%TLLOG boot`;
  - `%T3E8&` comes first, then one a second, caught up after a late tick;
  - `stat` every 10 s, not reset by `%I&`;
  - `%I&` gives `%TLID`, `%TLLOG boot reason=reset`, a clock from zero, and no early crossings;
  - `%TLWIFI` through the `wifi` vectors.
- `sim.test.js`: the model with `resetOnOpen` set to `true` and to `false`.
- `decoder-sim.test.js`: the power-up lines.

Bridge:
- A `%TLID` that comes before `%C&`: the bridge never sends `%C&`, ends unpaired, then pairs.
- A reboot with the port open (`%TLID`, then a clock from zero):
  - the passings after it carry the new boot, and none carries the old one;
  - no `hello()` loop starts.
- The same reboot with that `%TLID` dropped: the `boot` line asks again.

Browser: "connect, pair and forward with the simulated decoder" passes with the new model, and the TinyLap browser tests run with `resetOnOpen: true`.

### 7.4 The pairing form

Unit:
- `zround.test.js`: `wifiError` through the `wifi` vectors.
- Firmware `test_session`: the `wifi` vectors.

Bridge: a decoder that refuses Wi-Fi after `%TLOK&` for the pairing ends `ready`, and `pair` rejects with the Wi-Fi refusal.

Browser:
- A Wi-Fi name of 17 `é`: the field reports the byte message, no decoder is created (no POST), and nothing is written to the cable.
- A pasted 33-character ASCII name is reported, not truncated.
- A 7-character password, and 64 characters that aren't all hex, are reported.
- A password with no Wi-Fi name pairs.
- 64 hex digits, and an empty password, pair.
- Editing the field clears the message.
- A simulated refusal shows "The decoder is paired, but it refused the Wi-Fi settings: …".

### 7.5 Tests that count posts

Logs-only batches are new requests to `/passings`. The browser tests that count such requests today don't see them, because none of them connects a TinyLap decoder:
- bridge-element.test.js 150–158 is the earlier-passings flush, with no decoder connected;
- frames.test.js 80 and 94 count the Setup page's form posts, not `/passings`;
- decoders-server.test.js 92 and decoders-choose.test.js 129 and 192 use the plain ZRound and EasyLap models.

Any TinyLap test that counts `/passings` posts filters on `passings.length > 0`, so the simulated decoder stays as real as the firmware. The browser suite is the slow part of CI's `check` job, so the new tests go in the existing files and add no browser start.

## 8. Docs

`docs/timing.md`:
- "Over Wi-Fi: the ingest API":
  - the `logs` array, and that `passings` may then be empty;
  - the 64-line, 32 KiB and 512-byte limits;
  - that lines are written to the server's log and not stored;
  - that a bad line is skipped, not refused.
- "Diagnostics":
  - where the lines go: the bridge forwards them, and the server writes one JSON line for each, with the fields of §2.5;
  - the line rules of §2.1;
  - that a `boot` line follows its `%TLID` directly, which the bridge relies on.
- "The handshake": the bridge reads on after a break, framing, parity or overrun error, and drops the message the error cut.

`apps/timing/server/openapi.json`:
- the summary of the passings route becomes "Post a batch of passings, and decoder logs, of one boot";
- its description says what `logs` holds, and its 422 description says which body errors refuse the batch and that bad log lines don't;
- the request body gets a schema; it has none today.

The `/api` page shows only a request body's media type (`pages.js`), so it picks up the summary and the descriptions, not the schema.

## 9. Open guesses

All of these are for the board session (decoder spec §11, checklist items 1 and 2), and none of them blocks the implementation:

1. The board resets when the port opens, so `resetOnOpen` defaults to `true` (§4).
2. How many framing errors a reset's ROM output causes, which sets the 20-errors-in-a-row guard (§3.2).
3. A non-fatal read error leaves `port.writable` alone (§3.1).
4. What `setSignals` would have to be, and how the bridge would know the board (§6).
5. On an unplug, whether Chrome sets `port.readable` to null before the `NetworkError` rejection arrives. If it does so after, the bridge reads on for up to 20 errors before it ends. That is bounded, but the tests don't model it (§3.2).

## 10. Decisions

1. **One `parseLog`** in `packages/timing`, shared by the bridge and the server, reads `%TLLOG` by the rules of §2.1. Values stay strings and hold no `"`, `\` or `=`. The firmware's `test_diag` and `zround.test.js` both run the `logLines` vectors.
2. **The lines go in the passings body,** as `logs` beside `passings`, which may then be empty: same route, same auth, same answer (§2.3).
3. **A bad or excess log line is skipped and counted, never a 422**, so a log line never costs a passing (§2.3, §2.5).
4. **The limits** (§2.4):
   - 64 lines and 32 KiB per batch, 512 bytes per line;
   - 600 lines per decoder per minute on the server;
   - 256 lines held in the bridge.
5. **No post of their own while passings are sent.** Lines ride on the next batch of passings. With none, a logs-only batch goes at most 10 s after the first line queued (§2.4).
6. **A logs-only batch goes through `engine.ingest`.** It stores no passing, updates `last_seen_at`, and answers `through` (§2.3).
7. **The server's log line.** One JSON line per log line (`type`, `decoder`, `boot`, `via`, `kind`, `fields`), with no workspace, written to stdout through `request.log` after the passings are stored. No log line is stored (§2.5).
8. **Lines are best-effort, in the bridge's memory, not in the outbox.** A logs-only batch never changes what the page shows (§2.6).
9. **A `%TLLOG boot` line that doesn't follow a boot-changing `%TLID` means a new boot.** For a paired TinyLap decoder in `ready`, the bridge asks again. A `boot` line is known by its prefix (§2.2).
10. **The serial transport reads on while `port.readable` isn't null**, whatever the error's name (§3.2):
    - `done` ends it;
    - the guard is 20 failed reads in a row;
    - each non-fatal error yields `null`, which resets the protocol's reader, so two half messages are never joined (§3.3).
11. **The bridge doesn't report its own serial errors to the server** (§3.3).
12. **`createSimulator` owns the boot's clock,** with `start`, `tick`, `reply` and `advance` all on one monotonic `now`. That fixes the early crossings after `%I&` in `tinylapModel` and in `tools/decoder-sim.js`. The simulated decoder sends what the firmware sends (§4).
13. **The Wi-Fi byte limits are one `wifiError`**, shared through the `wifi` vectors with the firmware's `test_session` (§5.2):
    - the pair form has no `maxlength` or `minlength` on the Wi-Fi fields;
    - `tl-bridge` reports every length problem with `setCustomValidity`, before anything is created or sent.
14. **When the decoder refuses the Wi-Fi settings after storing the pairing**, the bridge calls `hello()` anyway and tells the member that the decoder is paired but its Wi-Fi was refused, with the decoder's reason (§5.2).
15. **No `setSignals` and no DTR or RTS changes in this work.** The board measurement decides what is needed, and USB chip ids won't be what selects the board (§6).
16. **Out of scope, and known** (§1): a password with no Wi-Fi name, the trimmed Wi-Fi name, and the firmware reader's lack of a reset after a receive error.
