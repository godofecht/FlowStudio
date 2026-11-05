"""Executable discrete summation syntax and dimensional semantics."""

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import LENGTH, DIMENSIONLESS, ExpressionError, evaluate, parse_expression


class DiscreteSummationTests(unittest.TestCase):
    def setUp(self):
        self.x, self.y = np.meshgrid(
            np.arange(8, dtype=float) / 8,
            np.arange(12, dtype=float) / 12,
            indexing="ij",
        )

    def test_unicode_and_ascii_lower_to_identical_ast(self):
        unicode_expression = parse_expression("∑(φ)", symbols={"φ": LENGTH})
        ascii_expression = parse_expression("sum(φ)", symbols={"φ": LENGTH})
        self.assertEqual(unicode_expression, ascii_expression)
        self.assertEqual(unicode_expression.operator, "sum")
        self.assertEqual(unicode_expression.dimension, LENGTH)
        field = 2 * self.x + self.y
        actual = evaluate(unicode_expression, self.x, self.y, values={"φ": field})
        self.assertAlmostEqual(float(actual), float(np.sum(field)), places=12)

    def test_sum_is_not_area_integral(self):
        total = evaluate(parse_expression("∑(1)"), self.x, self.y)
        integral = evaluate(parse_expression("∫(1)"), self.x, self.y)
        self.assertEqual(float(total), 1.0)
        self.assertAlmostEqual(float(integral), 1.0)

    def test_grid_field_sum_and_superposition(self):
        field = np.sin(2 * np.pi * self.x) + 3
        expression = parse_expression("sum(φ + 2m)", symbols={"φ": LENGTH})
        self.assertEqual(expression.dimension, LENGTH)
        result = evaluate(expression, self.x, self.y, values={"φ": field})
        self.assertAlmostEqual(float(result), float(np.sum(field + 2)), places=10)

    def test_nonfinite_and_missing_values_rejected(self):
        expression = parse_expression("∑(φ)", symbols={"φ": DIMENSIONLESS})
        with self.assertRaises(ExpressionError):
            evaluate(expression, self.x, self.y)
        with self.assertRaises(ExpressionError):
            evaluate(expression, self.x, self.y, values={"φ": np.array([np.inf])})

    def test_sum_is_discrete_not_spatial_area_quadrature(self):
        field = np.ones((8, 12))
        expression = parse_expression("∑(φ)", symbols={"φ": DIMENSIONLESS})
        self.assertEqual(float(evaluate(expression, self.x, self.y, values={"φ": field})), 96.0)


if __name__ == "__main__":
    unittest.main()
