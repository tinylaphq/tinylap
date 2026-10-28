# TinyLap transponder firmware

The program for the transponder in each car: an ATtiny45 that sends the car's id as infrared frames, for the decoder at the finish line to read. One program serves every transponder; the id and the clock calibration go into the chip's EEPROM when it is flashed.

The design is in `docs/superpowers/specs/2026-10-28-transponder-firmware-design.md`.

## Hardware

One transponder per car:

| Part | What | Notes |
| --- | --- | --- |
| Controller | Microchip ATtiny45 (DIP-8) | Internal 8 MHz RC oscillator. The program clears the clock prescaler itself, so it runs at 8 MHz whether the CKDIV8 fuse is set or not. |
| Driver | A transistor switches the LED | Which ATtiny pin drives it is open: see "Settings that depend on the board". |
| Emitter | Vishay TSAL6200: IR LED, GaAlAs, 940 nm, 34°, 5 mm (T-1 ¾) | Half the light 17° off its axis, so the transponder's aim matters more than the distance. |
| Connector | Three wires: red is 5 V, grey is ground, blue is not connected | The car's socket has three pins. |

The board also carries an electrolytic capacitor, a diode and three resistors.

To test one on the bench, power it from any 5 V supply. An ESP32-C3 SuperMini on a power bank works as one: red to its `5V` pin, grey to `G`.

Programming needs an AVR ISP programmer on the chip's SCK, MISO, MOSI and RESET legs, which are not on the three-wire connector.

## The frame

The frame is defined in one place, `firmware/lib/tinylap-ir`, which both this program and the decoder build on. The design (§3.1 of the spec) explains the choices. The carrier is made in software, with interrupts off while a frame goes out, and the transponder waits a random gap between frames.

At power-on the program reads the id from EEPROM. If the id is above 127 or its complement does not match, it sends nothing: a transponder that is visibly dead is better than one that claims a wrong id.

An id is 0–127. The app shows it in upper-case hex, so label each transponder with its hex id: `0C` for 12.

| EEPROM address | Content |
| --- | --- |
| 0 | id |
| 1 | id XOR 0xFF |
| 2 | OSCCAL value, or 0xFF for the factory value |

## Settings that depend on the board

Set both in `platformio.ini` (env `attiny45`) to the real board and programmer **before flashing**.

| Setting | Default | What |
| --- | --- | --- |
| `TL_LED_PIN` (in `build_flags`, as `-DTL_LED_PIN=PBn`) | `PB0` | The ATtiny pin that drives the transistor. Not yet known for the boards in the cars; with the wrong pin the LED stays dark. |
| `upload_protocol` | `usbasp` | The programmer. Any avrdude programmer works, such as `avrispmkII` or `arduinoisp`. |

The same programmer goes to `tools/flash.py` as `--programmer`, with `--port` for a serial one.

## Build and test

Two PlatformIO environments, run from this directory (`firmware/tinylap-transponder/`):

| Env | What |
| --- | --- |
| `attiny45` | The transponder's image. |
| `native` | The host tests of `lib/transponder/`. No board needed. |

```sh
pio test -e native                    # host tests
pio run -e attiny45                   # build the image
python3 -m unittest discover -s tools # tests of the flash script
```

## Flashing a transponder

Python 3.9 or later. The script runs avrdude through PlatformIO, so build first with `pio run -e attiny45`. Plain `pio run -t upload` is not used: it writes no id.

1. **Fuses, once per chip.** They set the internal 8 MHz oscillator, SPI programming and brown-out detection at 2.7 V, and keep the EEPROM across uploads. Nothing locks the chip.

   ```sh
   pio run -e attiny45 -t fuses
   ```

2. **Flash the program and the id.** The script writes the flash and the whole EEPROM image in one run, so nothing is left from an earlier program. The id is decimal.

   ```sh
   python3 tools/flash.py flash --id 12
   ```

3. **Check the clock.** The chip's oscillator is within ±10% of 8 MHz at worst, which moves the carrier and every time by the same share. Point the transponder at the decoder and run the decoder's capture build (`firmware/tinylap-decoder`, env `capture`). In the log, read the start period: the target is **2000 µs on the capture**, not 8 MHz. Within ±1.5% the chip is good; stop here.

4. **If it is outside ±1.5%, calibrate.** Read the chip's factory value, then let the script compute a corrected one from it and the measured start period:

   ```sh
   python3 tools/flash.py read-cal
   python3 tools/flash.py osccal --current 150 --start-us 2080
   ```

   `--current` is the value `read-cal` printed (or the one already stored); `--start-us` is the capture's start period. The script keeps the step within the chip's own OSCCAL range and below the value where EEPROM writes become unreliable.

5. **Reflash with the new value, and check again.**

   ```sh
   python3 tools/flash.py flash --id 12 --osccal 140
   ```

   Repeat the check from step 3 until the start period is within ±1.5%.

`flash` and `read-cal` take `--programmer` (default `usbasp`) and `--port`; `flash` also takes `--hex` (default `.pio/build/attiny45/firmware.hex`).

For a programmer PlatformIO does not know, use avrdude directly, with the same EEPROM layout as above.

## Checks on the bench

With the capture build on the decoder and the transponder fixed under the gantry at car height, for 60 seconds: at least 90% of frames whole, and the start period within ±1.5% of 2000 µs.
