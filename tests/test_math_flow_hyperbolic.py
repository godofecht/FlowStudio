"""Typed hyperbolic functions: parser, dimensional safety and native numerical execution."""
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

PROGRAM = ROOT / "examples/heat_hyperbolic_forcing.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class HyperbolicFlowTest(unittest.TestCase):
    def setUp(self):
        coordinates = (np.arange(32) + .5) / 32
        self.x, self.y = np.meshgrid(coordinates, coordinates, indexing="ij")

    def test_typed_scalar_and_array_values(self):
        for expression, expected in (
            ("sinh(0)", 0.),
            ("cosh(0)", 1.),
            ("asinh(0)", 0.),
            ("acosh(1)", 0.),
            ("atanh(0.5)", math.atanh(0.5)),
            ("sinh(asinh(sin(2πx/1m)))", np.sin(2*np.pi*self.x)),
            ("cosh(acosh(2))", 2.),
            ("tanh(atanh(sin(2πx/1m)/2))", np.sin(2*np.pi*self.x)/2),
        ):
            with self.subTest(expression=expression):
                ast = parse_expression(expression)
                self.assertEqual(ast.dimension, (0, 0, 0, 0))
                np.testing.assert_allclose(evaluate(ast, self.x, self.y),
                                           expected, rtol=0, atol=2e-14)

    def test_reject_invalid_dimensions_domains_and_arity(self):
        for expression in ("sinh(1m)", "cosh(1K)", "asinh(1s)",
                           "acosh(2m)", "atanh(1K)", "sinh()",
                           "acosh()", "atanh(1,2)", "cosh(1,2)"):
            with self.subTest(expression=expression):
                with self.assertRaises(ExpressionError):
                    parse_expression(expression)
        for expression in ("acosh(0.9)", "atanh(1)", "atanh(-1)",
                           "atanh(x/1m)", "sinh(1000)"):
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
            ("sinh(asinh(sin(2πx / 1m)))", "sinh(1m)"),
            ("cosh(acosh(2))", "cosh(2s)"),
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
