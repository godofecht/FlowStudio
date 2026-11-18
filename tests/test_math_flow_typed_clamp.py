"""Executable regression tests for dimension-checked clamp expressions."""
import unittest

import numpy as np

from src.math_flow_expr import ExpressionError, evaluate, parse_expression, TEMPERATURE, LENGTH


class TypedClampTests(unittest.TestCase):
    def test_scalar_clamp(self):
        expression = parse_expression("clamp(5, 1, 3)")
        self.assertEqual(float(evaluate(expression, 0, 0)), 3.0)

    def test_vectorized_clamp(self):
        expression = parse_expression("clamp(temperature, 273K, 300K)", symbols={"temperature": TEMPERATURE})
        result = evaluate(expression, 0, 0, values={"temperature": np.array([260.0, 280.0, 310.0])})
        np.testing.assert_array_equal(result, [273.0, 280.0, 300.0])
        self.assertEqual(expression.dimension, TEMPERATURE)

    def test_nested_arithmetic(self):
        expression = parse_expression("2 * clamp(3m, 1m, 2m)")
        self.assertEqual(expression.dimension, LENGTH)
        self.assertEqual(float(evaluate(expression, 0, 0)), 4.0)

    def test_incompatible_dimensions_rejected(self):
        with self.assertRaises(ExpressionError):
            parse_expression("clamp(3m, 1s, 5m)")

    def test_missing_argument_rejected(self):
        with self.assertRaises(ExpressionError):
            parse_expression("clamp(1, 2)")

    def test_inverted_bounds_rejected(self):
        expression = parse_expression("clamp(1, 4, 2)")
        with self.assertRaisesRegex(ExpressionError, "lower bound"):
            evaluate(expression, 0, 0)

    def test_vectorized_inverted_bounds_rejected(self):
        expression = parse_expression("clamp(temperature, lower, upper)", symbols={
            "temperature": TEMPERATURE, "lower": TEMPERATURE, "upper": TEMPERATURE})
        with self.assertRaisesRegex(ExpressionError, "lower bound"):
            evaluate(expression, 0, 0, values={
                "temperature": np.array([280.0, 290.0]),
                "lower": np.array([270.0, 300.0]),
                "upper": np.array([300.0, 290.0])})


if __name__ == "__main__":
    unittest.main()
