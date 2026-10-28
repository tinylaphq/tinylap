# TinyLap transponder firmware and frame format: design

Builds on the decoder spec, `2026-10-26-decoder-firmware-design.md`, whose §8 left a new transponder format to its own spec. Paths are relative to `firmware/` unless they start with `docs/`.

## 1. Why

A capture of the raw receiver output (`tinylap-decoder/README.md`, "The IR frame") shows that the transponders as programmed today can't be timed reliably:

- The bit is carried in a burst's length, and the short bursts are 130–220 µs, 5–8 carrier cycles. The TSOP38238 needs at least 10.
- The receiver shifts a burst's end by up to ±5 cycles (±132 µs, datasheet: `tpi − 5/f0 < tpo < tpi + 5/f0`), so the 275 µs pauses vanish and bursts merge.
- In the real setup, at car height under the gantry about 25 cm from the funnels, 0–4% of frames arrive whole. The decoder needs two whole frames per crossing.
- There is no check bit, so a misread frame can't be told from a real id.

This meets the decoder spec's §8 "misses" criterion, so the transponders get a new program.

## 2. Goals and non-goals

Goals:

1. A frame every TSOP38238 receives whole at car height under the gantry, inside the datasheet's limits with margin.
2. A check bit, so a single misread bit is rejected rather than counted as another car.
3. Two cars in view at once both get frames through: the random gap between frames is long enough for the other car's frame to fit into it (§3.2).
4. One program for every transponder; the id is set when flashing, not compiled in.
5. The decoder reads the new format, and both sides take the format from one shared definition, so they can't drift apart.

Non-goals:

