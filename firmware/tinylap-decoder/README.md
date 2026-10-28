# TinyLap decoder firmware

Firmware for a decoder you build yourself: an ESP32 with infrared receivers at the finish line, reading the transponders in the cars. Over USB it speaks ZRound plus TinyLap's four `%TL…` commands, as `docs/timing.md` describes, so the timing app's bridge can pair it and forward its passings. Wi-Fi delivery comes later.

The design is in `docs/superpowers/specs/2026-10-26-decoder-firmware-design.md`.

## Hardware

### The decoder

| Part | What | Notes |
| --- | --- | --- |
| Board | ESP32-WROOM-32E module (classic ESP32, chip ESP32-D0WD-V3, dual core, Wi-Fi) | PlatformIO board `esp32dev`, Arduino framework. The USB-to-serial chip is a Silicon Labs CP2102N, USB vendor and product id `10C4:EA60`; on a Mac it shows up as `/dev/cu.usbserial-…`. |
| Receivers | 4 × Vishay TSOP38238 | Demodulating IR receivers for a 38 kHz carrier. The output is active low: it goes low while a burst of carrier arrives. It reports that light came, not which car sent it. The datasheet's minimum burst is 10 carrier cycles, about 263 µs. |
| Mounting | A gantry over the track, about 30 cm up | The receivers look down through 3D-printed funnels, which narrow their view to a strip at the line. The transponders point up at them from the cars. |
| Wiring | All four receivers' outputs in parallel on **GPIO 4** | The pin is an input without the internal pull-up; the receivers' own output stages pull it high. Any receiver that sees a burst pulls the line low. |
| Power and data | The board's USB socket | One cable for power and the serial link to the bridge. |

### The transponders

One per car:

| Part | What |
| --- | --- |
| Controller | Microchip ATtiny45 on its internal 8 MHz oscillator, already programmed (the old program's source is lost) |
| Driver | A transistor switches the LED |
| Emitter | Vishay TSAL6200: IR LED, GaAlAs, 940 nm, 34°, 5 mm (T-1 ¾). Half the light 17° off its axis, so the transponder's aim matters more than the distance. |
| Connector | Three wires: red is 5 V, grey is ground, blue is not connected (the car's socket has three pins) |

The test transponder is powered by an ESP32-C3 SuperMini on a power bank, used only as a 5 V supply: red to its `5V` pin, grey (through a yellow jumper) to `G`.

Reprogramming the ATtiny45s is warranted (see below). It needs an AVR ISP programmer on the chip's SCK, MISO, MOSI and RESET legs, which are not on the three-wire connector.

### The IR frame

Measured with the capture build: one test transponder, 1 µs resolution on GPIO 4. Times are lengths of the receiver's output: a burst is the time it is low (carrier arriving), a pause the time it is high.

| Part | Burst (µs) | Pause after it (µs) |
| --- | --- | --- |
| Start | 820 (790–870) | 375 (320–400) |
| 7 data bursts, least significant first | short 130–220 = 0, long 380–410 = 1 | about 275 |
| Gap | – | 10–16 ms, evenly spread |

- The bit is in the burst's length, not in the time between bursts. There is no stop burst: the 7th data burst ends the frame. A frame lasts 4.6 ms, so a transponder sends about 76 frames a second.
- A long burst is 1: the test transponder reads 0011000, id 12 (`0C`).
- The id is 0–127, with no check bit.
- To ZRound and the app the id is the transponder code, in upper-case hex: car 42 is `%L2A,<hex ms>&`. Label each transponder with its hex code, since that is what the app shows.

**The frames mostly arrive broken.** The short bursts are 5–8 carrier cycles, below the receiver's minimum of 10. The receiver also stretches or shrinks bursts by up to about 100 µs depending on signal strength, so the 275 µs pauses vanish and bursts merge. The four receivers sharing one pin may smear them further.

| Position | Frames arriving whole |
| --- | --- |
| Hand-held, about 5 cm | 20–45% |
| Hand-held, about 20 cm | 19% |
| Hand-held, about 30 cm | 0% |
| Under the gantry at car height, about 25 cm | 0–4% |

With the transponder off for two minutes the receivers picked up nothing, apart from a single stray burst about every 45 minutes.

The fix is a new transponder program with longer bursts and pauses, the bit in the time between bursts and a parity bit. The design is in `docs/superpowers/specs/2026-10-28-transponder-firmware-design.md`. **Until the decoder reads the new format, `kLimits` in `lib/tinylap/frames.cpp` still describes the old receiving code's guess (start about 1350 µs, bits of 600 and 900 µs from falling edge to falling edge), which matches neither format.**

The receiving code that was on the board before this firmware printed text at 115200 baud and spoke no ZRound.

## Build and flash

Three PlatformIO environments, all run from this directory (`firmware/tinylap-decoder/`):

| Env | What |
| --- | --- |
| `esp32dev` | The decoder: ZRound and `%TL…` over USB at 19200 baud. |
| `capture` | The capture build: logs every receiver pulse at 921600 baud, to measure the transponders. |
| `native` | The host tests of `lib/tinylap/`. No board needed. |

```sh
pio test -e native                    # host tests
pio run -e esp32dev -e capture        # build both firmwares
pio run -e esp32dev -t upload --upload-port /dev/cu.usbserial-XXXX
pio device monitor -e esp32dev --port /dev/cu.usbserial-XXXX     # 19200 baud
```

For the capture build, upload with `-e capture` and open the monitor with `-e capture`, which sets 921600 baud.

Name the port every time: other devices (a monitor, a phone) show up as serial ports too. Only one program can hold the port, so close the monitor before an upload.

### Backing up and restoring a board

Before the first upload over the board's old firmware, keep a copy of the whole flash (4 MB on an ESP32-WROOM-32E):

```sh
esptool.py --port /dev/cu.usbserial-XXXX --baud 921600 read_flash 0 0x400000 backup.bin    # about 6 minutes without --baud
esptool.py --port /dev/cu.usbserial-XXXX write_flash 0 backup.bin    # to restore it
```

`esptool.py` comes with PlatformIO, in `~/.platformio/packages/tool-esptoolpy/`.

### The pairing and the token

The decoder keeps its pairing (decoder id and token) and the Wi-Fi settings in NVS, the board's flash. They are **not encrypted**: anyone holding the board can read the token with `esptool`. To unpair, pair again (a new `%TLPAIR` replaces the old pairing), or erase the flash with `pio run -e esp32dev -t erase --upload-port /dev/cu.usbserial-XXXX`, which also removes the firmware.
