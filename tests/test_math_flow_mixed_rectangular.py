"""Analytic checks for mixed periodic derivatives on anisotropic grids."""
import unittest

import numpy as np

from src.math_flow_expr import evaluate, parse_expression


class MixedDerivativeTests(unittest.TestCase):
    def test_mixed_derivative_on_rectangular_grid(self):
        expression = parse_expression("∂ₓᵧ(sin(2 * π * x / 1m) * cos(4 * π * y / 1m))")
        self.assertEqual(expression.dimension, (-2, 0, 0, 0))
        errors = []
        for nx, ny in ((32, 48), (64, 96), (128, 192)):
            x, y = np.meshgrid(
                np.arange(nx, dtype=float) / nx,
                np.arange(ny, dtype=float) / ny,
                indexing="ij",
            )
            actual = evaluate(expression, x, y)
            expected = -8 * np.pi ** 2 * np.cos(2 * np.pi * x) * np.sin(4 * np.pi * y)
            errors.append(float(np.max(np.abs(actual - expected))))
        self.assertGreater(errors[0] / errors[1], 3.5)
        self.assertGreater(errors[1] / errors[2], 3.5)


if __name__ == "__main__":
    unittest.main()
