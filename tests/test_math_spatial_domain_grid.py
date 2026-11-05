"""Spatially varying mathematical Flow domain regression.

Run: python -m unittest discover -s tests -p 'test_math_spatial_domain_grid.py'
This exercises the production bounded expression parser/evaluator, not native flowc.
"""
import sys
import unittest
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import ExpressionError, evaluate, parse_expression


class SpatialDomainGridTests(unittest.TestCase):
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

    def test_spatially_varying_domain_functions(self):
        cases = (
            ("log1p(x/1m)", np.log1p(self.x)),
            ("atanh(x/2m)", np.arctanh(self.x / 2.0)),
            ("acosh(1+x/1m)", np.arccosh(1.0 + self.x)),
            ("log(1+x/1m)", np.log(1.0 + self.x)),
        )
        for source, expected in cases:
            with self.subTest(source=source):
                actual = self.calculate(source)
                self.assertEqual(actual.shape, (9, 13))
                np.testing.assert_allclose(actual, expected, rtol=2e-14, atol=2e-14)
                self.assertGreater(float(np.ptp(actual)), 0.1)
                np.testing.assert_array_equal(actual, self.calculate(source))

    def test_exact_singularity_in_one_grid_row_rejects_entire_result(self):
        # A single invalid row must not be silently replaced with NaN/Inf.
        for source in ("log(x/1m)", "atanh(x/1m)", "acosh(x/1m)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    self.calculate(source)

    def test_negative_domain_crossing_rejects_entire_result(self):
        for source in ("log(x/1m-0.5)", "log1p(x/1m-1.5)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    self.calculate(source)

    def test_dimensionally_invalid_argument_rejected(self):
        for source in ("log(x)", "atanh(x)", "acosh(x)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    self.calculate(source)


if __name__ == "__main__":
    unittest.main()
