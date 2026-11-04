"""Analytic Fourier eigenmode acceptance for the executable spatial AST.

The periodic five-point Laplacian has a known discrete eigenvalue. This
test distinguishes actual numerical lowering from syntax-only acceptance.
"""
from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow_expr import DIMENSIONLESS, ExpressionError, evaluate, parse_expression


class FourierEigenmodeTest(unittest.TestCase):
    def test_periodic_laplacian_discrete_eigenvalue(self):
        for n in (16, 32, 64):
            with self.subTest(grid=n):
                h = 1.0 / n
                coordinates = (np.arange(n, dtype=float) + 0.5) * h
                x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
                field = np.sin(2 * np.pi * x) * np.cos(4 * np.pi * y)
                expression = parse_expression("∇²(u)", symbols={"u": DIMENSIONLESS})
                actual = evaluate(expression, x, y, values={"u": field})
                eigenvalue = (2 * np.cos(2 * np.pi / n) +
                              2 * np.cos(4 * np.pi / n) - 4) / (h * h)
                np.testing.assert_allclose(actual, eigenvalue * field,
                                           rtol=1e-10, atol=1e-10)
                self.assertLess(abs(float(np.mean(actual))), 1e-10)

    def test_derivative_dimensions_are_inferred(self):
        expression = parse_expression("∇²(u)", symbols={"u": (0, 0, 0, 1)})
        self.assertEqual(expression.dimension, (-2, 0, 0, 1))
        with self.assertRaises(ExpressionError):
            parse_expression("∇²(u) + u", symbols={"u": (0, 0, 0, 1)})


if __name__ == "__main__":
    unittest.main()
