# TinyLap decoder firmware

Firmware for a decoder you build yourself: an ESP32 with infrared receivers at the finish line, reading the transponders in the cars. Over USB it speaks ZRound plus TinyLap's `%TL…` commands, as `docs/timing.md` describes, so the timing app's bridge can pair it and forward its passings. Wi-Fi delivery comes later.

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
| Reset | No button reachable | Only an upload (through RTS) or a power cycle restarts it. Opening the port in Chrome does not. |

### The transponders

One per car, an ATtiny45 with an IR LED. Its hardware, settings and flashing are in `../tinylap-transponder/README.md`.

### The IR frame

The frame is defined once, in `firmware/lib/tinylap-ir`, for this decoder and the transponder program; the transponder design (`docs/superpowers/specs/2026-10-28-transponder-firmware-design.md`, §3) explains it. In short: equal 15-cycle bursts, the bit in the time from one burst's start to the next, 7 id bits least significant first, an even-parity bit and a stop burst, then a random gap of 12–28 ms.

- The decoder reads only this format. A frame whose parity fails is dropped and counted as `rej.parity`; `kLimits` in `lib/tinylap/frames.cpp` holds the timing windows.
- Transponders still running the original program (bit in the burst's length, no parity) are not read at all. Their capture is in the transponder design, §1.1.
- The id is 0–127. To ZRound and the app it is the transponder code, in upper-case hex: car 42 is `%L2A,<hex ms>&`. Label each transponder with its hex code, since that is what the app shows.
- With no transponder in view the receivers pick up almost nothing: a stray burst about every 45 minutes.

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

After an upload, the first `%TLLOG boot` line says `reason=poweron`: the ESP32 reports a reset through its EN pin, which the upload uses, as a power-on.

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
