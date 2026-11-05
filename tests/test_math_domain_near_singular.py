"""Near-singularity regression for the bounded mathematical Flow evaluator.

Run: python -m unittest discover -s tests -p 'test_math_domain_near_singular.py'
This is NumPy frontend coverage; native flowc/HTTP must be qualified separately.
"""
import sys
import unittest
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import ExpressionError, evaluate, parse_expression


class NearSingularityTests(unittest.TestCase):
    def setUp(self):
        self.x, self.y = np.meshgrid(
            np.linspace(0.0, 1.0, 9),
            np.linspace(0.0, 1.0, 13),
            indexing="ij",
        )

    def calculate(self, source):
        with warnings.catch_warnings():
            warnings.simplefilter("error", RuntimeWarning)
            return evaluate(parse_expression(source), self.x, self.y)

    def test_adjacent_finite_values(self):
        # All constants are representable IEEE-754 doubles, not rounded
        # decimal approximations to the singular point.
        cases = (
            ("log(0.0000000000000001)", np.log(1e-16)),
            ("log1p(-0.9999999999999999)", np.log1p(-0.9999999999999999)),
            ("atanh(0.9999999999999999)", np.arctanh(0.9999999999999999)),
            ("atanh(-0.9999999999999999)", np.arctanh(-0.9999999999999999)),
            ("acosh(1.0000000000000002)", np.arccosh(1.0000000000000002)),
        )
        for source, expected in cases:
            with self.subTest(source=source):
                actual = float(self.calculate(source))
                self.assertTrue(np.isfinite(actual))
                self.assertAlmostEqual(actual, float(expected), delta=1e-11)
                self.assertEqual(actual, float(self.calculate(source)))

    def test_exact_singular_points_fail_without_warning(self):
        for source in ("log(0)", "log1p(-1)", "atanh(1)", "atanh(-1)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    self.calculate(source)


if __name__ == "__main__":
    unittest.main()
