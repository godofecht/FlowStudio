"""Executable typed Unicode boolean masks with analytic heat forcing."""
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

PROGRAM = ROOT / "examples/heat_boolean_mask.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class UnicodeBooleanPredicatesTest(unittest.TestCase):
    def setUp(self):
        self.x, self.y = np.meshgrid((np.arange(32) + .5) / 32,
                                     (np.arange(32) + .5) / 32, indexing="ij")

    def test_and_or_not_precedence_and_numpy_lowering(self):
        expressions = (
            ("where(x < 0.5m ∧ y < 0.5m, 2K/s, 0K/s)",
             (self.x < .5) & (self.y < .5)),
            ("where(x < 0.5m ∨ y < 0.5m, 2K/s, 0K/s)",
             (self.x < .5) | (self.y < .5)),
            ("where(¬(x < 0.5m), 2K/s, 0K/s)", ~(self.x < .5)),
            ("where(x < 0.5m ∧ y < 0.5m ∨ x ≥ 0.5m, 2K/s, 0K/s)",
             ((self.x < .5) & (self.y < .5)) | (self.x >= .5)),
            ("where(x < 0.5m ∧ (y < 0.5m ∨ y ≥ 0.75m), 2K/s, 0K/s)",
             (self.x < .5) & ((self.y < .5) | (self.y >= .75))),
        )
        for source, mask in expressions:
            with self.subTest(source=source):
                ast = parse_expression(source)
                self.assertEqual(ast.dimension, TEMPERATURE_RATE)
                np.testing.assert_array_equal(evaluate(ast, self.x, self.y),
                                              np.where(mask, 2., 0.))

    def test_boolean_is_not_a_dimensionless_number(self):
        for source in (
            "x < 0.5m ∧ y < 0.5m",
            "¬(x < 0.5m)",
            "where(1, 2K/s, 0K/s)",
            "where(x < 0.5m ∧ 1, 2K/s, 0K/s)",
            "where(x < 0.5m ∨ 0, 2K/s, 0K/s)",
            "where(¬(1m), 2K/s, 0K/s)",
            "where(x < 0.5m, x < 0.5m, 0)",
            "where(x < 0.5m, 1K/s, y > 0.5m)",
            "where(x < 0.5m, 2K/s, 0K/s) + (y < 0.5m)",
            "where((x < 0.5m) < 1, 2K/s, 0K/s)",
            "where(x < 0.5m ∧ y < 1s, 2K/s, 0K/s)",
        ):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)
        with self.assertRaises(FlowMathError):
            parse(SOURCE.replace("y < 0.5m", "y < 0.5s"))

    def test_actual_rk2_solver_matches_analytic_two_quadrant_mean(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        field = np.full((32, 32), 300.)
        forcing = evaluate(model.equation.rhs, self.x, self.y,
                           expected_dimension=TEMPERATURE_RATE,
                           values={"temperature": field, "diffusivity": model.diffusivity, "t": 0.})
        expected_mask = ((self.x < .5) & (self.y < .5)) | ((self.x >= .5) & (self.y >= .5))
        np.testing.assert_array_equal(forcing, np.where(expected_mask, 2., 0.))
        result = simulate(model)
        self.assertEqual(result["steps"], 100)
        # Periodic diffusion conserves the mean, half the cells heat by 2 K/s.
        self.assertLess(abs(result["mean_temperature"] - 300.01), 1e-9)
        self.assertGreater(result["temperature_variance"], 0)
        self.assertIn("temperature", result["spatial"]["fields"])
        self.assertIn("semantic_trace", result)

    def test_real_cli_compilation_and_execution(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                completed = subprocess.run(
                    [sys.executable, "src/math_flow.py", *flags, str(PROGRAM)],
                    cwd=ROOT, capture_output=True, text=True, timeout=45)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                payload = json.loads(completed.stdout)
                self.assertTrue(payload["ok"])
                if not flags:
                    self.assertLess(abs(payload["mean_temperature"] - 300.01), 1e-9)


if __name__ == "__main__":
    unittest.main()
