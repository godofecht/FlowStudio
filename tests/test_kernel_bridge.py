#!/usr/bin/env python3
"""Compile and exercise the actual native bridge with Python 3 subprocesses."""
import ctypes
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class KernelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tempdir = tempfile.TemporaryDirectory(prefix="flowstudio-kernel-")
        cls.library = pathlib.Path(cls.tempdir.name) / "libkernel.so"
        subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-fPIC", "-shared",
                        str(ROOT / "src/kernel_bridge.c"), "-o", str(cls.library)], check=True)
        cls.lib = ctypes.CDLL(str(cls.library))
        cls.lib.fs_kernel_start.argtypes = [ctypes.c_char_p]
        cls.lib.fs_kernel_start.restype = ctypes.c_int
        cls.lib.fs_kernel_eval.argtypes = [ctypes.c_int, ctypes.c_char_p]
        cls.lib.fs_kernel_eval.restype = ctypes.c_char_p
        cls.lib.fs_kernel_inspect.argtypes = [ctypes.c_int]
        cls.lib.fs_kernel_inspect.restype = ctypes.c_char_p
        cls.lib.fs_kernel_reset.argtypes = [ctypes.c_int]
        cls.lib.fs_kernel_reset.restype = ctypes.c_int
        cls.lib.fs_kernel_close.argtypes = [ctypes.c_int]
        cls.lib.fs_kernel_ok.restype = ctypes.c_int
        assert cls.lib.fs_kernel_start(b"python") == 1

    @classmethod
    def tearDownClass(cls):
        cls.lib.fs_kernel_close(1)
        cls.tempdir.cleanup()

    def setUp(self):
        self.assertEqual(self.lib.fs_kernel_reset(1), 1)

    def eval(self, source):
        return self.lib.fs_kernel_eval(1, source.encode()).decode()

    def test_persists_state(self):
        self.assertEqual(self.eval("counter = 41"), "")
        self.assertEqual(self.lib.fs_kernel_ok(), 1)
        self.assertEqual(self.eval("counter += 1\nprint(counter)"), "42\n")
        self.assertEqual(self.lib.fs_kernel_ok(), 1)

    def test_inspector(self):
        self.eval("greeting = 'café'")
        payload = json.loads(self.lib.fs_kernel_inspect(1))
        self.assertEqual(self.lib.fs_kernel_ok(), 1)
        self.assertIn({"name": "greeting", "type": "str", "preview": "'café'"}, payload["variables"])

    def test_syntax_error_does_not_destroy_session(self):
        self.eval("x = 7")
        result = self.eval("def broken(:\n    pass")
        self.assertEqual(self.lib.fs_kernel_ok(), 0)
        self.assertIn("SyntaxError", result)
        self.assertEqual(self.eval("print(x)"), "7\n")
        self.assertEqual(self.lib.fs_kernel_ok(), 1)

    def test_stderr_captured(self):
        self.assertEqual(self.eval("import sys\nprint('oops', file=sys.stderr)"), "oops\n")

    def test_unicode_roundtrip(self):
        self.assertEqual(self.eval("print('γειά, 世界, café')"), "γειά, 世界, café\n")
        self.assertEqual(self.lib.fs_kernel_ok(), 1)

    def test_system_exit_is_captured(self):
        result = self.eval("raise SystemExit(3)")
        self.assertIn("SystemExit", result)
        self.assertEqual(self.lib.fs_kernel_ok(), 0)
        self.assertEqual(self.eval("print('alive')"), "alive\n")

    def test_output_nul_is_rejected(self):
        result = self.eval("print(chr(0))")
        self.assertIn("NUL", result)
        self.assertEqual(self.lib.fs_kernel_ok(), 0)
        self.assertEqual(self.eval("print('ok')"), "ok\n")

    def test_reset_clears_state(self):
        self.eval("value = 99")
        self.assertEqual(self.lib.fs_kernel_reset(1), 1)
        result = self.eval("print(value)")
        self.assertIn("NameError", result)
        self.assertEqual(self.lib.fs_kernel_ok(), 0)

    def test_timeout_terminates_kernel(self):
        result = self.eval("while True: pass")
        self.assertIn("timed out", result)
        self.assertEqual(self.lib.fs_kernel_ok(), 0)
        self.assertIn("Invalid interpreter session", self.eval("print('no')"))
        self.assertEqual(self.lib.fs_kernel_reset(1), 1)
        self.assertEqual(self.eval("print('recovered')"), "recovered\n")

    def test_reject_oversized_source_without_closing(self):
        result = self.lib.fs_kernel_eval(1, b"x" * 65537).decode()
        self.assertIn("64 KiB", result)
        self.assertEqual(self.eval("print('ok')"), "ok\n")

    def test_unsupported_interpreter(self):
        self.assertEqual(self.lib.fs_kernel_start(b"shell"), -1)
        self.assertEqual(self.lib.fs_kernel_ok(), 0)
        self.assertEqual(self.eval("print('still alive')"), "still alive\n")

    def test_large_output_is_bounded(self):
        result = self.eval("print('a' * 1100000)")
        self.assertIn("Output exceeded", result)
        self.assertEqual(self.lib.fs_kernel_ok(), 0)
        self.assertEqual(self.eval("print('ok')"), "ok\n")

    @unittest.skipUnless(shutil.which("R"), "R executable unavailable")
    def test_r_persistence(self):
        self.assertEqual(self.lib.fs_kernel_start(b"r"), 2)
        try:
            output = self.lib.fs_kernel_eval(2, b"x <- 12; cat(x + 1, '\\n')").decode()
            self.assertEqual(self.lib.fs_kernel_ok(), 1, output)
            self.assertIn("13", output)
        finally:
            self.lib.fs_kernel_close(2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
