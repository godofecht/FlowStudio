"""Executable double-star exponent regression tests for the typed mathematical Flow AST."""
import sys
from pathlib import Path
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow_expr import ExpressionError, evaluate, parse_expression, tokenize


class DoubleStarPowersTest(unittest.TestCase):
    def test_tokenization_and_typed_lowering(self):
        self.assertEqual(tokenize("(3m)**2 / 9m²"), ("(", "3m", ")", "**", "2", "/", "9m²"))
        x = np.zeros((3, 3))
        for source in ("(3m)**2 / 9m²", "(3m)^2 / 9m²", "(3m)² / 9m²"):
            with self.subTest(source=source):
                tree = parse_expression(source)
                self.assertEqual(tree.dimension, (0, 0, 0, 0))
                np.testing.assert_allclose(evaluate(tree, x, x), 1.0)

    def test_negative_power_and_precedence(self):
        x = np.zeros((3, 3))
        tree = parse_expression("(2m)**-2")
        self.assertEqual(tree.dimension, (-2, 0, 0, 0))
        np.testing.assert_allclose(evaluate(tree, x, x), .25)
        self.assertEqual(float(evaluate(parse_expression("−2**2 + 5"), x, x)), 1.)
        self.assertEqual(float(evaluate(parse_expression("2**3 * 2"), x, x)), 16.)

    def test_reject_unsafe_exponents(self):
        for source in ("2m**9", "2m**-9", "2m**1.5", "2m**1K",
                       "2m**(1+1)", "2m**x", "2m**3**2"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)


if __name__ == "__main__":
    unittest.main()
