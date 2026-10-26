# Decoder firmware, step one: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TinyLap's own decoder firmware for the owner's ESP32-WROOM-32E: first a capture build that measures the transponders, then a decoder build that turns the receivers' pulses into passings, speaks ZRound plus the `%TL…` messages over USB, and reports on itself in machine-readable `%TLLOG` lines.

**Architecture:**
- `firmware/tinylap-decoder/` is a PlatformIO project with three environments: `esp32dev` (the decoder), `capture` (the capture build) and `native` (host tests).
- All logic is plain C++17 in `lib/tinylap/` with no Arduino in it: frames (pulses → frames), crossings (frames → passings), zround (reader, parser, encoder), base64url, session (the decoder's replies, its boot and clock), diag (counters and `%TLLOG` lines) and capture_log (the capture build's lines). The host tests drive it with fakes.
- `src/` is board glue only: the RMT receiver (`ir_rmt`), NVS storage (`store_nvs`), and the two entry points (`main.cpp`, `capture.cpp`), picked per environment by `build_src_filter`.
- The protocol is mirrored, not shared: `packages/timing/test/zround-vectors.json` holds the cases, run by `zround.test.js` and by the C++ tests.

**Tech Stack:** PlatformIO Core 6.2.0, the `espressif32` platform pinned to its last 6.x release (Arduino core 2.0.x, ESP-IDF 4.4 legacy RMT driver), Unity for host tests, ArduinoJson (tests only). Node's `node:test` for the JavaScript side.

**Spec:** `docs/superpowers/specs/2026-10-26-decoder-firmware-design.md` (approved 2026-10-26). The spec is the authority; its sections (§2.4, §5.2, …) are cited below. Hardware: `firmware/tinylap-decoder/README.md`.

## Global Constraints

