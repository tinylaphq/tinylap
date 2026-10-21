# Decoders: ZRound as the baseline, the TinyLap extension as an enhancement, EasyLap over WebHID, and decoder simulators

Status: draft, revised after the spec review and its re-review (scratchpad `review-dec-spec.md`: C1–C2, I3–I13, m14–m25; R1–R9), the owner's decision on boots and the coordinator's rulings. It follows the step-three spec (`2026-10-19-custom-elements-step-three-tap-bridge.md`), `docs/timing.md` and AGENTS.md ("Web platform first", light-DOM `tl-*` elements, no markup built in script). The EasyLap facts come from the research note `easylap-protocol.md` (scratchpad, 2026-10-21), cited as R§n. Review evidence is cited as `ricino-receiver.ino`, `openstint-bridge-zround.py` and `lappr-serial.js` (scratchpad `review-dec-src/`). openstint is a ZRound bridge over TCP, which Web Serial can't reach, so it is cited only as a reference for the protocol, not as a target (R1). Paths are relative to `apps/timing/` unless they start with `packages/`, `docs/` or `tools/`.

Product owner decisions recorded here (binding):
- **ZRound is the baseline.** A device that speaks ZRound and doesn't answer `%TLHELLO&` is a plain ZRound decoder and works fully over USB. Its identity comes from pairing in the browser, and the server records it. The bridge makes its boot ids (§2.4).
- **Every connect of a plain ZRound decoder or an EasyLap gets a new boot** (owner, 2026-10-21). There is no boot reuse across a replug. The reasons: plain ZRound decoders stream only after `%I&`, which zeroes their clock anyway (C1); Arduino-based decoders reset when the port opens (DTR, C2); and an EasyLap is bus-powered, so a replug is a power cycle. **A replug costs every car its current lap, and crossings while the decoder is unplugged are lost.** The page says so (§4.2).
- **The TinyLap commands are an enhancement**, used only when answered: `%TLPAIR`, `%TLWIFI`, the decoder's own `%TLID`, and with them Wi-Fi delivery without a browser and USB+Wi-Fi dedupe through the passing key. "not-tinylap" stops being an error state.
- **The decoder's kind is not stored on the server** for now (owner, 2026-10-21; §1).
- **EasyLap is supported.** It is a CP2110 HID-to-UART bridge (`10C4:86B9`) speaking Robitronic binary, reached with WebHID. So the bridge gets two layers, a **transport** and a **protocol reader**, with the identity, outbox, posting and preview shared behind them.
- **Simulators:** one shared track plus pluggable device models (TinyLap, plain ZRound, EasyLap). A server setting picks one, `TINYLAP_SIMULATE=<model>[,fast]`, and production never sets it. The simulator is injected at the platform boundary, in place of Web Serial's and WebHID's pickers; `tl-bridge` and `Bridge` have no simulation code at all (owner, 2026-10-21; §5.4). The page's `?simulate` goes.
- UI wording follows the glossary and the frontend-design writing rules. Commits are conventional, signed off (`-s`), with no AI attribution.

Coordinator rulings on the review (2026-10-21): the bridge sends `%I&` to a plain ZRound decoder (C1); the handshake retries, with an open delay and spacing (C2); I3–I13 and m14–m25 as the review proposes, with the choices named in their sections. The re-review's R1–R9 are applied as the reviewer proposes.

## 1. Goals and non-goals

**Goals**
1. A plain ZRound decoder over USB serial (RiCino and the like) connects, is chosen once per connect in the browser, and forwards passings with browser-made boots.
2. A TinyLap decoder behaves as today: the same states, pairing and Wi-Fi setup, and the same tests. The one change is the handshake in front of `%TLHELLO&` (§2.4).
3. An EasyLap connects over WebHID and forwards passings, through a Robitronic reader that tolerates every point the research marks low-confidence.
4. One simulator frame with three device models, each over its own fake transport, so every path above runs in CI without hardware.
5. No change to the ingest API, the passing key, the outbox format or the server's decoder table.

**Non-goals**
- AMB, and Robitronic over Web Serial (the RS-232 EasyLap, R§4 q7). The layers allow both later; neither ships now.
- Re-opening a granted port or HID device without a click (`getPorts()`, `hid.getDevices()`).
- Keeping a boot across a reconnect (owner, above).
- Race control from the bridge. It writes `%I&` only as the plain ZRound start handshake (§2.4), never `%F&`, and never Robitronic's reset.
- Unwrapping a clock rollover. It is treated as a new boot (§2.4).
- Posting `hits` and `strength`. The batch has no place for them (`packages/timing/passing.js:36-52`).
- A new look. The bridge screen keeps its sections and classes (§4).
- Storing the decoder's kind (TinyLap, ZRound, EasyLap) on the server. Nothing needs it yet; it can be added, as a `kind` column on `decoder`, when Setup needs to show which decoders can use Wi-Fi.
- Telling two decoders on the same USB chip apart (§3.2, I8).

## 2. Architecture

### 2.1 Layers

```
 transport            protocol reader              session (Bridge)                tl-bridge
 ─────────            ───────────────              ────────────────                ─────────
 serial  ──bytes──▶   zround   (+ TL commands)  ─┐
                                                  ├─events─▶ identity, boot, outbox, ─▶ sections, pickers,
 hid     ──bytes──▶   robitronic                ─┘          posting, preview           choose form, devices
 (CP2110 setup)       ◀──commands (bytes)───────            ◀── pair / assign ──────────
```

- **Transport**: opens, streams bytes in, writes bytes out, closes, and names the device. It knows nothing of frames.
- **Protocol reader**: turns bytes into session events and builds command bytes. It knows nothing of identity or the server.
- **Session**: today's `Bridge`, widened. It runs the handshake, decides the decoder kind, holds the identity and the boot, stamps passings, and keeps the outbox, the flush and the preview exactly as today (`public/bridge.js:175-205`, `sendOutbox` at `:235-275`, unchanged).

### 2.2 Files

| File | What | New or changed |
|---|---|---|
| `packages/timing/robitronic.js` | Robitronic frames: `crc8`, `createFrameReader`, `parseFrame`, `frames` (encoders, for commands and the simulator). MPL-2.0, like `zround.js`. | new |
| `packages/timing/index.js` | `export * from './robitronic.js'` | changed |
| `packages/timing/types.d.ts` | `RobitronicMessage` (§2.5), `DecoderEvent` (§2.3) | changed |
| `packages/timing/simulator.js` | `createTrack` pulled out of `createSimulator` (§5.1). `createSimulator`'s signature and replies stay. | changed |
| `public/link/serial.js` | `serialTransport(port)` | new |
| `public/link/hid.js` | `hidTransport(device, { hid = navigator.hid })`, with the CP2110 setup; `EASYLAP_FILTER` | new |
| `public/link/zround.js` | `zroundProtocol()`: text reader over `createReader` (`packages/timing/zround.js:71-99`), TL commands | new |
| `public/link/robitronic.js` | `robitronicProtocol()` over `createFrameReader` | new |
| `public/bridge.js` | `Bridge` becomes the session (§2.4). `sendOutbox` is unchanged. | changed |
| `public/devices.js` | the browser's remembered choice: device → decoder (§3.2) | new |
| `public/sim/track.js`, `public/sim/serial-port.js`, `public/sim/hid-device.js`, `public/sim/models.js`, `public/sim/models/{tinylap,zround,easylap}.js` | simulators (§5) | new |
| `public/sim-port.js` | stays, as `simulatedPort(options) = fakeSerialPort(tinylapModel(options))`, so `test/browser/bridge.test.js:240` and the stream-counting init scripts keep working | changed |
| `public/elements/bridge.js` | two pickers, the choose form, new state texts; today's `simulate` branch (`:24-27`, `:74`) is removed | changed |
| `public/sim/install.js` | the simulator at the platform boundary: `navigator.serial` and `navigator.hid` replaced, or defined where missing (§5.4) | new |
| `server/simulate.js` | `readSimulate(value)`: the setting's format, `<model>[,fast]`, checked | new |
| `server/main.js`, `server/app.js` | `TINYLAP_SIMULATE` read with the other settings and handed to the handler as `settings.simulate`; `install.js` served only while it is set | changed |
| `server/views/layout.js` | with the setting on, one `<script type="module" src="…/public/sim/install.js" data-model="…">` before the page's own scripts | changed |
| `server/views/bridge.js`, `server/bridge-pages.js`, `server/store.js` | new sections, the second Connect button, the club's choosable decoders as options (one new read query, §3.2) | changed |
| `docs/timing.md` | "Plain ZRound decoders" and "EasyLap" sections, and the handshake; the existing tables stay | changed |

