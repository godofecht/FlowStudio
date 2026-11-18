"""Execute rectangular resolution overrides through both PDE backends and CLI."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, parse_grid_argument, simulate, validated_grid


class RectangularOverrides(unittest.TestCase):
    def test_cli_spelling_and_strict_axes(self):
        self.assertEqual(parse_grid_argument("16"), 16)
        for spelling in ("16x24", "16×24"):
            self.assertEqual(parse_grid_argument(spelling), (16, 24))
        for invalid in ("16.0", "16x", "16x24x32", "16e1", "-16", " 16"):
            with self.subTest(invalid=invalid), self.assertRaises(FlowMathError):
                parse_grid_argument(invalid)
        for invalid in ((True, 16), (16, 7), (513, 16), (16.0, 24), (16,), [16, 24]):
            with self.subTest(invalid=invalid), self.assertRaises(FlowMathError):
                validated_grid(32, 32, invalid)

    def test_both_backends_compute_rectangular_grids(self):
        for example, observable in (("navier_stokes_smoke.flow", "kinetic_energy"),
                                    ("heat_piecewise_forcing.flow", "mean_temperature")):
            with self.subTest(example=example):
                model = parse((ROOT / "examples" / example).read_text())
                result = simulate(model, grid=(16, 24), until=0.0002)
                self.assertEqual(result["grid"], [16, 24])
                self.assertTrue(math.isfinite(result[observable]))
                self.assertEqual(result[observable], simulate(model, grid=(16, 24), until=0.0002)[observable])
                completed = subprocess.run(
                    [sys.executable, str(ROOT / "src/math_flow.py"),
                     str(ROOT / "examples" / example), "--grid", "16x24", "--until", "0.0002"],
                    capture_output=True, text=True, timeout=20)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                actual = json.loads(completed.stdout)
                self.assertEqual(actual["grid"], [16, 24])
                self.assertAlmostEqual(actual[observable], result[observable], places=12)
