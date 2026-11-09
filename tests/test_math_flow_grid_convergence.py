"""Grid-refinement convergence tests for the executable periodic derivative runtime."""
import unittest

import numpy as np

from src.math_flow_expr import evaluate, parse_expression


class PeriodicConvergenceTests(unittest.TestCase):
    def test_first_derivative_second_order_convergence(self):
        expression = parse_expression("∂ₓ(sin(2 * π * x / 1m))")
        self.assertEqual(expression.dimension, (-1, 0, 0, 0))
        errors = []
        for n in (32, 64, 128):
            x, y = np.meshgrid(
                np.arange(n, dtype=float) / n,
                np.arange(32, dtype=float) / 32,
                indexing="ij",
            )
            actual = evaluate(expression, x, y)
            expected = 2 * np.pi * np.cos(2 * np.pi * x)
            errors.append(float(np.max(np.abs(actual - expected))))
        self.assertGreater(errors[0] / errors[1], 3.8)
        self.assertGreater(errors[1] / errors[2], 3.8)

    def test_laplacian_second_order_convergence(self):
        expression = parse_expression("∇²(sin(2 * π * x / 1m))")
        self.assertEqual(expression.dimension, (-2, 0, 0, 0))
        errors = []
        for n in (32, 64, 128):
            x, y = np.meshgrid(
                np.arange(n, dtype=float) / n,
                np.arange(32, dtype=float) / 32,
                indexing="ij",
            )
            actual = evaluate(expression, x, y)
            expected = -(2 * np.pi) ** 2 * np.sin(2 * np.pi * x)
            errors.append(float(np.max(np.abs(actual - expected))))
        self.assertGreater(errors[0] / errors[1], 3.8)
        self.assertGreater(errors[1] / errors[2], 3.8)


if __name__ == "__main__":
    unittest.main()
