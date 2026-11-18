"""Independent analytic scalar and dimensional oracles for executable math Flow.

Run with python -m unittest discover -s tests -p 'test_math_flow_analytic_oracles.py'.
These tests exercise the actual typed AST and NumPy evaluator, not editor snippets.
"""
import math
import unittest

import numpy as np

from src.math_flow_expr import (
    DIMENSIONLESS, LENGTH, ExpressionError, evaluate, parse_expression,
)


class AnalyticExpressionOracles(unittest.TestCase):
    def setUp(self):
        self.x = np.zeros((4, 4), dtype=float)
        self.y = np.zeros((4, 4), dtype=float)

    def check(self, source, expected, *, symbols=None, values=None):
        tree = parse_expression(source, symbols=symbols)
        actual = evaluate(tree, self.x, self.y, values=values)
        np.testing.assert_allclose(actual, expected, rtol=2e-13, atol=2e-15)
        return tree

    def test_logarithm_inverse_near_zero(self):
        for value in (1e-12, -1e-12, 0.125, -0.25):
            self.check("log1p(expm1(z))", value,
                       symbols={"z": DIMENSIONLESS}, values={"z": value})

    def test_sinc_analytic_values(self):
        for value, expected in ((0., 1.), (math.pi, 0.), (math.pi / 2, 2 / math.pi)):
            self.check("sinc(z)", expected,
                       symbols={"z": DIMENSIONLESS}, values={"z": value})

    def test_unicode_operator_lowering(self):
        self.check("2 × (3 + 4) − 8 ÷ 2", 10.)
        self.check("√(9m²)", 3., symbols=None)

    def test_dimensional_conservation(self):
        tree = self.check("2m + 3m", 5.)
        self.assertEqual(tree.dimension, LENGTH)
        with self.assertRaises(ExpressionError):
            parse_expression("2m + 3s")
        with self.assertRaises(ExpressionError):
            parse_expression("log2(2m)")

    def test_bounded_domain_rejection(self):
        with self.assertRaises(ExpressionError):
            parse_expression("1e999")
        with self.assertRaises(ExpressionError):
            parse_expression("1e-999")


if __name__ == "__main__":
    unittest.main()
