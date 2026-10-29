"""Typed conditional predicates through executable PDE, CLI and analytic mean."""
import json
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

PROGRAM = ROOT / "examples/heat_conditional_forcing.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class ConditionalForcingTest(unittest.TestCase):
    def test_comparisons_are_typed_and_vectorized(self):
        x, y = np.meshgrid((np.arange(8) + .5) / 8,
                           (np.arange(8) + .5) / 8, indexing="ij")
        cases = (
            ("where(x < 0.5m, 2K/s, 0K/s)", x < .5),
            ("where(x ≤ 0.5m, 2K/s, 0K/s)", x <= .5),
            ("where(x > 0.5m, 2K/s, 0K/s)", x > .5),
            ("where(x ≥ 0.5m, 2K/s, 0K/s)", x >= .5),
        )
        for source, mask in cases:
            with self.subTest(source=source):
                ast = parse_expression(source)
                self.assertEqual(ast.dimension, TEMPERATURE_RATE)
                np.testing.assert_array_equal(evaluate(ast, x, y),
                                              np.where(mask, 2., 0.))
        ast = parse_expression("where(x < 0.5m, where(y < 0.5m, 3K/s, 2K/s), 0K/s)")
        np.testing.assert_array_equal(evaluate(ast, x, y),
                                      np.where(x < .5, np.where(y < .5, 3., 2.), 0.))

    def test_invalid_predicates_fail_closed(self):
        for source in (
            "where(x < 1s, 1K/s, 0K/s)",
            "where(x < 1m, 1K/s, 0m/s)",
            "where(x, 1K/s, 0K/s)",
            "where(x < 1m, 1K/s)",
            "where(x < 1m, 1K/s, 0K/s, 3K/s)",
            "where(x < 1m < 2m, 1K/s, 0K/s)",
            "x < 1m",
            "2K/s * (x < 1m)",
        ):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)
        with self.assertRaises(ExpressionError):
            parse_expression("where(x < 1m, 1K/s, 0K/s)", symbols={"where": (0, 0, 0, 0)})
        with self.assertRaises(FlowMathError):
            parse(SOURCE.replace("x < 0.5m", "x < 0.5s"))

    def test_executable_heat_equation_conserves_analytic_mean(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        result = simulate(model)
        self.assertEqual(result["steps"], 100)
        # Periodic diffusion conserves the mean; exactly half the cells
        # receive a constant 2 K/s forcing for 0.01 s.
        self.assertLess(abs(result["mean_temperature"] - 300.01), 1e-9)
        self.assertGreater(result["temperature_variance"], 0)
        self.assertIn("temperature", result["spatial"]["fields"])

    def test_checked_in_program_compiles_and_executes(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                completed = subprocess.run(
                    [sys.executable, "src/math_flow.py", *flags, str(PROGRAM)],
                    cwd=ROOT, capture_output=True, text=True, timeout=45)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                data = json.loads(completed.stdout)
                self.assertTrue(data["ok"])
                if not flags:
                    self.assertLess(abs(data["mean_temperature"] - 300.01), 1e-9)


if __name__ == "__main__":
    unittest.main()
