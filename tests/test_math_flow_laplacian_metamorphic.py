"""Metamorphic checks for the bounded mathematical Flow Laplacian evaluator.

Run: python -m unittest discover -s tests -p test_math_flow_laplacian_metamorphic.py
Resource bound: 48 x 72 cells, fewer than 20 stencil evaluations.
These are NumPy-backed mathematical frontend tests, NOT native flowc tests.
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import ExpressionError, evaluate, parse_expression


class LaplacianMetamorphicTests(unittest.TestCase):
    @staticmethod
    def grid():
        nx, ny = 48, 72
        x, y = np.meshgrid(
            np.arange(nx, dtype=float) * (2.0 / nx),
            np.arange(ny, dtype=float) * (3.0 / ny),
            indexing="ij",
        )
        return x, y

    def test_linearity_constant_nullspace_and_periodic_equivariance(self):
        x, y = self.grid()
        a = np.sin(np.pi * x) + 0.25 * np.cos(4 * np.pi * y / 3)
        b = np.cos(2 * np.pi * x) * np.sin(2 * np.pi * y / 3)
        symbols = {"ρ": (0, 0, 0, 0)}
        expr = parse_expression("∆ρ", symbols=symbols)

        def lap(field):
            return evaluate(expr, x, y, values={"ρ": field})

        la, lb = lap(a), lap(b)
        np.testing.assert_allclose(lap(2.0 * a - 0.75 * b),
                                   2.0 * la - 0.75 * lb,
                                   rtol=0, atol=2e-10)
        np.testing.assert_allclose(lap(np.full(a.shape, 7.0)), 0.0,
                                   rtol=0, atol=1e-11)
        np.testing.assert_allclose(lap(a + 7.0), la,
                                   rtol=0, atol=2e-10)
        np.testing.assert_allclose(lap(np.roll(a, (7, -11), axis=(0, 1))),
                                   np.roll(la, (7, -11), axis=(0, 1)),
                                   rtol=0, atol=2e-10)
        self.assertLess(abs(float(np.sum(la))), 1e-9)
        np.testing.assert_array_equal(la, lap(a))

    def test_negative_nonfinite_field_and_invalid_coordinates(self):
        x, y = self.grid()
        expr = parse_expression("∆ρ", symbols={"ρ": (0, 0, 0, 0)})
        field = np.zeros(x.shape)
        for bad_x, bad_y in ((x * 0, y), (x, y * 0), (x, y + np.inf)):
            with self.subTest(kind="grid"):
                with self.assertRaises(ExpressionError):
                    evaluate(expr, bad_x, bad_y, values={"ρ": field})
        with self.assertRaises(ExpressionError):
            evaluate(expr, x, y, values={})


if __name__ == "__main__":
    unittest.main()
