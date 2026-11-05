"""Regression: expected transcendental domain errors fail closed without NumPy warnings.

Run: python -m unittest discover -s tests -p 'test_math_flow_domain_warnings.py'
This exercises the bounded NumPy-backed mathematical frontend, not native flowc.
"""
import sys
import unittest
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import ExpressionError, evaluate, parse_expression


class DomainWarningTests(unittest.TestCase):
    def setUp(self):
        self.x, self.y = np.meshgrid(
            np.linspace(0.0, 1.0, 8),
            np.linspace(0.0, 1.0, 12),
            indexing="ij",
        )

    def test_singularities_reject_without_runtime_warning(self):
        for source in ("log(0)", "log1p(-1)", "atanh(1)", "atanh(-1)",
                       "log(-1)", "sqrt(-1)", "acosh(0)"):
            with self.subTest(source=source):
                expression = parse_expression(source)
                with warnings.catch_warnings():
                    warnings.simplefilter("error", RuntimeWarning)
                    with self.assertRaises(ExpressionError):
                        evaluate(expression, self.x, self.y)

    def test_finite_boundary_and_near_boundary_values(self):
        for source, expected in (
            ("log(1)", 0.0),
            ("log1p(0)", 0.0),
            ("atanh(0)", 0.0),
            ("sqrt(0)", 0.0),
            ("acosh(1)", 0.0),
        ):
            with self.subTest(source=source):
                expression = parse_expression(source)
                with warnings.catch_warnings():
                    warnings.simplefilter("error", RuntimeWarning)
                    actual = evaluate(expression, self.x, self.y)
                self.assertTrue(np.all(np.isfinite(actual)))
                self.assertAlmostEqual(float(actual), expected, places=12)


if __name__ == "__main__":
    unittest.main()
