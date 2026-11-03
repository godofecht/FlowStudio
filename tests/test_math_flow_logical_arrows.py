"""Typed logical arrows and XOR through real PDE parser, solver and CLI."""
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

PROGRAM = ROOT / "examples/heat_logical_arrows.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class LogicalArrowsTest(unittest.TestCase):
    def setUp(self):
        coordinates = (np.arange(32) + .5) / 32
        self.x, self.y = np.meshgrid(coordinates, coordinates, indexing="ij")
        self.a = self.x < .5
        self.b = self.y < .5

    def test_vectorized_truth_tables_and_ascii_aliases(self):
        cases = (
            ("x < 0.5m ⇒ y < 0.5m", ~self.a | self.b),
            ("x < 0.5m → y < 0.5m", ~self.a | self.b),
            ("x < 0.5m implies y < 0.5m", ~self.a | self.b),
            ("x < 0.5m ⇔ y < 0.5m", self.a == self.b),
            ("x < 0.5m ↔ y < 0.5m", self.a == self.b),
            ("x < 0.5m iff y < 0.5m", self.a == self.b),
            ("x < 0.5m ⊻ y < 0.5m", self.a ^ self.b),
            ("x < 0.5m xor y < 0.5m", self.a ^ self.b),
        )
        for predicate, mask in cases:
            with self.subTest(predicate=predicate):
                expression = parse_expression(f"where({predicate}, 2K/s, 0K/s)")
                self.assertEqual(expression.dimension, TEMPERATURE_RATE)
                np.testing.assert_array_equal(
                    evaluate(expression, self.x, self.y),
                    np.where(mask, 2., 0.))

    def test_associativity_and_precedence_are_explicit_in_typed_ast(self):
        right = parse_expression(
            "where(x < 0.5m ⇒ y < 0.5m ⇒ x ≥ 0.5m, 1K/s, 0K/s)")
        self.assertEqual(right.operands[0].operator, "implies")
        self.assertEqual(right.operands[0].operands[1].operator, "implies")
        left = parse_expression(
            "where(x < 0.5m ⇔ y < 0.5m ⇔ x ≥ 0.5m, 1K/s, 0K/s)")
        self.assertEqual(left.operands[0].operator, "iff")
        self.assertEqual(left.operands[0].operands[0].operator, "iff")
        mixed = parse_expression(
            "where(x < 0.5m ∨ y < 0.5m ⊻ x ≥ 0.5m ∧ y ≥ 0.5m, 1K/s, 0K/s)")
        self.assertEqual(mixed.operands[0].operator, "or")
        self.assertEqual(mixed.operands[0].operands[1].operator, "xor")
        self.assertEqual(mixed.operands[0].operands[1].operands[1].operator, "and")

    def test_rejects_non_predicate_operands_and_invalid_dimensions(self):
        invalid = (
            "where(x < 0.5m ⇒ 1, 2K/s, 0K/s)",
            "where(1 ⇔ y < 0.5m, 2K/s, 0K/s)",
            "where(x < 0.5m ⊻ 1, 2K/s, 0K/s)",
            "where(x < 0.5m ⇒ y < 0.5s, 2K/s, 0K/s)",
            "where(x < 0.5m ⇒ y < 0.5m, 2K/s, 0m/s)",
            "where(x < 0.5m ⇒, 2K/s, 0K/s)",
            "x < 0.5m ⇒ y < 0.5m",
            "where(x < 0.5m, 2K/s, 0K/s) + (x < 0.5m ⇔ y < 0.5m)",
        )
        for source in invalid:
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)
        for reserved in ("xor", "implies", "iff"):
            with self.subTest(reserved=reserved):
                with self.assertRaises(ExpressionError):
                    parse_expression("1", symbols={reserved: (0, 0, 0, 0)})
        with self.assertRaises(FlowMathError):
            parse(SOURCE.replace("y < 0.5m", "y < 0.5s", 1))

    def test_real_rk2_solver_matches_quadrant_mean(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        initial = np.full((32, 32), 300.)
        forcing = evaluate(model.equation.rhs, self.x, self.y,
                           expected_dimension=TEMPERATURE_RATE,
                           values={"temperature": initial,
                                   "diffusivity": model.diffusivity, "t": 0.})
        expected = (~self.a) & self.b
        np.testing.assert_array_equal(forcing, np.where(expected, 2., 0.))
        result = simulate(model)
        self.assertEqual(result["steps"], 100)
        self.assertEqual(result["grid"], [32, 32])
        # One quadrant receives 2 K/s for 0.01 s; diffusion conserves mean.
        self.assertLess(abs(result["mean_temperature"] - 300.005), 1e-9)
        self.assertGreater(result["temperature_variance"], 0)
        self.assertIn("temperature", result["spatial"]["fields"])

    def test_checked_in_pde_cli_compiles_and_executes(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                run = subprocess.run(
                    [sys.executable, "src/math_flow.py", *flags, str(PROGRAM)],
                    cwd=ROOT, text=True, capture_output=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                payload = json.loads(run.stdout)
                self.assertTrue(payload["ok"])
                if not flags:
                    self.assertLess(abs(payload["mean_temperature"] - 300.005), 1e-9)


if __name__ == "__main__":
    unittest.main()
