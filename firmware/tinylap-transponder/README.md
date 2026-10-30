# TinyLap transponder firmware

The program for the transponder in each car: an ATtiny45 that sends the car's id as infrared frames, for the decoder at the finish line to read. One program serves every transponder; the id and the clock calibration go into the chip's EEPROM when it is flashed.

The design is in `docs/superpowers/specs/2026-10-28-transponder-firmware-design.md`.

## Hardware

One transponder per car:

| Part | What | Notes |
| --- | --- | --- |
| Controller | Microchip ATtiny45 (DIP-8) | Internal 8 MHz RC oscillator. The program clears the clock prescaler itself, so it runs at 8 MHz whether the CKDIV8 fuse is set or not. |
| Driver | BS170 N-channel MOSFET switches the LED | Its gate is on leg 5 (PB0) through R2, 100 Ω. A high pin turns the LED on. |
| Emitter | Vishay TSAL6200: IR LED, GaAlAs, 940 nm, 34°, 5 mm (T-1 ¾) | Half the light 17° off its axis, so the transponder's aim matters more than the distance. |
| Connector | Three wires: red is 5 V, grey is ground, blue is not connected | The car's socket has three pins. |

The board also carries an electrolytic capacitor, a diode and two more resistors. The wiring is from the board's KiCad schematic, `miniZSender.kicad_sch`.

To test one on the bench, power it from any 5 V supply. An ESP32-C3 SuperMini on a power bank works as one: red to its `5V` pin, grey to `G`.

Programming needs an AVR ISP programmer on the chip's SCK, MISO, MOSI and RESET legs, which are not on the three-wire connector.

## The frame

The frame is defined in one place, `firmware/lib/tinylap-ir`, which both this program and the decoder build on. The design (§3.1 of the spec) explains the choices. The carrier is made in software, with interrupts off while a frame goes out, and the transponder waits a random gap between frames.

At power-on the program reads the id from EEPROM. If the id is above 127 or its complement does not match, it sends no frames: a transponder that the decoder never sees is better than one that claims a wrong id. It blinks instead, as a sign that it runs but has no id (see "Checks on the bench").

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
| `TL_LED_PIN` (in `build_flags`, as `-DTL_LED_PIN=PBn`) | `PB0` | The ATtiny pin that drives the transistor. PB0 is right for the boards in the cars (see "Hardware"). For another board, set the pin its driver is on; with the wrong pin the LED stays dark. |
| `upload_protocol` | `usbasp` | The programmer, for `-t fuses`. Any avrdude programmer works, such as `avrispmkII`, `arduino_as_isp` (ArduinoISP) or `linuxspi`; add `upload_port` for one that needs a port. |

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

Python 3.9 or later. The script runs avrdude through PlatformIO, so build first with `pio run -e attiny45`.

**Only `tools/flash.py flash` (or avrdude with the EEPROM line below) writes the id.** `pio run -t upload`, and avrdude with only `-U flash:w:…`, write the program and leave the EEPROM as it was, so a new chip has no id. A transponder without a valid id sends no frames; it blinks instead (see "Checks on the bench").

1. **Fuses, once per chip.** They set the internal 8 MHz oscillator, SPI programming and brown-out detection at 2.7 V, and keep the EEPROM across uploads. Nothing locks the chip.

   ```sh
   pio run -e attiny45 -t fuses
   ```

2. **Flash the program and the id.** The script writes the flash and the whole EEPROM image in one run, so nothing is left from an earlier program. The id is decimal.

   ```sh
   python3 tools/flash.py flash --id 12
   ```

3. **Check the clock.** The chip's oscillator is within ±10% of 8 MHz at worst, which moves the carrier and every time by the same share. Point the transponder at the decoder and run the decoder's capture build (`firmware/tinylap-decoder`, env `capture`). Save the log to a file. The capture build prints no start period; an `F` line holds the frame's raw levels, such as `F t=… n=19 L1211 H789 …`, and the start period is the first `L` plus the first `H`. One frame is too noisy to read it from (the receiver moves each burst start by up to ±79 µs, more than the ±30 µs tolerance), so average it over 20 or more decoded `F` lines, those with an id (not `id=?`). This prints the average and the count:

   ```sh
   awk '/^F / && /id=[0-9]/ && $4 ~ /^L/ && $5 ~ /^H/ { s += substr($4, 2) + substr($5, 2); n++ } END { if (n) printf "start period %.0f us over %d frames\n", s / n, n }' capture.log
   ```

   The target is **2000 µs on the capture**, not 8 MHz. Within ±1.5% (1970–2030 µs) the chip is good; stop here.

