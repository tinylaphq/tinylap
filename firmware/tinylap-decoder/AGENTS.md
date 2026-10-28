# TinyLap decoder firmware: agent rules

The hardware, the wiring is in `README.md`; the IR frame format is in `firmware/lib/tinylap-ir`; the USB protocol is in `docs/timing.md`. The repository's rules (`/AGENTS.md`) apply here too.

## Boards and ports

- **Ask before every upload.** The owner plugs the board in and names the port.
- **Never upload to a port you were not given.** The LG monitor shows up as `/dev/cu.usbmodem111…`; it is not a decoder.
- Only one program can hold a serial port. Close `pio device monitor` before an upload; run the monitor in the background and read its output from a file.
- `pio device monitor` needs a terminal. To log in the background, read the port with pyserial from PlatformIO's Python (`/opt/homebrew/opt/platformio/libexec/bin/python`), with DTR and RTS set to false before opening it, so opening the port does not reset the board. The first line after a reset is the ROM's 115200-baud boot text, unreadable at 921600.
- A board that lights up but shows no new USB device has a charge-only cable or dock port; try a cable that works for another board. An ESP32-C3 (such as the SuperMini) shows up as `/dev/cu.usbmodem…`, USB id `303A:1001`, whatever program it runs.
- Don't deduce wiring from photos. Ask the owner.

## Tooling

- PlatformIO Core is at `/opt/homebrew/bin/pio`; the framework is Arduino.
- `arduino-cli` is installed but not on the shell's PATH.
