"""Analytic periodic PDE stencil oracles for the executable mathematical AST.

These tests evaluate actual NumPy lowering, not editor-only syntax.
"""
import unittest

import numpy as np

from src.math_flow_expr import DIMENSIONLESS, ExpressionError, evaluate, parse_expression


class PeriodicDerivativeOracles(unittest.TestCase):
    def setUp(self):
        self.nx, self.ny = 96, 80
        self.x, self.y = np.meshgrid(
            np.arange(self.nx, dtype=float) / self.nx,
            np.arange(self.ny, dtype=float) / self.ny,
            indexing="ij",
        )
        self.k = 2 * np.pi
        self.field_source = "sin(2 * π * x / 1m) * cos(2 * π * y / 1m)"
        self.field = np.sin(self.k * self.x) * np.cos(self.k * self.y)

    def check(self, source, oracle, dimension, tolerance=0.004):
        tree = parse_expression(source)
        self.assertEqual(tree.dimension, dimension)
        actual = evaluate(tree, self.x, self.y)
        self.assertEqual(actual.shape, self.x.shape)
        self.assertLess(
            np.max(np.abs(actual - oracle)) / max(1.0, np.max(np.abs(oracle))),
            tolerance,
        )

    def test_first_derivatives_against_analytic_modes(self):
        self.check(
            f"∂ₓ({self.field_source})",
            self.k * np.cos(self.k * self.x) * np.cos(self.k * self.y),
            (-1, 0, 0, 0),
        )
        self.check(
            f"∂ᵧ({self.field_source})",
            -self.k * np.sin(self.k * self.x) * np.sin(self.k * self.y),
            (-1, 0, 0, 0),
        )

    def test_laplacian_and_second_derivatives(self):
        self.check(f"∂ₓ²({self.field_source})", -self.k**2 * self.field, (-2, 0, 0, 0))
        self.check(f"∂ᵧ²({self.field_source})", -self.k**2 * self.field, (-2, 0, 0, 0))
        self.check(f"∇²({self.field_source})", -2 * self.k**2 * self.field, (-2, 0, 0, 0))

    def test_mixed_derivative_symmetry_and_analytic_oracle(self):
        expected = -self.k**2 * np.cos(self.k * self.x) * np.sin(self.k * self.y)
        self.check(f"∂ₓᵧ({self.field_source})", expected, (-2, 0, 0, 0))
        first = evaluate(parse_expression(f"∂ₓᵧ({self.field_source})"), self.x, self.y)
        second = evaluate(parse_expression(f"∂ᵧₓ({self.field_source})"), self.x, self.y)
        np.testing.assert_allclose(first, second, rtol=0, atol=0)

    def test_integral_of_periodic_mode_is_zero(self):
        self.check(f"∫({self.field_source})", 0.0, (2, 0, 0, 0), tolerance=1e-12)

    def test_derivative_rejects_non_cartesian_grid(self):
        sheared = self.x + 0.01 * self.y
        with self.assertRaises(ExpressionError):
            evaluate(parse_expression(f"∂ₓ({self.field_source})"), sheared, self.y)


if __name__ == "__main__":
    unittest.main()
