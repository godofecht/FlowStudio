"""Typed time-dependent forcing: real RK2 stages, analytic integration and CLI."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from math_flow import FlowMathError, parse, simulate
from math_flow_expr import ExpressionError, evaluate, parse_expression
from math_flow_equations import TEMPERATURE_RATE


SOURCE = (ROOT / "examples/heat_temporal_forcing.flow").read_text(encoding="utf-8")
BASE = (ROOT / "examples/heat_equation_forced.flow").read_text(encoding="utf-8")


class TemporalForcingTest(unittest.TestCase):
    def test_typed_temporal_coordinate_and_real_numpy_lowering(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        x, y = np.meshgrid((np.arange(8) + .5) / 8, (np.arange(8) + .5) / 8, indexing="ij")
        field = np.full((8, 8), 300.)
        values = {"temperature": field, "diffusivity": .01, "t": .25}
        result = evaluate(model.equation.rhs, x, y,
                          expected_dimension=TEMPERATURE_RATE, values=values)
        np.testing.assert_allclose(result, 2., rtol=0, atol=1e-11)
        values["t"] = .75
        result = evaluate(model.equation.rhs, x, y,
                          expected_dimension=TEMPERATURE_RATE, values=values)
        np.testing.assert_allclose(result, -2., rtol=0, atol=1e-11)
        with self.assertRaisesRegex(ExpressionError, "Missing numerical value"):
            evaluate(model.equation.rhs, x, y, values={"temperature": field, "diffusivity": .01})

    def test_analytic_integrated_sinusoidal_source(self):
        model = parse(SOURCE)
        result = simulate(model)
        exact_mean = 300 + (1 - math.cos(2 * math.pi * model.until)) / math.pi
        self.assertEqual(result["steps"], 100)
        self.assertLess(abs(result["mean_temperature"] - exact_mean), 2e-8)
        self.assertLess(result["temperature_variance"], result["initial_temperature_variance"])
        self.assertAlmostEqual(result["observations"][-1]["meanTemperature"],
                               result["mean_temperature"], places=10)
        # Constant-source evaluation would yield 300.02; evaluating both
        # RK2 stages is required for the actual sinusoidal integral.
        self.assertGreater(abs(result["mean_temperature"] - 300.02), 0.01)

    def test_rejects_wrong_time_dimensions_and_initial_time_symbol(self):
        for bad in ("sin(2πt / 1m)", "sin(2πt)", "sin(2πunknown / 1s)"):
            with self.subTest(bad=bad), self.assertRaises(FlowMathError):
                parse(SOURCE.replace("sin(2πt / 1s)", bad))
        with self.assertRaises(FlowMathError):
            parse(BASE.replace("300K +", "300K + t * 1K/s +"))

    def test_checked_in_program_executes_through_cli(self):
        run = subprocess.run([sys.executable, "src/math_flow.py",
                              "examples/heat_temporal_forcing.flow"],
                             cwd=ROOT, text=True, capture_output=True, timeout=45)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        expected_mean = 300 + (1 - math.cos(2 * math.pi * .01)) / math.pi
        self.assertLess(abs(result["mean_temperature"] - expected_mean), 2e-8)
        self.assertIn("temperature", result["spatial"]["fields"])


if __name__ == "__main__":
    unittest.main()
