from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from flash import (
    avrdude_args,
    conf_path,
    eeprom_hex,
    link_args,
    main,
    osccal_correction,
)


class EepromHex(unittest.TestCase):
    def test_id_12(self):
        self.assertEqual(eeprom_hex(12, None), ":030000000CF3FFFF\n:00000001FF\n")

    def test_id_12_with_osccal(self):
        self.assertEqual(eeprom_hex(12, 0x5A), ":030000000CF35AA4\n:00000001FF\n")

    def test_id_out_of_range(self):
        for bad in (-1, 128):
            with self.assertRaises(ValueError):
                eeprom_hex(bad, None)

    def test_osccal_out_of_range(self):
        for bad in (-1, 256):
            with self.assertRaises(ValueError):
                eeprom_hex(12, bad)


class OsccalCorrection(unittest.TestCase):
    def test_on_target(self):
        self.assertEqual(osccal_correction(100, 2000), 100)

    def test_slow_clock_steps_up(self):
        self.assertEqual(osccal_correction(100, 2040), 102)

    def test_fast_clock_steps_down(self):
        self.assertEqual(osccal_correction(100, 1960), 98)

    def test_clamped_to_lower_half(self):
        self.assertEqual(osccal_correction(120, 2290), 127)
        self.assertEqual(osccal_correction(3, 1700), 0)

    def test_clamped_to_upper_half(self):
        self.assertEqual(osccal_correction(130, 1700), 128)
        self.assertEqual(osccal_correction(250, 2290), 255)

    def test_too_far_off(self):
        for bad in (1500, 2400):
            with self.assertRaises(ValueError):
                osccal_correction(200, bad)


class AvrdudeArgs(unittest.TestCase):
    def test_without_port(self):
        self.assertEqual(
            avrdude_args("a.conf", "usbasp", None, "f.hex", "e.hex"),
            ["-C", "a.conf", "-c", "usbasp", "-p", "t45",
             "-U", "flash:w:f.hex:i", "-U", "eeprom:w:e.hex:i"],
        )

    def test_with_port(self):
        args = avrdude_args("a.conf", "usbasp", "usb", "f.hex", "e.hex")
        self.assertEqual(args[6:8], ["-P", "usb"])
        self.assertEqual(args[8:], ["-U", "flash:w:f.hex:i", "-U", "eeprom:w:e.hex:i"])

    def test_with_baud(self):
        self.assertEqual(
            avrdude_args("a.conf", "stk500v1", "/dev/ttyUSB0", "f.hex", "e.hex", 57600),
            ["-C", "a.conf", "-c", "stk500v1", "-p", "t45", "-P", "/dev/ttyUSB0", "-b", "57600",
             "-U", "flash:w:f.hex:i", "-U", "eeprom:w:e.hex:i"],
        )


class LinkArgs(unittest.TestCase):
    def test_no_baud_by_default(self):
        self.assertNotIn("-b", link_args("a.conf", "usbasp", None))

    def test_avrisp_defaults_to_19200(self):
        self.assertEqual(
            link_args("a.conf", "avrisp", "/dev/ttyACM0"),
            ["-C", "a.conf", "-c", "avrisp", "-p", "t45", "-P", "/dev/ttyACM0", "-b", "19200"],
        )

    def test_baud_overrides_default(self):
        self.assertEqual(
            link_args("a.conf", "avrisp", "/dev/ttyACM0", 9600),
            ["-C", "a.conf", "-c", "avrisp", "-p", "t45", "-P", "/dev/ttyACM0", "-b", "9600"],
        )


class ConfPath(unittest.TestCase):
    def test_env_override(self):
        with tempfile.TemporaryDirectory() as core:
            conf = os.path.join(core, "packages", "tool-avrdude", "avrdude.conf")
            os.makedirs(os.path.dirname(conf))
            open(conf, "w").close()
            self.assertEqual(conf_path({"PLATFORMIO_CORE_DIR": core}), conf)

    def test_default_is_home(self):
        home = os.path.expanduser("~/.platformio")
        self.assertTrue(conf_path({}, check=False).startswith(home))

    def test_missing_points_to_fuses(self):
        with tempfile.TemporaryDirectory() as core:
            with self.assertRaises(SystemExit) as e:
                conf_path({"PLATFORMIO_CORE_DIR": core})
            self.assertIn("-t fuses", str(e.exception))


class Parsing(unittest.TestCase):
    def test_osccal_subcommand_prints(self):
        import contextlib
        import io

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            main(["osccal", "--current", "100", "--start-us", "2040"])
        self.assertEqual(out.getvalue(), "102\n")

    def test_baud_reaches_avrdude(self):
        with mock.patch("flash.conf_path", return_value="a.conf"), mock.patch("flash.run_avrdude", return_value=0) as run:
            main(["flash", "--id", "12", "--programmer", "avrisp", "--port", "/dev/ttyACM0", "--baud", "9600"])
            main(["read-cal", "--programmer", "avrisp", "--port", "/dev/ttyACM0"])
        flash_args, cal_args = (c.args[0] for c in run.call_args_list)
        link = ["-C", "a.conf", "-c", "avrisp", "-p", "t45", "-P", "/dev/ttyACM0"]
        self.assertEqual(flash_args[:10], link + ["-b", "9600"])
        self.assertEqual(cal_args, link + ["-b", "19200", "-U", "calibration:r:-:h"])

    def test_baud_must_be_positive(self):
        import contextlib
        import io

        for bad in ("0", "-5", "fast"):
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                main(["read-cal", "--programmer", "avrisp", "--baud", bad])

    def test_flash_rejects_bad_id_before_running(self):
        with self.assertRaises(SystemExit):
            main(["flash", "--id", "200"])


if __name__ == "__main__":
    unittest.main()
