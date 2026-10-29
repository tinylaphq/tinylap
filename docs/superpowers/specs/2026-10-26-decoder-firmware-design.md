# Decoder firmware: a TinyLap decoder on an ESP32, step one

It implements the decoder side of `docs/timing.md` ("Over USB: ZRound, plus TinyLap's commands"), with the simulated TinyLap decoder (`packages/timing/simulator.js` `createSimulator`, `apps/timing/public/sim/models/tinylap.js`) as the reference behaviour, and the bridge (`apps/timing/public/bridge.js`) as the other end. The hardware is in `firmware/tinylap-decoder/README.md`. Paths are relative to `firmware/tinylap-decoder/` unless they start with `docs/`, `packages/`, `apps/` or `tools/`.

Owner decisions recorded here (binding):
- **The hardware is the owner's kit:** an ESP32-WROOM-32E, four TSOP38238 receivers in parallel on GPIO 4, and ATtiny45 + TSAL6200 transponders that are already programmed (README).
- **RiCino is inspiration, nothing more.** We build what's right for TinyLap; nothing of RiCino's (GPL-3.0) code is used.
- **The transponders' format is found by measuring, not assumed.** The transponder source is not at hand, so a capture build records the raw pulses on the owner's board first (§4). The frame format in the README, read from the receiving code the board runs today, is the starting hypothesis.
- **Reprogramming the transponders is possible, if warranted.** The data from the track decides (§8); it is not part of step one.
- **`firmware/**` is MPL-2.0**, as `packages/**` (in `REUSE.toml`).
- **The decoder reports on itself, for an agent to read, not a person** (owner, 2026-10-26): machine-readable `%TLLOG` lines over USB (§6.1), which the bridge forwards and the timing server writes to its log, read with `fly logs` like any service's logs. No log storage or endpoint of our own.
- The spec and the plan are reviewed before any code. No upload to a board without asking; the owner plugs it in and names the port. Commits are conventional, signed off (`-s`), with no AI attribution.

## 1. Goals and non-goals

**Goals**
1. **A capture build** that prints every pulse the receivers see, so the owner's transponders can be measured on the owner's board (§4).
2. **A decoder build** that turns the receivers' pulses into one passing per car per crossing, stamped on the decoder's own clock (§5).
3. Over USB, the decoder **behaves as the simulated TinyLap decoder does**, which the bridge follow-up (§11) brings up to date: ZRound at 19200 8N1, `%A&` to `%C&`, `%TLID` to `%TLHELLO&` and on every boot change, `%TLPAIR` stored, `%I&` starting a new boot, `%L` per passing and `%T` clocks (§6). The bridge pairs it and forwards its passings; what the app needs for a real board is in that follow-up.
4. The protocol, the frame decoding and the crossing logic are **plain C++ with no Arduino in them, tested on the host** with `pio test -e native` (§9), against the **same vectors** as `packages/timing/test/zround.test.js` (§7).
5. **Diagnostics** that show, in use, what the bench can't: what the receivers reject, what the firmware drops, why a crossing made no passing, and why the board reset (§6.1).
6. A **CI job** that runs the host tests and builds both board environments, in parallel with `check`, so `check` stays at about 3 minutes (§10).

**Non-goals**
- **Wi-Fi delivery** (the ingest API, the outbox, connecting at all). `%TLWIFI` stores the credentials and answers, so the bridge's setup flow already works; using them is the next step.
- Transponder firmware, and any change to the transponders.
- Another board (Nano/Uno, ESP32-S3, C3). The pure code builds anywhere; only the `esp32dev` environment is set up.
- Over-the-air updates, a status LED, a display, a web page on the decoder.
- Signal strength and hit counts in the ZRound output. ZRound's `%L` has no place for them; the crossing logic keeps a frame count for diagnosis only.
- Keeping a boot across a power cycle or reset. Every start is a new boot (`docs/timing.md`, "A passing").
- Telling the four receivers apart. They share one pin; which one saw a car is not knowable and not needed.

## 2. Architecture

### 2.1 Layers

```
 TSOP38238 ×4 ──GPIO 4──▶ RMT receiver (hardware)          src/ir_rmt.cpp       [board only]
                              │ pulses: (level, µs)…, one batch per frame
                              ▼
                         frame decoder                     lib/tinylap/frames   [pure, host-tested]
                              │ frames: { id, t_us }
                              ▼
                         crossings                         lib/tinylap/crossings[pure, host-tested]
                              │ passings: { transponder, t_ms }
                              ▼
 USB serial ◀──────────▶ session (ZRound + %TL…)           lib/tinylap/session  [pure, host-tested]
   19200 8N1               uses zround reader/encoder      lib/tinylap/zround
                           and a store (pairing, Wi-Fi)    src/store_nvs.cpp    [board only]
```

