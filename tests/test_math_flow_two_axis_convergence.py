"""Independent two-axis periodic derivative convergence checks."""
import unittest

import numpy as np

from src.math_flow_expr import evaluate, parse_expression


class TwoAxisConvergenceTests(unittest.TestCase):
    def test_y_derivative_refinement(self):
        expression = parse_expression("∂ᵧ(sin(2 * π * y / 1m))")
        self.assertEqual(expression.dimension, (-1, 0, 0, 0))
        errors = []
        for n in (32, 64, 128):
            x, y = np.meshgrid(
                np.arange(32, dtype=float) / 32,
                np.arange(n, dtype=float) / n,
                indexing="ij",
            )
            actual = evaluate(expression, x, y)
            expected = 2 * np.pi * np.cos(2 * np.pi * y)
            errors.append(float(np.max(np.abs(actual - expected))))
        self.assertGreater(errors[0] / errors[1], 3.8)
        self.assertGreater(errors[1] / errors[2], 3.8)

    def test_two_axis_laplacian_refinement(self):
        expression = parse_expression(
            "∇²(sin(2 * π * x / 1m) + cos(2 * π * y / 1m))"
        )
        self.assertEqual(expression.dimension, (-2, 0, 0, 0))
        errors = []
        for n in (32, 64, 128):
            x, y = np.meshgrid(
                np.arange(n, dtype=float) / n,
                np.arange(n, dtype=float) / n,
                indexing="ij",
            )
            actual = evaluate(expression, x, y)
            expected = -(2 * np.pi) ** 2 * (
                np.sin(2 * np.pi * x) + np.cos(2 * np.pi * y)
            )
            errors.append(float(np.max(np.abs(actual - expected))))
        self.assertGreater(errors[0] / errors[1], 3.8)
        self.assertGreater(errors[1] / errors[2], 3.8)


if __name__ == "__main__":
    unittest.main()
