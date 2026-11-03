"""End-to-end PDE regressions for trailing-decimal scientific literals."""
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import parse, simulate

HEAT = (ROOT / "examples/heat_equation_smoke.flow").read_text(encoding="utf-8")
NAVIER = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")


class ExecutableDecimalPDETests(unittest.TestCase):
    def test_heat_equivalent_literal_through_real_solver(self):
        self.assertIn("0.01m²/s", HEAT)
        canonical = simulate(parse(HEAT))
        rewritten = HEAT.replace("0.01m²/s", "1.e-2m²/s")
        alternative = HEAT.replace("0.01m²/s", "1.E-2m²/s")
        for source in (rewritten, alternative):
            with self.subTest(source=source):
                actual = simulate(parse(source))
                self.assertEqual(actual["steps"], canonical["steps"])
                self.assertAlmostEqual(actual["mean_temperature"], 300.0, places=10)
                self.assertAlmostEqual(actual["temperature_variance"],
                                       canonical["temperature_variance"], places=12)
                self.assertLess(actual["temperature_variance"],
                                actual["initial_temperature_variance"])

    def test_navier_program_remains_numerically_executable(self):
        result = simulate(parse(NAVIER))
        self.assertTrue(math.isfinite(result["max_divergence"]))
        self.assertLess(result["max_divergence"], 1e-5)


if __name__ == "__main__":
    unittest.main()
