"""Exercise the real native Python session IPC without requiring the Flow compiler."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NativePythonSessionTest(unittest.TestCase):
    def test_persistent_kernel_lifecycle(self):
        with tempfile.TemporaryDirectory(prefix="flowstudio-py-kernel-") as temp:
            binary = Path(temp) / "session-harness"
            subprocess.run([
                "cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2",
                str(ROOT / "src/python_session.c"),
                str(ROOT / "tests/python_session_harness.c"),
                "-o", str(binary),
            ], cwd=ROOT, check=True, capture_output=True, text=True, timeout=30)
            result = subprocess.run([str(binary)], cwd=ROOT, capture_output=True,
                                    text=True, timeout=30, check=True)
            self.assertIn("PASS: native persistent Python session", result.stdout)