Modules under `public/link/` and `public/sim/` import `@tinylap/timing` through the existing import map (`views/bridge.js:13-16`). The CSP is unchanged: everything is `'self'`. WebHID's default allowlist is `self`, and the server sends no `Permissions-Policy`.

### 2.3 Interfaces

```js
/** A transport. */
{
  device: string,                    // 'serial:<vid>:<pid>' or 'hid:<vid>:<pid>': the USB chip, not the decoder (§3.2)
  open(): Promise<void>,
  bytes(): AsyncIterable<Uint8Array>,// ends when the device goes away
  write(bytes: Uint8Array): Promise<void>,
  close(): Promise<void>,            // idempotent
}

/** A protocol reader. */
{
  kind: 'zround' | 'robitronic',
  baudRate: number,                  // 19200 (ZROUND_BAUD, packages/timing/zround.js:14) or 38400
  push(bytes: Uint8Array): DecoderEvent[],
}
```

The handshake writes (§2.4) come from `commands` (`packages/timing/zround.js:105-122`) and `frames` (§2.5); the session owns their timing, so the reader stays a pure parser.

```ts
/** What the session sees. */
type DecoderEvent =
  | { type: 'identity'; decoder: string | null; boot: string }   // %TLID only
  | { type: 'alive' }                                            // %A&, or a valid frame: the device speaks this protocol
  | { type: 'clock'; t: number }                                 // %T…&, Robitronic 0x83
  | { type: 'reset' }                                            // %I& seen from the decoder
  | { type: 'passing'; transponder: string; t: number; hits?: number; strength?: number }
  | { type: 'ok' } | { type: 'error'; text: string }             // %TLOK&, %TLERR
  | { type: 'noise'; detail: string };                           // a checksum mismatch, an unknown ZRound message
```

`zroundProtocol` maps `parseMessage` (`packages/timing/zround.js:32-68`) one to one: `hello` → `identity`, `lap` → `passing`, `ack` → `alive`, `unknown` → `noise`. Every `clock`, `lap` and `ack` also yields `alive` first. `robitronicProtocol` yields `alive` only for a checksum-good frame (§2.5). The serial transport is `port.open({ baudRate })`, `port.readable` and `port.writable`, as `bridge.js:68-69`, `:88-113` do today.

### 2.4 The session (`Bridge`)

```js
new Bridge({ link: { transport, protocol }, outbox, post, openDelayMs = 0, synMs = 500, handshakeMs = 6000,
             spacingMs = 300, helloMs = 2500, startMs = 6000, listenMs = 60_000, retryMs = 5000, replyMs = 3000 })
new Bridge({ port, outbox, post, … })   // shorthand: { transport: serialTransport(port), protocol: zroundProtocol() }
```

The `port` shorthand keeps every `new Bridge({ port, … })` in `test/bridge.test.js` valid. New public fields: `kind` (`'tinylap' | 'zround' | 'easylap' | null`) and `device` (the transport's). `tl-bridge` passes `openDelayMs: 1500` for every serial port; it can't tell a simulated one apart (§5.4), so a simulated decoder pays the same 1.5 s. The Node defaults stay fast, so the existing tests' `until` (about 1 s, `test/bridge.test.js:31-37`) still holds.

**Every write** checks `#closed` first, so no write follows a `close()` (I13; E3b, `test/browser/bridge-element.test.js:211-240`).

**The ZRound handshake** (C2). Two firmware facts shape it:
- RiCino reads 3 bytes per poll at 50 ms a byte and loops while bytes are waiting, so only the **last** 3-byte chunk of a burst counts (`ricino-receiver.ino:53-58`). `%C&` followed at once by `%TLHELLO&` reaches it as `LO&`, and `%A&` never comes. After `%C&` it writes `%A&` 21 times over about 2 s without reading (`:62-70`).
- Opening the port toggles DTR, which resets an Arduino Nano or Uno; bytes sent in the bootloader's 1–2 s are lost.

So:
1. Open; wait `openDelayMs`.
2. Write `%C&` every `synMs` until the first `alive` (an `%A&`, a `%T`, an `%L`) or an `identity`. No answer within `handshakeMs`: state `listening`, which keeps writing `%C&` every 2 s, so a decoder that boots late is still found. That retry runs only while the kind is undecided, and stops `listenMs` (60 s) after open, so a wrong device (a printer, a GPS) isn't written to forever (R1, R7). After that, `listening` only listens.
3. After the first `alive`: wait until `spacingMs` has passed since the last write, then write `%TLHELLO&`. Write it again every 700 ms, up to three times in all, stopping at the first `%TLID` (R7). The window ends `helloMs` after the first `%TLHELLO&`. Every command is a multiple of 3 bytes (`%C&` 3, `%TLHELLO&` 9, `%I&` 3), so a RiCino burst that holds several still ends on a whole command. The hellos are harmless to RiCino: none of their 3-byte chunks matches (review finding 2).
4. `identity` inside or after the window: `tinylap` (below). Window over, no `identity`: `zround`.
5. **Race start, plain ZRound only** (C1, R1). RiCino streams only after `%I&` (`ricino-receiver.ino:81-91`); openstint's protocol code does the same (`openstint-bridge-zround.py:36-39`). If no `%T` or `%L` has come by the end of the window, the session makes the boot (boot first, then write), waits `spacingMs`, and writes `%I&`. If nothing comes within `startMs` (6 s, past RiCino's first clock at 5 s, `ricino-receiver.ino:135-150`), it writes `%I&` again, up to three times in all, each time with a new boot first.
   - A running decoder may well be quiet: with no car on the line, RiCino may send no clock for 5 s, and openstint's protocol sends none before the first passing (`openstint-bridge-zround.py:84-113`). So the state never becomes `listening` here. It stays `choose` (or `ready`), the kind stays `zround`, the last `%I&`'s boot stays, and the first `%T` or `%L` simply flows under it.
   - A repeated `%I&` doesn't reset a running RiCino, which only listens for `%F&` then (`:168-183`). Since each `%I&` comes after a new boot, a decoder that does reset gives no wrong lap either.
   - **Once any `%T` or `%L` has come, or after the last `%I&`, the bridge writes nothing more to a plain decoder.** Every write stalls RiCino's timing loop by about 150 ms (`:160-165`), which would stamp passings late.
   - A decoder that already streams gets no `%I&`. The bridge never writes `%F&`, and never writes `%I&` to a TinyLap decoder.

**The Robitronic start.** The EasyLap streams once the UART is enabled: both EasyLap readers (easylap-server and lappr) never write to the device (R fact 17, code, implicit). So by default the bridge writes nothing. Safe fallback: if no checksum-good frame comes within `handshakeMs`, it writes `frames.start` (`03 B9 01`) up to three times, 500 ms apart, as FlipSide does on connect (R fact 14), then `listening`. Whether the start is ever needed **needs a real-device capture** (§7, item 7).

**Deciding the kind.**

| Seen | Kind | Identity | Next state |
|---|---|---|---|
| `identity`, at any time | `tinylap`, for the rest of the connection | device-reported: `decoder`, `boot` from `%TLID`, as `bridge.js:117-126` | `unpaired` or `ready` |
| the hello window over, no `identity` | `zround` | browser-assigned | `choose` |
| the first checksum-good Robitronic frame | `easylap` | browser-assigned | `choose` |
| no answer within `handshakeMs` | still unknown | — | `listening` |

- **`listening` is not an error** and doesn't close the port (today `elements/bridge.js:267` closes it). It means the kind is still undecided. The first `alive` later moves on as the table says. A plain decoder that was decided never goes back to `listening` (R1).
- **Once TinyLap, always TinyLap** for that connection (I5). A clock back sends `hello()` (`bridge.js:127-131`): the state is `connecting`, stamping stops (passings are held, below), the old identity and boot stay, and `%TLHELLO&` repeats every `helloMs` until a `%TLID` answers. It never falls back to `zround`.
- **A late `%TLID`** (I6), after the window decided `zround`: a TinyLap firmware that lost three hellos, or one that answered the `%I&` with `%TLID` (as `packages/timing/simulator.js:63-67` does). The kind becomes `tinylap`. Then:
  - the session waits for the flush in flight (`#flushing`, `bridge.js:178-181`), then drops this connection's unsent browser-stamped passings, and its held ones. **They are never re-stamped** (R4). For a late `%TLID` (the kind was `zround`), this drop wins over the stamping of held passings below: only passings that arrive after the `%TLID` are stamped with it (F2). A TinyLap decoder sends `%TLID` unprompted whenever its boot changes (`docs/timing.md:33`), so a late `%TLID` is most often a reboot: the passings before it belong to a boot the bridge never knew, and under the new boot they would make bogus laps and, with Wi-Fi, copies that don't dedupe. No clock check can tell a reboot apart, since a TinyLap decoder may send no `%T` at all (`public/sim-port.js:26-28`);
  - passings already posted under the browser identity stay on the server. This is rare: posting needs `ready`, which needs the member's click in `choose` (§3.2) after the window;
  - `tl-bridge` forgets the remembered choice for this device (§3.2).
