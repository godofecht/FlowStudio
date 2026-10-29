"""Typed logarithms execute through the real mathematical Flow parser and NumPy solver."""
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

PROGRAM = ROOT / "examples/heat_logarithmic_forcing.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class LogarithmicFlowTest(unittest.TestCase):
    def setUp(self):
        coordinates = (np.arange(32) + .5) / 32
        self.x, self.y = np.meshgrid(coordinates, coordinates, indexing="ij")

    def test_logarithms_have_dimensionless_arguments_and_numpy_values(self):
        for expression, expected in (
            ("ln(exp(1))", 1.),
            ("log(exp(1))", 1.),
            ("log10(100)", 2.),
            ("log1p(exp(1) − 1)", 1.),
        ):
            with self.subTest(expression=expression):
                ast = parse_expression(expression)
                self.assertEqual(ast.dimension, (0, 0, 0, 0))
                np.testing.assert_allclose(evaluate(ast, self.x, self.y), expected, atol=1e-14)
        for source in ("ln(1m)", "log(1K)", "log10(1s)", "log1p(1m)",
                       "ln(-1)", "log(0)", "log10(−10)", "log1p(−1)"):
            with self.subTest(source=source):
                if source.endswith(("m)", "K)", "s)")):
                    with self.assertRaises(ExpressionError):
                        parse_expression(source)
                else:
                    with self.assertRaises(ExpressionError):
                        evaluate(parse_expression(source), self.x, self.y)
        for malformed in ("ln()", "log(1,2)", "log10(1,2)", "log1p()"):
            with self.subTest(malformed=malformed):
                with self.assertRaises(ExpressionError):
                    parse_expression(malformed)

    def test_checked_in_heat_equation_matches_analytic_fourier_response(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        rhs = evaluate(model.equation.rhs, self.x, self.y,
                       expected_dimension=TEMPERATURE_RATE,
                       values={"temperature": np.full_like(self.x, 300.),
                               "diffusivity": model.diffusivity, "t": 0.})
        np.testing.assert_allclose(rhs, 4 * np.sin(2 * np.pi * self.x),
                                   rtol=0, atol=2e-13)
        result = simulate(model)
        eigenvalue = 4 * model.width**2 * math.sin(math.pi / model.width)**2
        decay = model.diffusivity * eigenvalue
        amplitude = 4 * (-math.expm1(-decay * model.until)) / decay
        self.assertEqual(result["steps"], 100)
        self.assertLess(abs(result["mean_temperature"] - 300.), 1e-9)
        self.assertLess(abs(result["temperature_variance"] - amplitude**2 / 2), 1e-8)
        self.assertIn("temperature", result["spatial"]["fields"])
        self.assertIn("semantic_trace", result)

    def test_fail_closed_for_bad_equation_units(self):
        with self.assertRaises(FlowMathError):
            parse(SOURCE.replace("log(exp(sin(2πx / 1m)))", "log(1m)"))

    def test_real_cli_check_and_execution(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                run = subprocess.run([sys.executable, "src/math_flow.py", *flags,
                                      str(PROGRAM)], cwd=ROOT,
                                     capture_output=True, text=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                payload = json.loads(run.stdout)
                self.assertTrue(payload["ok"])
                if not flags:
                    self.assertEqual(payload["steps"], 100)
                    self.assertLess(abs(payload["mean_temperature"] - 300.), 1e-9)


if __name__ == "__main__":
    unittest.main()
