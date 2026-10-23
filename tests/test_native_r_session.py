"""Exercise the real Rscript-backed IPC transport, not a mocked interpreter."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("Rscript"), "Rscript is not installed")
class NativeRSessionTest(unittest.TestCase):
    def test_persistent_r_kernel(self):
        with tempfile.TemporaryDirectory(prefix="flowstudio-r-kernel-") as temp:
            binary = Path(temp) / "session-harness"
            subprocess.run([
                "cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2",
                str(ROOT / "src/r_session.c"),
                str(ROOT / "tests/r_session_harness.c"),
                "-o", str(binary),
            ], cwd=ROOT, check=True, capture_output=True, text=True, timeout=30)
            result = subprocess.run([str(binary)], cwd=ROOT, capture_output=True,
                                    text=True, timeout=45, check=True)
            self.assertIn("PASS: native persistent R", result.stdout)
