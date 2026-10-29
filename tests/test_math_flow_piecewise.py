"""Typed piecewise mathematical operators: parser, dimensions, NumPy, PDE, CLI."""
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

PROGRAM = ROOT / "examples/heat_piecewise_forcing.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class PiecewiseOperatorsTest(unittest.TestCase):
    def test_typed_absolute_and_minimum_maximum_lower_to_numpy(self):
        x, y = np.meshgrid(np.arange(4.), np.arange(4.), indexing="ij")
        cases = (
            ("|−3m|", (1, 0, 0, 0), 3.),
            ("abs(-3m)", (1, 0, 0, 0), 3.),
            ("2|−3m|", (1, 0, 0, 0), 6.),
            ("|1m − 4m| + |2m|", (1, 0, 0, 0), 5.),
            ("min(2m, 3m)", (1, 0, 0, 0), 2.),
            ("max(2m, 3m)", (1, 0, 0, 0), 3.),
            ("min(3K/s, 2K/s)", (0, 0, -1, 1), 2.),
        )
        for source, dimension, expected in cases:
            with self.subTest(source=source):
                ast = parse_expression(source)
                self.assertEqual(ast.dimension, dimension)
                np.testing.assert_allclose(evaluate(ast, x, y), expected, atol=0, rtol=0)
        ast = parse_expression("max(0m, min(2m, x))")
        np.testing.assert_allclose(evaluate(ast, x, y), np.minimum(2., x))

    def test_fail_closed_on_wrong_dimensions_or_malformed_arguments(self):
        for source in (
            "min(1m, 1s)", "max(1K, 1K/s)", "|1m + 1s|",
            "min(1m)", "max(1m, 2m, 3m)", "|1m", "abs(1m, 2m)",
        ):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)
        with self.assertRaises(ExpressionError):
            parse_expression("temperature", symbols={"abs": (0, 0, 0, 0)})
        with self.assertRaises(FlowMathError):
            parse(SOURCE.replace("max(0K/s", "max(0K"))

    def test_piecewise_source_executes_at_actual_rk2_stage_times(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        x, y = np.meshgrid((np.arange(8) + .5) / 8, (np.arange(8) + .5) / 8, indexing="ij")
        field = np.full((8, 8), 300.)
        for time in (0.25, 0.75):
            with self.subTest(time=time):
                rate = evaluate(model.equation.rhs, x, y,
                                expected_dimension=TEMPERATURE_RATE,
                                values={"temperature": field, "diffusivity": model.diffusivity, "t": time})
                np.testing.assert_allclose(rate, 2., atol=1e-12, rtol=0)
        result = simulate(model)
        expected_mean = 300. + (1. - math.cos(2 * math.pi * model.until)) / math.pi
        self.assertEqual(result["steps"], 100)
        self.assertLess(abs(result["mean_temperature"] - expected_mean), 2e-8)
        self.assertLess(result["temperature_variance"], 1e-12)
        self.assertIn("temperature", result["spatial"]["fields"])

    def test_checked_in_program_compiles_and_executes_as_cli(self):
        for options in (["--check"], []):
            with self.subTest(options=options):
                run = subprocess.run(
                    [sys.executable, "src/math_flow.py", *options, str(PROGRAM)],
                    cwd=ROOT, text=True, capture_output=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                payload = json.loads(run.stdout)
                self.assertTrue(payload["ok"])
                if not options:
                    self.assertEqual(payload["steps"], 100)
                    self.assertIn("temperature", payload["spatial"]["fields"])


if __name__ == "__main__":
    unittest.main()