`src/main.cpp` is the glue: it reads the serial port into the session, the RMT batches into the frame decoder, the frames into the crossings, the passings into the session, and writes whatever the session returns. Everything under `lib/tinylap/` takes time, randomness and storage as arguments, so the host tests drive it with fakes.

### 2.2 Files

```
firmware/tinylap-decoder/
  platformio.ini            envs: esp32dev, capture, native
  README.md                 hardware, wiring, frame format, build and flash (exists)
  AGENTS.md, CLAUDE.md      agent rules (exist)
  src/
    main.cpp                decoder: glue only
    capture.cpp             capture build (§4): its own setup()/loop()
    ir_rmt.cpp/.h           RMT receive on GPIO 4, shared by both builds
    store_nvs.cpp/.h        pairing and Wi-Fi in NVS (Preferences)
  lib/tinylap/
    zround.cpp/.h           reader (stream → messages), parser, encoder
    base64url.cpp/.h        decode for %TLWIFI, encode for boot ids
    frames.cpp/.h           pulses → frames, with the timing limits as one struct
    crossings.cpp/.h        frames → passings
    session.cpp/.h          the decoder's replies and its boot, as createSimulator.reply
    diag.cpp/.h             counters and the %TLLOG lines (§6.1)
    library.json            "platforms": "*", so native and esp32dev both pick it up
  test/
    test_zround/            the shared vectors (§7) and the reader's cases
    test_frames/            synthetic pulse trains, then the owner's capture (§4.4)
    test_crossings/
    test_session/           the replies, mirroring simulator.js
    test_diag/
```

`capture.cpp` and `main.cpp` each define `setup()`/`loop()`; each environment picks one with `build_src_filter`. A `.gitignore` keeps `.pio/` out.

### 2.3 Environments

| Env | What | Notes |
| --- | --- | --- |
| `esp32dev` | the decoder | `platform = espressif32` pinned to an exact version (Arduino core 2.0.x), `framework = arduino`, `board = esp32dev`, `monitor_speed = 19200`, `build_flags = -DCORE_DEBUG_LEVEL=0`. That silences the core's own logging, not the precompiled IDF's errors, nor the ROM (§11). |
| `capture` | the capture build (§4) | Same board and platform, `monitor_speed = 921600`, so the log keeps up (§4.1). |
| `native` | host tests | `platform = native`, Unity, `lib/tinylap` only. ArduinoJson, pinned to an exact version, as a test-only dependency, to read the shared vectors; their path as an absolute `-DVECTORS_PATH` from `${PROJECT_DIR}`. |

The exact platform version is pinned in the plan and changed only on purpose, so a CI run and the owner's upload build the same thing. The official `espressif32` 6.x platform stops at Arduino core 2.0.x; core 3.x would need the pioarduino fork and a new RMT API (§11).

### 2.4 Tasks

Two tasks, and one owner for each piece of state:

- **The RMT task** (high priority, core 0) only reads batches from the ring buffer, runs the frame decoder (§5.1), stamps each frame (§5.3) and puts `{ id, t_us }` on a FreeRTOS queue. It touches nothing else.
- **`loop()`** (core 1) owns everything else: the crossings, the session, the boot and its clock, the store, and **every write to `Serial`**. Each pass it reads the serial port into the session, takes the frames off the queue into the crossings, sends the passings, and sends `%T` when due.

The RMT task's counters (batches, frames, rejections by reason, overflows, the ring buffer's low-water mark, frames lost to a full queue) are atomics it only increments; `loop()` only reads them, for §6.1's `stat` line.

