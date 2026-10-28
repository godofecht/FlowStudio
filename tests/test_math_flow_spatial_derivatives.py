"""Execute typed Unicode spatial operators through the real PDE frontends."""
from pathlib import Path
import math
import json
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from math_flow_expr import (parse_expression, evaluate, ExpressionError,
                            VELOCITY, TEMPERATURE)
from math_flow import parse, simulate

NAVIER = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")
HEAT = (ROOT / "examples/heat_equation_smoke.flow").read_text(encoding="utf-8")


class SpatialDerivativeTest(unittest.TestCase):
    @staticmethod
    def grid(n):
        import numpy as np
        coordinates = (np.arange(n) + .5) / n
        return np.meshgrid(coordinates, coordinates, indexing="ij")

    def test_partial_derivative_dimensions_and_fourier_refinement(self):
        import numpy as np
        expression = parse_expression("∂ₓ(cos(2πx / 1m) * 1m²/s)")
        self.assertEqual(expression.dimension, VELOCITY)
        errors = []
        for n in (16, 32, 64):
            x, y = self.grid(n)
            actual = evaluate(expression, x, y, expected_dimension=VELOCITY)
            expected = -2 * np.pi * np.sin(2 * np.pi * x)
            errors.append(float(np.max(np.abs(actual - expected))))
        self.assertLess(errors[1], errors[0] / 3)
        self.assertLess(errors[2], errors[1] / 3)

    def test_y_derivative_and_laplacian(self):
        import numpy as np
        first = parse_expression("∂ᵧ(sin(2πy / 1m) * 1m²/s)")
        second = parse_expression("∇²(sin(2πx / 1m) * 1m³/s)")
        self.assertEqual(first.dimension, VELOCITY)
        self.assertEqual(second.dimension, VELOCITY)
        errors = []
        for n in (16, 32, 64):
            x, y = self.grid(n)
            derivative = evaluate(first, x, y)
            laplacian = evaluate(second, x, y)
            np.testing.assert_allclose(derivative, 2 * np.pi * np.cos(2 * np.pi * y), atol=0.18 if n == 16 else 0.05)
            errors.append(float(np.max(np.abs(laplacian + (2 * np.pi)**2 * np.sin(2 * np.pi * x)))))
        self.assertLess(errors[1], errors[0] / 3)
        self.assertLess(errors[2], errors[1] / 3)

    def test_invalid_derivative_inputs_fail_closed(self):
        import numpy as np
        derivative = parse_expression("∂ₓ(1m²/s)")
        with self.assertRaisesRegex(ExpressionError, "two-dimensional periodic"):
            evaluate(derivative, 1.0, 2.0)
        x, y = self.grid(16)
        with self.assertRaisesRegex(ExpressionError, "uniformly spaced"):
            evaluate(derivative, x * x, y)
        with self.assertRaises(ExpressionError):
            parse_expression("∂ₜ(x)")
        with self.assertRaises(ExpressionError):
            parse_expression("∂ₓ(x).__class__")

    def test_unicode_derivative_executes_in_navier_stokes(self):
        source = (ROOT / "examples/navier_stokes_spatial_derivative.flow").read_text(encoding="utf-8")
        model = parse(source)
        result = simulate(model)
        self.assertEqual(result["steps"], 10)
        self.assertLess(result["max_divergence"], 1e-5)
        self.assertGreater(result["kinetic_energy"], 0)
        self.assertTrue(math.isfinite(result["kinetic_energy"]))

    def test_unicode_derivative_executes_in_heat(self):
        source = (ROOT / "examples/heat_equation_spatial_derivative.flow").read_text(encoding="utf-8")
        model = parse(source)
        result = simulate(model)
        self.assertAlmostEqual(result["mean_temperature"], 300.0, places=10)
        self.assertLess(result["temperature_variance"], result["initial_temperature_variance"])
        self.assertGreater(result["temperature_variance"], 0)

    def test_checked_in_derivative_examples_run_through_cli(self):
        for name in ("navier_stokes_spatial_derivative.flow",
                     "heat_equation_spatial_derivative.flow"):
            with self.subTest(name=name):
                completed = subprocess.run(
                    [sys.executable, str(ROOT / "src/math_flow.py"),
                     str(ROOT / "examples" / name)],
                    cwd=ROOT, text=True, capture_output=True, timeout=45, check=False)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                output = json.loads(completed.stdout)
                self.assertTrue(output["ok"])
                self.assertGreater(output["steps"], 0)
                self.assertGreater(len(output["observations"]), 1)



if __name__ == "__main__":
    unittest.main()