- **Reading the old format.** The decoder spec's §8 said the decoder would read both. It doesn't: the decoder never decoded the real old format (its limits are the old receiving code's guess, which matches neither), there is one test transponder and no cars yet, and every transponder gets reprogrammed. Supporting a format that fails at the line is effort without a user.
- More than 128 ids, or ids unique across clubs. Still 7 bits.
- New hardware. The transponder board, the receivers and the wiring stay as they are. (Vishay recommends its TSOP383../385.. series for short bursts; swapping receivers would be an alternative fix, but it leaves the missing check bit and needs a hardware change at every gantry.)
- Power saving. The transponder runs from the car's supply.

## 3. The frame

### 3.1 Timing

Every data burst has the same length, and the bit is in the time from one burst's start to the next. The receiver keeps a burst's start steady when it distorts its end, and the decoder already measures falling edge to falling edge (decoder spec §5.1).

**The format is defined in carrier cycles** (38 kHz, one cycle 26.3 µs), because that is what the transponder counts and what the datasheet's rules are in. The µs are derived:

| Part | Burst | Pause after it | Burst start to next burst start |
| --- | --- | --- | --- |
| Start | 46 cycles (1211 µs) | 30 cycles (789 µs) | 76 cycles (2000 µs) |
| Bit 0 | 15 cycles (395 µs) | 15 cycles (395 µs) | 30 cycles (789 µs) |
| Bit 1 | 15 cycles | 30 cycles (789 µs) | 45 cycles (1184 µs) |
| Stop | 15 cycles | the gap | – |
| Gap | – | 12,000–28,000 µs, random (§3.2) | – |

- **8 bits, least significant first:** the 7-bit id (0–127), then an even-parity bit, so the 8 bits hold an even number of ones. A single wrong bit fails the check. It doesn't catch two errors, nor one shifted burst start, which swaps two neighbouring bits; the decoder's two-frame confirmation covers those.
- **Carrier:** 38 kHz, half on and half off.
- **Length:** 2.0 ms + 8 bits of 0.79–1.18 ms + the stop burst = 8.7–11.9 ms. With the gap, a frame starts every 21–40 ms: about 33 frames a second.

Against the TSOP38238's data format rules (datasheet rev. 2.1, AGC2):

| Rule | Limit | This frame |
| --- | --- | --- |
| Minimum burst | 10 cycles | 15 cycles (start: 46) |
| Gap after a burst of 10–70 cycles | at least 12 cycles | 15 cycles (after the start: 30) |
| Short bursts per second | at most 1700 | 10 per frame, at most 480 |
| Envelope duty cycle (Fig. 8) | about 0.6 at 15 cycles | at most 0.5, in a run of zeros: passes, but with little margin |
| Output pulse width | burst ± 5 cycles | the decoder doesn't use the burst's end for the bit |

The datasheet also allows a burst's start to come out 7–13 cycles after the light (`7/f0 < td < 13/f0`), so a burst start moves by up to ±3 cycles (±79 µs) between bursts, more on a weak signal. The decoder's windows (§5.2) leave room for that and for the oscillator's error after calibration.

### 3.2 Why the gap is 12–28 ms

The decoder takes a frame only when silence comes before and after it (decoder spec §5.1). With two cars in view, car B's frame decodes only if it falls whole into a gap of car A's, with silence on both sides. So **the gap must be clearly longer than a frame plus two silences**: 11.9 + 2 × 2.5 ms ≈ 17 ms. A gap of 4–8 ms gives two cars in view no frames at all. A simulation with a copy of `decodeBatch` gives, for a gap of 10–30 ms, about 7.5 frames a second for each of two cars, against about 34 for a car alone.

12–28 ms keeps a car alone at about 33 frames a second and gives two cars together several each. The right range depends on how long a car is in view at full speed, which is not measured yet. The gap's limits are build constants; §7.2 measures the view time and adjusts them.

If the values change, only the shared definition (§5.1) changes; the tests take their values from it.

## 4. The transponder program (`tinylap-transponder/`)

### 4.1 Hardware, as known and as still open

Known from the board: an ATtiny45 (DIP-8, Atmel "TINY45 20U"), a transistor switching the TSAL6200, an electrolytic capacitor, a diode, three resistors and a three-wire connector (red 5 V, grey ground, blue not connected: it is there because the car's socket has three pins).

The chips run on the internal 8 MHz oscillator, and the four receivers share one data pin. The old transponder program's source is not available, so the new program starts from scratch.

**Still open:**

1. Which ATtiny pin drives the transistor.
2. Whether CKDIV8 is set today (it doesn't matter to the program, which clears the prescaler, only to whether the fuse write changes anything).
3. The LED's current. The current at 50% carrier duty must stay inside the TSAL6200's ratings.
4. Which programmer is used (USBasp, AVRISP mkII, an Arduino as ISP …), and whether the chip is socketed or programmed on the board.
5. Whether the car's supply is regulated, or bounces with the track power.

The program takes the LED pin as a build setting (`-D TL_LED_PIN=PBn`, default PB0), so question 1 changes one line.

### 4.2 Clock and carrier

- **Clock:** the internal 8 MHz RC oscillator, with the prescaler cleared in code (`CLKPR`) at power-on, so it runs at 8 MHz whether CKDIV8 is set or not.
- **Fuses**, written once per chip for a known state: low `0xE2` (internal 8 MHz RC, CKDIV8 off), high `0xD5` (SPI programming on, EESAVE on so a firmware upload keeps the EEPROM, brown-out detection at 2.7 V so a sagging car supply can't corrupt it), extended left as it is (`0xFF` by default). None of these lock the chip: reset stays a reset pin and SPI programming stays on.
- **Carrier in software, with interrupts off while a frame goes out.** One cycle of 38 kHz is 210.5 clock cycles at 8 MHz: high for 105, low for 105, rounded to 210 (38.1 kHz). The loop's timing is fixed with `__builtin_avr_delay_cycles` around the pin writes, so it doesn't depend on the optimiser. Software works on any pin. Timer1 could make it in hardware on every pin except PB2 (with its inverted outputs), so if the pin allows it, a hardware carrier is a possible follow-up, not a need.
- **Accuracy:** the factory-calibrated RC oscillator is within ±10% at worst (datasheet), which moves the carrier and every period by the same share. The receiver's band-pass is ±5% wide at 3 dB (`Δf = f0/10`). So **every chip is checked, and calibrated if needed, when it is flashed** (§4.4). That brings it within about ±1%.

### 4.3 What it does

1. At power-on, clear the prescaler and apply OSCCAL from EEPROM if one is stored (§4.4).
2. Read the id from EEPROM address 0 and its complement from address 1. **If the id is above 127, or the complement doesn't match, it sends nothing.** A transponder that would claim a wrong id is worse than one that is visibly dead.
3. Seed a 16-bit xorshift generator from the id (`0xACE1 ^ (id × 0x9E37)`, never zero). Different ids draw different gaps; nothing is written to EEPROM at run time.
4. Loop: send a frame (§3), wait a gap drawn evenly from 12,000–28,000 µs, repeat.

### 4.4 Flashing a transponder

One `.hex` for every transponder; the id and the calibration go into EEPROM:

| EEPROM address | Content |
| --- | --- |
| 0 | id, 0–127 |
| 1 | id XOR 0xFF |
| 2 | OSCCAL value, or 0xFF for the factory value |

The steps, per transponder:

1. `pio run -e attiny45 -t fuses` (avrdude: `-U lfuse:w:0xE2:m -U hfuse:w:0xD5:m`), once per chip.
2. `tools/flash.py flash --id …`: it writes the flash and the full three-byte EEPROM image in one avrdude run, so nothing is left from an earlier program. Plain `pio run -t upload` is not used: it writes no id.
3. **Check the clock with the decoder's capture build:** the transponder's start period should be 2000 µs. The capture shows it to a microsecond; the error in percent is the clock's. Outside ±1.5%, the script computes a corrected OSCCAL (about 1% per step, read from the chip; the ATtiny45 has two overlapping OSCCAL ranges, and the step stays in the chip's own range), writes address 2, and the check is repeated. The OSCCAL value must not push the clock above 8.8 MHz, where EEPROM writes become unreliable.

The README describes this for whoever flashes the transponders, with the avrdude lines for programmers PlatformIO doesn't know.

### 4.5 Layout

```
firmware/
  lib/tinylap-ir/        shared by both projects: the frame definition (§5.1)
  tinylap-transponder/
    platformio.ini       envs attiny45 (atmelavr, framework none) and native
    src/main.cpp         clock, carrier loop, EEPROM, the loop of §4.3
    tools/               the EEPROM-image and OSCCAL script
    test/                native tests of the parts that aren't timing
    README.md, AGENTS.md, CLAUDE.md (@AGENTS.md)
```

Both `platformio.ini` files add `lib_extra_dirs = ../lib`. Plain avr-libc, not Arduino: Arduino's `millis` timer interrupt would break the carrier loop's timing, and the program needs nothing else from it.

## 5. Shared definition and the decoder

### 5.1 `lib/tinylap-ir`

One header with the format in carrier cycles (the table of §3.1) and the gap limits in µs, plus:

- `uint32_t tlCyclesToUs(uint16_t cycles)`: rounded, at the nominal 38 kHz.
- `bool tlParity(uint8_t id)`: the parity bit for an id.
- `size_t tlEncodeFrame(uint8_t id, uint16_t* levelsCycles, size_t max)`: the frame as alternating burst and pause lengths in carrier cycles, start burst first, stop burst last, which the transponder plays out and the decoder's tests turn into levels.

### 5.2 The decoder

`FrameLimits` gains `startBurstMin` and `startBurstMax`: `decodeBatch` checks every burst against one `burstMin`/`burstMax` today, and the start burst is three times as long as the others. Since `kLimits` is a positional initialiser, it and the tests that build limits change with it.

The windows, from the nominal periods, meet halfway between them, so a period is never refused for lack of a window; anything outside all of them is not a frame:

| Limit | Value (µs) | Nominal |
| --- | --- | --- |
| zero period | 590–986 | 789 |
| one period | 987–1592 | 1184 |
| start period | 1593–2400 | 2000 |
| data burst | 200–700 | 395 |
| start burst | 800–1700 | 1211 |
| frame | up to `startMax + 8 × oneMax + burstMax` = 15,836 | 8700–11,900 |
| `silenceMin` | 2000 | above the longest pause in a frame (789), below the RMT's idle split (`kIdleUs` 2500) |

Within a frame the zero/one boundary at 987 µs leaves ±25% for a zero and −17% for a one. With the clock calibrated to ±1.5% and a burst start moving by ±79 µs, that holds; an uncalibrated chip at −10% with a weak signal might not, which is why §4.4 checks every chip.

Further decoder changes:

- `decodeBatch` reads 8 bits instead of 7, so a frame has 10 bursts instead of 9, and rejects a frame whose parity fails, with a new `Reject::Parity`.
- `capture_log` names the new reason, so the capture build changes by one case; `diag` counts it in `%TLLOG stat` (`rej.parity`), and the stat key lists in `docs/timing.md` and the decoder spec §6.1 gain it.
- The overlap tests (two frames in one batch) are rerun on the new format. No overlap decodes to a third id in the new format, even without parity; the test asserts exactly that, over offsets of 0–16,000 µs (a frame is up to 11.9 ms).
- The CI cache key hashes both `platformio.ini` files.

## 6. Tests

Native, in CI with the decoder's:

- `tinylap-ir`: parity for all 128 ids; every encoded frame has 10 bursts and the cycle counts of §3.1; `tlEncodeFrame` respects `max`; `tlCyclesToUs` rounds as the table says.
- The decoder: every id round-trips through `tlEncodeFrame` → levels → `decodeBatch`; each single bit flipped is rejected with `Reject::Parity`; every burst start moved by up to ±79 µs, and every burst end by up to ±132 µs, still decodes; a clock 1.5% slow and 1.5% fast decodes; two frames 12,000 µs apart decode as two.
- The transponder: the xorshift draws stay within 12,000–28,000 µs, are never stuck at zero, and differ for different ids; an id above 127 or a wrong complement sends nothing; the EEPROM-image script writes the three bytes for a given id and OSCCAL.
- `pio run -e attiny45` builds in CI. It is a small download (avr-gcc), cached like the ESP32 toolchain.

The carrier loop's cycle count can't be host-tested; §7 measures it.

## 7. On the bench, once one is flashed

1. Capture build on the decoder, transponder fixed under the gantry at car height, 60 seconds: **at least 90% of frames whole**, the start period within ±1.5% of 2000 µs.
2. The time a car is in view: five fast hand sweeps under the gantry. The capture shows how long each sweep is seen; at least 2 whole frames per sweep. If fewer, shorten the gap's range first, keeping its minimum above 17 ms.
3. The decoder build: a passing per sweep, nothing in two quiet minutes.
4. From the sweeps, `confirmFrames`: 2 if every sweep gives at least 2 whole frames with margin, else 1, which the parity bit makes safe against single-bit errors.
5. Results into the README; the decoder spec §11 checklist items for cars stay open.

## 8. Risks

- **The open hardware questions (§4.1).** The pin is a build setting and the timings live in one header, so only a different clock or a different programming setup would mean real changes.
- **The carrier is a counted loop.** §4.2 fixes its timing with `__builtin_avr_delay_cycles`; §7.1 checks the result.
- **The view time is unknown.** A car crossing fast under a narrow funnel may be in view for only a few frame periods; §7.2 measures it before the gap is final.
- **The envelope duty is near the receiver's limit** in a run of zeros (§3.1). If reception is poor, the zero pause grows first.
- **The receivers wired in parallel smear bursts further.** The windows leave room; §7.1 shows whether it's enough.

## 9. Decisions

1. The frame of §3: bursts of 15 cycles, the bit in the time between burst starts, even parity as the 8th bit, a 2000 µs start period.
2. The gap 12–28 ms, so two cars in view both get frames through; adjusted after §7.2.
3. The decoder reads only the new format (§2, against the decoder spec's §8).
4. The id lives in EEPROM with its complement, written when flashing; a missing or broken id sends nothing.
5. Carrier in software with interrupts off, so any pin works.
6. Internal 8 MHz RC; every chip's clock checked with the capture build and calibrated through OSCCAL when it is flashed.
7. Fuses low `0xE2`, high `0xD5` (EESAVE and brown-out detection on).
8. A shared `firmware/lib/tinylap-ir` for the format, used by both projects.
