from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOMINAL_US = 2000


def record(addr: int, kind: int, data: list[int]) -> str:
    body = [len(data), addr >> 8, addr & 0xFF, kind] + data
    return ":" + "".join(f"{b:02X}" for b in body + [-sum(body) & 0xFF])


def eeprom_hex(id: int, osccal: int | None) -> str:
    if not 0 <= id <= 127:
        raise ValueError("id must be 0 to 127")
    if osccal is not None and not 0 <= osccal <= 255:
        raise ValueError("osccal must be 0 to 255")
    data = [id, id ^ 0xFF, 0xFF if osccal is None else osccal]
    return record(0, 0, data) + "\n" + record(0, 1, []) + "\n"


def osccal_correction(current: int, measured_start_us: float) -> int:
    off = (measured_start_us - NOMINAL_US) / NOMINAL_US
    if abs(off) > 0.15:
        raise ValueError(f"{measured_start_us} us is more than 15% off {NOMINAL_US} us")
    # One OSCCAL step is about 1% of the clock; the ranges 0-127 and 128-255 are separate.
    lo, hi = (0, 127) if current < 128 else (128, 255)
    return max(lo, min(hi, current + round(off * 100)))


def avrdude_args(conf: str, programmer: str, port: str | None, flash_hex: str, eeprom_hex_path: str) -> list[str]:
    args = ["-C", conf, "-c", programmer, "-p", "t45"]
    if port:
        args += ["-P", port]
    return args + ["-U", f"flash:w:{flash_hex}:i", "-U", f"eeprom:w:{eeprom_hex_path}:i"]


def conf_path(env: dict[str, str] | os._Environ = os.environ, check: bool = True) -> str:
    core = env.get("PLATFORMIO_CORE_DIR") or os.path.expanduser("~/.platformio")
    conf = os.path.join(core, "packages", "tool-avrdude", "avrdude.conf")
    if check and not os.path.isfile(conf):
        sys.exit(f"{conf} is missing; run `pio run -e attiny45 -t fuses` once, which installs avrdude")
    return conf


def run_avrdude(args: list[str]) -> int:
    cmd = ["pio", "pkg", "exec", "-p", "tool-avrdude", "--", "avrdude"] + args
    return subprocess.call(cmd, cwd=PROJECT)


def flash(a: argparse.Namespace) -> int:
    try:
        image = eeprom_hex(a.id, a.osccal)
    except ValueError as e:
        sys.exit(str(e))
    conf = conf_path()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "eeprom.hex")
        with open(path, "w") as f:
            f.write(image)
        return run_avrdude(avrdude_args(conf, a.programmer, a.port, a.hex, path))


def read_cal(a: argparse.Namespace) -> int:
    args = ["-C", conf_path(), "-c", a.programmer, "-p", "t45"]
    if a.port:
        args += ["-P", a.port]
    return run_avrdude(args + ["-U", "calibration:r:-:h"])


def osccal(a: argparse.Namespace) -> int:
    try:
        print(osccal_correction(a.current, a.start_us))
    except ValueError as e:
        sys.exit(str(e))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Flash a TinyLap transponder with its id.")
    sub = p.add_subparsers(dest="cmd", required=True)

    def link(s: argparse.ArgumentParser) -> None:
        s.add_argument("--programmer", default="usbasp")
        s.add_argument("--port")

    s = sub.add_parser("flash", help="write the program, the id and optionally OSCCAL")
    s.add_argument("--id", type=int, required=True)
    s.add_argument("--osccal", type=int)
    s.add_argument("--hex", default=".pio/build/attiny45/firmware.hex")
    link(s)
    s.set_defaults(run=flash)

    s = sub.add_parser("read-cal", help="read the factory calibration byte")
    link(s)
    s.set_defaults(run=read_cal)

    s = sub.add_parser("osccal", help="print the corrected OSCCAL")
    s.add_argument("--current", type=int, required=True)
    s.add_argument("--start-us", type=float, required=True)
    s.set_defaults(run=osccal)

    a = p.parse_args(argv)
    return a.run(a)


if __name__ == "__main__":
    sys.exit(main())
