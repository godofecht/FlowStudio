"""Deterministic anisotropic manufactured-solution checks for Unicode ∆.

Run: python -m unittest discover -s tests -p test_math_flow_increment_convergence.py
Bound: largest grid 96 x 144; three finite-difference evaluations per grid.
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import ExpressionError, evaluate, parse_expression


class UnicodeLaplacianConvergenceTests(unittest.TestCase):
    @staticmethod
    def sample(nx, ny):
        # Deliberately non-square and unequal physical side lengths.
        lx, ly = 2.0, 3.0
        x, y = np.meshgrid(
            np.arange(nx, dtype=float) * lx / nx,
            np.arange(ny, dtype=float) * ly / ny,
            indexing="ij",
        )
        kx, ky = 2 * np.pi / lx, 4 * np.pi / ly
        f = np.sin(kx * x) + 0.35 * np.cos(ky * y)
        exact = -(kx ** 2) * np.sin(kx * x) - 0.35 * (ky ** 2) * np.cos(ky * y)
        return x, y, f, exact

    def test_second_order_anisotropic_refinement(self):
        symbols = {"ρ": (0, 0, 0, 0)}
        alias = parse_expression("∆ρ", symbols=symbols)
        canonical = parse_expression("∇²(ρ)", symbols=symbols)
        errors = []
        for nx, ny in ((24, 36), (48, 72), (96, 144)):
            with self.subTest(grid=(nx, ny)):
                x, y, field, exact = self.sample(nx, ny)
                a = evaluate(alias, x, y, values={"ρ": field})
                b = evaluate(canonical, x, y, values={"ρ": field})
                np.testing.assert_allclose(a, b, rtol=0, atol=1e-11)
                self.assertEqual(a.shape, (nx, ny))
                self.assertTrue(np.isfinite(a).all())
                self.assertLess(abs(float(np.mean(a))), 1e-11)
                # Repeated production evaluator invocation must be deterministic.
                np.testing.assert_array_equal(
                    a, evaluate(alias, x, y, values={"ρ": field})
                )
                errors.append(float(np.sqrt(np.mean((a - exact) ** 2))))
        self.assertGreater(errors[0], 1e-5)
        self.assertLess(errors[1], errors[0] / 3.7)
        self.assertLess(errors[2], errors[1] / 3.7)
        self.assertLess(errors[2], 0.002)

    def test_missing_binding_and_invalid_grid_fail_closed(self):
        expr = parse_expression("∆ρ", symbols={"ρ": (0, 0, 0, 0)})
        x, y, field, _ = self.sample(12, 18)
        with self.assertRaises(ExpressionError):
            evaluate(expr, x, y, values={})
        with self.assertRaises(ExpressionError):
            evaluate(expr, x, y[:, :-1], values={"ρ": field})
        with self.assertRaises(ExpressionError):
            evaluate(expr, x[::-1], y, values={"ρ": field[::-1]})
        with self.assertRaises(ExpressionError):
            evaluate(expr, x, y + np.nan, values={"ρ": field})


if __name__ == "__main__":
    unittest.main()
