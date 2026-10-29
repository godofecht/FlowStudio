"""Executable Unicode radicals and division: dimensions, NumPy and analytic heat PDE."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_expr import ExpressionError, evaluate, parse_expression
from math_flow_equations import TEMPERATURE_RATE

SOURCE_PATH = ROOT / "examples/heat_unicode_radicals.flow"
SOURCE = SOURCE_PATH.read_text(encoding="utf-8")


class UnicodeRadicalsTest(unittest.TestCase):
    def test_dimension_inference_and_real_numpy_lowering(self):
        x = np.zeros((4, 4))
        y = x.copy()
        for source, dimension, expected in (
            ("√(9m²)", (1, 0, 0, 0), 3.0),
            ("sqrt(9m²)", (1, 0, 0, 0), 3.0),
            ("∛(−8m³)", (1, 0, 0, 0), -2.0),
            ("cbrt(-8m³)", (1, 0, 0, 0), -2.0),
            ("9m ÷ 3s", (1, 0, -1, 0), 3.0),
            ("√9m² ÷ 3m", (0, 0, 0, 0), 1.0),
        ):
            with self.subTest(source=source):
                expression = parse_expression(source)
                self.assertEqual(expression.dimension, dimension)
                np.testing.assert_allclose(evaluate(expression, x, y), expected)

    def test_fail_closed_for_invalid_dimensions_and_values(self):
        for source in ("√(2m)", "∛(2m²)", "cbrt(2K)", "sqrt(2m³)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)
        with self.assertRaises(ExpressionError):
            evaluate(parse_expression("√(−1)"), 0, 0)
        with self.assertRaises(ExpressionError):
            parse(SOURCE.replace("√(4m²)", "√(4m)"))

    def test_real_heat_equation_and_analytic_fourier_response(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        n = model.width
        coordinates = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
        temperature = np.full_like(x, 300.)
        rhs = evaluate(model.equation.rhs, x, y,
                       expected_dimension=TEMPERATURE_RATE,
                       values={"temperature": temperature, "diffusivity": model.diffusivity})
        np.testing.assert_allclose(rhs, np.sin(2 * np.pi * x), atol=1e-13, rtol=0)
        result = simulate(model)
        eigenvalue = 4 * n * n * math.sin(math.pi / n)**2
        decay = model.diffusivity * eigenvalue
        amplitude = -math.expm1(-decay * model.until) / decay
        self.assertEqual(result["steps"], 100)
        self.assertAlmostEqual(result["mean_temperature"], 300., places=9)
        self.assertLess(abs(result["temperature_variance"] - amplitude**2 / 2), 1e-8)

    def test_checked_in_flow_program_executes_via_cli(self):
        for extra in (["--check"], []):
            with self.subTest(extra=extra):
                run = subprocess.run(
                    [sys.executable, "src/math_flow.py", *extra,
                     "examples/heat_unicode_radicals.flow"],
                    cwd=ROOT, capture_output=True, text=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                payload = json.loads(run.stdout)
                self.assertTrue(payload["ok"])
                if not extra:
                    self.assertEqual(payload["steps"], 100)
                    self.assertLess(payload["temperature_variance"], 1e-3)


if __name__ == "__main__":
    unittest.main()
