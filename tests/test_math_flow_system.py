"""Analytic tests for executable mathematical constraint systems."""
import unittest

import numpy as np

from math_flow_expr import ExpressionError
from math_flow_system import (
    parse_constraint_system,
    system_max_abs_residual,
    system_residuals,
)


class ConstraintSystemTests(unittest.TestCase):
    def test_two_independent_analytic_identities(self):
        x = np.linspace(-1.0, 1.0, 17)
        y = np.zeros_like(x)
        system = parse_constraint_system(
            "x² + 2m*x + 1m² = (x + 1m)²; x + 1m = 1m + x"
        )
        residuals = system_residuals(system, x, y)
        self.assertEqual(len(residuals), 2)
        for residual in residuals:
            np.testing.assert_allclose(residual, 0.0, atol=1e-12)
        self.assertTrue(all(error < 1e-12 for error in system_max_abs_residual(system, x, y)))

    def test_nonzero_residual_is_not_hidden(self):
        x = np.linspace(0.0, 1.0, 9)
        system = parse_constraint_system("x = 1m; x = x")
        first, second = system_residuals(system, x, x)
        np.testing.assert_allclose(first, x - 1.0)
        np.testing.assert_allclose(second, 0.0)
        self.assertAlmostEqual(system_max_abs_residual(system, x, x)[0], 1.0)

    def test_rejects_malformed_and_unbounded_systems(self):
        invalid = ("", ";", "x = x;", ";x = x", "x = x;;x = x",
                   "x = 1s", "x = x;" * 33)
        for source in invalid:
            with self.subTest(source=source[:40]), self.assertRaises(ExpressionError):
                parse_constraint_system(source)

    def test_different_dimensions_remain_separate(self):
        system = parse_constraint_system("x = x; 1s = 1s")
        self.assertNotEqual(system.equations[0].dimension, system.equations[1].dimension)
        self.assertEqual(len(system_residuals(system, np.array([0.0]), np.array([0.0]))), 2)

    def test_nonfinite_residual_rejected_by_summary(self):
        system = parse_constraint_system("x = 0m")
        with self.assertRaises(ExpressionError):
            system_max_abs_residual(system, np.array([np.nan]), np.array([0.0]))


if __name__ == "__main__":
    unittest.main()
