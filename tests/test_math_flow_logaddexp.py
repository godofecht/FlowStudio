"""Executable stable logaddexp regression oracles for the typed mathematical AST."""
import unittest

import numpy as np

from src.math_flow_expr import DIMENSIONLESS, LENGTH, ExpressionError, evaluate, parse_expression


class LogAddExpTests(unittest.TestCase):
    def setUp(self):
        self.x = np.zeros((2, 3))
        self.y = np.zeros((2, 3))

    def test_stable_large_positive_and_negative_inputs(self):
        a = np.array([[1000., -1000., 0.], [800., -800., 2.]])
        b = np.array([[1001., -1001., 0.], [799., -799., -2.]])
        ast = parse_expression("logaddexp(a,b)", symbols={"a": DIMENSIONLESS, "b": DIMENSIONLESS})
        actual = evaluate(ast, self.x, self.y, values={"a": a, "b": b})
        expected = np.maximum(a, b) + np.log1p(np.exp(-np.abs(a - b)))
        np.testing.assert_allclose(actual, expected, rtol=1e-14, atol=1e-13)
        self.assertTrue(np.isfinite(actual).all())

    def test_broadcast_and_nested_expression(self):
        ast = parse_expression("logaddexp(a,log(2))", symbols={"a": DIMENSIONLESS})
        a = np.array([[-4., -2., 0.], [1., 2., 3.]])
        actual = evaluate(ast, self.x, self.y, values={"a": a})
        np.testing.assert_allclose(actual, np.log(np.exp(a) + 2), rtol=1e-14)

    def test_rejects_physical_dimensions(self):
        with self.assertRaises(ExpressionError):
            parse_expression("logaddexp(a,b)", symbols={"a": LENGTH, "b": LENGTH})
        with self.assertRaises(ExpressionError):
            parse_expression("logaddexp(a,b)", symbols={"a": LENGTH, "b": DIMENSIONLESS})

    def test_rejects_nonfinite_result(self):
        ast = parse_expression("logaddexp(a,b)", symbols={"a": DIMENSIONLESS, "b": DIMENSIONLESS})
        with self.assertRaises(ExpressionError):
            evaluate(ast, self.x, self.y, values={"a": np.inf, "b": 0.0})


if __name__ == "__main__":
    unittest.main()
