"""Executable, dimension-checked equality and inequality in mathematical Flow."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_expr import ExpressionError, evaluate, parse_expression, tokenize
from math_flow_equations import TEMPERATURE_RATE

PROGRAM = ROOT / "examples/heat_equality_mask.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class EqualityPredicateTest(unittest.TestCase):
    def setUp(self):
        coordinates = (np.arange(32) + 0.5) / 32
        self.x, self.y = np.meshgrid(coordinates, coordinates, indexing="ij")

    def test_unicode_and_ascii_equality_lower_to_real_numpy_arrays(self):
        cases = (
            ("where(x == y, 2K/s, 0K/s)", self.x == self.y),
            ("where(x ≠ y, 2K/s, 0K/s)", self.x != self.y),
            ("where(x != y, 2K/s, 0K/s)", self.x != self.y),
            ("where(x == y ∨ x + y == 1m, 2K/s, 0K/s)",
             (self.x == self.y) | (self.x + self.y == 1)),
            ("where(¬(x ≠ y) ∧ x ≤ y, 2K/s, 0K/s)",
             (self.x == self.y) & (self.x <= self.y)),
        )
        for source, mask in cases:
            with self.subTest(source=source):
                ast = parse_expression(source)
                self.assertEqual(ast.dimension, TEMPERATURE_RATE)
                np.testing.assert_array_equal(evaluate(ast, self.x, self.y),
                                              np.where(mask, 2., 0.))
        self.assertEqual(tokenize("x==y"), ("x", "==", "y"))
        self.assertEqual(tokenize("x!=y"), ("x", "!=", "y"))

    def test_dimension_and_predicate_guards(self):
        for source in (
            "x == y", "x ≠ y", "x != y",
            "where(x == 1s, 2K/s, 0K/s)",
            "where(x ≠ 1s, 2K/s, 0K/s)",
            "where(x != 1s, 2K/s, 0K/s)",
            "where(x == y == x, 2K/s, 0K/s)",
            "where(x == y, 2K/s, 0m/s)",
            "where(x == y, x != y, 0K/s)",
            "where(x == y, 2K/s, x == y)",
            "where(x == y, 2K/s, 0K/s) + (x != y)",
        ):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)
        with self.assertRaises(FlowMathError):
            parse(SOURCE.replace("2K/s, 0K/s)", "2K/s, 0K/s) = 2K/s"))
        for replacement in ("x == 1s", "x ≠ 1s", "x != 1s"):
            with self.subTest(replacement=replacement):
                with self.assertRaises(FlowMathError):
                    parse(SOURCE.replace("x == y", replacement))

    def test_full_program_analytic_diagonal_mean(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        expected_mask = (self.x == self.y) | (self.x + self.y == 1)
        self.assertEqual(np.count_nonzero(expected_mask), 64)
        field = np.full((32, 32), 300.)
        forcing = evaluate(model.equation.rhs, self.x, self.y,
                           expected_dimension=TEMPERATURE_RATE,
                           values={"temperature": field, "diffusivity": model.diffusivity, "t": 0.})
        np.testing.assert_array_equal(forcing, np.where(expected_mask, 2., 0.))
        result = simulate(model)
        self.assertEqual(result["steps"], 100)
        self.assertLess(abs(result["mean_temperature"] - 300.00125), 1e-9)
        self.assertGreater(result["temperature_variance"], 0)
        self.assertIn("temperature", result["spatial"]["fields"])
        self.assertIn("semantic_trace", result)
        # Exercise the complete Flow lexer and solver with both inequality spellings.
        for inequality in ("≠", "!="):
            with self.subTest(inequality=inequality):
                alternate = parse(SOURCE.replace("x == y", f"x {inequality} y"))
                alternate_result = simulate(alternate)
                self.assertLess(abs(alternate_result["mean_temperature"] - 300.019375), 1e-9)

    def test_real_cli_compilation_and_execution(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                completed = subprocess.run(
                    [sys.executable, "src/math_flow.py", *flags, str(PROGRAM)],
                    cwd=ROOT, capture_output=True, text=True, timeout=45)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                data = json.loads(completed.stdout)
                self.assertTrue(data["ok"])
                if not flags:
                    self.assertLess(abs(data["mean_temperature"] - 300.00125), 1e-9)


if __name__ == "__main__":
    unittest.main()