- **`pair()` and the Wi-Fi command** reject with "This decoder can't be paired over the cable." when `kind` is `zround` or `easylap` (I3). While the kind is undecided, `pair()` writes as today, so `test/bridge.test.js:239-248` stays valid.

**Browser-assigned identity.** After the kind is decided the state is `choose`. `assign(decoderId)` sets the decoder, goes to `ready`, stamps the held passings, and flushes. It is the browser-side counterpart of `pair()` and writes nothing to the device.

**Held passings** (I4, R2, R3).
- **The boot rules run live**, as events arrive, in every state: they need no decoder id. Clocks and resets are never held; only the latest clock is kept, outside the queue.
- **Only passings are held**: from open until the kind is decided, in `choose`, and in TinyLap's `connecting` after a clock back. Each is held as `{ boot, transponder, t, hits, strength }`, with the boot current when it arrived (for a TinyLap re-hello, the boot is set when the `%TLID` answers). A passing held before any boot exists takes the first boot the session makes (F1). The cap is 500 passings, oldest dropped first; at an EasyLap's 250 ms heartbeat, a cap on all events would have lasted about 2 minutes.
- **On `assign()`, or a `%TLID` with a paired decoder**, the session stamps each held passing with the decoder id and adds them to the outbox in arrival order, with the preview's lap steps.
- **One chain** (R3). The read loop's handlers (`bridge.js:93-96`), `assign()`'s stamping and a `%TLID`'s stamping run on one promise queue (`#serial`), so a live passing waits until the held ones are in.
- An unpaired TinyLap decoder's held passings are dropped, as today's `bridge.js:134` drops them. `close()` drops the queue.