- **Branch:** `feat/decoder-firmware`, from `main`. Never push to or merge into `main`; no pull request without asking the owner.
- **Licence:** `firmware/**` is MPL-2.0 through `REUSE.toml` (done); new files need no SPDX header of their own, as in `packages/**`. Check with `pipx run reuse lint` (or `reuse lint`).
- **Commits:** conventional, `git commit -s`, author `1009814+jostsg@users.noreply.github.com` (already the repo's `user.email`). **No AI attribution anywhere**: no `Co-Authored-By`, no "Generated with" lines.
- **Logs:** `LOGS=/private/tmp/claude-502/-Users-simon-repos-track-layout/3a0dd595-2217-4c6b-9d9b-f467c06b2ab6/scratchpad/fw-logs`; `mkdir -p "$LOGS"` first. Every run writes its whole output to `$LOGS/<name>.log`, then prints the exit code and the tail. Read the log when it fails; don't rerun to grep.
- **Commands**, from `firmware/tinylap-decoder/`:

  ```sh
  /opt/homebrew/bin/pio test -e native > "$LOGS/native.log" 2>&1; echo "exit $?"; tail -n 30 "$LOGS/native.log"
  /opt/homebrew/bin/pio test -e native -f test_frames > "$LOGS/frames.log" 2>&1; echo "exit $?"; tail -n 30 "$LOGS/frames.log"
  /opt/homebrew/bin/pio run -e esp32dev -e capture > "$LOGS/build.log" 2>&1; echo "exit $?"; tail -n 30 "$LOGS/build.log"
  ```

  For `packages/timing`, from the repo root, as three commands (AGENTS.md): `pnpm --filter @tinylap/timing test`, then `lint`, then `typecheck`.
- **Before each commit:** `pio test -e native`, and `pio run -e esp32dev -e capture` once Task 2 exists; for a task that touches `packages/timing`, its three checks too. All green.
- **Boards:** never upload without asking; the owner plugs the board in and names the port. Never touch `/dev/cu.usbmodem111…` (the LG monitor). Close `pio device monitor` before an upload; run the monitor in the background, writing to a file in `$LOGS`.
- **Copy rule:** comments and docs in the repo's style: plain English, short sentences, spec sections cited as `(spec §5.2)`.
- **No allocation in the frame path:** `frames` and `crossings` use fixed arrays; `zround`, `session` and `capture_log` may use `std::string`/`std::vector`.

## Review Focus

1. **A burst of IR noise that fills the RMT's memory** (512 levels of random lengths: sunlight, a remote): no frame, no read past the batch, no crash. Test in Task 1: `test_noise_batch_at_capacity`.
2. **A car seen in the first 500 ms of a boot:** "never seen" and "never passed" must not be mistaken for time 0, so its first crossing counts. Test in Task 5: `test_first_crossing_right_after_boot_counts`.
3. **Transponder id 0:** encodes as `0` (a valid code), not as an empty string. Test in Task 4: a `fromDecoder` vector `["transponder", 0] → "0"`.
4. **The longest pairing:** a 64-character decoder id and a 43-character token survive the store and come back whole in `%TLID`. Test in Task 6: `test_longest_pairing_round_trips`.
5. **An SSID with a NUL byte or non-ASCII bytes:** reaches the store as the exact bytes, not cut at the NUL. Test in Task 6: `test_wifi_bytes_reach_the_store_exactly`.

---

### Task 1: The project, and frames (pulses → frames)

**Files:**
- Create: `firmware/tinylap-decoder/platformio.ini`, `.gitignore` (`.pio/`), `lib/tinylap/library.json`, `lib/tinylap/frames.h`, `lib/tinylap/frames.cpp`, `test/test_frames/test_main.cpp`
- Commit first, unchanged: the spec, this plan, `firmware/tinylap-decoder/{README,AGENTS,CLAUDE}.md`, `REUSE.toml`

**Interfaces:**
- Produces (namespace `tinylap`, `frames.h`):
  ```cpp
  struct Level { bool low; uint16_t us; };            // low: carrier present (the TSOP pulls the line low)
  struct FrameLimits { uint16_t glitchMax, startMin, startMax, oneMin, oneMax, zeroMin, zeroMax, burstMin, burstMax, frameMax; };
  extern const FrameLimits kLimits;                   // the README's values (spec §5.1)
  struct Frame { uint8_t id; uint32_t offsetUs; };    // offsetUs: the frame's first falling edge, from the batch's start
  enum class Reject : uint8_t { None, Start, Bit, Stop, Short, Burst, Long };
  struct Rejection { Reject why; uint8_t bit; };      // bit: 0–6, for Reject::Bit
  size_t filterGlitches(Level* levels, size_t n, uint16_t glitchMax);   // in place; returns the new count
  size_t decodeBatch(const Level* levels, size_t n, const FrameLimits& limits,
                     Frame* out, size_t maxOut, Rejection* first);      // returns frames found; *first = first rejection, or None
  int64_t batchStartUs(int64_t readUs, const Level* levels, size_t n, uint16_t idleUs);  // spec §5.3
  ```

- [ ] **Step 1: Branch and commit the approved docs**

  ```sh
  git switch -c feat/decoder-firmware
  git add docs/superpowers/specs/2026-10-26-decoder-firmware-design.md docs/superpowers/plans/2026-10-26-decoder-firmware.md firmware/tinylap-decoder/README.md firmware/tinylap-decoder/AGENTS.md firmware/tinylap-decoder/CLAUDE.md REUSE.toml
  git commit -s -m "docs(firmware): spec and plan for the TinyLap decoder firmware"
  ```

- [ ] **Step 2: Pin the versions and write `platformio.ini`**

  Find the last `espressif32` 6.x release (`pio pkg show platformio/espressif32`) and the current ArduinoJson 7.x (`pio pkg show bblanchon/ArduinoJson`); pin both exactly. Environments:
  - `[env:esp32dev]`: `platform = espressif32@<6.x.y>`, `board = esp32dev`, `framework = arduino`, `monitor_speed = 19200`, `build_flags = -DCORE_DEBUG_LEVEL=0 -std=gnu++17`, `build_unflags = -std=gnu++11`, `build_src_filter = +<*> -<capture.cpp>`.
  - `[env:capture]`: `extends = env:esp32dev`, `monitor_speed = 921600`, `build_src_filter = +<capture.cpp> +<ir_rmt.cpp>`.
  - `[env:native]`: `platform = native`, `test_framework = unity`, `build_flags = -std=c++17 -Wall -Wextra '-DVECTORS_PATH="${PROJECT_DIR}/../../packages/timing/test/zround-vectors.json"'`, `lib_deps = bblanchon/ArduinoJson@<7.x.y>`.
  - `lib/tinylap/library.json`: `{ "name": "tinylap", "version": "0.0.0", "platforms": "*", "frameworks": "*" }`.
  - Until Task 2, `src/` is empty, so build only `native` in this task.

- [ ] **Step 3: Write the failing tests** in `test/test_frames/test_main.cpp`

  A helper `train(id, limits)` builds the levels of one frame: a 900 µs burst + 450 µs pause (start), then per bit a 300 µs burst and a pause making the period 900 µs (1) or 600 µs (0), least significant first, then a 300 µs stop burst. Tests:
  - `test_every_id_decodes`: ids 0–127, each `decodeBatch` → 1 frame, that id, `offsetUs == 0`.
  - `test_limits_inside_and_outside`: every range is inclusive (`min ≤ period ≤ max`). Periods at each of `startMin`, `startMax`, `oneMin`, `oneMax`, `zeroMin`, `zeroMax` → decodes; at `startMin − 1`, `startMax + 1`, `oneMax + 1`, `zeroMin − 1` → 0 frames with `Reject::Start` or `Reject::Bit` and the right `bit`.
  - `test_missing_stop`: no stop burst → 0 frames, `Reject::Stop`.
  - `test_glitch_inside_a_bit`: a 60 µs high inside a burst → after `filterGlitches(…, 100)` decodes; a 150 µs one → doesn't.
  - `test_seven_bits_then_noise`: → 0 frames.
  - `test_two_frames_in_one_batch`: id 5, a 2 ms pause, id 99 → 2 frames, the second's `offsetUs` is the first's length + 2000.
  - `test_overlap_is_not_a_third_id`: id 0x2A and id 0x55 summed (the union of their low levels, as two transponders seen at once) → no frame other than 0x2A or 0x55.
  - `test_noise_batch_at_capacity` (Review Focus 1): 512 levels of pseudo-random lengths 20–3000 µs, a fixed seed → 0 frames, no crash (run under `-fsanitize=address,undefined` if the native toolchain supports it).
  - `test_batch_start`: `batchStartUs(1'000'000, levels, n, 2500)` == `1'000'000 − sum(levels) − 2500`.

- [ ] **Step 4: Run and see them fail** (`pio test -e native -f test_frames`): link errors for the missing functions.

- [ ] **Step 5: Implement `frames.cpp`**

  `kLimits = { 100, 1100, 1700, 751, 1100, 421, 750, 150, 1200, 9000 }` (glitch; start; one; zero; burst; frame, µs; inclusive; the README's limits, whose 750 µs boundary belongs to 0). `filterGlitches`: a level shorter than `glitchMax` is merged with both neighbours into one level of the neighbours' polarity; at either end, into its one neighbour. `decodeBatch`:
  ```
  starts[] = offsets of every low level; lens[] = their lengths
  i = 0
  while i + 8 < bursts:
    if period(i) not in start range: note Start; i += 1; continue
    bits over periods i+1 … i+7 (period(k) = starts[k+1] − starts[k]); a period in neither range: note Bit k−i−1; i += 1; continue
    bursts i … i+8 each within burstMin…burstMax, else note Burst; i += 1; continue
    starts[i+8] + lens[i+8] − starts[i] ≤ frameMax, else note Long; i += 1; continue
    emit { id, starts[i] }; i += 9
  fewer than 9 bursts left after a good start: note Stop (Short if the batch had fewer than 9 bursts at all)
  ```
  A leading high level (the RMT may start on one) is skipped.

- [ ] **Step 6: Run the tests:** all pass.

- [ ] **Step 7: Commit:** `feat(firmware): decode IR frames from receiver pulses`

### Task 2: The capture build

**Files:**
- Create: `lib/tinylap/capture_log.h/.cpp`, `test/test_capture_log/test_main.cpp`, `src/ir_rmt.h/.cpp`, `src/capture.cpp`

**Interfaces:**
- Consumes: `Level`, `Frame`, `Rejection`, `decodeBatch`, `filterGlitches`, `batchStartUs`, `kLimits` (Task 1).
- Produces:
  ```cpp
  // capture_log.h
  std::string formatBatch(int64_t startUs, const Level* raw, size_t n, const Frame* frames, size_t nFrames, Rejection first);
  class CaptureStats {
   public:
    void add(int64_t startUs, const Frame* frames, size_t nFrames);   // frame times: startUs + offsetUs
    void overflowed();                                               // a batch that filled the RMT's memory
    std::string summary(size_t ringLowWater);                        // and resets the counters
  };
  // ir_rmt.h (board only)
  namespace ir {
    constexpr size_t kMaxLevels = 512;                // 4 memory blocks (spec §5.3)
    struct Batch { int64_t readUs; size_t n; tinylap::Level levels[kMaxLevels]; };
    bool begin(int pin);                              // RMT RX: channel 0, 4 blocks, clk_div 80 (1 µs), filter 255 APB ticks, idle 2500 µs, 8 KB ring
    bool receive(Batch& out, uint32_t waitMs);        // one batch, items converted to levels (level 0 → low); false on timeout
    size_t ringLowWater();                            // the least free space the ring buffer has had, in bytes
  }
  ```

- [ ] **Step 1: Write the failing tests** for `capture_log`:
  - `test_line_format`: a 3-level batch with one frame of id 42 at `startUs = 12345678` → exactly `F t=12345678 n=3 L902 H448 L301 d=1651 id=42` (spec §4.1; `d` is the sum of the levels).
  - `test_line_rejected`: no frames, `{Reject::Bit, 3}` → ends in `id=? bit 3`; `Start` → `id=? start`; `Stop` → `id=? stop`; `Short` → `id=? short`; `Burst` → `id=? burst`; `Long` → `id=? long`.
  - `test_line_two_frames`: → ends in `id=5,99`.
  - `test_summary` (spec §4.1's "batches dropped" is reported as `overflow`, batches that filled the RMT's memory, and `ringlow`, the ring buffer's low-water mark: the legacy driver drops a batch on a full ring buffer without telling the caller, so a `ringlow` near 0 is the sign): id 42 at 0, 12000, 25000 µs and one overflow → `S batches=3 overflow=1 ringlow=4096 id=42 frames=3 gap=12000..13000 mean=12500 sd=500`, then a second `summary` reports `batches=0` with no id parts.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement `capture_log.cpp`.** Gaps are per id, frame to frame within a summary period; `sd` is the population standard deviation of the gaps, rounded to whole µs; ids in ascending order.

- [ ] **Step 4: Run the tests:** all pass.

- [ ] **Step 5: Implement `ir_rmt.cpp` and `capture.cpp`.** `ir_rmt` uses the legacy `driver/rmt.h` (`rmt_config`, `rmt_driver_install`, `rmt_get_ringbuf_handle`, `rmt_rx_start`, `xRingbufferReceive`, `vRingbufferReturnItem`), with the values in the interface above; `readUs` is `esp_timer_get_time()` right after the receive. `capture.cpp`: `Serial.setTxBufferSize(8192)`, `Serial.begin(921600)`, `ir::begin(4)`; `loop()` receives a batch (100 ms wait), keeps a copy of the raw levels, filters and decodes a working copy with `kLimits`, prints `formatBatch`, adds to the stats (`overflowed()` when `n == kMaxLevels`), and every 5 s prints `summary(ir::ringLowWater())`. It reads nothing from the serial port.

- [ ] **Step 6: Build:** `pio run -e capture` and `pio run -e esp32dev` (the latter with an empty `src/main.cpp` defining `setup()`/`loop()` until Task 8). No warnings from our files.

- [ ] **Step 7: Commit:** `feat(firmware): a capture build that logs every receiver pulse`

### Task 3: Capture on the owner's board

Needs the owner. The tasks after it don't depend on it: if the owner isn't ready, go on with Task 4 and come back; Task 5's parameters and Task 1's limits are revisited here.

**Files:**
- Create: `test/test_frames/capture-2026-10-<dd>.txt`
- Modify: `lib/tinylap/frames.cpp` (`kLimits`), `test/test_frames/test_main.cpp`, `README.md` (the frame format, no longer "to be confirmed"), `lib/tinylap/crossings.h` defaults if Task 5 is done

- [ ] **Step 1: Find the port.** `ls /dev/cu.* > "$LOGS/ports-before.txt"`; ask the owner to plug the board in (data cable, receivers connected) and say "plugged in"; `ls /dev/cu.*` again; the one new port is the board's. Name it back to the owner and wait for their yes. Record the USB chip: `ioreg -p IOUSB -l -w0 | grep -E '"USB Product Name"|idVendor|idProduct'` (spec §11 item 1).

- [ ] **Step 2: Back up the firmware on the board** (spec §4.2 step 0): `pio pkg exec -p tool-esptoolpy -- esptool.py --port <port> read_flash 0 0x400000 "$LOGS/backup-<date>.bin"`. Write the restore command into `$LOGS/restore.txt`: `pio pkg exec -p tool-esptoolpy -- esptool.py --port <port> write_flash 0 "$LOGS/backup-<date>.bin"`.

- [ ] **Step 3: Ask the owner to allow the upload**, then `pio run -e capture -t upload --upload-port <port>`.

- [ ] **Step 4: Monitor in the background:** `pio device monitor -e capture -p <port> > "$LOGS/capture.log" 2>&1` (run in background). Check the first lines arrive.

- [ ] **Step 5: Walk the owner through spec §4.2 steps 3–7**, one at a time, saying exactly what to do, writing a marker for each into `$LOGS/capture-steps.txt` with the time, and waiting for a summary line (`S …`) after each.

- [ ] **Step 6: Stop the monitor and analyse.** Report to the owner (spec §4.2): the id, burst and pause lengths and their spread, the frame rate, frames per fast sweep, how range and angle change the pulses, the noise in the quiet run, `overflow` and `ringlow`. If the format isn't the README's, stop and agree the frame decoder's changes with the owner before going on.

- [ ] **Step 7: Set the limits** in `kLimits` from the measured values with at least ±15% margin (spec §4.3); write in `frames.cpp` where each value came from. If a ratio to the start period separates 0 and 1 better, say so to the owner first; it changes `decodeBatch`.

- [ ] **Step 8: Commit the capture as a test** (spec §4.4): a few seconds per case from `capture.log`, each case under a line `# case <name> id=<known id>`. Add `test_capture_decodes_to_known_ids`: parse every `F …` line's levels, filter and decode them; assert no frame has an id other than its case's, and that at least 90% of the `still` case's batches decode. Update the README's frame format and drop "to be confirmed". Run the tests.

- [ ] **Step 9: Commit:** `test(firmware): the owner's transponder capture sets the frame limits`

### Task 4: Shared protocol vectors, and the C++ protocol

**Files:**
- Create: `packages/timing/test/zround-vectors.json`, `lib/tinylap/zround.h/.cpp`, `lib/tinylap/base64url.h/.cpp`, `test/test_zround/test_main.cpp`, `test/test_base64url/test_main.cpp`
- Modify: `packages/timing/zround.js:16-23` (`decode`), `packages/timing/test/zround.test.js`

**Interfaces:**
- Produces (namespace `tinylap`):
  ```cpp
  // base64url.h
  bool base64urlDecode(const std::string& in, std::string& out);   // alphabet A–Z a–z 0–9 - _ only, no padding; length % 4 == 1 is invalid
  std::string bootId(uint32_t (*random)());                        // 11 characters of the base64url alphabet, random() % 64 each
  // zround.h
  struct Message {
    enum class Type { Unknown, Startup, Reset, Stop, HelloRequest, Pair, Wifi } type;
    std::string decoder, token;      // Pair
    std::string ssid, password;      // Wifi: decoded bytes
    std::string raw;                 // Unknown
  };
  Message parseMessage(const std::string& body);    // PC → decoder messages only (spec §7)
  class Reader { public: std::vector<Message> push(const char* data, size_t n); };   // as createReader; pending cut at 1024
  namespace line {
    std::string ack();                                           // %A&
    std::string ok();                                            // %TLOK&
    std::string error(const std::string& text);                  // %TLERR <text without % and &>&
    std::string id(const std::string& decoder, const std::string& boot);   // decoder "" → "-"
    std::string lap(const std::string& transponder, uint64_t tMs);
    std::string clock(uint64_t tMs);
    std::string transponder(uint8_t id);                         // upper-case hex, no padding (spec §6)
  }
  bool validDecoderId(const std::string&);   // /^[A-Za-z0-9_-]{1,64}$/
  bool validToken(const std::string&);       // /^[A-Za-z0-9_-]{43}$/
  ```
- Vectors file shape:
  ```json
  { "toDecoder": [ { "body": "C", "message": { "type": "startup" } } ],
    "fromDecoder": [ { "call": ["lap", "4A1F", 1000], "line": "%L4A1F,3E8&" } ],
    "streams": [ { "chunks": ["noise %C", "&%TLHE", "LLO&"], "messages": [{ "type": "startup" }, { "type": "hello-request" }] } ] }
  ```
  `message` is what `parseMessage` returns, so `type` uses its names (`startup`, `reset`, `stop`, `hello-request`, `pair`, `wifi`, `unknown`). `call` names a `commands` entry (a string one when there are no arguments) or `transponder` (the C++ only; JavaScript skips it). Streams carry only PC → decoder messages and ASCII.

- [ ] **Step 1: Write the vectors.** `toDecoder`: `C`, `I`, `F`, `TLHELLO`, a valid `TLPAIR`, `TLPAIR` with a short token (unknown), `TLWIFI` of `Office 5G & Co` / `p%ss wörd` (as `commands.wifi` encodes it), an empty password (`TLWIFI T2ZmaWNl ` → password `""`), `+`, `/`, `=`, a tab in a field, a length-1-mod-4 field, invalid UTF-8 (`TLWIFI _w ` style) — each of the last five `unknown`. `fromDecoder`: `ack`, `ok`, `error("50% & more")` → `%TLERR 50  more&`, `id(null, "b00tb00t")`, `id("dec_1", "b00tb00t")`, `lap("2A", 1000)`, `clock(500)`, `transponder` 0 → `0`, 42 → `2A`, 127 → `7F` (Review Focus 3). `streams`: the chunk boundary case above, a cut-off message resyncing at the last `%`, 5000 characters without `&` then `%C&`.

- [ ] **Step 2: Write the JavaScript test** in `zround.test.js`: read the file with `readFileSync(new URL('./zround-vectors.json', import.meta.url))`; one test each for `toDecoder` (`parseMessage(body)` deep-equals `message`; for `unknown` only the type is compared), `fromDecoder` (skip `transponder`; `commands[name](...args)` or `commands[name]` equals `line`), and `streams` (one reader, push each chunk, the concatenated output deep-equals `messages`). Run `pnpm --filter @tinylap/timing test`: the `+`/`/`/`=`/tab cases fail.

- [ ] **Step 3: Make `decode` in `zround.js` strict:** return `null` unless the value matches `/^[A-Za-z0-9_-]*$/`, before `atob`. Run the package's test, lint and typecheck: green.

- [ ] **Step 4: Write the failing C++ tests.** `test_zround`: open `VECTORS_PATH` (fail the test if it can't), parse with ArduinoJson, run `toDecoder` through `parseMessage` (type, and the fields for `pair`/`wifi`), `fromDecoder` through `line::…`, `streams` through one `Reader`. Plus `test_reader_bounded`: 5000 bytes without `&` then `%C&` → one Startup. `test_base64url`: the vectors' `TLWIFI` fields decode to the expected bytes; `"a"` (length 1) fails; `bootId` with a counter as `random` → 11 characters, all in the alphabet, and two calls differ.

- [ ] **Step 5: Run and see them fail.**

- [ ] **Step 6: Implement `base64url.cpp` and `zround.cpp`.** `parseMessage` splits the body on single spaces keeping empty fields (so `TLWIFI x ` has two fields, the second empty); `TLPAIR` needs exactly two fields passing `validDecoderId`/`validToken`; `TLWIFI` needs exactly two fields that both decode, and valid UTF-8 (reject invalid sequences, as JavaScript's `fatal: true` does).

- [ ] **Step 7: Run the native tests and the package's three checks:** green.

- [ ] **Step 8: Commit:** `feat(firmware): ZRound and %TL… messages, checked against shared vectors` (the JavaScript change in the same commit, since the vectors tie them).

### Task 5: Crossings (frames → passings)

**Files:**
- Create: `lib/tinylap/crossings.h/.cpp`, `test/test_crossings/test_main.cpp`

**Interfaces:**
- Produces:
  ```cpp
  enum class Stamp : uint8_t { First, Middle };
  struct CrossingParams { uint32_t gapMs = 150, quietMs = 500, minLapMs = 2000, maxCrossingMs = 500; uint8_t confirmFrames = 2; Stamp stamp = Stamp::Middle; };
  struct Passing { uint8_t id; uint32_t tMs; };
  class Crossings {
   public:
    explicit Crossings(const CrossingParams& p = {}, CrossingObserver* observer = nullptr);
    size_t onFrame(uint8_t id, uint32_t tMs, Passing* out, size_t maxOut);   // frames in time order
    size_t tick(uint32_t nowMs, Passing* out, size_t maxOut);                // closes crossings past gapMs, caps at maxCrossingMs
    void reset();                                                            // a new boot (spec §5.2)
  };
  enum class Outcome : uint8_t { Passed, Single, Quiet, MinLap };            // Single: fewer than confirmFrames
  struct CrossingEnd { uint8_t id; Outcome outcome; uint32_t firstMs, lastMs, stampMs; uint16_t frames; };
  struct CrossingObserver { virtual void ended(const CrossingEnd& e) = 0; virtual ~CrossingObserver() = default; };
  // the constructor is Crossings(const CrossingParams& p = {}, CrossingObserver* observer = nullptr)
  bool toBootMs(int64_t frameUs, int64_t bootStartUs, uint32_t* outMs);      // false for a frame from before the boot (spec §2.4)
  ```

- [ ] **Step 1: Write the failing tests** (frames every 12 ms unless said; "passings" are everything `onFrame` and `tick` return):
  - `test_one_crossing_first`: `Stamp::First`, frames at 1000, 1012, 1024 → one passing at 1000, returned by the frame at 1012.
  - `test_one_crossing_middle`: `Stamp::Middle`, frames 1000…1096 → nothing until `tick(1096 + 150)`, then one passing at 1048.
  - `test_single_frame_is_nothing`: one frame, `tick` far later → none.
  - `test_gap_149_and_151`: frames at 1000, 1149 → one crossing; at 1000, 1151 → two crossings, neither confirmed.
  - `test_parked_30s_is_one`: frames every 12 ms for 30 s → one passing, at `first + maxCrossingMs` with `Middle`, its stamp the middle of the frames so far.
  - `test_parked_with_dropouts_is_one`: 30 s of 2 s bursts separated by 200–400 ms gaps → one passing.
  - `test_lap_after_park_counts`: parked 10 s, unseen 3 s, a crossing → two passings.
  - `test_min_lap`: a crossing 1.5 s after a passing, with 600 ms unseen → nothing; 2.5 s after → a passing.
  - `test_two_cars_interleaved`: ids 3 and 9 alternating every 6 ms → one passing each.
  - `test_reset_drops_open_crossing`: two frames, `reset()`, `tick` → nothing; then a new crossing → a passing.
  - `test_first_crossing_right_after_boot_counts` (Review Focus 2): frames at 0, 12, 24 ms → a passing.
  - `test_frame_before_boot_is_dropped`: `toBootMs(999, 1000, &t)` is false; `toBootMs(2500, 1000, &t)` gives 1.
  - `test_128_ids`: ids 0 and 127 both tracked.
  - `test_ends_are_reported` (spec §6.1): with an observer, a confirmed crossing ends `Passed` with its frames, first, last and stamp; a lone frame `Single`; a flicker inside `quietMs` `Quiet`; a crossing inside `minLapMs` `MinLap`. Each reported once, when the crossing closes (on the next frame of that id past `gapMs`, or in `tick`). `reset()` reports nothing.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement `crossings.cpp`.** Per id, fixed array of 128: `open`, `counts`, `confirmed`, `emitted`, `frames`, `firstMs`, `lastMs`, `seen` (bool) + `lastSeenMs`, `passed` (bool) + `lastPassingMs`. A frame extends an open crossing when `t − lastMs < gapMs`; otherwise it closes the old one (emitting a `Middle` passing if confirmed and not emitted) and opens one with `counts = (!seen || t − lastSeenMs ≥ quietMs) && (!passed || t − lastPassingMs ≥ minLapMs)`. Confirmation at `confirmFrames`; `First` emits then; `Middle` emits on close or once `t − firstMs ≥ maxCrossingMs`, with `(firstMs + lastMs) / 2`. Every frame sets `lastSeenMs`. Emitting sets `lastPassingMs` to the stamp.

- [ ] **Step 4: Run the tests:** all pass.

- [ ] **Step 5: Commit:** `feat(firmware): one passing per car per crossing`

### Task 6: The session

**Files:**
- Create: `lib/tinylap/session.h/.cpp`, `test/test_session/test_main.cpp`

**Interfaces:**
- Consumes: `Reader`, `Message`, `line::…`, `validDecoderId`, `validToken`, `bootId` (Task 4); `Passing` (Task 5).
- Produces:
  ```cpp
  struct Store {
    virtual bool load(std::string& decoder, std::string& token) = 0;     // false when nothing is stored
    virtual bool savePairing(const std::string& decoder, const std::string& token) = 0;
    virtual bool saveWifi(const std::string& ssid, const std::string& password) = 0;   // bytes, may hold NUL
    virtual ~Store() = default;
  };
  struct Sink { virtual void write(const std::string& line) = 0; virtual ~Sink() = default; };
  class Session {
   public:
    Session(Store& store, uint32_t (*random)(), Sink& out, std::function<void(bool powerOn)> onBoot = {});
    void begin(int64_t nowUs);                                  // loads the pairing (a bad id counts as unpaired), new boot, %TLID
    void onBytes(const char* data, size_t n, int64_t nowUs);    // replies per spec §6
    // onBoot runs right after every %TLID that starts a boot: powerOn true from begin(), false for %I&
    void onPassing(const Passing& p);                           // %L<line::transponder(p.id)>,<hex tMs>&
    void tick(int64_t nowUs);                                   // %T at every whole second of the boot, the first at 1000
    int64_t bootStartUs() const;
    const std::string& boot() const;
  };
  ```

- [ ] **Step 1: Write the failing tests** with a fake store (records calls, can be told to fail), a counter as `random`, and a sink that collects lines. One test per row of spec §6's table, then:
  - `test_begin_unpaired_and_paired`: empty store → `%TLID - <boot>&`, then `onBoot(true)`; a stored `dec_1` → `%TLID dec_1 <boot>&`.
  - `test_bad_stored_id_is_unpaired`: stored `"bad id!"` → `%TLID - …`.
  - `test_reset_new_boot`: `%I&` → `onBoot(false)` right after the `%TLID` line (the sink holds `%TLID` when the callback runs), a different `boot()`, `bootStartUs()` = now, `%TLID` with the new boot; the pairing kept.
  - `test_pair`: `%TLPAIR dec_1 <43 chars>&` → `savePairing`, `%TLOK&`; then `%TLHELLO&` → `%TLID dec_1 …`; a second `%TLPAIR dec_2 …` replaces it; with the store failing → `%TLERR store&` and the old identity kept.
  - `test_wifi_bounds`: SSID of 0 and 33 bytes → `%TLERR Wi-Fi name too long&`; password of 7 and 64 non-hex bytes → `%TLERR Wi-Fi password length&`; empty, 8, 63 bytes and 64 hex digits → `saveWifi`, `%TLOK&`; store failing → `%TLERR store&`.
  - `test_wifi_bytes_reach_the_store_exactly` (Review Focus 5): an SSID `"a\0b\xC3\xA9"` → `saveWifi` gets those 5 bytes.
  - `test_longest_pairing_round_trips` (Review Focus 4): a 64-character id → stored and in `%TLID`.
  - `test_stop_and_unknown_are_silent`: `%F&`, `%XYZ&` → no lines.
  - `test_clock`: `begin(0)`; `tick` at 999 ms → nothing; 1000 → `%T3E8&`; 3500 → `%T7D0&`, `%TBB8&`; after `%I&` at 4000 the next is at 5000 → `%T3E8&`.
  - `test_passing_line`: `onPassing({42, 1000})` → `%L2A,3E8&`.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement `session.cpp`.** Validation of `%TLWIFI` lengths is in bytes. Each reply is one `out.write` call of a whole line.

- [ ] **Step 4: Run the tests:** all pass.

- [ ] **Step 5: Commit:** `feat(firmware): the decoder's ZRound and %TL… session`

### Task 7: Diagnostics: counters and `%TLLOG`

**Files:**
- Create: `lib/tinylap/diag.h/.cpp`, `test/test_diag/test_main.cpp`
- Modify: `docs/timing.md` (the TinyLap messages table and a short "Diagnostics" paragraph: `%TLLOG`, decoder → PC, the four kinds and their fields, as spec §6.1)

**Interfaces:**
- Consumes: `CrossingEnd`, `Outcome` (Task 5); `line::…` style (Task 4).
- Produces:
  ```cpp
  struct Counters { uint32_t batches, frames, rejStart, rejBit, rejStop, rejShort, rejBurst, rejLong,
                    overflow, ringlow, qdrop, pass, single, quiet, minlap, rxdrop, suppressed; };
  std::string bootLine(const char* reason, const char* fw, const Counters* prev);   // prev may be null
  std::string statLine(const Counters& c, uint32_t upS, uint32_t heap);
  std::string passLine(const CrossingEnd& e);                       // Outcome::Passed only
  std::string eventLine(const CrossingEnd& e);                      // Single, Quiet, MinLap
  std::string overflowLine(uint32_t tMs);
  class EventLimit { public: bool allow(uint32_t nowMs); };        // 20 per 10 s window; the caller counts the rest in suppressed
  struct Saved { uint32_t magic; Counters c; uint32_t sum; };       // lives in RTC_NOINIT memory on the board
  void save(Saved& s, const Counters& c);
  bool restore(const Saved& s, Counters& out);                      // false unless magic and sum match
  ```

- [ ] **Step 1: Write the failing tests:**
  - `test_boot_line`: `bootLine("poweron", "v0.1.0-3-gabc", nullptr)` → `%TLLOG boot reason=poweron fw=v0.1.0-3-gabc&`; with `prev` → the same followed by ` prev.batches=… prev.frames=…` for every counter, in the `Counters` order.
  - `test_stat_line`: given counters, `upS=600`, `heap=200000` → exactly `%TLLOG stat up=600 batches=… frames=… rej.start=… rej.bit=… rej.stop=… rej.short=… rej.burst=… rej.long=… overflow=… ringlow=… qdrop=… pass=… single=… quiet=… minlap=… rxdrop=… suppressed=… heap=200000&`.
  - `test_lines_fit`: every counter at `UINT32_MAX`, `upS` and `heap` too, a 40-character `fw` → `statLine` and `bootLine` with `prev` each under 512 bytes (spec §6.1).
  - `test_pass_line`: `{0x2A, Passed, 8000, 8104, 8052, 9}` → `%TLLOG pass id=2A t=1F74 first=1F40 last=1FA8 frames=9&`.
  - `test_event_lines`: `Single` → `%TLLOG event what=single id=2A t=1F40&` (`t` is `firstMs`); `Quiet`, `MinLap` likewise; `overflowLine(0x10)` → `%TLLOG event what=overflow t=10&`.
  - `test_event_limit`: 20 allowed in a window, the 21st not; allowed again 10 s after the window opened.
  - `test_saved_round_trip`: `save` then `restore` → equal; a flipped bit, or a wrong magic → `restore` false.
  - `test_no_bad_characters`: a `fw` with a space, `%` or `&` → replaced by `_`.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement `diag.cpp`.** `magic = 0x544C4C47` ("TLLG"); `sum` is a 32-bit FNV-1a over `c`'s bytes.

- [ ] **Step 4: Update `docs/timing.md`** as listed under Files.

- [ ] **Step 5: Run the tests:** all pass.

- [ ] **Step 6: Commit:** `feat(firmware): counters and %TLLOG diagnostics`

### Task 8: The decoder build

**Files:**
- Create: `src/store_nvs.h/.cpp`, `src/main.cpp` (replacing the placeholder)

**Interfaces:**
- Consumes: everything above; `ir::begin`, `ir::receive` (Task 2).
- Produces: `class NvsStore : public tinylap::Store` with `bool begin()`; namespace `tinylap`, keys `decoder`, `token` (`putString`), `ssid`, `pass` (`putBytes`).

- [ ] **Step 1: Implement `store_nvs.cpp`** with `Preferences`.

- [ ] **Step 2: Implement `main.cpp`** (spec §2.4):
  - `setup()`: `Serial.setRxBufferSize(1024)`, `Serial.begin(19200)`, the store, `Session::begin(esp_timer_get_time())`, a queue of 64 `{ uint8_t id; int64_t tUs; }`, `ir::begin(4)`, and the IR task pinned to core 0 at priority 10: `ir::receive` (portMAX_DELAY), `filterGlitches`, `decodeBatch` with `kLimits`, `batchStartUs(readUs, …, 2500)`, then one queue item per frame at `start + offsetUs`. It touches nothing else.
  - `loop()`: bytes from `Serial` into `onBytes`; drain the queue through `toBootMs` and `onFrame`; `crossings.tick`; every passing to `onPassing`; `session.tick`; `vTaskDelay(1)`.
  - The `Sink` writes with `Serial.write(line.data(), line.size())`; only `loop()` calls it.
  - **Diagnostics** (spec §6.1): the IR task's counters as `std::atomic<uint32_t>` it only increments (batches, frames, each rejection, overflow when `n == ir::kMaxLevels`, `qdrop` when `xQueueSend` fails) and `ringlow` from `ir::ringLowWater()`; `loop()` copies them into a `Counters` with its own (pass, single, quiet, minlap from a `CrossingObserver` that also writes the `pass`/`event` lines through an `EventLimit`; `rxdrop` from `Serial.onReceiveError`), writes `statLine` every 10 s with `ESP.getFreeHeap()`, and `save`s to an `RTC_NOINIT_ATTR Saved` each time. `onBoot(true)` writes `bootLine` with `esp_reset_reason()` mapped to `poweron`/`brownout`/`panic`/`wdt`/`sw`/`ext`/`other` (the task watchdogs and interrupt watchdog are `wdt`) and the restored counters as `prev` unless the reason is `poweron`; `onBoot(false)` writes `bootLine("reset", …, nullptr)` and resets the crossings. `FW_VERSION` comes from `git describe --always --dirty` through a `build_flags = !echo …` line in `platformio.ini`.
  - `boot ids`: `random` wraps `esp_random()`; `begin` and `%I&` run inside `bootloader_random_enable()`/`bootloader_random_disable()` (a wrapper in `main.cpp`, with a comment that it must never run once Wi-Fi is on, spec §3).

- [ ] **Step 3: Build both environments:** `pio run -e esp32dev -e capture`; no warnings from our files. Note the decoder's flash and RAM use from the log.

- [ ] **Step 4: Complete the README** (spec §2.2, §6): a "Build and flash" section (the three environments, the commands above with `--upload-port`, the capture's 921600 baud, restoring a backup), and a note that the token sits in NVS unencrypted, readable with `esptool`, and that unpairing is a new `%TLPAIR` or `pio run -t erase`.

- [ ] **Step 5: Commit:** `feat(firmware): the decoder build: IR to passings over ZRound`

### Task 9: CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the jobs** (spec §10):
  - `changes`: `dorny/paths-filter@v3` with a `firmware` filter on `firmware/**`, `packages/timing/test/zround-vectors.json`, `.github/workflows/ci.yml`.
  - `firmware`: `needs: changes`, `if: github.event_name != 'pull_request' || needs.changes.outputs.firmware == 'true'`; `actions/checkout@v4`, `actions/setup-python@v5` (3.12), `actions/cache@v4` on `~/.platformio` keyed `pio-${{ hashFiles('firmware/tinylap-decoder/platformio.ini') }}`, `pip install platformio==6.2.0`, then in `firmware/tinylap-decoder`: `pio test -e native` and `pio run -e esp32dev -e capture`.
  - No deploy job depends on it.

- [ ] **Step 2: Check the YAML** with `actionlint` if installed (`pipx run actionlint` or `brew`), otherwise `python3 -c 'import yaml,sys; yaml.safe_load(open(".github/workflows/ci.yml"))'`.

- [ ] **Step 3: Commit:** `ci: build and host-test the decoder firmware`

The job's first real run comes with the pull request, which needs the owner's go-ahead. Say then how long it took, cold and warm.

### Task 10: The decoder on the owner's board

Needs the owner, and the bridge. If a serial error ends the bridge's session (spec §11), that is the bridge follow-up, not a firmware bug: note it and go on with what can be checked over `pio device monitor`.

- [ ] **Step 1: Ask the owner to allow the upload**, then `pio run -e esp32dev -t upload --upload-port <port>`.

- [ ] **Step 2: Over the monitor** (in the background at 19200, its output to `$LOGS/decoder.log`, commands sent by the owner or with `pio device monitor`'s input): power-up `%TLID - <boot>&`; `%C&` → `%A&`; `%TLHELLO&` → `%TLID`; `%T` every second; the test transponder held up → one `%L<hex id>,<t>&`; held still for 30 s → still one; `%TLLOG boot reason=poweron …` after the first `%TLID`, a `stat` line every 10 s, a `pass` line per passing; press EN → `reason=ext`.

- [ ] **Step 3: With the bridge** (timing running locally per `apps/timing/README.md`, or the owner's production club, as the owner prefers): spec §11 items 2, 4, 5 and 7, the owner clicking where Chrome needs a click. Record each result.

- [ ] **Step 4: Write the results** into the README (the USB chip, how opening the port behaves) and commit: `docs(firmware): what the board does on the bench`.

- [ ] **Step 5: Report to the owner:** the checklist results, and whether the bridge follow-up needs `setSignals` and the serial-error fix (spec §11). Ask before opening a pull request.
