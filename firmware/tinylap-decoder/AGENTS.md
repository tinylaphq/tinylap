# TinyLap decoder firmware: agent rules

The hardware, the wiring and the IR frame format are in `README.md`; the USB protocol is in `docs/timing.md`. The repository's rules (`/AGENTS.md`) apply here too.

## Boards and ports

- **Ask before every upload.** The owner plugs the board in and names the port.
- **Never upload to a port you were not given.** The LG monitor shows up as `/dev/cu.usbmodem111…`; it is not a decoder.
- Only one program can hold a serial port. Close `pio device monitor` before an upload; run the monitor in the background and read its output from a file.

## Tooling

- PlatformIO Core is at `/opt/homebrew/bin/pio`; the framework is Arduino.
- `arduino-cli` is installed but not on the shell's PATH.
