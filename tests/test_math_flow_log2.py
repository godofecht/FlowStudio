"""Analytic regression coverage for executable base-two logarithms."""
import math
import unittest

import numpy as np

from math_flow_expr import DIMENSIONLESS, ExpressionError, evaluate, parse_expression


class Log2ExpressionTests(unittest.TestCase):
    def test_scalar_analytic(self):
        expression = parse_expression("log2(8)")
        self.assertEqual(expression.dimension, DIMENSIONLESS)
        self.assertAlmostEqual(float(evaluate(expression, 0.0, 0.0)), 3.0)

    def test_vectorized_analytic(self):
        expression = parse_expression("log2(a)", symbols={"a": DIMENSIONLESS})
        values = np.array([0.5, 1.0, 2.0, 4.0, 1024.0])
        np.testing.assert_allclose(
            evaluate(expression, 0.0, 0.0, values={"a": values}),
            [-1.0, 0.0, 1.0, 2.0, 10.0], rtol=0, atol=1e-14)

    def test_nested_and_unicode_arithmetic(self):
        expression = parse_expression("2 × log2(√(16))")
        self.assertAlmostEqual(float(evaluate(expression, 0.0, 0.0)), 4.0)

    def test_dimension_rejection(self):
        with self.assertRaises(ExpressionError):
            parse_expression("log2(2m)")

    def test_nonpositive_domain_rejection(self):
        for source in ("log2(0)", "log2(-1)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    evaluate(parse_expression(source), 0.0, 0.0)


if __name__ == "__main__":
    unittest.main()