A frame stamped before the current boot started (`t_us` below the boot's start, so one that was in the queue when `%I&` came) is dropped, so no passing ever has a negative time. Since one task writes, a passing never interleaves with a reply.

## 3. Time and the boot

- The decoder's clock is **milliseconds since the current boot**, from `esp_timer_get_time()` (64-bit µs since power-up) minus the boot's start. It never wraps in practice.
- A **boot id** is 11 base64url characters (66 random bits) from `esp_random()`, with `bootloader_random_enable()`/`bootloader_random_disable()` around it, since without Wi-Fi or Bluetooth running the ESP32's generator is not truly random. It uses the SAR ADC, so it must never run while Wi-Fi is on; the code guards that now, for the next step. 11 matches the example in `docs/timing.md` and lies within 8–32.
- A new boot starts **at power-up and at every `%I&`**. Each sends `%TLID <decoder or -> <boot>&` unprompted (`docs/timing.md`; `simulator.js` on `reset`). The one at power-up may go out before anything listens; the bridge asks with `%TLHELLO&` anyway.
- A reset of the board (the EN button, or opening the port, §11) is a power-up: a new boot, a clock from zero. The bridge sees its clock go back and asks again.
- The first `%T` is `%T3E8&`, one second into the boot.
- The decoder id read from NVS at power-up is checked against `DECODER_ID` (`packages/timing/passing.js`); a bad one counts as unpaired, so `%TLID` always parses.

## 4. Capture: measuring the transponders

### 4.1 What the capture build does

It configures the RMT receiver on GPIO 4 exactly as the decoder does (1 µs ticks, the hardware glitch filter at its maximum, an idle threshold of 2.5 ms, and the same memory blocks and ring buffer, §5.3), and prints, at 921600 baud, one line per batch. A batch is a run of edges with no 2.5 ms silence in it: normally one frame, sometimes two that follow closely (§5.1):

```
F t=12345678 n=18 L902 H448 L301 H602 … d=6740 id=42
```

- `t`: µs since power-up at the batch's first edge; `n`: the number of levels; then each level and its length in µs, `L` for low (carrier present) and `H` for high (silence), as the RMT gave them, before the software glitch filter (§5.1); `d`: the batch's total length.
- `id=`: what the frame decoder (§5.1), with the README's limits, makes of it: one id per frame found, or `id=?` with the reason (`start`, `bit 3`, `stop`, `short`).
- Every 5 s, a summary line: batches seen, frames decoded per id, the shortest and longest gap between frames per id, the spread of frame-to-frame times for a still transponder, and **batches dropped** (ring buffer full or RMT overflow), so a log that lost data says so.

One line is about 125 bytes, at 70–90 frames a second: about 11 kB/s, which 115200 baud (11.5 kB/s) can't carry with margin. 921600 can; both common USB chips (CP2102, CH340) do it.

The capture build sends nothing else and reads nothing.

### 4.2 What the owner does

Once the plan's first task (the capture build, host-tested) is done:

0. **Before the first upload I back up the firmware on the board today** with `esptool.py read_flash` (all 4 MB, to a file in the scratchpad), and write down the one command that restores it. Nothing else on the board is kept.
1. **Plug the board into the Mac** with a USB cable that carries data (a charge-only cable shows no port), with the receivers connected as on the track. Tell me "plugged in"; I compare the serial ports before and after, and name the new port back to you to confirm. I never touch `/dev/cu.usbmodem111…` (the monitor).
2. **Allow the upload** when I ask. I build and upload the `capture` environment, then start the monitor in the background, writing to a file in the scratchpad.

For now there is one test transponder, not mounted in a car, so it is held by hand. If other programmed transponders are at hand, step 3 is repeated for each, with its label. Each step: say when you start, and wait until I've seen the summary line before the next.

3. **Still:** power the transponder, LED pointing at the receivers, about 20 cm away, for **60 seconds**. A long still run shows whether the receivers' automatic gain control fades a steady signal out.
4. **Distance:** the same at about 5 cm, 50 cm and 1 m, 5 seconds each.
5. **Angle:** at 20 cm, tilted about 45° away from the receivers, then sideways along the line, 5 seconds each.
6. **Sweeps:** move it past the receivers as fast as you can by hand, as a car would cross the line, **five times**, a few seconds apart.
7. **Nothing:** the transponder off or covered for two minutes, room lights and any sunlight as during a race, to see what noise the receivers pick up.

That is about 12 minutes. I stop the monitor, keep the log, and report: the transponder's id, the measured timings and their spread, the frame rate, how many frames a fast sweep gives, how range and angle change the pulses, and the noise.

Two transponders at once, and real crossings at racing speed, need cars; they are on the checklist (§11, items 8 and 11) for when the transponders are mounted.

### 4.3 What follows from it

- The **README's frame format** is confirmed or corrected, and the "to be confirmed" goes.
- The **timing limits** in `frames.h` are set from the measured values with at least ±15% margin, not from one unit's spread: the ATtiny45's internal clock is within ±10% from the factory and drifts with temperature and battery. If a ratio to the frame's own start period separates 0 from 1 better than fixed limits do, the decoder uses the ratio.
- The **crossing parameters** (§5.2) are set from the frames per fast crossing and the noise.
- If the format is not the README's at all, the frame decoder is written for what was measured; the rest of the design stands.

### 4.4 The capture as a test

The log is committed, shortened to a few seconds per case, as `test/test_frames/capture-<date>.txt`, each case labelled with the transponder's known id. A host test runs every batch through the frame decoder and asserts that **no batch decodes to any other id**, and that at least a set share (from the capture, e.g. 90% of the still case) decodes to the right one. A later change to the limits that breaks real frames, or makes ghosts of them, fails on the host.

## 5. Passings

### 5.1 Frames (`lib/tinylap/frames`)

Input: one RMT batch, a list of `(level, µs)`. Output: **zero or more frames** `{ id, t_us }`, and the reasons for what didn't decode. A frame lasts about 7 ms and repeats every 11–14 ms, so two transponders in view leave gaps under 2.5 ms between their frames, and the RMT then hands both over in one batch; the decoder scans the batch for start periods and decodes each frame it finds.

First a **software glitch filter** merges any level shorter than `glitchMax` (100 µs to start with) into its neighbours. The RMT's own filter can't do it: in the Arduino core 2.0.x driver its threshold is 8 bits of the 80 MHz APB clock, about 3 µs at most, so it stays at that maximum and the rest is done here, where the host tests reach it.

The decoder then works on **falling edge to falling edge periods** (the start of one burst to the start of the next), as the receiving code on the board does today, since a burst's length varies more with distance than its start does. From the batch it computes the periods, then checks the start period, seven bit periods (least significant bit first) and the stop burst. Periods alone don't make a frame: the number of bursts, each burst's length and the frame's total length must fit too, so two overlapping frames don't decode to a third id. The limits are held in one struct:

```cpp
struct FrameLimits { uint16_t glitchMax, startMin, startMax, oneMin, oneMax, zeroMin, zeroMax, burstMin, burstMax, frameMax; };
```

The initial values are the README's (start 1100–1700, one 750–1100, zero 420–750 µs; the burst and frame limits wide); §4.3 sets the final ones. Anything outside them is not a frame. `t_us` is the time of the frame's first falling edge (§5.3).

### 5.2 Crossings (`lib/tinylap/crossings`)

A car in front of the receivers sends a frame every 11–14 ms. A crossing is the run of frames one car sends while it passes the line. Per id:

- A frame **opens** a crossing if none is open. A crossing stays open while frames of that id keep coming less than `gapMs` apart (150 ms to start with).
- A crossing **counts** only if the car was unseen for at least `quietMs` (500 ms to start with) before it opened, and it opened at least `minLapMs` (2000 ms) after this car's last passing. A car whose signal flickers at the edge of reception (in the pit lane, on the grid, after a crash past the line) keeps being seen, so it makes no new passings.
- A crossing that counts is **confirmed** at its `confirmFrames`-th frame (2 to start with) and emits **one passing**.
- A crossing that ends unconfirmed (a single frame: noise, or a garbled id) emits nothing.
- A car standing on the line keeps one crossing open, and so makes one passing, however long it stands there.

**The stamp is a parameter**, `stamp`:
- `first`: the crossing's first frame. The passing goes out at confirmation, one frame later.
- `middle`: halfway between the first and last frame. The passing goes out when the crossing ends, `gapMs` later, or at `first + maxCrossingMs` (500 ms) for a car that stays in view.

The stamp is on the decoder's clock either way; only the report comes later, which the bridge and server don't mind. `middle` cancels the error of where a car enters and leaves the receivers' field when that is symmetric; `first` depends on where each approach first comes into view. Which is steadier is decided by the racing-speed capture (§11, item 11); until then the default is `middle`.

A new boot (`%I&`) clears every crossing, every car's last passing and its last-seen time: a crossing open across it is dropped, since its first frame lies on the old boot's clock.

Every crossing reports how it ended, for §6.1: `passed` (with its frames and its first and last frame), `single`, `quiet` or `minlap`.

The crossings track up to 128 ids (the frame's 7 bits) in a fixed array; nothing allocates.

### 5.3 The time of a frame

The RMT gives lengths, not times. The glue reads a batch from the RMT's ring buffer and stamps it: the time it was read, minus the batch's length, minus the idle threshold that ended it. The task that reads it runs at a high priority and blocks on the ring buffer, so the stamp is late by the task's wake-up latency, well under a millisecond with Wi-Fi off. A constant lateness cancels between laps; only its spread matters, and the capture measures it (the frame-to-frame spread of a still transponder, §4.1). Writing to NVS stalls both cores for tens of milliseconds, which happens only while pairing. The passing's `t` is that time in whole ms on the boot's clock (§3).

The RMT channel gets 4 memory blocks (512 levels), so a burst of noise without a 2.5 ms silence doesn't overflow it, and a ring buffer that holds about 500 ms of frames. A full buffer makes the driver log from its interrupt; the glue counts dropped batches (§4.1).

Why the RMT and not a pin interrupt with `micros()`, as today: the RMT measures each level in hardware, so a late interrupt can't stretch a 600 µs bit into a 750 µs one. That matters most once Wi-Fi runs, which delays interrupts.

## 6. The serial session (`lib/tinylap/session`, `lib/tinylap/zround`)

**19200 baud, 8N1**, on the board's USB serial (`Serial`, UART0). The session reads with a reader that behaves as `createReader` does: text outside `%…&` is dropped, a cut-off message restarts at the last `%` before the `&`, and the pending text is cut at 1024 characters.

| Message in | Answer | As `simulator.js` |
| --- | --- | --- |
| `%C&` | `%A&`, at once | `startup` |
| `%TLHELLO&` | `%TLID <decoder or -> <boot>&` | `hello-request` |
| `%TLPAIR <id> <token>&` (id and 43-character token valid, as `parseMessage` checks) | store both, then `%TLOK&`; `%TLERR store&` if storing failed | `pair` |
| `%TLWIFI <ssid> <password>&` (both base64url of UTF-8; the password may be empty, an open network, so the line ends in a space before `&`) | store both, then `%TLOK&`; `%TLERR Wi-Fi name too long&` if the SSID is not 1–32 bytes, `%TLERR Wi-Fi password length&` if the password is not empty, 8–63 bytes, or 64 hex digits; `%TLERR store&` if storing failed | `wifi` |
| `%I&` | a new boot (§3), `%TLID …&` | `reset` |
| `%F&`, anything else | nothing | `default` |

Unprompted:
- `%TLID …&` at power-up and at every new boot (§3).
- `%L<transponder>,<t>&` per passing, as `commands.lap`: the id in **upper-case hex** without padding (car 5 is `5`, car 42 is `2A`), as `docs/timing.md` and every ZRound decoder write it; `t` in upper-case hex ms. A transponder read by any decoder gets the same code, so a second format later (§8) reports a transponder as other decoders of that kind do.
- `%T<t>&` **every second** on the boot's clock, as `commands.clock`. The simulated TinyLap decoder sends none; ZRound software expects them, and the bridge uses a clock that goes back to notice a reset.

Notes:
- The decoder **streams from power-up**; it doesn't wait for `%I&` as a plain ZRound decoder does. `%F&` stops nothing: the decoder doesn't keep races, the app does.
- A `%TLPAIR` while paired replaces the pairing, as the simulator does.
- The bridge shows a `%TLERR` text to the member ("The decoder said: …", `bridge.js` `#reply`), so the texts are short, readable English.
- The SSID is stored as bytes (`putBytes`), not as a string: an SSID may contain NUL.
- The token is stored in NVS unencrypted; anyone with the board and `esptool` can read it. The README says so. Unpairing is a new `%TLPAIR`, or erasing the flash.
- Writes are whole messages, from one task (§2.4); a passing never interleaves with a reply.

### 6.1 Diagnostics: `%TLLOG`

The decoder says what it sees and drops, as `%TLLOG` lines over USB. They are written for an agent to read, not a person: every field is `key=value`, values hold no spaces, `%` or `&`, times are upper-case hex ms on the boot's clock (as in `%L`), counts are decimal. A line stays under 512 bytes (a `boot` line with `prev.` and every counter at its maximum is the longest), within the bridge reader's 1024.

| Line | When | Fields |
| --- | --- | --- |
| `%TLLOG boot …&` | right after every `%TLID` that starts a boot | `reason=` `poweron`, `reset` (`%I&`), `brownout`, `panic`, `wdt`, `sw`, `ext` or `other` (from `esp_reset_reason()`); `fw=` the build's `git describe`; after a crash, the previous run's counters as `prev.<key>=` when they survived (below) |
| `%TLLOG stat …&` | every 10 s | `up=` seconds since power-up; `batches`, `frames`, `rej.start`, `rej.bit`, `rej.stop`, `rej.short`, `rej.burst`, `rej.long`, `rej.parity`, `overflow`, `ringlow` (bytes), `qdrop`, `pass`, `single` (crossings with one frame), `quiet` and `minlap` (crossings that didn't count, by rule), `rxdrop` (serial input lost), `heap` (free bytes) |
| `%TLLOG pass …&` | when a crossing that made a passing ends | `id=` (hex, as in `%L`), `t=` its stamp, `first=`, `last=`, `frames=` |
| `%TLLOG event …&` | as it happens, at most 20 per 10 s; beyond that only counted, as `suppressed=` in the next `stat` | `what=single`, `quiet` or `minlap` with `id=` and `t=`; `what=overflow` with `t=` |

- The counters run from power-up and never reset, not even on `%I&`, so a lost `stat` line loses nothing: the next one has it all.
- They are kept in `RTC_NOINIT` memory with a magic word and a checksum, so after a crash, a watchdog or a software reset the next `boot` line carries the last values. After a power cut or a brownout they may not survive; then `prev.` is left out.
- At 19200 baud the line is about 1.9 kB/s. A `stat` line every 10 s, a `pass` line per passing and at most 20 events per 10 s stay well under a tenth of that.
- ZRound software sees `%TLLOG` as it sees `%TLID`: an unknown message, ignored. Today's bridge turns it into noise and ignores it (`apps/timing/public/link/zround.js`, the `unknown` case).
- `docs/timing.md` gets the message in its table of TinyLap messages, decoder → PC, with this section's fields.

**Where the lines go.** At the bench, the serial monitor. In use, the bridge forwards them to the timing server with the passings, and the server writes each as one JSON line to its log, with the decoder id and boot; on Fly.io that is `fly logs` and Fly's log search. That is in the bridge follow-up (§11); once Wi-Fi delivery exists, the decoder posts them itself. If Fly's log retention is too short, a log shipper is added then; nothing here changes.

## 7. Shared protocol vectors

The firmware's protocol is C++, the app's is JavaScript; neither can use the other's code, so the code is **mirrored, and the vectors are shared**:

- `packages/timing/test/zround-vectors.json` holds the cases, **tagged by direction**: message bodies the PC sends and what they parse to (as `parseMessage` returns them), the lines `commands` encode for what the decoder sends, and reader streams in chunks with the messages they yield. The C++ parses only what a PC sends (`C`, `I`, `F`, `TLHELLO`, `TLPAIR`, `TLWIFI`) and encodes only what a decoder sends; it doesn't mirror all of `parseMessage`.
- It starts as the cases in `zround.test.js` today, plus the decoder's own: `%TLWIFI` with `&`, `%` and non-ASCII, an empty password, a bad SSID length.
- It pins the edges where two implementations drift, and whichever side is wrong changes; JavaScript gets stricter, not the C++ looser: `+`, `/`, `=` and whitespace in base64url (JavaScript's `atob` accepts them today; both reject them), invalid UTF-8 (both `unknown`), the empty last field.
- Reader streams are ASCII, so counting UTF-16 units and bytes agrees.
- `%TLLOG` lines are encoded only by the C++; their vectors are C++-only, until the bridge follow-up teaches `parseMessage` to read them, when JavaScript runs them too.
- `zround.test.js` runs every vector against `parseMessage`, `createReader` and `commands`, alongside its existing tests, which stay.
- `test/test_zround` runs the same file against the C++ reader, parser and encoder, through ArduinoJson. The file's path is passed to the test as a build flag from `platformio.ini`.

So a change to the protocol on either side fails the other side's tests until both agree. The file is MPL-2.0 under `packages/**`.

The session's replies are checked the same way in spirit: `test_session` mirrors `simulator.js`'s `reply` case by case (§6's table).

## 8. Reprogramming the transponders: what decides it

Not in step one. After the capture (§4) and a first session on the track with the decoder build, reprogramming is warranted if one of these shows:

- **Misses:** fast crossings that give fewer than `confirmFrames` good frames.
- **Ghosts:** a garbled frame that decodes to a wrong id and gets confirmed. The format has no checksum; two matching frames make that unlikely, but not impossible with two cars at once.
- **Collisions:** two cars side by side that keep garbling each other, because both repeat at the same fixed rate.
- **Ids:** more than 128 cars, or ids that clash between clubs that share transponders.

The fix would be a TinyLap transponder format: the id with a checksum, sent in a short frame, repeated at random intervals. That is its own spec, with ATtiny45 firmware, and the decoder would read both formats.

## 9. Test plan

### 9.1 Host tests (`pio test -e native`)

- **zround:** the shared vectors (§7); the reader at every chunk boundary; noise and a 5000-character run without `&`; the encoder's upper-case hex.
- **base64url:** decode with and without padding characters, bad characters rejected, UTF-8 kept as bytes; boot ids are 11 characters of the alphabet, from a fake random source.
- **frames:** synthetic pulse trains built from the limits: every id 0–127; each limit just inside and just outside; a missing stop; a glitch inside a bit, under and over `glitchMax`; seven bits then noise; two frames in one batch; two overlapping frames, which must not decode to a third id. Then the committed capture (§4.4).
- **crossings:** one car, one crossing, one passing, with each `stamp`; a single frame is nothing; frames 149 ms and 151 ms apart; a car parked on the line for 30 s is one passing; parked for 30 s with 200–400 ms dropouts is one passing; a real lap after a park is one passing; a second crossing inside `minLapMs` is nothing; two cars interleaved frame by frame are two passings; `%I&` during an open crossing drops it; a frame from before the boot is dropped.
- **diag:** each line's exact text from given counters; `prev.` only with a valid magic and checksum; the event limit (20 in 10 s, then `suppressed=`); no value with a space, `%` or `&`; the longest `stat` and `boot` lines under 512 bytes.
- **session:** every row of §6's table, against fakes for the store and the clock: `%TLID` with and without a pairing; `%I&` makes a new boot and sends `%TLID`; a pairing survives a new boot; `%TLWIFI` bounds, an empty password and a 64-hex-digit key; a failing store answers `%TLERR store&`; a bad decoder id in the store counts as unpaired; the clock line every 1000 ms, the first at 1000.

### 9.2 Builds (`pio run -e esp32dev -e capture`)

Both build with no warnings in our code. The size of the decoder build is printed, not checked.

### 9.3 On the board (the owner, §4.2 and §11)

Everything in §11's checklist. None of it runs in CI.

## 10. CI

A new job, `firmware`, in `.github/workflows/ci.yml`, beside `check`, never a dependency of a deploy and not a required check on main (those are `check`, `smoke`, `reuse`, the commit title and DCO):

- `actions/setup-python`, then `pip install platformio==6.2.0` (the version installed locally), and a cache of `~/.platformio` keyed on `platformio.ini`, so the ESP32 toolchain downloads once.
- `pio test -e native`, then `pio run -e esp32dev -e capture`, in `firmware/tinylap-decoder/`.
- It runs only when `firmware/**`, `packages/timing/test/zround-vectors.json` or the workflow changed, and on every push to main. The filter is on the job (a small `changes` job, then `if:` on `firmware`), not on the workflow, which would skip `check` too.
- With the cache warm it takes 2–4 minutes (restoring about 1 GB, then the Arduino core compiled for two environments). Beside `check`, that doesn't lengthen CI.
- `zround.test.js` reading the vectors is part of `check` as before.

## 11. Risks and the real-device checklist

**Risks**
- **The format is not what the README says.** The capture shows it in minutes; the frame decoder is small and behind its own tests.
- **A serial error ends the bridge's session.** `apps/timing/public/link/serial.js` stops reading on any error, though Web Serial's break, framing, parity and overrun errors are not fatal: `port.readable` comes back with a new stream. The ESP32's ROM prints at 115200 on every reset (opening the port, the EN button, a brownout, a crash), which at 19200 may well cause a framing error. The decoders spec already lists this as open (`2026-10-21-decoders-and-simulators.md` §7, item 14). The fix is in the bridge follow-up below.
- **Opening the port resets the board, or keeps it from running.** Most ESP32 dev boards wire DTR and RTS to EN and GPIO 0 through two transistors. Both lines raised together, as a port usually opens, doesn't reset; one changing before the other does. A reset is harmless (a new boot, §3; the bridge waits 1.5 s after opening). The harmful case is GPIO 0 low as EN rises: the board sits in its ROM's download mode, prints `waiting for download`, and runs no firmware. Checklist item 2 finds out, on opening and on closing the port.
- **Other text on the serial port.** The ROM's reset lines, and errors the precompiled IDF still logs at its default level, are text outside `%…&`, which the reader drops, as long as they contain no `%` or `&`, and as long as the serial transport survives them (above).
- **Interference:** sunlight, room lights and IR remotes at 38 kHz. The glitch filter, the strict limits, the two-frame confirmation and `quietMs` cover it; the capture's quiet run (§4.2, step 7) shows how much there is.
- **Arduino core 2.x's RMT driver is the IDF's legacy one.** It is what the pinned platform ships. A move to core 3.x changes the RMT API, which is confined to `src/ir_rmt.cpp`.

**The bridge follow-up.** Its own pull request, right after this work and before the decoder is used with the bridge on the track (checklist item 4 onward); it changes the app, so it has browser tests and a timing deploy:
- `serial.js` reads on after a non-fatal error (`while (port.readable)`, a new reader each time).
- The simulated TinyLap decoder does what the firmware does: `%TLID` from `start()`, `%T` every second from `tick()`; and bridge tests for a `%TLID` that comes before `%C&`, and for a reboot with the port open (`%TLID`, then a clock from zero).
- The pairing form's Wi-Fi fields check their lengths in bytes, so a member can't get stuck pressing Pair on a password the decoder refuses (the pairing is stored before Wi-Fi is sent, `bridge.js` `pair`).
- `setSignals` on open, if checklist item 2 shows the board needs it.
- `%TLLOG` (§6.1): `parseMessage` reads it, the bridge forwards the lines to the timing server with the passings, and the server writes each as one JSON line to its log with the decoder id and boot.

**Real-device checklist**
1. The board's USB chip, its vendor and product id, and the port name on macOS.
2. Opening and closing the port from Chrome's Web Serial: whether it resets the board, whether the board ends in download mode, and whether any break, framing, parity or overrun error comes with it.
3. The capture (§4.2), every step.
4. With the decoder build and the bridge: the handshake ends in a TinyLap decoder, `%TLID -` while unpaired.
5. Pairing from the bridge, then a power cycle: `%TLID <id> <new boot>`, the pairing kept.
6. `%TLLOG`: a `boot` line after every `%TLID`, a `stat` line every 10 s, a `pass` line per passing; after pressing EN, `reason=ext`.
7. `%TLWIFI` from the bridge's setup: `%TLOK&`, and the credentials still there after a power cycle; an over-long SSID shows the decoder's error to the member.
8. Five fast crossings per car give five passings; a car parked on the line gives one, also when parked at the edge of reception.
9. Lap times on a rig, not against a hand stopwatch (which is off by 50–150 ms): a transponder on a turning wheel or arm at a steady speed, or a 240 fps video of the line. Report the spread of the lap times; it settles `stamp` (§5.2) with item 11.
10. ZRound itself (on Windows, if available): it connects, starts a race, counts laps.
11. Once cars carry transponders: two cars across the line side by side, three times, both counted; and a capture of real crossings at racing speed, added to `test/test_frames/`.

## 12. Decided

1. **The ESP32-WROOM-32E, `esp32dev`, Arduino framework, with the pinned `espressif32` platform** (owner's board).
2. **Measure, then decode:** the capture build comes first (owner).
3. **The RMT, not a pin interrupt,** for receiving (my call, §5.3).
4. **One passing per crossing**, confirmed by a second frame, after `quietMs` unseen and `minLapMs` since the last passing; the stamp a parameter, `middle` until real crossings decide (my call, §5.2; the 2 s from the code on the board today).
5. **The code is mirrored and the vectors shared**, tagged by direction, through `packages/timing/test/zround-vectors.json` (my call, §7).
6. **`%T` every second, the first at 1 s; streaming from power-up; `%F&` ignored** (my call, §6).
7. **A CI job beside `check`, cached and filtered by path at the job** (my call, §10).
8. **The glitch filter in software, the RMT's at its maximum** (my call, §5.1).
9. **The board's current firmware is backed up before the first upload** (my call, §4.2).
10. **The bridge follow-up** (§11): a separate pull request after this work, before the decoder is used with the bridge on the track (my call, recommended to the owner).
11. **Two tasks, `loop()` owning all state and every serial write** (my call, §2.4).
12. **The capture build at 921600 baud, with a count of dropped batches** (my call, §4.1).
13. **Transponder ids in hex**, as the ZRound contract has them (owner, 2026-10-26; §6). Decimal was considered: it matches the number the code on the board today prints, but breaks the contract and would give one transponder different codes on different decoders. A member picks codes from those the board has seen, rather than typing them; labelling each transponder with its hex code covers the rest.
14. **Diagnostics as `%TLLOG` lines, forwarded by the bridge and written to the timing server's log**, read with `fly logs`; no log store of our own (owner, 2026-10-26; §6.1).
