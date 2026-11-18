"""Analytic regression coverage for dimension-aware residual diagnostics."""
import unittest

import numpy as np

from math_flow_expr import ExpressionError
from math_flow_system import parse_constraint_system
from math_flow_diagnostics import scaled_system_diagnostics


class ScaledDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.system = parse_constraint_system("x = 1m; 2s = 1s")

    def test_mixed_dimensions_use_independent_physical_scales(self):
        results = scaled_system_diagnostics(
            self.system, np.array([1.0, 1.1]), np.zeros(2),
            scales=(1.0, 100.0), tolerance=0.02,
        )
        self.assertNotEqual(results[0].dimension, results[1].dimension)
        self.assertAlmostEqual(results[0].normalized_max_abs, 0.1)
        self.assertAlmostEqual(results[1].normalized_max_abs, 0.01)
        self.assertFalse(results[0].satisfied)
        self.assertTrue(results[1].satisfied)

    def test_analytic_zero_residual(self):
        system = parse_constraint_system("x² = x*x")
        result, = scaled_system_diagnostics(
            system, np.linspace(-2.0, 2.0, 17), np.zeros(17), scales=(1.0,)
        )
        self.assertLess(result.normalized_max_abs, 1e-12)
        self.assertTrue(result.satisfied)

    def test_invalid_scales_and_tolerances(self):
        for scales in ((), (1.0,), (0.0, 1.0), (-1.0, 1.0),
                       (float("nan"), 1.0), (float("inf"), 1.0),
                       (True, 1.0)):
            with self.subTest(scales=scales), self.assertRaises(ExpressionError):
                scaled_system_diagnostics(self.system, 0.0, 0.0, scales=scales)
        for tolerance in (-1.0, float("nan"), float("inf")):
            with self.subTest(tolerance=tolerance), self.assertRaises(ExpressionError):
                scaled_system_diagnostics(
                    self.system, 0.0, 0.0, scales=(1.0, 1.0), tolerance=tolerance
                )

    def test_nonfinite_residual_rejected(self):
        with self.assertRaises(ExpressionError):
            scaled_system_diagnostics(
                self.system, np.array([float("nan")]), np.array([0.0]),
                scales=(1.0, 1.0),
            )


if __name__ == "__main__":
    unittest.main()
