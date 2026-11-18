"""Executable analytic sinc regression tests for mathematical Flow."""
import math
import unittest

import numpy as np

from src.math_flow_expr import DIMENSIONLESS, ExpressionError, evaluate, parse_expression


class TestSinc(unittest.TestCase):
    def test_zero_and_small_argument(self):
        for value in (0.0, 1e-12, -1e-12):
            actual = float(evaluate(parse_expression("sinc(z)", symbols={"z": DIMENSIONLESS}),
                                    0.0, 0.0, values={"z": value}))
            self.assertAlmostEqual(actual, 1.0, places=12)

    def test_analytic_values_and_vectorization(self):
        values = np.array([0.0, math.pi / 2, math.pi, -math.pi / 2])
        result = evaluate(parse_expression("sinc(z)", symbols={"z": DIMENSIONLESS}),
                          0.0, 0.0, values={"z": values})
        np.testing.assert_allclose(result, [1.0, 2.0 / math.pi, 0.0, 2.0 / math.pi],
                                   rtol=1e-14, atol=1e-15)

    def test_nested_and_dimension(self):
        expression = parse_expression("2*sinc(π/2)")
        self.assertEqual(expression.dimension, DIMENSIONLESS)
        self.assertAlmostEqual(float(evaluate(expression, 0.0, 0.0)), 4 / math.pi)

    def test_reject_physical_argument(self):
        with self.assertRaises(ExpressionError):
            parse_expression("sinc(2m)")

    def test_reject_nonfinite_result(self):
        expression = parse_expression("sinc(z)", symbols={"z": DIMENSIONLESS})
        with self.assertRaises(ExpressionError):
            evaluate(expression, 0.0, 0.0, values={"z": float("nan")})


if __name__ == "__main__":
    unittest.main()
