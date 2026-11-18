"""Analytic and dimensional regression tests for executable expm1 lowering."""
import unittest
import numpy as np
from math_flow_expr import DIMENSIONLESS, ExpressionError, parse_expression, evaluate


class Expm1NumericalTests(unittest.TestCase):
    def setUp(self):
        self.x = np.zeros((3, 3), dtype=float)
        self.y = np.zeros_like(self.x)

    def test_small_argument_retains_significant_digits(self):
        node = parse_expression("expm1(1e-12)")
        self.assertEqual(node.dimension, DIMENSIONLESS)
        np.testing.assert_allclose(evaluate(node, self.x, self.y),
                                   np.expm1(1e-12), rtol=1e-14, atol=0)

    def test_vectorized_analytic_oracle(self):
        field = np.array([[-2., -1., 0.], [0.25, 0.5, 1.], [2., 3., 4.]])
        node = parse_expression("expm1(z)", symbols={"z": DIMENSIONLESS})
        np.testing.assert_allclose(evaluate(node, self.x, self.y, values={"z": field}),
                                   np.expm1(field), rtol=1e-14, atol=0)

    def test_nested_expression(self):
        node = parse_expression("expm1(log1p(0.25))")
        np.testing.assert_allclose(evaluate(node, self.x, self.y), 0.25, rtol=1e-14)

    def test_reject_dimensioned_argument(self):
        with self.assertRaises(ExpressionError):
            parse_expression("expm1(2m)")

    def test_reject_nonfinite_result(self):
        node = parse_expression("expm1(1000)")
        with self.assertRaises(ExpressionError):
            evaluate(node, self.x, self.y)


if __name__ == "__main__":
    unittest.main()
