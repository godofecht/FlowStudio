"""Independent analytic oracle for the production logical heat PDE CLI.

The forcing predicate (A => B) XOR (A <=> B), with
A=(x<0.5m), B=(y<0.5m), is true on exactly one of four
equal-sized periodic grid quadrants. With zero diffusivity
the RK2 solution is exactly 300K + 0.02K in that quadrant.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "src" / "math_flow.py"
SOURCE = (ROOT / "examples" / "heat_logical_arrows.flow").read_text(encoding="utf-8")


def run(source, check=False):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "analytic_mask.flow"
        path.write_text(source, encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(CLI), *(["--check"] if check else []), str(path)],
            cwd=ROOT, capture_output=True, text=True, timeout=45,
        )


class HeatLogicalMaskAnalyticAcceptance(unittest.TestCase):
    def test_zero_diffusion_has_exact_quadrant_mean_and_variance(self):
        self.assertIn("const diffusivity = 0.01m²/s", SOURCE)
        source = SOURCE.replace("const diffusivity = 0.01m²/s",
                                "const diffusivity = 0m²/s", 1)
        expected_mean = 300.0 + 0.25 * (2.0 * 0.01)
        expected_variance = 0.25 * 0.75 * (2.0 * 0.01) ** 2
        checked = run(source, check=True)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        first = run(source)
        self.assertEqual(first.returncode, 0, first.stderr)
        second = run(source)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(first.stdout, second.stdout)
        payload = json.loads(first.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["grid"], [32, 32])
        self.assertEqual(payload["steps"], 100)
        self.assertAlmostEqual(payload["mean_temperature"], expected_mean, delta=1e-9)
        self.assertAlmostEqual(payload["temperature_variance"], expected_variance, delta=1e-9)

    def test_no_forcing_preserves_uniform_temperature(self):
        self.assertIn("2K/s, 0K/s)", SOURCE)
        source = SOURCE.replace("2K/s, 0K/s)", "0K/s, 0K/s)", 1)
        checked = run(source, check=True)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        executed = run(source)
        self.assertEqual(executed.returncode, 0, executed.stderr)
        payload = json.loads(executed.stdout)
        self.assertTrue(payload["ok"])
        self.assertAlmostEqual(payload["mean_temperature"], 300.0, delta=1e-9)
        self.assertAlmostEqual(payload["temperature_variance"], 0.0, delta=1e-12)

    def test_invalid_diffusivity_rejected_then_clean_process_recovers(self):
        for bad in ("-0.01m²/s", "1e999m²/s"):
            with self.subTest(bad=bad):
                source = SOURCE.replace("0.01m²/s", bad, 1)
                rejected = run(source, check=True)
                self.assertNotEqual(rejected.returncode, 0)
                clean = run(SOURCE)
                self.assertEqual(clean.returncode, 0, clean.stderr)
                self.assertTrue(json.loads(clean.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
