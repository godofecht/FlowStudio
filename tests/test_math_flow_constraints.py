"""Analytic acceptance for executable, dimension-checked scalar constraints."""
import unittest

import numpy as np

from math_flow_constraints import parse_constraint, constraint_residual
from math_flow_expr import ExpressionError


class ScalarConstraintTests(unittest.TestCase):
    def test_analytic_identity(self):
        x = np.linspace(-1.0, 1.0, 17)
        y = np.zeros_like(x)
        equation = parse_constraint("x² + 2m*x + 1m² = (x + 1m)²")
        np.testing.assert_allclose(constraint_residual(equation, x, y), 0, atol=1e-12)

    def test_nonzero_residual(self):
        x = np.linspace(0.0, 1.0, 9)
        equation = parse_constraint("x + 1m = 2m")
        np.testing.assert_allclose(constraint_residual(equation, x, x), x - 1.0)

    def test_dimension_mismatch(self):
        with self.assertRaises(ExpressionError):
            parse_constraint("x = 1s")

    def test_comparison_and_chained_equality_rejected(self):
        for source in ("x == y", "x = y = x", "x >= y", "= x", "x ="):
            with self.subTest(source=source), self.assertRaises(ExpressionError):
                parse_constraint(source)


if __name__ == "__main__":
    unittest.main()
