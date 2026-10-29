"""Real typed inverse-trigonometry and geometric-norm compiler/runtime acceptance."""
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

PROGRAM = ROOT / "examples/heat_inverse_trigonometry.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class InverseTrigonometryFlowTest(unittest.TestCase):
    def setUp(self):
        coordinates = (np.arange(32) + .5) / 32
        self.x, self.y = np.meshgrid(coordinates, coordinates, indexing="ij")

    def test_typed_scalar_and_array_values(self):
        for expression, expected, dimension in (
            ("asin(0.5)", math.pi / 6, (0, 0, 0, 0)),
            ("acos(0.5)", math.pi / 3, (0, 0, 0, 0)),
            ("atan(1)", math.pi / 4, (0, 0, 0, 0)),
            ("atan2(1m, 1m)", math.pi / 4, (0, 0, 0, 0)),
            ("hypot(3m, 4m)", 5., (1, 0, 0, 0)),
            ("hypot(x, y)", np.hypot(self.x, self.y), (1, 0, 0, 0)),
            ("atan2(y, x)", np.arctan2(self.y, self.x), (0, 0, 0, 0)),
        ):
            with self.subTest(expression=expression):
                ast = parse_expression(expression)
                self.assertEqual(ast.dimension, dimension)
                np.testing.assert_allclose(evaluate(ast, self.x, self.y), expected, rtol=0, atol=2e-14)

    def test_reject_invalid_dimensions_domains_and_arity(self):
        for expression in ("asin(1m)", "acos(1K)", "atan(1s)", "atan2(1m, 1s)",
                           "hypot(1m, 1s)", "atan2(1m)", "hypot(1m)",
                           "atan2(1m, 1m, 1m)", "hypot(1m, 2m, 3m)",
                           "asin(1, 2)", "acos()", "atan()"):
            with self.subTest(expression=expression):
                with self.assertRaises(ExpressionError):
                    parse_expression(expression)
        for expression in ("asin(1.1)", "acos(-1.1)", "atan2(0, 0)",
                           "atan2(x - x, y - y)"):
            with self.subTest(expression=expression):
                with self.assertRaises(ExpressionError):
                    evaluate(parse_expression(expression), self.x, self.y)

    def test_full_heat_program_matches_analytic_fourier_mode(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        rhs = evaluate(model.equation.rhs, self.x, self.y,
                       expected_dimension=TEMPERATURE_RATE,
                       values={"temperature": np.full_like(self.x, 300.),
                               "diffusivity": model.diffusivity, "t": 0.})
        np.testing.assert_allclose(rhs, 5 * np.sin(2 * np.pi * self.x), rtol=0, atol=2e-12)
        result = simulate(model)
        eigenvalue = 4 * model.width**2 * math.sin(math.pi / model.width)**2
        decay = model.diffusivity * eigenvalue
        amplitude = 5 * (-math.expm1(-decay * model.until)) / decay
        self.assertEqual(result["steps"], 100)
        self.assertLess(abs(result["mean_temperature"] - 300.), 1e-9)
        self.assertLess(abs(result["temperature_variance"] - amplitude**2 / 2), 1e-8)
        self.assertIn("temperature", result["spatial"]["fields"])

    def test_bad_units_fail_at_full_flow_parse(self):
        for original, replacement in (
            ("atan2(sin(2πx / 1m), cos(2πx / 1m))", "atan2(1m, 1s)"),
            ("hypot(3m, 4m)", "hypot(3m, 4s)"),
        ):
            with self.subTest(replacement=replacement):
                with self.assertRaises(FlowMathError):
                    parse(SOURCE.replace(original, replacement))

    def test_checked_in_program_compiles_and_executes_on_cli(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                run = subprocess.run([sys.executable, "src/math_flow.py", *flags, str(PROGRAM)],
                                     cwd=ROOT, capture_output=True, text=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                payload = json.loads(run.stdout)
                self.assertTrue(payload["ok"])
                if not flags:
                    self.assertEqual(payload["steps"], 100)
                    self.assertLess(abs(payload["mean_temperature"] - 300.), 1e-9)


if __name__ == "__main__":
    unittest.main()
