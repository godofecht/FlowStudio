"""Independent analytic oracles for executable Unicode SI expressions.

These exercise the real typed parser and NumPy evaluator, not editor highlighting.
Run with PYTHONPATH=src python -m unittest tests/test_math_flow_dimensional_identities.py
"""
import unittest

import numpy as np

from math_flow_expr import ExpressionError, evaluate, parse_expression, DIMENSIONLESS


class DimensionalIdentityOracles(unittest.TestCase):
    def evaluate_scalar(self, source):
        ast = parse_expression(source)
        x = np.zeros((3, 3), dtype=float)
        y = np.zeros_like(x)
        return ast.dimension, np.asarray(evaluate(ast, x, y))

    def test_newton_second_law_derived_unit(self):
        dimension, value = self.evaluate_scalar("2kg × (3m / (1s)²) / 6N")
        self.assertEqual(dimension, DIMENSIONLESS)
        np.testing.assert_allclose(value, 1.0)

    def test_energy_power_time_identity(self):
        dimension, value = self.evaluate_scalar("12W ⋅ 3s / 36J")
        self.assertEqual(dimension, DIMENSIONLESS)
        np.testing.assert_allclose(value, 1.0)

    def test_frequency_period_identity(self):
        dimension, value = self.evaluate_scalar("4Hz ∙ (1s / 4)")
        self.assertEqual(dimension, DIMENSIONLESS)
        np.testing.assert_allclose(value, 1.0)

    def test_dose_energy_mass_identity(self):
        dimension, value = self.evaluate_scalar("8J ∕ 2kg / 4Gy")
        self.assertEqual(dimension, DIMENSIONLESS)
        np.testing.assert_allclose(value, 1.0)

    def test_dimensionally_invalid_energy_plus_power(self):
        with self.assertRaises(ExpressionError):
            parse_expression("1J + 1W")

    def test_dimensionally_invalid_frequency_plus_time(self):
        with self.assertRaises(ExpressionError):
            parse_expression("1Hz + 1s")


if __name__ == "__main__":
    unittest.main()
