# TinyLap decoder firmware

Firmware for a decoder you build yourself: an ESP32 with infrared receivers at the finish line, reading the transponders in the cars. Over USB it speaks ZRound plus TinyLap's four `%TL…` commands, as `docs/timing.md` describes, so the timing app's bridge can pair it and forward its passings. Wi-Fi delivery comes later.

Status: no firmware yet. The spec and plan come first (`docs/superpowers/specs/`, `docs/superpowers/plans/`).

## Hardware

### The decoder

| Part | What | Notes |
| --- | --- | --- |
| Board | ESP32-WROOM-32E module (classic ESP32, dual core, Wi-Fi) | PlatformIO board `esp32dev`, Arduino framework. The USB-to-serial chip on the board is not yet known (CP2102 or CH340 are common); it decides the USB vendor and product id the bridge sees. |
| Receivers | 4 × Vishay TSOP38238 | Demodulating IR receivers for a 38 kHz carrier. The output is active low: it goes low while a burst of carrier arrives. It reports that light came, not which car sent it. |
| Wiring | All four receivers' outputs in parallel on **GPIO 4** | The pin is an input without the internal pull-up; the receivers' own output stages pull it high. Any receiver that sees a burst pulls the line low. |
| Power and data | The board's USB socket | One cable for power and the serial link to the bridge. |

### The transponders

One per car:

| Part | What |
| --- | --- |
| Controller | Microchip ATtiny45, already programmed |
| Emitter | Vishay TSAL6200: IR LED, GaAlAs, 940 nm, 34°, 5 mm (T-1 ¾) |

Reprogramming the ATtiny45s is possible, if the measurements on the track show it is warranted. It needs an AVR ISP programmer, or the ESP32 acting as one.

### The IR frame

Read from the receiving code that runs on the decoder today; **to be confirmed** against the transponder code and by a capture of the raw pulses on GPIO 4.

Times are measured from one falling edge of the receiver's output to the next, that is, from the start of one carrier burst to the start of the next:

| Part | Time | Meaning |
| --- | --- | --- |
| Gap | more than 2.5 ms of silence (4–7 ms in practice) | A frame starts with the next burst. |
| Start | about 1350 µs (900 µs burst, 450 µs pause) | Accepted between 1100 and 1700 µs. |
| 7 data bits, least significant first | about 900 µs for 1, about 600 µs for 0 | 1 between 750 and 1100 µs, 0 between 420 and 750 µs. How each splits into burst and pause is not yet known. |
| Stop | one more burst | Its falling edge ends the last bit. |

- A frame takes about 7 ms and, with its gap, repeats every 11–14 ms, so a car sends 70–90 frames a second and two or more while it crosses the line.
- The id is 0–127. There is no checksum: the receiving code counts a car only after two frames with the same id within 150 ms, so one garbled frame can't make a ghost car.
- The receiving code ignores a car for 2 s after it passed (the minimum lap time; its comment says 3 s for real races).
- To ZRound and the app the id is the transponder code, in upper-case hex: car 42 is `%L2A,<hex ms>&`. Label each transponder with its hex code, since that is what the app shows.

The receiving code on the board today prints text at 115200 baud and speaks no ZRound. This firmware replaces it.
