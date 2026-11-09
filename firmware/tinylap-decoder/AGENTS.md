# TinyLap decoder firmware: agent rules

The hardware and the wiring are in `README.md`; the IR frame format is in `firmware/lib/tinylap-ir`; the USB protocol is in `docs/timing.md`. The repository's rules (`/AGENTS.md`) apply here too.

## Boards and ports

- **Ask before every upload.** The owner plugs the board in and names the port.
- **Never upload to a port you were not given.** The LG monitor shows up as `/dev/cu.usbmodem111…`; it is not a decoder.
- Only one program can hold a serial port. Close `pio device monitor` before an upload; run the monitor in the background and read its output from a file.
- `pio device monitor` needs a terminal. To log in the background, read the port with pyserial from PlatformIO's Python (`/opt/homebrew/opt/platformio/libexec/bin/python`) and leave DTR and RTS as opening the port sets them: `serial.Serial(port, 19200, timeout=0.2)`. Opening asserts both together, which the board's auto-reset circuit ignores. Setting either one, for example `dtr = False` before `open()`, changes them apart and resets the board, as an upload does. The first line after a reset is the ROM's 115200-baud boot text, unreadable at 19200 or 921600.
- To try the bridge with the board, run `pnpm --filter @tinylap/timing-app bench` from the repository root: a local timing server and a Chrome window signed in on the Bridge page. The owner clicks Connect and picks the port; the server's log, `decoder-log` lines included, goes to stdout.
- A board that lights up but shows no new USB device has a charge-only cable or dock port; try a cable that works for another board. An ESP32-C3 (such as the SuperMini) shows up as `/dev/cu.usbmodem…`, USB id `303A:1001`, whatever program it runs.
- Don't deduce wiring from photos. Ask the owner.

## Tooling

- PlatformIO Core is at `/opt/homebrew/bin/pio`; the framework is Arduino.
- `arduino-cli` is installed but not on the shell's PATH.
