#!/usr/bin/env python3
"""Native kernel status regression using the real C bridge and Python worker."""
import ctypes
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class KernelStatusTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="flowstudio-status-")
        library = Path(cls.tmp.name) / "kernel.so"
        subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
                        "-O2", "-fPIC", "-shared", str(ROOT / "src/kernel_bridge.c"),
                        "-o", str(library)], cwd=ROOT, check=True)
        cls.lib = ctypes.CDLL(str(library))
        cls.lib.fs_kernel_start.argtypes = [ctypes.c_char_p]
        cls.lib.fs_kernel_start.restype = ctypes.c_int
        cls.lib.fs_kernel_eval.argtypes = [ctypes.c_int, ctypes.c_char_p]
        cls.lib.fs_kernel_eval.restype = ctypes.c_char_p
        cls.lib.fs_kernel_close.argtypes = [ctypes.c_int]
        cls.lib.fs_kernel_reset.argtypes = [ctypes.c_int]
        cls.lib.fs_kernel_reset.restype = ctypes.c_int
        cls.lib.fs_kernel_status.restype = ctypes.c_int
        if cls.lib.fs_kernel_start(b"python") != 1:
            raise RuntimeError("Python kernel unavailable")

    @classmethod
    def tearDownClass(cls):
        cls.lib.fs_kernel_close(1)
        cls.tmp.cleanup()

    def setUp(self):
        self.assertEqual(self.lib.fs_kernel_reset(1), 1)

    def evaluate(self, code):
        return self.lib.fs_kernel_eval(1, code.encode()).decode()

    def test_exception_preserves_state(self):
        self.assertEqual(self.evaluate("x = 41\nprint(x + 1)"), "42\n")
        self.assertEqual(self.lib.fs_kernel_status(), 200)
        self.assertIn("ValueError", self.evaluate("raise ValueError('expected')"))
        self.assertEqual(self.lib.fs_kernel_status(), 422)
        self.assertEqual(self.evaluate("print(x)"), "41\n")
        self.assertEqual(self.lib.fs_kernel_status(), 200)

    def test_oversize_preserves_session(self):
        self.assertIn("64 KiB", self.evaluate("x" * 65537))
        self.assertEqual(self.lib.fs_kernel_status(), 413)
        self.assertEqual(self.evaluate("print('alive')"), "alive\n")
        self.assertEqual(self.lib.fs_kernel_status(), 200)

    def test_timeout_and_recovery(self):
        self.assertIn("timed out", self.evaluate("while True: pass"))
        self.assertEqual(self.lib.fs_kernel_status(), 504)
        self.assertIn("Invalid interpreter session", self.evaluate("print('gone')"))
        self.assertEqual(self.lib.fs_kernel_status(), 503)
        self.assertEqual(self.lib.fs_kernel_reset(1), 1)
        self.assertEqual(self.evaluate("print('recovered')"), "recovered\n")
        self.assertEqual(self.lib.fs_kernel_status(), 200)

    @unittest.skipUnless(shutil.which("R"), "R executable unavailable")
    def test_r_error_recovery(self):
        self.assertEqual(self.lib.fs_kernel_start(b"r"), 2)
        try:
            output = self.lib.fs_kernel_eval(2, b"stop('expected-r-error')").decode()
            self.assertIn("expected-r-error", output)
            self.assertEqual(self.lib.fs_kernel_status(), 422)
            output = self.lib.fs_kernel_eval(2, b"x <- 12; cat(x + 1, '\\n')").decode()
            self.assertIn("13", output)
            self.assertEqual(self.lib.fs_kernel_status(), 200)
        finally:
            self.lib.fs_kernel_close(2)


class FlowWiringTest(unittest.TestCase):
    def test_native_status_propagated_to_flow(self):
        session = (ROOT / "src/kernel_session.flow").read_text()
        main = (ROOT / "src/main.flow").read_text()
        self.assertEqual(session.count("status: fs_kernel_status()"), 2)
        self.assertIn('fs_reply(result.status, "text/plain; charset=utf-8", result.output)', main)
        self.assertIn('fs_reply(result.status, "text/plain; charset=utf-8", result.output)', main)


if __name__ == "__main__":
    unittest.main(verbosity=2)
