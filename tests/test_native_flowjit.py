"""Compile and run real R/C FlowJIT kernels, without a mocked runtime."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("Rscript") and shutil.which("cc"),
                     "Rscript and a C compiler are required")
class NativeFlowJITTest(unittest.TestCase):
    def test_native_specialization(self):
        result = subprocess.run(
            ["Rscript", "--vanilla", "tests/flowjit_smoke.R"],
            cwd=ROOT, capture_output=True, text=True, timeout=60, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: FlowJIT native compilation", result.stdout)
