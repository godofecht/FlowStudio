"""Metamorphic numerical oracles for executable typed logaddexp lowering."""
import math
import unittest

import numpy as np

from src.math_flow_expr import DIMENSIONLESS, LENGTH, ExpressionError, evaluate, parse_expression


class LogaddexpMetamorphicTests(unittest.TestCase):
    def setUp(self):
        self.x = np.zeros((3, 4), dtype=float)
        self.y = np.zeros((3, 4), dtype=float)

    def compute(self, source, **values):
        expression = parse_expression(
            source, symbols={name: DIMENSIONLESS for name in values}
        )
        self.assertEqual(expression.dimension, DIMENSIONLESS)
        return evaluate(expression, self.x, self.y, values=values)

    def test_symmetry_and_translation(self):
        a = np.array([-700., -20., 0., 20., 700.])
        b = np.array([700., 20., 0., -20., -700.])
        for offset in (-100., 0., 100.):
            actual = self.compute("logaddexp(a + c, b + c)", a=a, b=b, c=offset)
            expected = self.compute("logaddexp(b, a)", a=a, b=b) + offset
            np.testing.assert_allclose(actual, expected, rtol=2e-14, atol=2e-12)

    def test_independent_stable_analytic_oracle(self):
        a = np.array([-1000., -1., 0., 1., 1000.])
        b = np.array([1000., 1., 0., -1., -1000.])
        expected = np.maximum(a, b) + np.log1p(np.exp(-np.abs(a - b)))
        np.testing.assert_allclose(
            self.compute("logaddexp(a,b)", a=a, b=b),
            expected, rtol=2e-14, atol=2e-12
        )

    def test_units_rejected_even_when_matching(self):
        with self.assertRaises(ExpressionError):
            parse_expression("logaddexp(a,b)", symbols={"a": LENGTH, "b": LENGTH})


if __name__ == "__main__":
    unittest.main()
