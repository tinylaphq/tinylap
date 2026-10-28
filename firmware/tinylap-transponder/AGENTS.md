# TinyLap transponder firmware: agent rules

The hardware, the settings and how to flash are in `README.md`; the frame is defined in `firmware/lib/tinylap-ir`. The repository's rules (`/AGENTS.md`) apply here too.

## Programmers and chips

- **Ask before every upload, fuse write or read of a chip.** The owner connects the programmer and names it. That covers `pio run -t upload`, `-t fuses` and every `tools/flash.py` subcommand except `osccal`, which only computes.
- Never upload to a transponder you were not told about. Fuses and EEPROM are written to the chip on the programmer.
- `TL_LED_PIN` and `upload_protocol` depend on the board and programmer. Don't guess them; ask the owner.
- Don't deduce wiring from photos. Ask the owner.

## Checks

Run from this directory, as three separate commands:

- `pio test -e native`
- `pio run -e attiny45`
- `python3 -m unittest discover -s tools`

## The carrier loop

After any change to `carrier` in `src/main.cpp`, to the main loop that calls it (it holds 17 of the 26 overhead clocks), or to the toolchain or platform version, check the loop's cycle count by disassembly (`avr-objdump -d` on `.pio/build/attiny45/firmware.elf`): every carrier cycle must stay at the clock count the comments in the file state. The native tests cannot see it.

## Tooling

- PlatformIO Core (`pio`) builds and tests it. The program is plain avr-libc, not Arduino: Arduino's timer interrupt would break the carrier loop's timing.
- The transponder library and `tinylap-ir` compile for AVR: no STL containers, no exceptions, no heap.
