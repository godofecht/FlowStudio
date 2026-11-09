"""Vectorized analytic oracles for the executable typed mathematical AST."""
import unittest

import numpy as np

from src.math_flow_expr import DIMENSIONLESS, LENGTH, ExpressionError, evaluate, parse_expression


class VectorizedAnalyticOracles(unittest.TestCase):
    def setUp(self):
        self.x = np.zeros((4, 5), dtype=float)
        self.y = np.zeros_like(self.x)
        self.z = np.array([
            [-1e-10, -1e-8, -0.25, 0.0, 1e-12],
            [0.125, 0.5, 1.0, 2.0, 3.0],
            [-0.5, -0.1, 0.25, 0.75, 1.5],
            [1e-9, -1e-9, 0.01, -0.01, 4.0],
        ])

    def test_logarithmic_inverse_on_entire_field(self):
        expression = parse_expression("log1p(expm1(z))", symbols={"z": DIMENSIONLESS})
        actual = evaluate(expression, self.x, self.y, values={"z": self.z})
        np.testing.assert_allclose(actual, self.z, rtol=2e-13, atol=2e-15)
        self.assertEqual(np.shape(actual), self.z.shape)

    def test_sinc_field_against_independent_series_and_trigonometry(self):
        expression = parse_expression("sinc(z)", symbols={"z": DIMENSIONLESS})
        actual = evaluate(expression, self.x, self.y, values={"z": self.z})
        expected = np.empty_like(self.z)
        small = np.abs(self.z) < 1e-4
        q = self.z[small] ** 2
        expected[small] = 1 - q / 6 + q * q / 120
        expected[~small] = np.sin(self.z[~small]) / self.z[~small]
        np.testing.assert_allclose(actual, expected, rtol=2e-13, atol=2e-15)
        self.assertTrue(np.isfinite(actual).all())

    def test_dimension_checks_apply_to_vector_symbols(self):
        with self.assertRaises(ExpressionError):
            parse_expression("sinc(z)", symbols={"z": LENGTH})
        with self.assertRaises(ExpressionError):
            parse_expression("log1p(z)", symbols={"z": LENGTH})


if __name__ == "__main__":
    unittest.main()