**Boots for a browser-assigned decoder.** A new `randomBoot()` (`passing.js:29`), and the preview's references cleared, whenever:
1. the kind is decided (once per connect, owner's decision), or the bridge writes `%I&` or a Robitronic start (the boot first, then the write);
2. a `reset` event comes in (a decoder that reports `%I&`);
3. a checksum-good `clock` is lower than the last clock (the existing check, `bridge.js:127-131`);
4. a `passing` is more than `MIN_LAP_MS` (1500, `laps.js:10`) below the latest `t` seen in this boot. Plain decoders may send no `%T` clocks at all; the slack lets two cars' passings arrive slightly out of order. TinyLap keeps today's rule: only a clock back asks again.

A Robitronic clock that wraps (2^24 or 2^32 ms, R fact 13) falls under rule 3: a new boot, one lap lost per car, once in 4.66 h at worst.

**Boots for a TinyLap decoder.** Unchanged: from `%TLID`, and `hello()` again on a clock back.

**Passings** are stamped only in `ready`. `hits` and `strength` go into the `passing` event's detail for the preview, not into the outbox.

**`tl-bridge` vs `Bridge`.** The split stays as step three drew it: `Bridge` has no DOM. `tl-bridge` picks the transport, builds the link (§5.4 for simulators), shows the section for each state, and runs the choose form and `devices.js` (§3.2). The run object (`elements/bridge.js:92`) gains `transport: 'serial' | 'hid' | null`, the last one used, for "Connect again".

**The run guard** (I13, R6). After each await in `connect` (the pick, `devices.recall`, the decoder-list GET, `openOutbox`, `start`) and in the choose submit (the POST, `remember`), `tl-bridge` returns if `run !== this.run`, as `elements/bridge.js:259`, `:264`, `:337` do today. Code that runs on a `Bridge` event (filling the choose form when `choose` opens) also checks `run.bridge === next`, as `:268` does. A choose answer that lands after a move calls neither `remember` nor `assign`.

**One decoder-list GET per connect** (R6). `connect` GETs `/workspaces/:id/decoders` once, before it constructs the `Bridge`, and keeps the answer and its `Date` header on the run. The remembered choice (§3.2), the in-use marks and the submit check all use it. If the GET fails (offline, a 5xx), the server-rendered options stay as they are, with no in-use marks; the remembered decoder is preselected if it is among them; and the submit skips the existing-id check, so a decoder removed meanwhile 404s later and its passings are dropped, as for any removed decoder (F3).

### 2.5 The Robitronic reader (`packages/timing/robitronic.js`)

Everything here is R§1.2–1.4. **Needs a real-device capture** marks the low-confidence points; §7 lists them again.

**Framing.** `[len, ck, type, payload…]`, `len` counting itself, numbers little-endian, no delimiter (R fact 7).
- The reader keeps a buffer (cap 256 bytes; past it the buffer is cleared, as `packages/timing/zround.js:95`).
- At the buffer's start it accepts only a known `(len, type)` pair: `(0x0B, 0x83)` or `(0x0D, 0x84)`. Anything else drops one byte and looks again. That resyncs after garbage, a cut frame, or the `00` the decoder may answer to a start (R fact 14).
- An incomplete frame waits for more bytes.

**Checksum.** CRC-8, poly `0x07`, init `0xDE`, not reflected, no final XOR, over the whole frame with byte 1 read as `00` (R fact 18). **Needs a real-device capture**: derived by brute force, and no known software checks it. The review re-ran it over all six frames (`review-dec-crc.log`).

**A frame that fails the checksum is never used** (I9). It is skipped, the reader resyncs one byte on (not a frame length), counts it (`reader.mismatches`), and yields `noise: checksum`. It never moves the clock, never makes a boot, never decides the kind, and never posts. The first mismatch of a connect goes to `console.warn` once, with the frame in hex, so a tester can report it.

Why the first draft kept such frames, and why that was wrong:
- It kept them so that a wrong CRC derivation wouldn't make every EasyLap unusable.
- But the CRC fits four published frames from independent programs, two of them host commands, and it is the only CRC-8 family that fits (R fact 18). If it were still wrong, every frame would fail at once, which a capture shows in seconds (§7, item 3).
- A wrong frame that is used costs every car a lap (rule 3) or posts a phantom transponder. The reader starts mid-stream on nearly every connect, so false syncs on `0B ?? 83` / `0D ?? 84` are routine, and the CRC is what rejects them (a false sync passes it 1 time in 256).
- So the safe default is to drop. There is no strict/lenient flag.

**Passing, type `0x84`, 13 bytes** (R fact 8): `0D ck 84 | id u32 LE (3–6) | t u32 LE (7–10) | hits u8 (11) | strength u8 (12)`.
- Both u32s are read with `DataView.getUint32(offset, true)`, or `(b0 | b1 << 8 | b2 << 16 | b3 << 24) >>> 0`. The fourth byte shifts by **24**. The public `<< 32` (R§3) is `<< 0` in JavaScript and must not be copied; a test pins it (§6.1).
- **The id is all four bytes** (lappr, RicinoNext; Robitronic sends 24 bits, R fact 19). **Needs a real-device capture**: FlipSide and easylap-server read only bytes 3–4 (R fact 9). Reading u32 gives the same code for a transponder either way, as long as bytes 5–6 don't change between passings; a capture confirms they don't. `ID_BYTES = 4` is one constant in `robitronic.js` should the capture say 2.
- **Transponder code**: `id.toString(16).toUpperCase()`, no leading zeros, so it passes `TRANSPONDER` (`passing.js:12`). `0x081E` → `81E`, `0x123456` → `123456`. Whether the printed transponder label is this number in decimal **needs a real-device capture** (R§4 q2); the code stays hex either way, and the preview shows it (§4).
- **Time**: milliseconds (R fact 11), `t = getUint32(7, true)`.

**Heartbeat, type `0x83`, 11 bytes** (R fact 10): `0B ck 83 | t u32 LE (3–6) | 4 tail bytes`. It yields `clock`. The tail (`14 D0 01 02` or `… 03`) is ignored, apart from a `tail` field in the parsed frame for logs. **The interval needs a real-device capture** (250 ms or 1 s, R fact 12), so nothing depends on it.

**Commands** (R§1.4): `frames.start = 03 B9 01`, `frames.reset = 03 B0 02`. The bridge sends `start` only as the fallback above and never sends `reset`. **Clock start and reset need a real-device capture** (R§4 q4).

**Rollover**: 2^24 (lappr's guess) or 2^32. **Needs a real-device capture** or a 4.7 h run. A clock back is a new boot (§2.4), so neither breaks anything.

`parseFrame(bytes)` returns `RobitronicMessage`: `{ type: 'passing', id, transponder, t, hits, strength } | { type: 'heartbeat', t, tail }`, with `checksumOk` on each, or `null` for a `(len, type)` pair it doesn't know. That case is reachable only when `parseFrame` is called directly; the reader never hands it one (m18).

### 2.6 The HID transport (`public/link/hid.js`)

R§1.1, facts 1–6; checked against `lappr-serial.js:115-123`.
- **Picker**: `navigator.hid.requestDevice({ filters: [{ vendorId: 0x10C4, productId: 0x86B9 }] })`. An empty array is a closed picker: `null`, no error (as `NotFoundError` on serial, `elements/bridge.js:78`).
- **Open**: `device.open()`, then `sendFeatureReport(0x50, Uint8Array.of(0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0x03, 0x00))` (38400 big-endian, no parity, no flow, 8 bits, 1 stop), then `sendFeatureReport(0x41, Uint8Array.of(0x01))` (UART on). The data is a `BufferSource` without the report id. No purge: its values conflict between sources (R§3). A rejected `open()` (`NotAllowedError`, as on Linux without a udev rule) is thrown to `tl-bridge`, which shows it as today's errors do (`elements/bridge.js:192-196`), and Connect stays.
- **In**: `inputreport` events; the data is the first `min(reportId, event.data.byteLength)` bytes (1–63). Padding beyond them is ignored (R fact 6, lappr).
- **Out**: one `sendReport(n, bytes)` with `n = bytes.length ≤ 63`, not `n + 1` (pycp2110's bug, R§3). The only write is the 3-byte start fallback, so there is no chunking (m18).
- **Close**: `sendFeatureReport(0x41, Uint8Array.of(0x00))` (errors ignored), remove the listeners, `device.close()`. A `disconnect` event on the injected `hid` whose `event.device === device` ends `bytes()`, and the session goes to `disconnected`.
- `device` is `hid:${vendorId}:${productId}`.

## 3. Pairing and identity per decoder kind

### 3.1 TinyLap decoder: unchanged

`%TLID` tells the decoder id and the boot; an unpaired one shows "Pair this decoder", which creates the decoder (`POST /workspaces/:id/decoders`), sends `%TLPAIR` and, if given, `%TLWIFI`, then asks again (`bridge.js:162-173`, `elements/bridge.js:326-353`). The `made` retry for a failed cable write stays. The decoder then also posts over Wi-Fi with its token, and the server dedupes the cable and Wi-Fi copies by the passing key (`docs/timing.md:9`).

### 3.2 Plain ZRound and EasyLap: browser-assigned

The device has no id and nowhere to store a token. So the member says which decoder it is, **on every connect**:

1. **Choose.** The `choose` section asks "Which decoder is this?". A `<select name="decoder" id="bridge-choose">` lists the club's choosable decoders, rendered by the server, and ends with "A new decoder" (value `""`). A field of its own, `id="bridge-choose-name"`, labelled "Name for the new decoder", names a new one (I10: a second "Decoder name" field would break every `getByLabel('Decoder name')` in the browser tests, `review-dec-pw-label.log`).
2. **Which decoders are choosable** (I7). Two decoders that share an id interleave their boots, so every passing becomes a `start` (`laps.js:21`, `server/engine.js:107`) and no laps count. From data the server already has:
   - the server leaves out decoders with any stored passing `via = 'net'` (`server/ingest.js:34`): they send over Wi-Fi and are TinyLap decoders. This is one new read query in `server/store.js` (`SELECT DISTINCT decoder_id FROM passing WHERE workspace_id = ? AND via = 'net'`), used by the page only, with a new index `passing_net ON passing (workspace_id, via, decoder_id)` so it doesn't scan every passing of the club (R5; only `passing_workspace` exists today, `server/store.js:37-42`). An index only: the decoder table and the API are unchanged;
   - when `choose` opens, `tl-bridge` uses the connect's GET answer (`lastSeenAt`, `server/store.js:281`; `server/setup.js:45`). It measures "seen in the last 2 minutes" (`IN_USE_MS`) against **the server's time**, from the answer's `Date` header, never the laptop's clock, which may be minutes off (R5). Such a decoder's option is `disabled`, with "(in use)" added to its text;
   - **the remembered decoder is not exempt** (R5): a match on the chip may be another decoder (I8). It also reads "(in use)" when it was seen recently, but stays enabled, since a replug a minute ago is the usual reason;
   - an option whose decoder is gone from the list is removed (m24). No markup is built: the script removes nodes, sets `disabled` and sets `textContent`;
   - **`reset` puts the server's choose form back** (R6). Each `<option>` carries `data-name`, its server-rendered name. `reset(run)` (`elements/bridge.js:129-138`) restores the heading to "Which decoder is this?", every option's text from `data-name`, `disabled = false`, and the preselect of "A new decoder". Removed options stay removed: their decoder is gone;
   - under the select: "Choose an existing decoder only if it is this same device. A decoder that another laptop uses needs its own."
3. **The remembered choice** (I8). `device` is the USB chip (CH340 `1A86:7523`, FTDI `0403:6001`, CP210x `10C4:EA60`), not the decoder, so a match only suggests. With a remembered decoder that is still listed, `choose` shows with it preselected, the heading "Is this Gate?" (set as `textContent`), and focus on "Use this decoder". So connecting is one extra click, and a different decoder on the same chip is never forwarded unnoticed. Without one, "A new decoder" is preselected and the heading is "Which decoder is this?".
4. **Submit.** For a new one: `POST /workspaces/:id/decoders` with the name, as today. The token in the answer is neither used nor kept, since the bridge posts with the member's session (`server/ingest.js:40-44`). For an existing one there is nothing to post, but its id is checked against the connect's GET answer first; if it is gone, the option is removed and the form says "That decoder was removed. Choose another." Then `devices.remember(workspace, device, decoderId)` and `bridge.assign(decoderId)`, both behind the run guard (§2.4).

`devices.js` is a separate IndexedDB database, `tinylap-bridge-devices`, one store keyed `[workspace, device]` → `{ decoder }`, with the memory fallback of `outbox.js:43-55`. That is all it keeps: there is no boot and no clock (owner's decision). `outbox.js` and its database are untouched. Its API is `recall`, `remember` and `forget` (the last used on a late `%TLID`, §2.4, and when the remembered decoder is gone).

`made` (`elements/bridge.js:83-93`) is TinyLap-only: a browser-assigned pairing has no cable write that can fail after the POST.

### 3.3 What the server stores

Nothing new. A browser-assigned decoder is a row in `decoder` (`server/store.js:32`) with a name and a token hash, like any other. Its passings come through the session path of `POST /decoders/:id/passings` with `via = 'serial'`, as today. **No API change**: the 401/403/404/422 handling (`docs/timing.md:45`, `bridge.js:217-275`) applies as it is. A browser-assigned decoder can't use Wi-Fi; its token is simply never used. Setup's decoder list (`views/setup.js:91-97`) shows it like any other. Its "Unpair" (`views/setup.js:96`) is the only way to remove it. Removing one while it forwards makes its passings 404, and they are dropped, as for any removed decoder.

## 4. Page and UI

The implementer uses the `frontend-design` skill (CLAUDE.local.md) and checks 390×844 and 1280×800. The look doesn't change: the new sections reuse `card-static stack-md`, `status`, `field` and `btn` from palace-ui, and no new CSS is expected.

### 4.1 Serial or HID: two buttons

One button can't open both pickers: the first picker uses up the click's user activation. So the Connect section has two:

```html
<section data-bridge-state="connect" hidden class="card-static stack-md">
  <p>Plug the decoder in by USB, then connect. Keep this tab open while racing; the board runs in any other tab or screen.</p>
  <p>
    <button type="button" class="btn btn-primary btn-lg" data-bridge-connect="serial">Connect decoder</button>
    <button type="button" class="btn btn-secondary btn-lg" data-bridge-connect="hid">Connect EasyLap</button>
  </p>
  <p>An EasyLap? Use Connect EasyLap: it doesn't show up in the decoder list.</p>
  <p class="status status-warning" data-bridge-missing="serial" hidden>This browser can't reach USB decoders, only an EasyLap.</p>
  <p class="status status-warning" data-bridge-missing="hid" hidden>This browser can't reach an EasyLap, only other USB decoders.</p>
</section>
```

The two buttons sit inline in one paragraph and wrap at phone width; palace 0.12 has no cluster helper (`btn-secondary` exists). If their spacing needs a rule, it goes in `app.css`, or upstream in palace-ui if it is generic (AGENTS.md).

- "Connect decoder" keeps its name (every browser test clicks it) and covers TinyLap and ZRound decoders. It stays first in DOM order, so the step-three tests' `querySelector('[data-bridge-connect]')` still clicks it.
- When one API is missing (`serial` or `hid` not in `navigator`), `tl-bridge` hides that button and shows its `data-bridge-missing` note; `reset` (`elements/bridge.js:129-138`) puts both back. The rule applies to `serial` and `hid` buttons only, never to `last` ones (m20). `supported` (`:27`) becomes `'serial' in navigator || 'hid' in navigator`. With a simulation installed both APIs exist (§5.4), so both buttons show and no missing-API note does.
- "Connect again" and "Try another device" carry `data-bridge-connect="last"`: the run's last transport.

### 4.2 States and what each says

| State | Section (server-rendered) | Live text (`STATE_TEXT`, `elements/bridge.js:64-70`) |
|---|---|---|
| `unsupported` | "The bridge needs Chrome or Edge on a laptop, with JavaScript on: it reads the decoder over USB with Web Serial, or an EasyLap with WebHID." (R8) + today's Wi-Fi and tap links (`views/bridge.js:36-39`) | — |
| `connect` | §4.1 | "Ready to connect." |
| `connecting` | "Talking to the decoder…" (unchanged) | "Talking to the decoder." |
| `listening` (replaces `not-tinylap`, `views/bridge.js:45-48`) | `<p class="status status-warning" data-bridge-listening>Connected, but nothing has come from this device yet.</p><p>A decoder answers within a few seconds. If this is the wrong device, try another.</p>` + "Try another device" | "Connected. Nothing from the device yet." When the reader has counted checksum mismatches (R8): "Data is coming, but it can't be read. Report this device." (set as `textContent` of `[data-bridge-listening]`, and put back by `reset`) |
| `unpaired` (TinyLap) | unchanged: "Pair this decoder", Wi-Fi fields, "Pair" | "The decoder is not paired yet." |
| `choose` (ZRound, EasyLap) | `<h2 class="h3" data-bridge-choose-heading>Which decoder is this?</h2><p data-bridge-kind></p><p>If it comes unplugged, crossings until you connect again are lost, and each car's lap starts over.</p>` + select, the note under it (§3.2), name field, "Use this decoder" | "Choose which decoder this is." |
| `ready` | unchanged | "Forwarding from Gate", and the offline texts, unchanged |
| `disconnected` | unchanged, "Connect again", plus `<p data-bridge-gap hidden>Crossings while it is unplugged are lost, and each car's lap starts over when you connect again.</p>` | "Decoder disconnected." |

- `[data-bridge-kind]` gets plain text from a constant (m20): "This decoder speaks plain ZRound, so it can't keep a pairing. This browser remembers which decoder it is for this club." For an EasyLap: "An EasyLap can't keep a pairing. This browser remembers which decoder it is for this club." "This club" becomes "your personal space" from the server's `where` (`views/bridge.js:23`), passed as a `data-` attribute.
- `[data-bridge-gap]` shows only after a browser-assigned decoder disconnects. A TinyLap decoder keeps its boot, and with Wi-Fi its crossings too.
- The submit button says "Use this decoder" in both cases, so the action names what happens; the next state's line, "Forwarding from Gate", confirms it.
- A blank new name keeps today's check and text: "A decoder name is 1 to 60 characters." (`elements/bridge.js:332`).
- The listening text is a warning, not an error: nothing failed, and the device may still speak. "Try another device" fits both pickers (m20).
- Glossary: "club", "personal space", never "workspace"; `test/server/glossary.test.js` scans the new strings.

## 5. Simulators

### 5.1 The track (`public/sim/track.js`, over `packages/timing/simulator.js`)

`createTrack({ cars, jitterMs = 150, noise = {}, random = Math.random })` with `cars: { id: number, lapMs: number }[]`. `advance(until)` returns crossings in time order, `{ id, t, hits, strength }`, from the car loop of `packages/timing/simulator.js:24-49`. That loop moves into `createTrack` in `packages/timing`; `createSimulator` uses it and keeps its API, so the repo-root `tools/decoder-sim.js` and `packages/timing/test/simulator.test.js` don't change. `track.reset(now)` shifts every car's next crossing back by `now`, as `simulator.js:65`.

`noise` (all off by default, so today's simulated laps are unchanged):
- `double`: the chance a crossing is reported twice, 50–300 ms apart;
- `miss`: the chance a crossing is lost;
- `garbage`: the chance of random bytes between messages.

`hits` and `strength` are random in plausible ranges (R fact 20 has no scale; 5–60 and 100–255).

### 5.2 Device models

A model turns crossings and host writes into device output. It never touches a transport.

```js
{
  transport: 'serial' | 'hid',
  info: { usbVendorId, usbProductId } | { vendorId, productId, productName },
  start(now): Uint8Array[],               // after open (and, on HID, after UART enable)
  tick(now): Uint8Array[],                // every 100 ms: clocks, heartbeats, passings
  write(bytes, now): Uint8Array[],        // answers to host writes
}
```

| Model | Transport | What it sends | Answers |
|---|---|---|---|
| `tinylap` | serial, `1209:0001` (`sim-port.js:33-34`) | `%L…&` per crossing, as `sim-port.js:26-28` | `createSimulator.reply` (`simulator.js:51-71`), unchanged: `%TLID`, `%TLOK&`, `%A&`, new boot on `%I&` |
| `zround` | serial, `0403:6001` | **nothing until `%I&`** (C1). Then `%T<hex>&` every second and `%L<hex id>,<hex t>&` per crossing, from a clock zeroed at `%I&` | `%A&` to `%C&`, 21 times 100 ms apart, reading nothing meanwhile; ignores every `%TL…`; `%F&` stops it again |
| `easylap` | hid, `10C4:86B9`, "EasyLap USB" | heartbeat `0x83` every 250 ms and passing `0x84` per crossing, from UART enable; tail `14 D0 01 03` | `00` to `03 B9 01`, which zeroes its clock; `03 B0 02` zeroes it too |

- The `zround` model reads like RiCino (`ricino-receiver.ino:53-58`): its input is consumed in bursts, and only the last 3-byte chunk of each burst counts. So a bridge that writes `%C&%TLHELLO&` back to back fails D1, as the real firmware would.
- `zround` options: `waitsForStart` (default `true`; `false` is a free-running decoder that streams from open) and `bootMs` (default 1500: the bytes of the first `bootMs` after open are lost, as on an Arduino that resets on DTR; 0 for none). It is the model's own knob, separate from the session's `openDelayMs` (R9).
- The models build their output with `commands` (`packages/timing/zround.js:105-122`) and `frames` (§2.5). The `easylap` model's transponders have 24-bit ids (`0x0A1B2C + i`).

### 5.3 Fake transports

- **`fakeSerialPort(model)`** (`public/sim/serial-port.js`): today's `sim-port.js` shape: `readable`, `writable` with JS sink and source, `open`, `close`, `getInfo`. Keeping that shape keeps the stream-counting init scripts of `test/browser/bridge-element.test.js:33-56` valid. `unplug()` closes the readable, as the `__unplug` init script does today (`test/browser/bridge.test.js:231-235`) (m22).
- **`fakeHidDevice(model, { hid })`** (`public/sim/hid-device.js`): an `EventTarget` with `vendorId`, `productId`, `productName`, `opened`, `open`, `close`, `sendFeatureReport`, `sendReport`, and `inputreport` events.
  - The handshake is enforced: before `0x50` with exactly the EasyLap config and `0x41 [01]`, nothing is sent, and a `sendReport` rejects. `0x41 [00]` stops it. It records the feature reports in `log` for tests.
  - It splits and merges frames across reports at random lengths 1–63 (R§1.5), seeded, to exercise reassembly. Its `data` `DataView`s alternate between exact length and 63 bytes padded with zeros (m17).
  - A `sendReport(n, data)` whose `n` isn't `data.length` rejects, which catches the `n + 1` bug.
  - `failOpen` makes `open()` reject with `NotAllowedError`. `unplug()` fires a `disconnect` on its fake `hid`.

### 5.4 Picking a model: a server setting, injected at the platform boundary

The simulator is a server setting, and it is injected in place of the platform's pickers (owner, 2026-10-21). Production components don't change for it: `tl-bridge` and `Bridge` contain no simulation code, call Web Serial and WebHID exactly as with hardware, and never call `simulation()`. Production never sets the setting, so nothing of the simulator is rendered or loaded there.

- **The setting:** `TINYLAP_SIMULATE=<model>[,fast]`, where `<model>` is `tinylap`, `zround` or `easylap`, and `,fast` makes a lap 2 s instead of 8 s. Unset or empty: no simulation.
  - `server/main.js` reads it with the timing server's other settings (`main.js:25-84`) and checks it with `readSimulate` (`server/simulate.js`). A value in any other format stops the server with a message, as a bad `TINYLAP_TOKEN_KEYS` does (`main.js:47-49`).
  - It reaches the handler as `settings.simulate` (`server/app.js`). One `settings` object is shared by every request, so a test can change it on a running server.
- **Tests:** `startTiming({ simulate: 'zround,fast' })`, and between tests `app.simulate = 'easylap'` or `app.simulate = null`. A test that needs a device of its own (silent, failing, noisy) keeps the setting off and stubs `navigator.serial` or `navigator.hid` with an init script, as today's tests do.
- **The injection:** with the setting on, the layout renders `<script type="module" src="…/public/sim/install.js" data-model="zround,fast"></script>` after the import map and before the page's own scripts. Module scripts run in document order, so it runs before `tl-bridge`'s module. It is same-origin, so the CSP's `script-src 'self'` covers it with no hash. Today only the bridge page carries the import map that `install.js` needs, and the layout renders it only on pages that have one.
- **`public/sim/install.js`:** reads its `data-model` through `simulation(value)` (`public/sim/models.js`, which parses that format), then replaces the platform's entry points:
  - `navigator.serial.requestPort` and `getPorts`, and `navigator.hid.requestDevice` and `getDevices`, defining `navigator.serial` and `navigator.hid` (each an `EventTarget`) where the browser has none;
  - `requestPort` returns a fresh `fakeSerialPort`, and `requestDevice` a fresh `[fakeHidDevice]` with the page's `navigator.hid` as its disconnect source, for the configured model's transport. The other transport acts as a closed picker: `requestPort` rejects with `NotFoundError`, and `requestDevice` resolves `[]`. No device of that kind is plugged in;
  - `getPorts` and `getDevices` resolve `[]`: nothing is granted ahead of a click.
- **The start:** the simulation starts when the member clicks Connect, because `requestPort` and `requestDevice` are what return the fake: the same moment and user gesture as with hardware. The rest of the flow is unchanged: the handshake, choose, forwarding.
- **Serving:** the server answers `…/public/sim/install.js` with a 404 while the setting is off. That is the one file that changes the page's platform, so production can't load it even by hand. The rest of `public/sim/` and `public/sim-port.js` stay served like any static file. They are inert modules that nothing in production imports, and the tests' own stubs import them.

`public/sim/models.js` holds a registry, `{ tinylap, zround, easylap }`. A later AMB model is one more entry. Every pick makes a fresh model and device, as `elements/bridge.js:74` does today (m22): an unplug and Connect again is a new device, which matches the owner's decision.

| Setting | Model | Lap |
|---|---|---|
| unset or empty | none: real Web Serial and WebHID; `install.js` not rendered, and a 404 | — |
| `tinylap` | `tinylap` | 8 s |
| `tinylap,fast` | `tinylap` | 2 s (today's `?simulate=fast` tests) |
| `zround`, `easylap` | that model | 8 s |
| `zround,fast`, `easylap,fast` | that model | 2 s |
| any other value | the server refuses to start; `simulation()` in `install.js` warns and takes `tinylap` | — |

## 6. Test plan

### 6.1 Unit tests

**New: `packages/timing/test/robitronic.test.js`**
1. **`crc8`** (m15). The four published frames pin it: `0D BD 84 1E 08 00 00 E7 36 00 00 55 F9`, `0B 5C 83 9B 3A 00 00 14 D0 01 02`, `03 B9 01`, `03 B0 02`. The two frames generated with it (`0B 58 83 00 00 00 00 14 D0 01 02`, `0D D9 84 56 34 12 00 39 30 00 00 0C C8`, R§1.5) pin `frames.heartbeat` and `frames.passing`.
2. The published passing: `{ type: 'passing', id: 0x081E, transponder: '81E', t: 14055, hits: 0x55, strength: 0xF9, checksumOk: true }`. The generated one: `'123456'`, `12345`, `12`, `200`.
3. The published heartbeat: `{ type: 'heartbeat', t: 15003, tail: [0x14, 0xD0, 0x01, 0x02] }`.
4. **The fourth byte** (m14). A passing with id `0x12345678` and `t = 0x01000000` reads `'12345678'` and `16777216`. The `<< 32` bug reads `t = 1` and the id `0x34567A`; `<< 16` reads 65536.
5. `frames.passing` and `frames.heartbeat` round-trip through the reader.
6. The reader, on the stream `garbage · heartbeat · 00 · passing · passing`: split at every byte position, and as one chunk, it yields the same three frames.
7. A frame cut in the middle, then a whole frame: the whole frame is read.
8. **A wrong checksum** (I9): the frame is not yielded, `noise: checksum` is, `mismatches === 1`, and the next good frame reads.
9. **A false sync at the start** (I9): a stream that begins mid-frame with bytes forming `0D xx 84 …` with a bad checksum yields nothing for them, and the first real frame after them reads.
10. A buffer past 256 bytes of junk is cleared, and the next frame reads.
11. `parseFrame` on an unknown `(len, type)` returns `null`.

**`packages/timing/test/simulator.test.js`**: kept. New: `createTrack` with a seeded `random` gives the same crossings as today's `createSimulator`; `double` and `miss` change only what they say.

**`packages/timing/test/zround.test.js`**: unchanged.

**New: `test/link.test.js`**
- `hidTransport` over `fakeHidDevice` with an injected `hid` (m17), in Node:
  - the feature reports are `0x50 [00 00 96 00 00 00 03 00]`, then `0x41 [01]`, in that order;
  - a 3-byte write is `sendReport(3, …)`;
  - padded and exact-length reports read the same bytes;
  - `close` sends `0x41 [00]`;
  - a `disconnect` for another device changes nothing, and one for this device ends `bytes()`;
  - `failOpen` rejects `open()` with `NotAllowedError`.
- `serialTransport` opens at the protocol's baud rate.
- `zroundProtocol` maps every `parseMessage` type (§2.3), `alive` included.

**`test/bridge.test.js`**: all 15 tests are kept. One is adapted, consciously:
- `:85` "a device that does not answer is not a TinyLap decoder" becomes "a device that says nothing is listening, not an error; a lost port is disconnected". Silent, `handshakeMs: 20` → `listening`, and the port stays open; then `end()` → `disconnected`. The old state no longer exists.

The TinyLap tests (`:39`, `:63`, `:223`) stay verbatim and pin goal 2. `:239` stays verbatim too: the kind is undecided on its silent port, so `pair()` writes as today (I3). A helper `modelPort(model)` next to `fakePort` (`:12-29`) feeds writes to `model.write` and enqueues its output (m25). `fakePort` stays for the existing tests.

New tests:
- **The TinyLap handshake** (C2, I12): with the `tinylap` model, the writes are `%C&` (possibly repeated), then `%TLHELLO&` only after the first `%A&` and at least `spacingMs` after the last `%C&`. No `%I&` is written. Every `state` event is recorded: a TinyLap decoder never passes through `choose` or `listening`.
- **Open delay and retry** (C2, R9): a `zround` model with `bootMs: 50` and a session with `openDelayMs: 60` answers the first `%C&`. With `openDelayMs: 0`, the first `%C&` is lost and the retry still gets `%A&`.
- **Plain ZRound, waiting for start** (C1): with the `zround` model on `modelPort`, `kind === 'zround'` and state `choose` after the window; exactly one `%I&` is written, after the boot is made, and `spacingMs` after the last `%TLHELLO&`; `assign('dec_9')` → `ready`; two laps are posted with `decoder: 'dec_9'` and a boot matching `BOOT_ID`. No `%TLPAIR`, `%TLWIFI` or `%F&` is ever written, and `pair()` rejects.
- **`%I&` retried** (R1): a model that ignores the first `%I&` gets a second, each with a new boot first, `startMs` apart. One that ignores all three stays `choose` (never `listening`), and a passing it sends later is stamped with the last `%I&`'s boot. After the last `%I&`, and after the first `%T` or `%L`, nothing more is written.
- **A quiet running decoder** (R1): a model that answers `%I&` but sends its first clock only after 5 s gets one `%I&`, not two.
- **The `listening` retry ends** (R1, R7): on a silent port, `%C&` stops after `listenMs`.
- **The hello repeats stop** (R7): a TinyLap decoder that answers the first `%TLHELLO&` gets no second.
- **A free-running plain decoder** (`waitsForStart: false`): no `%I&` is written.
- **Held passings** (I4, R2): a free-running decoder whose first passing comes 100 ms after open, and passings during `choose`, are all posted after `assign()`, in order, each with the boot current when it arrived (a clock back during `choose` splits them over two boots). Heartbeats are not held: 600 EasyLap heartbeats during `choose` drop no passing. `close()` before `assign()` posts nothing.
- **One chain** (R3): a live passing that arrives while `assign()` is stamping held ones lands after them in the outbox, and the preview's laps follow arrival order.
- **Once TinyLap** (I5): a TinyLap decoder whose re-hello after a clock back is lost twice stays `tinylap` in `connecting`, repeats `%TLHELLO&`, and goes `ready` with the new boot when it answers. Its passings in between are posted with that boot.
- **A late `%TLID`** (I6, R4): a decoder decided `zround`, assigned `dec_9`, with two unsent passings and a flush held in flight, then sends `%TLID dec_1 b00tb00t`. It becomes `tinylap`; once the flush is answered, the outbox holds no passing under `dec_9`, and none was re-stamped under `dec_1`.
- **Boots, ZRound**: a new boot and cleared references on a received `%I&`, on a clock back, and on a passing more than 1.5 s back; no new boot for one 1 s back.
- **A reconnect is a new boot** (owner's decision): close and start a new `Bridge` on the same model; the boots differ.
- **EasyLap** (`fakeHidDevice` + `robitronicProtocol`): `kind === 'easylap'` on the first checksum-good heartbeat; `assign` → `ready`; the generated passing is posted as `{ transponder: '123456', t: 12345 }`; a heartbeat back is a new boot. Writes: none while frames come.
- **EasyLap checksum** (I9): a corrupted heartbeat whose `t` is back in time makes no new boot, and a corrupted passing is never posted.
- **EasyLap start fallback**: a model silent until `03 B9 01` gets it after `handshakeMs`, at most three times, and then forwards.
- **No write after close** (I13): `close()` between two handshake writes; nothing more is written.

**New `test/server/simulate.test.js`**: `readSimulate` takes `tinylap`, `zround,fast` and `easylap`, gives `null` for unset or empty, and throws for `amb`, `zround,slow` and ` tinylap`. The bridge page has the `install.js` script, with `data-model`, before `elements/bridge.js` exactly when the setting is on; `install.js` is a 404 while it is off; and both follow `app.simulate` on a running server.

**`test/sim.test.js`** (from the models task) gains `install.js` in Node: with a stub `navigator` (no `serial`, no `hid`), it defines both; the model's transport returns a fake device, the other is a closed picker, and `getPorts`/`getDevices` resolve `[]`.

**`test/outbox.test.js`**: unchanged. **New `test/devices.test.js`**: remember, recall, forget, the memory fallback, and the record holds only `{ decoder }`.

**`test/server/bridge-pages.test.js`**:
- The state list (`:25`) loses `not-tinylap` and gains `listening` and `choose`.
- New: both Connect buttons, the serial one first; the two missing-API notes, hidden; and the choose form's own field `bridge-choose-name`, with exactly one "Decoder name" label on the page.
- New: the club's decoders as `<option>`s, escaped, with "A new decoder" last. A decoder with a `via = 'net'` passing is not offered (I7).

### 6.2 Browser tests

Every existing test in `test/browser/bridge.test.js` and `bridge-element.test.js` is kept. Those on `?simulate=fast` switch to the server setting `tinylap,fast` (`app.simulate`, §5.4); those on real Web Serial stubs keep the setting off. Two are adapted:
- `bridge.test.js:50` "without Web Serial, the notice stays": it deletes `Navigator.prototype.hid` too. New next to it: "with WebHID only, just Connect EasyLap is offered, and the note says USB decoders can't be reached".
- `bridge.test.js:41` and `:55`: the new `unsupported` sentence keeps "needs Chrome or Edge", so `/needs Chrome or Edge/` still matches (m16).

E1–E7 (step three §4) run unchanged: `sim-port.js` keeps its streams (§5.3), and Connect decoder stays the first `[data-bridge-connect]`. The `SERIAL` init scripts that import `/public/sim-port.js` (`bridge.test.js:219-244`) keep working.

New, in `test/browser/decoders.test.js`:
- **D1 Plain ZRound** (setting `zround,fast`, RiCino-style reads, waiting for `%I&`): Connect decoder → "Which decoder is this?" → "Name for the new decoder" "Gate" → "Use this decoder" → "Forwarding from Gate" → a preview row. The store has one decoder "Gate", and the engine has crossings.
- **D2 Remembered, confirmed** (I8): Connect again → "Is this Gate?" with Gate preselected and focus on "Use this decoder"; nothing is posted before the click; no `POST …/decoders`.
- **D3 Removed on the server**: delete "Gate" through `app.api`, reconnect → "Which decoder is this?", Gate is not an option, and no POST goes to `/decoders/<old id>/passings`.
- **D4 An existing decoder**: pick it in the select; no `POST …/decoders`. A decoder removed after the page loaded, then chosen: its option goes and the form says so (m24).
- **D5 In use** (I7, R5): a decoder posted to within 2 minutes (through `app.api`) is `disabled` and reads "(in use)". The remembered one reads "(in use)" too but stays enabled. With the page's clock moved 10 minutes ahead (an init script), the marks are the same: they follow the server's `Date`.
- **E4d Reset of the choose form** (R6): at "Is this Gate?" with an option disabled, move the element, then Connect again: the heading reads "Which decoder is this?" until the new run's remembered match applies, every option's text comes from `data-name`, and none is disabled before the new GET answers.
- **D14 The connect GET fails** (F3): with `/workspaces/*/decoders` routed to a 503, Connect decoder with the setting `zround,fast` shows the server-rendered options unchanged, with none disabled or marked "(in use)"; the remembered decoder is preselected; and "Use this decoder" goes to "Forwarding from Gate" with no `POST …/decoders`.
- **D13 Unreadable EasyLap** (R8): a fake device whose frames all fail the checksum: `listening` says "Data is coming, but it can't be read. Report this device."
- **D6 EasyLap** (setting `easylap,fast`): Connect EasyLap → choose → forward. The preview shows the 24-bit codes as hex. The fake device's `log` shows the two feature reports in order, and removing the element sends `0x41 [00]`.
- **D7 Listening**: a silent serial port (init script) → "Connected, but nothing has come from this device yet.", no alert role; "Try another device" opens one picker.
- **D8 The other button with the setting `easylap,fast`**: Connect decoder acts as a closed picker (nothing opens, no error), and Connect EasyLap opens the simulated EasyLap. Both buttons show and no missing-API note does, even with `serial` and `hid` deleted from `Navigator.prototype` before the page loads. With the setting off, the page has no `install.js`, a GET of it is a 404, and `?simulate=easylap` in the URL changes nothing.
- **D9 A replug** (owner's decision): forward from "Gate", unplug, Connect again, confirm. The disconnected section shows the lost-crossings note. The passings after the replug carry a new boot, and each car's first passing after it is a start, not a lap.
- **D10 Noise**: `zround` with `double` and `garbage` on: no page error, and the preview shows laps.
- **D11 HID picker closed** (I12): `requestDevice` resolves `[]` → no error, and Connect stays (the WebHID twin of E4c).
- **D12 HID open refused** (I12): `failOpen` → the error shows as an alert, and Connect stays.
- **E3c and E6c** (I13): a removal while the decoder-list GET is held opens nothing; a choose POST that lands after a move writes nothing, with no `remember` and no `assign`.

### 6.3 Mutation targets

| Mutation | Caught by |
|---|---|
| robitronic: fourth byte `<< 32`, or `<< 16` | unit 4 |
| robitronic: id from bytes 3–4 only | unit 2 (generated frame `123456`) |
| robitronic: no resync, or resync by a frame length | unit 6, 7, 9 |
| robitronic: a bad-checksum frame yielded, or used for the clock | unit 8, 9; the EasyLap checksum test |
| robitronic: CRC init `0x00`, or byte 1 not zeroed | unit 1 |
| robitronic: transponder not upper-case, or zero-padded | unit 2 |
| hid: `sendReport(n + 1, …)` | `link.test.js`, fake device rejects |
| hid: enable before config, or no config | `link.test.js`, D6 |
| hid: data from `event.data.byteLength`, not `reportId` | `link.test.js` (padded reports) |
| hid: no `0x41 [00]` on close | `link.test.js`, D6 |
| hid: `disconnect` not compared by device | `link.test.js` |
| session: `listening` closes the port, or is an error | adapted `:85`, D7 |
| session: `%TLHELLO&` right after `%C&`, or no `%C&` retry | the TinyLap handshake test, open-delay test, D1 |
| session: kind decided on the first `%A&`, before the window | the TinyLap handshake test (no `choose` state) |
| session: no `%I&`, `%I&` before the boot, or `%I&` to TinyLap or a streaming decoder | waiting-for-start, free-running and TinyLap handshake tests |
| session: falls back to `zround` after a lost re-hello | once-TinyLap test |
| session: `%TLID` ignored once the kind is `zround` | late-`%TLID` test |
| session: late `%TLID` leaves passings under the browser id, re-stamps them, or doesn't wait for the flush | late-`%TLID` test |
| session: `listening` after the last `%I&`, or a write after streaming or after the last `%I&` | `%I&` retried test, quiet-decoder test |
| session: `startMs` below RiCino's 5 s clock | quiet-decoder test |
| session: `%C&` in `listening` never stops, or `%TLHELLO&` repeats after a `%TLID` | `listening`-retry and hello-repeat tests |
| session: heartbeats held, or held passings stamped with the boot at `assign()` time | held-passings test |
| session: stamping held passings off the read loop's chain | one-chain test |
| tl-bridge: in-use measured on the laptop's clock, or the remembered decoder exempt | D5 |
| tl-bridge: `reset` doesn't restore the choose form | E4d |
| session: held passings dropped, or stamped out of order | held-passings test |
| session: `pair()` rejects while the kind is undecided | `bridge.test.js:239` |
| session: no new boot on `%I&`, clock back or passing back | ZRound boot test |
| session: new boot on a small passing step back | ZRound boot test (1 s case) |
| session: a boot kept across a reconnect | reconnect test, D9 |
| session: TL commands written to a plain decoder | waiting-for-start test |
| session: a write after `close()` | no-write-after-close test, E3b |
| tl-bridge: a remembered choice forwards without the click | D2 |
| tl-bridge: remembered id not checked against the list | D3 |
| tl-bridge: Wi-Fi or in-use decoders offered | `bridge-pages.test.js`, D5 |
| tl-bridge: a chosen id not checked against the list | D4 |
| tl-bridge: token stored, or a decoder made for an existing choice | D4, `devices.test.js` |
| tl-bridge: a missing API's button still shown, or a `last` button hidden | the WebHID-only browser test |
| tl-bridge: no run guard after the list GET or the choose POST | E3c, E6c |
| simulate: `tinylap,fast` not a 2 s lap | every existing browser test (timeouts) |
| simulate: `install.js` rendered, or served, with the setting off; or `tl-bridge` still reads `location.search` | `server/simulate.js`'s page test; D8 |
| simulate: the other transport returns a device | D8 |
| simulate: `readSimulate` accepts any value | `server/simulate.js`'s test |

**Covered by review only:** the 500-passing cap on held passings, and the `console.warn` on the first checksum mismatch.

## 7. Risks and the real-device checklist

**Risks**
- **TinyLap regressions.** The session rewrite touches `bridge.js`'s glue, and the handshake now writes `%C&` before `%TLHELLO&`. The existing tests stay verbatim (one adapted, `:85`), and the handshake test pins the order. Migrate in steps: (1) transports and readers behind the `port` shorthand, with no behaviour change; (2) the handshake, plain ZRound and `listening`; (3) EasyLap; (4) simulators and `?simulate`. Each commit keeps every test green.
- **`%C&` to existing TinyLap firmware.** It answers `%A&` (`simulator.js:61-62`), as `docs/timing.md:17` requires. Firmware that doesn't implement it ignores it; the handshake moves on at its first `%L` or `%T`, or after `handshakeMs`.
- **Opening the port resets Arduino-based decoders** (DTR). `openDelayMs` and the `%C&` retry cover it. A board that takes longer than `handshakeMs` lands in `listening`, which keeps trying for up to 60 s.
- **A replug or a power cycle costs every car its current lap, and crossings while unplugged are lost** (owner's decision). The page says so (§4.2). A TinyLap decoder with Wi-Fi loses neither.
- **Taking a wrong device for a decoder.** A device that answers `%A&` becomes `zround`. The choose step, which always needs a click, keeps a wrong port from posting anything unnoticed.
- **Same-chip plain decoders share one remembered choice** (`device` is vid:pid). The confirmation in `choose` (I8) and the in-use rule (I7) keep two from posting under one id by accident. The in-use rule can't see a decoder that was idle for more than 2 minutes, nor a TinyLap decoder used only over USB.
- **A late `%TLID` costs passings** (R4). The unsent browser-stamped passings of that connection are dropped, not re-stamped: with Wi-Fi the decoder's own copies cover them; without Wi-Fi those crossings are lost, back to when the member clicked "Use this decoder". Passings already posted stay under the browser identity (§2.4). It needs a TinyLap firmware that lost three hellos, or one that rebooted after the window.
- **EasyLap facts at medium confidence** (R§5). Each low-confidence point is either unused (heartbeat interval, reset), a fallback (start), absorbed (rollover as a new boot), or behind one constant (`ID_BYTES`). A wrong CRC shows at once as every frame failing (§2.5).
- **Platform access** (m21). On Linux, hidraw nodes are root-only by default, so WebHID `open()` fails without a udev rule (D12 shows the error). Web Serial needs the `dialout` group. `docs/timing.md` says both.
- **CP2110 variants** (R§4 q8). A different PID won't show in the picker; the filter is one constant.

**Real-device checklist.** For the EasyLap, a few minutes of raw HID input reports, with the transponder labels noted, must confirm:
1. Feature reports `0x50` and `0x41` as specified start the stream; nothing else is needed.
2. Report ids equal the number of valid bytes; frames split and merge across reports.
3. The checksum of every frame matches CRC-8 `0x07`/`0xDE`. If none do, the reader drops everything and `console.warn` says so: fix the CRC before release.
4. The id bytes 3–6 against at least two known transponders: bytes 5–6 never change for one transponder, and how the label maps (decimal of the 24-bit value?).
5. The time unit is 1 ms: two passings against a stopwatch over a minute.
6. The heartbeat interval and tail bytes.
7. Whether it streams without `03 B9 01` (the default), whether the clock runs from power-on, and what `03 B9 01` and `03 B0 02` do.
8. Anything else the decoder sends unprompted (an ack `00`, errors).
9. The range of hits and strength, and one passing per crossing (no repeats within a lap).
10. Rollover, if a 4.7 h run is possible; otherwise accept the new-boot fallback.
11. WebHID `open()` on Linux (with and without a udev rule), macOS and Windows.

For a plain ZRound decoder (RiCino, or any ZRound-compatible box):
12. Whether opening the port resets it, and how long it takes to answer.
13. `%A&` after the retried `%C&`, and that the spaced `%TLHELLO&`s don't disturb it.
14. Whether it sends anything before `%I&`, and that one `%I&` starts `%T` clocks and `%L` passings.

Until items 3 and 4 are done, `docs/timing.md` marks EasyLap support "preview".

## 8. Decided

1. **Every connect of a plain ZRound decoder or an EasyLap gets a new boot; there is no boot reuse** (owner, 2026-10-21). The reasons: ZRound decoders need `%I&` to stream at all, which zeroes their clock; Arduinos reset when the port opens; and an EasyLap is bus-powered. A replug costs each car its current lap, and crossings during the gap are lost; the page says so (§4.2). `devices.js` keeps only the device → decoder choice.
2. **The decoder's kind is not stored on the server** for now (owner, 2026-10-21): a non-goal (§1), to be added when Setup needs to show Wi-Fi capability.
3. **The bridge sends `%I&` to a plain ZRound decoder** that doesn't stream after the handshake (coordinator, C1; §2.4).
4. **The handshake retries `%C&`, after an open delay, and spaces and repeats `%TLHELLO&`** (coordinator, C2; §2.4).
5. **A frame that fails the checksum is skipped and logged, never used** (coordinator, I9; §2.5).
6. **The remembered choice is confirmed on every connect**, and only decoders not in use can be chosen (coordinator, I7, I8; §3.2).
7. **The re-review's R1–R9 as the reviewer proposes** (coordinator, 2026-10-21):
   - `startMs` is 6 s; after the last `%I&` the state stays `choose` or `ready`, and nothing more is written to a plain decoder once it streams or after the last `%I&`;
   - boot rules run live, only passings are held, each with its boot, on one chain with the read loop;
   - a late `%TLID` drops the unsent browser-stamped passings after the flush in flight, without re-stamping;
   - "in use" follows the server's time, the remembered decoder is not exempt, and `passing_net` indexes the query;
   - one guarded GET per connect, and `reset` restores the choose form from `data-name`;
   - the `%TLHELLO&` repeats stop at the first `%TLID`, and `%C&` in `listening` stops after 60 s;
   - the copy fixes, and the model's own `bootMs`.

8. **The simulator is a server setting, injected at the platform boundary** (owner, 2026-10-21): `TINYLAP_SIMULATE=<model>[,fast]`, read in `server/main.js`. With it on, the layout loads `public/sim/install.js`, which stands in for Web Serial's and WebHID's pickers. `tl-bridge` and `Bridge` have no simulation code. Production never sets it, so nothing is rendered there and `install.js` is a 404 (§5.4).

No open questions remain.