4. **If it is outside ±1.5%, calibrate.** Read the chip's factory value, then let the script compute a corrected one from it and the measured start period:

   ```sh
   python3 tools/flash.py read-cal
   python3 tools/flash.py osccal --current 150 --start-us 2080
   ```

   `--current` is the value `read-cal` printed (or the one already stored); `--start-us` is the averaged start period. The script moves OSCCAL by one step per about 1% of error, stays within the chip's half of the range, and refuses a reading more than 15% off. Aiming at a 2000 µs start period keeps the clock at about 8 MHz, below the 8.8 MHz limit for EEPROM writes.

5. **Reflash with the new value, and check again.**

   ```sh
   python3 tools/flash.py flash --id 12 --osccal 154
   ```

   Repeat the check from step 3 until the start period is within ±1.5%.

`flash` and `read-cal` take `--programmer` (default `usbasp`) and `--port`; `flash` also takes `--hex` (default `.pio/build/attiny45/firmware.hex`).

`--programmer` takes any avrdude programmer name, passed on as `-c`, and `--port` is passed on as `-P`. For example:

| Programmer | Options |
| --- | --- |
| USBasp | none (the default) |
| ArduinoISP on an Arduino | `--programmer arduino_as_isp --port /dev/ttyACM0` (the Arduino's serial port). This entry talks at the sketch's 19200 baud; plain `arduino` defaults to 115200, and the script has no option for the baud rate. |
| A Raspberry Pi's SPI pins | `--programmer linuxspi --port /dev/spidev0.0` |
| A Raspberry Pi's GPIO pins, bit-banged | `--programmer linuxgpio`, with the pins set in a `linuxgpio` entry of the avrdude config |

The script runs PlatformIO's avrdude with PlatformIO's `avrdude.conf` (`~/.platformio/packages/tool-avrdude/`), so a `linuxgpio` entry with your pins goes in that file. `linuxspi` and `linuxgpio` work only on Linux.

For the fuses in step 1 with another programmer, set `upload_protocol` (and `upload_port`) in `platformio.ini` to the same values, or write them with avrdude as below.

To flash without PlatformIO, use avrdude directly, with `-C` (config file), `-c` (programmer), `-P` (port, when the programmer needs one) and `-p t45`. The examples use a USBasp; put your programmer in `-c`. The fuses first, once per chip:

```sh
avrdude -C avrdude.conf -c usbasp -p t45 -U lfuse:w:0xE2:m -U hfuse:w:0xD5:m
```

Then the flash and the EEPROM, with the EEPROM given inline as the three bytes of the layout above: the id, the id XOR 0xFF, and the OSCCAL value or 0xFF. For id 12 without calibration, `0x0C,0xF3,0xFF`:

```sh
avrdude -C avrdude.conf -c usbasp -p t45 -U flash:w:.pio/build/attiny45/firmware.hex:i -U eeprom:w:0x0C,0xF3,0xFF:m
```

## Checks on the bench

**Is it running, and does it have an id?** The IR LED is invisible to the eye; look at it through a phone camera (the front camera, if the main one filters infrared).

| What the camera shows | What it means |
| --- | --- |
| A steady faint glow or flicker | Frames go out: it runs and has a valid id. |
| Three short flashes about every 2 seconds | It runs but has no valid id: EEPROM is blank or wrong, for example after `pio run -t upload`. Flash it with `tools/flash.py flash --id …`. |
| Nothing | No power, no program, wrong fuses, or a fault on the LED's side of the board. |

The flashes are the LED plainly on for 50 ms each, without the 38 kHz carrier, so the decoder's receivers ignore them and no passing is counted. Between them the chip sleeps, woken by its watchdog.

With the capture build on the decoder and the transponder fixed under the gantry at car height, for 60 seconds: at least 90% of frames whole, and the start period within ±1.5% of 2000 µs.
