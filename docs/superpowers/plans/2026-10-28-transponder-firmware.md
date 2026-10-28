# Transponder firmware and frame format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new ATtiny45 transponder program that sends a frame every TSOP38238 receives whole, and a decoder that reads it.

**Architecture:** One shared library, `firmware/lib/tinylap-ir`, defines the frame in carrier cycles and encodes it. The transponder (`firmware/tinylap-transponder`, plain avr-libc) plays the encoded frame out with a cycle-counted software carrier. The decoder's `decodeBatch` reads 8 bits with parity, with limits that meet halfway between the nominal periods.

**Tech Stack:** PlatformIO 6.2.0, `platformio/atmelavr@5.3.0` (board `attiny45`, no framework), the decoder's existing `espressif32@6.13.0` and `native` envs with Unity, Python 3 standard library (`unittest`) for the flashing tool.

**Spec:** `docs/superpowers/specs/2026-10-28-transponder-firmware-design.md`

## Global Constraints

- Files under `firmware/**` are MPL-2.0 through `REUSE.toml`; no per-file headers (the decoder's files have none). `reuse lint` stays compliant.
- Commits: conventional, `git commit -s`, author email `1009814+jostsg@users.noreply.github.com`, no AI attribution.
- Docs describe how things work: no people's names, no who-did-what, no dated events.
- The format lives only in `firmware/lib/tinylap-ir`; nothing else repeats its cycle counts.
- `tinylap-ir` and the transponder's library compile for AVR: no STL containers, no exceptions, no heap.
- The native envs build with `-std=c++17 -Wall -Wextra -fsanitize=address,undefined`; no warnings.
- Never upload to a board without asking. No board work in this plan except Task 8, which is the owner's.

## Review Focus

1. **A burst start jittering by ±79 µs on every burst at once, in opposite directions on neighbours** must still decode: Task 3's tolerance test moves alternate starts −79/+79.
2. **The clock off by 1.5% in both directions, together with jitter** must still decode: Task 3 scales every level by 0.985 and 1.015 and adds the jitter.
3. **Two transponders whose frames overlap at any offset** must never decode a third id: Task 3's overlap sweep covers offsets 0–16,000 µs in 40 µs steps.
4. **A blank or half-written EEPROM** (id 0xFF, or a complement that doesn't match) must send nothing, not id 127: Task 4's `tlIdValid` tests.
5. **A batch cut off mid-frame** (fewer than 10 bursts, or a good start with no stop) must be rejected as `Short` or `Stop`, never decode: Task 3's truncation test.

---

### Task 1: The shared frame definition

**Files:**
- Create: `firmware/lib/tinylap-ir/library.json`, `firmware/lib/tinylap-ir/tinylap_ir.h`, `firmware/lib/tinylap-ir/tinylap_ir.cpp`
- Create: `firmware/tinylap-decoder/test/test_ir/test_main.cpp`
- Modify: `firmware/tinylap-decoder/platformio.ini` (add `lib_extra_dirs = ../lib` to `[env:esp32dev]` and `[env:native]`; `capture` inherits it)

**Interfaces:**
- Produces (global scope, no namespace):
  - `constexpr uint32_t TL_CARRIER_HZ = 38000;`
  - `constexpr uint8_t TL_START_BURST = 46, TL_START_PAUSE = 30, TL_BURST = 15, TL_ZERO_PAUSE = 15, TL_ONE_PAUSE = 30, TL_BITS = 8;`
  - `constexpr uint8_t TL_LEVELS = 19;` (start burst, start pause, 8 × (burst, pause), stop burst)
  - `constexpr uint16_t TL_GAP_MIN_US = 12000, TL_GAP_MAX_US = 28000;`
  - `uint32_t tlCyclesToUs(uint16_t cycles);` rounds `cycles × 1e6 / 38000` to the nearest µs, computed as `(uint32_t(cycles) * 1000 + 19) / 38` (no overflow, no 64-bit division on AVR)
  - `bool tlParity(uint8_t id);` the even-parity bit for the 7-bit id (true when the id has an odd number of ones)
  - `size_t tlEncodeFrame(uint8_t id, uint16_t* levelsCycles, size_t max);` writes the 19 levels in cycles (burst first, alternating) and returns 19; returns 0 for `id > 127` or `max < 19`

- [ ] **Step 1: Write the failing tests** in `test/test_ir/test_main.cpp`:

```cpp
void test_cycles_to_us() {
  TEST_ASSERT_EQUAL_UINT32(1211, tlCyclesToUs(46));
  TEST_ASSERT_EQUAL_UINT32(395, tlCyclesToUs(15));
  TEST_ASSERT_EQUAL_UINT32(789, tlCyclesToUs(30));
  TEST_ASSERT_EQUAL_UINT32(1184, tlCyclesToUs(45));
  TEST_ASSERT_EQUAL_UINT32(2000, tlCyclesToUs(76));
}
void test_parity_makes_eight_bits_even() {
  for (int id = 0; id < 128; id++) {
    int ones = __builtin_popcount(id) + (tlParity(uint8_t(id)) ? 1 : 0);
    TEST_ASSERT_EQUAL(0, ones % 2);
  }
}
void test_encode_every_id() {
  uint16_t c[TL_LEVELS];
  for (int id = 0; id < 128; id++) {
    TEST_ASSERT_EQUAL(19, tlEncodeFrame(uint8_t(id), c, TL_LEVELS));
    TEST_ASSERT_EQUAL(46, c[0]);
    TEST_ASSERT_EQUAL(30, c[1]);
    uint8_t bits = uint8_t(id) | uint8_t(tlParity(uint8_t(id)) << 7);
    for (int b = 0; b < 8; b++) {
      TEST_ASSERT_EQUAL(15, c[2 + 2 * b]);
      TEST_ASSERT_EQUAL((bits >> b) & 1 ? 30 : 15, c[3 + 2 * b]);
    }
    TEST_ASSERT_EQUAL(15, c[18]);
  }
}
void test_encode_refuses() {
  uint16_t c[TL_LEVELS];
  TEST_ASSERT_EQUAL(0, tlEncodeFrame(128, c, TL_LEVELS));
  TEST_ASSERT_EQUAL(0, tlEncodeFrame(5, c, 18));
}
```

- [ ] **Step 2:** `pio test -e native -f test_ir` in `firmware/tinylap-decoder`. Expected: FAIL, `tinylap_ir.h` not found.
- [ ] **Step 3:** Write the library. `library.json`: `{ "name": "tinylap-ir", "version": "0.0.0", "platforms": "*", "frameworks": "*" }`. The header comments say the format is in carrier cycles and points to the spec's §3.1.
- [ ] **Step 4:** `pio test -e native` (all suites) and `pio run -e esp32dev -e capture`. Expected: all PASS, both builds SUCCESS.
- [ ] **Step 5: Commit** `feat(firmware): a shared definition of the TinyLap IR frame`

### Task 2: A parity reason, through capture log, counters and docs

**Files:**
- Modify: `firmware/tinylap-decoder/lib/tinylap/frames.h` (`enum class Reject : uint8_t { None, Start, Bit, Stop, Short, Burst, Long, Parity };`, `Parity` appended; nothing returns it until Task 3)
- Modify: `firmware/tinylap-decoder/lib/tinylap/capture_log.cpp` (case `Reject::Parity` → `" parity"`), `test/test_capture_log/test_main.cpp`
- Modify: `firmware/tinylap-decoder/lib/tinylap/diag.h` (`rejParity` after `rejLong`; 18 counters; `static_assert` 18), `diag.cpp` (`kKeys[18]` with `"rej.parity"` after `"rej.long"`, and the loop bound at `diag.cpp:32`), `test/test_diag/test_main.cpp` (its own `kKeys[17]` and the three loops bounded by 17); better, replace each literal 17/18 with a count derived from `sizeof(Counters) / sizeof(uint32_t)`
- Modify: `firmware/tinylap-decoder/src/main.cpp` (an atomic `rejParity`, copied into the counters, counted in the reason switch)
- Modify: `docs/timing.md` (the `stat` key list), `docs/superpowers/specs/2026-10-26-decoder-firmware-design.md` §6.1 table (the key list)

**Interfaces:**
- Produces: `Reject::Parity`; `%TLLOG stat` carries `rej.parity=<hex>` after `rej.long`.

- [ ] **Step 1:** Add the failing cases: capture log `{{Reject::Parity, 0}, "id=? parity"}`; the diag key list in its test gains `"rej.parity"` in position 8.
- [ ] **Step 2:** `pio test -e native`. Expected: FAIL in `test_capture_log` and `test_diag`.
- [ ] **Step 3:** Implement. `restore` of counters saved by the 17-counter build fails its checksum and reports nothing, which is right after a reflash; say so in a comment at `Saved`.
- [ ] **Step 4:** `pio test -e native`, `pio run -e esp32dev -e capture`. Expected: PASS, SUCCESS, no warnings.
- [ ] **Step 5: Commit** `feat(firmware): count frames that fail parity`

### Task 3: The decoder reads the new frame

**Files:**
- Modify: `firmware/tinylap-decoder/lib/tinylap/frames.h`, `frames.cpp`
- Modify: `firmware/tinylap-decoder/test/test_frames/test_main.cpp` (rewrite the frame builders on `tlEncodeFrame`)
- Modify: `firmware/tinylap-decoder/README.md` (drop the paragraph saying `kLimits` holds the old guess; the frame section says the decoder reads the format of `firmware/lib/tinylap-ir`)
- Modify: `firmware/tinylap-decoder/src/main.cpp` (`kTickLagMs`)

**Interfaces:**
- Consumes: Task 1's `tlEncodeFrame`, `tlCyclesToUs`, `TL_*`; Task 2's `Reject::Parity`.
- Produces:
  - `struct FrameLimits { uint16_t glitchMax, startMin, startMax, oneMin, oneMax, zeroMin, zeroMax, burstMin, burstMax, frameMax, silenceMin, startBurstMin, startBurstMax; };` (two fields appended)
  - `kLimits = {100, 1593, 2400, 987, 1592, 590, 986, 200, 700, 15836, 2000, 800, 1700};`
  - `Rejection::bit` is 0–7.
  - `decodeBatch` unchanged in signature: a frame is 10 bursts; the start burst is checked against `startBurstMin/Max`, the 9 others against `burstMin/Max`; 8 periods give 8 bits LSB first; the frame's id is the low 7 bits; a frame whose 8 bits hold an odd number of ones is rejected with `Reject::Parity`; `after` is checked on the 10th burst; the frame length is `starts[i+9] + lens[i+9] − starts[i]`; `i += 10` after a frame; fewer than 10 bursts with no start period is `Short`.

- [ ] **Step 1: Rewrite the test builders.** `static Levels train(uint8_t id, const uint16_t* periodsUs = nullptr, bool stop = true, const int16_t* startJitterUs = nullptr, const int16_t* endJitterUs = nullptr, double scale = 1.0)` builds levels from `tlEncodeFrame` through `tlCyclesToUs`: `periodsUs` overrides the 9 start-to-start periods (slot 0 the start, 1–8 the bits) as the old builder did; `stop = false` leaves out the stop burst; `startJitterUs[k]` moves burst k's start (taken from the pause before it, given to the pause after it); `endJitterUs[k]` lengthens or shortens burst k (taken from or given to the pause after it); every level is then multiplied by `scale`. `periodsFor` becomes 9 periods from the shared constants. `overlap()` sizes its buffer `offUs + 16000` (a frame is up to 11,867 µs). Keep the existing tests' intent with the new values; `test_silence_bound_is_a_parameter` asserts 2000 and its comment no longer calls the value a pre-measurement default.
- [ ] **Step 2: Write the new failing tests:**

```cpp
void test_limits_meet_halfway() {  // spec §5.2: windows from the nominal periods, meeting halfway
  uint32_t z = tlCyclesToUs(TL_BURST + TL_ZERO_PAUSE), o = tlCyclesToUs(TL_BURST + TL_ONE_PAUSE),
           s = tlCyclesToUs(TL_START_BURST + TL_START_PAUSE);
  TEST_ASSERT_EQUAL(kLimits.zeroMax + 1, kLimits.oneMin);
  TEST_ASSERT_EQUAL(kLimits.oneMax + 1, kLimits.startMin);
  TEST_ASSERT_UINT32_WITHIN(1, (z + o) / 2, kLimits.zeroMax);
  TEST_ASSERT_UINT32_WITHIN(1, (o + s) / 2, kLimits.oneMax);
  TEST_ASSERT_EQUAL(kLimits.startMax + 8u * kLimits.oneMax + kLimits.burstMax, kLimits.frameMax);
  TEST_ASSERT_TRUE(kLimits.zeroMin <= z && kLimits.startMax >= s);
  uint32_t b = tlCyclesToUs(TL_BURST), sb = tlCyclesToUs(TL_START_BURST);
  TEST_ASSERT_TRUE(kLimits.burstMin < b && b < kLimits.burstMax);
  TEST_ASSERT_TRUE(kLimits.startBurstMin < sb && sb < kLimits.startBurstMax);
}
void test_every_id_round_trips();          // all 128 ids: one frame, that id, offsetUs 0
void test_single_bit_flip_is_parity();     // for each of the 8 bits: swap 15 <-> 30 pause cycles -> 0 frames, Reject::Parity
void test_jitter_and_clock_tolerance();    // ids 0, 0x2A, 0x55, 127; scale 0.985 and 1.015; burst starts alternately -79/+79 µs; burst ends ±132 µs -> decodes
void test_truncated_frames();              // the first 9 bursts only -> Reject::Stop; 5 data bursts (no start burst, so no start period) -> Reject::Short
void test_two_frames_gap_apart();          // two frames TL_GAP_MIN_US apart -> 2 frames, offsets right
void test_start_burst_limits();            // start burst 799 µs and 1701 µs -> Reject::Burst; 800 and 1700 -> decodes
```

and change `test_overlap_is_not_a_third_id` to sweep offsets 0–16,000 µs in 40 µs steps over ids `{0, 5, 0x2A, 0x55, 99, 127}` and assert `third == 0`, removing the "ghost risk" comment.
- [ ] **Step 3:** `pio test -e native -f test_frames`. Expected: FAIL (old limits, 7 bits).
- [ ] **Step 4:** Change `frames.h`/`frames.cpp` as in Interfaces. The checks run in this order: start period, the 8 bit periods (`Reject::Bit` with the bit 0–7), burst lengths, silence before and after, frame length, and **parity last**, so a frame that fails anything else keeps its old reason. Update `frames.h`'s comment on `silenceMin` (it is above the longest pause in a frame, 789 µs, and below `kIdleUs` 2500). In `src/main.cpp`, raise `kTickLagMs` from 15 to 20 and fix its comment: the idle threshold (2.5 ms), the longest frame (about 12 ms) and wake-up margin.
- [ ] **Step 5:** `pio test -e native` and `pio run -e esp32dev -e capture`. Expected: all PASS, both SUCCESS.
- [ ] **Step 6: Commit** `feat(firmware): decode the new frame with parity`

### Task 4: The transponder project and its logic

**Files:**
- Create: `firmware/tinylap-transponder/platformio.ini`
- Create: `firmware/tinylap-transponder/lib/transponder/library.json`, `transponder.h`, `transponder.cpp`
- Create: `firmware/tinylap-transponder/test/test_transponder/test_main.cpp`
- Create: `firmware/tinylap-transponder/.gitignore` (`.pio/`, as the decoder's)

**Interfaces:**
- Consumes: Task 1's `TL_GAP_MIN_US`, `TL_GAP_MAX_US`.
- Produces (global scope):
  - `bool tlIdValid(uint8_t id, uint8_t complement);` true iff `id <= 127` and `complement == id ^ 0xFF`
  - `uint16_t tlSeed(uint8_t id);` `0xACE1 ^ uint16_t(id * 0x9E37)`, or `0xACE1` if that is 0
  - `uint16_t tlXorshift(uint16_t& state);` xorshift16 (7, 9, 8); never returns 0 from a non-zero state
  - `uint16_t tlNextGapUs(uint16_t& state);` evenly from `TL_GAP_MIN_US`–`TL_GAP_MAX_US`: draw `tlXorshift` until the value is below `64004` (4 × 16001, so no value is favoured), then `TL_GAP_MIN_US + value % 16001`

`platformio.ini`:

```ini
[env:attiny45]
platform = atmelavr@5.3.0
board = attiny45
board_build.f_cpu = 8000000L
board_fuses.lfuse = 0xE2
board_fuses.hfuse = 0xD5
board_fuses.lock_bits = 0xFF
upload_protocol = usbasp
build_unflags = -std=gnu++11
build_flags = -std=gnu++17 -DTL_LED_PIN=PB0
lib_extra_dirs = ../lib

[env:native]
platform = native
test_framework = unity
build_flags = -std=c++17 -Wall -Wextra -fsanitize=address,undefined
lib_extra_dirs = ../lib
```

with a comment that `TL_LED_PIN` and `upload_protocol` are the two settings that depend on the board and the programmer (spec §4.1). The extended fuse is not set (spec §4.2); `lock_bits = 0xFF` keeps `-t fuses` from sending an empty lock write. Step 2 checks that `pio run -e attiny45 -t fuses -v` (dry: no programmer attached, so it fails at connecting) shows exactly `-Ulfuse:w:0xE2:m -Uhfuse:w:0xD5:m -Ulock:w:0xFF:m`.

- [ ] **Step 1: Write the failing tests:**

```cpp
void test_id_valid() {
  TEST_ASSERT_TRUE(tlIdValid(0, 0xFF));
  TEST_ASSERT_TRUE(tlIdValid(12, 0xF3));
  TEST_ASSERT_TRUE(tlIdValid(127, 0x80));
  TEST_ASSERT_FALSE(tlIdValid(0xFF, 0xFF));  // blank EEPROM
  TEST_ASSERT_FALSE(tlIdValid(0xFF, 0x00));  // 255 with its complement: above 127
  TEST_ASSERT_FALSE(tlIdValid(12, 0xFF));    // complement not written
  TEST_ASSERT_FALSE(tlIdValid(128, 0x7F));
}
void test_seed_never_zero();         // all 256 ids: tlSeed != 0
void test_gaps_in_range();           // 100,000 draws from tlSeed(12): all within 12000..28000, min == 12000, max == 28000; the counts in the first and last 1000 µs of the range differ by under 10%
void test_ids_draw_different_gaps(); // ids 0..127: the first 8 gaps of each pair of ids differ somewhere
```

- [ ] **Step 2:** `pio test -e native` in `firmware/tinylap-transponder`. Expected: FAIL, `transponder.h` not found.
- [ ] **Step 3:** Implement `transponder.cpp`.
- [ ] **Step 4:** `pio test -e native`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(firmware): the transponder's id check and random gap`

### Task 5: The transponder program

**Files:**
- Create: `firmware/tinylap-transponder/src/main.cpp`

**Interfaces:**
- Consumes: Tasks 1 and 4.
- Produces: `.pio/build/attiny45/firmware.hex`.

Behaviour (spec §4.2, §4.3):
1. `clock_prescale_set(clock_div_1)` (`<avr/power.h>`, which keeps the timed CLKPR sequence). If EEPROM byte 2 isn't 0xFF, step `OSCCAL` towards it one unit at a time, as the datasheet recommends.
2. LED pin `TL_LED_PIN` as output, low. Read EEPROM bytes 0 and 1; if `!tlIdValid`, stay with the LED off forever (`sleep_mode()` in power-down with interrupts off).
3. Encode the frame once with `tlEncodeFrame` into a static array. `uint16_t state = tlSeed(id);`
4. Loop: `cli()`; for each level, `carrier(cycles, on)` where even levels are on; `sei()`; then wait `tlNextGapUs(state) / 100` iterations of `_delay_us(100)`.

`carrier(uint16_t cycles, bool on)` is the one timing-critical function: **each carrier cycle takes exactly 210 clock cycles, 105 with the pin high and 105 low when `on`, and the same 210 with the pin low when `!on`**, so bursts and pauses use the same clock. Write the loop in inline assembly (or with `__builtin_avr_delay_cycles` around single `sbi`/`cbi` writes, counted by hand) so the count doesn't depend on the optimiser, and put the cycle count per instruction in a comment.

- [ ] **Step 1:** Write `main.cpp`.
- [ ] **Step 2:** `pio run -e attiny45`. Expected: SUCCESS, flash under 2 KB, no warnings.
- [ ] **Step 3: Check the cycle count.** `pio pkg exec -p toolchain-atmelavr -- avr-objdump -d .pio/build/attiny45/firmware.elf`, find `carrier`, and count the cycles of one carrier period in both branches against the AVR instruction set's timings. Expected: 210 per period, 105 high + 105 low for `on`; also count the few cycles between two `carrier()` calls, which add to every level. At exactly 8 MHz, 210 clocks give a 1995 µs start period (−0.25%); that's fine, since each chip is calibrated to 2000 µs on the capture, not to 8 MHz. Write the counts into the report.
- [ ] **Step 4: Commit** `feat(firmware): the transponder program`

### Task 6: The flashing tool

**Files:**
- Create: `firmware/tinylap-transponder/tools/flash.py`, `firmware/tinylap-transponder/tools/test_flash.py`

**Interfaces:**
- Produces, as functions tested directly and as subcommands:
  - `eeprom_hex(id: int, osccal: int | None) -> str`: Intel HEX of 3 bytes at address 0 (`id`, `id ^ 0xFF`, `osccal` or `0xFF`), then `:00000001FF`. Raises `ValueError` for `id` outside 0–127 or `osccal` outside 0–255.
  - `osccal_correction(current: int, measured_start_us: float) -> int`: the clock runs `2000 / measured` of nominal; one OSCCAL step is about 1%; returns `current + round((measured − 2000) / 2000 × 100)`, clamped to the half of the range `current` is in (0–127 or 128–255). Raises `ValueError` if the measured period is more than 15% off 2000.
  - `avrdude_args(conf: str, programmer: str, port: str | None, flash_hex: str, eeprom_hex_path: str) -> list[str]`: `["-C", conf, "-c", programmer, "-p", "t45", (+ "-P", port), "-U", f"flash:w:{flash_hex}:i", "-U", f"eeprom:w:{eeprom_hex_path}:i"]`. `conf` is `<core dir>/packages/tool-avrdude/avrdude.conf`, the core dir being `$PLATFORMIO_CORE_DIR` or `~/.platformio`; if it's missing, the tool says to run `pio run -e attiny45 -t fuses` once, which installs avrdude.
  - `python3 tools/flash.py read-cal [--programmer] [--port]`: reads the chip's factory calibration byte (`-U calibration:r:-:h`), the value to pass as `--current` when no OSCCAL is stored yet.
  - `python3 tools/flash.py flash --id 12 [--osccal N] [--programmer usbasp] [--port P] [--hex .pio/build/attiny45/firmware.hex]`: checks the id and OSCCAL ranges, writes the EEPROM image to a temp file and runs `pio pkg exec -p tool-avrdude -- avrdude <args>` from the project directory. It is the only way to flash a transponder: plain `pio run -t upload` would erase the chip and write no id.
  - The file starts with `from __future__ import annotations`, so it runs on macOS's Python 3.9 too. `python3 tools/flash.py osccal --current N --start-us X` prints the corrected value.

- [ ] **Step 1: Write the failing tests** (`unittest`):

```python
def test_eeprom_hex_id_12(self):
    self.assertEqual(eeprom_hex(12, None), ":030000000CF3FFFF\n:00000001FF\n")
```

(the record's checksum is the two's complement of the byte sum: `03 + 00 + 00 + 00 + 0C + F3 + FF` → `0xFF`), plus: `eeprom_hex(12, 0x5A)` → `":030000000CF35AA4\n:00000001FF\n"`; `osccal_correction(100, 2000)` → 100; `(100, 2040)` → 102; `(100, 1960)` → 98; `(120, 2290)` → 127 (clamped); `(200, 1500)` raises; `eeprom_hex(128, None)` raises; `avrdude_args("a.conf", "usbasp", None, "f.hex", "e.hex")` equals the list above, and with `port="usb"` gains `-P usb` after the part.
- [ ] **Step 2:** `python3 -m unittest discover -s tools` in `firmware/tinylap-transponder`. Expected: FAIL (import).
- [ ] **Step 3:** Implement `flash.py`, standard library only.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(firmware): a tool to flash a transponder with its id`

### Task 7: Docs and CI

**Files:**
- Create: `firmware/tinylap-transponder/README.md`, `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`)
- Modify: `.github/workflows/ci.yml` (the `firmware` job)

- [ ] **Step 1: README.md**: the hardware (from the decoder README's transponder section, which then links here instead of repeating it), the frame (pointing to `firmware/lib/tinylap-ir` and the spec, not repeating the numbers), the open settings (`TL_LED_PIN`, `upload_protocol`), and flashing a transponder step by step as in spec §4.4: fuses once, `tools/flash.py flash --id …`, the clock check with the decoder's capture build (what to read in the log: the start period; the target is 2000 µs on the capture, not 8 MHz), `tools/flash.py read-cal`, `tools/flash.py osccal` and reflashing with `--osccal`. Python 3.9 or later. An id is written in hex in the app (`0C` for 12).
- [ ] **Step 2: AGENTS.md**: ask before every upload; `pio test -e native`, `pio run -e attiny45`, `python3 -m unittest discover -s tools`; the carrier loop's cycle count is checked by disassembly after any change to `carrier`; the repository's rules apply.
- [ ] **Step 3: CI.** Cache key `pio-${{ hashFiles('firmware/*/platformio.ini') }}`; after the decoder's steps add `pio test -e native` and `pio run -e attiny45` in `firmware/tinylap-transponder`, and `python3 -m unittest discover -s tools` there. Update the job's comments, which speak of the decoder only. Expected cost: about +30 s on a cold cache, +15 s warm.
- [ ] **Step 4:** Run each CI command locally; `reuse lint`. Expected: all pass, compliant.
- [ ] **Step 5: Commit** `docs(firmware): the transponder's README` and `ci: test and build the transponder firmware`

### Task 8: On the bench (owner, with the transponders' builder)

Not run by an agent: it needs the transponder flashed, which happens on the builder's programmer. Spec §7, with the decoder's capture build:

1. Fixed under the gantry at car height, 60 s: at least 90% of frames whole; start period within ±1.5% of 2000 µs (else `tools/flash.py osccal` and reflash).
2. Five fast hand sweeps: at least 2 whole frames each; else shorten the gap range, keeping its minimum above 17 ms.
3. The decoder build: one passing per sweep, nothing in two quiet minutes.
4. Results into the transponder README; then decide `confirmFrames` (1 or 2).
