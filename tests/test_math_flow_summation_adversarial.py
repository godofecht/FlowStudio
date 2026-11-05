"""Adversarial finite-grid tests for the bounded discrete summation frontend.

Run: python -m unittest discover -s tests -p 'test_math_flow_summation_adversarial.py'
These tests do not claim native upstream flowc syntax support.
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import DIMENSIONLESS, LENGTH, ExpressionError, evaluate, parse_expression


class SummationAdversarialTests(unittest.TestCase):
    def setUp(self):
        self.x, self.y = np.meshgrid(
            (np.arange(32, dtype=np.float64) + 0.5) / 32,
            (np.arange(48, dtype=np.float64) + 0.5) / 48,
            indexing="ij",
        )
        self.symbols = {"φ": DIMENSIONLESS}

    def run_sum(self, source, field):
        expr = parse_expression(source, symbols=self.symbols)
        return float(evaluate(expr, self.x, self.y, values={"φ": field}))

    def test_unicode_ascii_and_replay_on_anisotropic_grid(self):
        rng = np.random.default_rng(20261105)
        field = rng.uniform(-0.25, 0.75, size=self.x.shape)
        expected = float(np.sum(field))
        for source in ("∑(φ)", "sum(φ)"):
            with self.subTest(source=source):
                first = self.run_sum(source, field)
                self.assertAlmostEqual(first, expected, delta=1e-11)
                self.assertEqual(first, self.run_sum(source, field))

    def test_large_finite_values_do_not_overflow_intermediate_reduction(self):
        field = np.full(self.x.shape, 1e200)
        actual = self.run_sum("∑(φ)", field)
        self.assertTrue(np.isfinite(actual))
        self.assertAlmostEqual(actual / 1e200, field.size, places=10)

    def test_zero_and_signed_cancellation(self):
        field = np.zeros(self.x.shape)
        self.assertEqual(self.run_sum("sum(φ)", field), 0.0)
        field[:, ::2] = 1e100
        field[:, 1::2] = -1e100
        self.assertAlmostEqual(self.run_sum("∑(φ)", field) / 1e100, 0.0, places=10)

    def test_discrete_sum_and_area_integral_have_distinct_units(self):
        discrete = parse_expression("∑(φ)", symbols={"φ": LENGTH})
        continuous = parse_expression("∫(φ)", symbols={"φ": LENGTH})
        self.assertEqual(discrete.dimension, LENGTH)
        self.assertEqual(continuous.dimension, (3, 0, 0, 0))
        field = np.full(self.x.shape, 2.0)
        self.assertEqual(float(evaluate(discrete, self.x, self.y, values={"φ": field})), 3072.0)
        self.assertAlmostEqual(float(evaluate(continuous, self.x, self.y, values={"φ": field})), 2.0)

    def test_nonfinite_overflow_missing_binding_and_empty_field_fail_closed(self):
        expr = parse_expression("∑(φ)", symbols=self.symbols)
        with self.assertRaises(ExpressionError):
            evaluate(expr, self.x, self.y)
        for field in (np.array([]), np.array([np.nan]), np.array([np.inf]),
                      np.full(self.x.shape, 1e308)):
            with self.subTest(shape=field.shape, value=field.flat[0] if field.size else None):
                with self.assertRaises(ExpressionError):
                    evaluate(expr, self.x, self.y, values={"φ": field})

    def test_malformed_reduction_and_dimension_mismatch_rejected(self):
        for source in ("∑()", "sum(", "∑(φ", "sum(φ, φ)", "∑(φ + 1m)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source, symbols=self.symbols)


if __name__ == "__main__":
    unittest.main()
