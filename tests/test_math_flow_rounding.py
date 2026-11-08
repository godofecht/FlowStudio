"""Native mathematical expression regression tests for rounding and sign."""
import unittest
import numpy as np
from math_flow_expr import DIMENSIONLESS, ExpressionError, evaluate, parse_expression


class RoundingFunctionOracles(unittest.TestCase):
    def scalar(self, source):
        ast = parse_expression(source)
        grid = np.zeros((3, 3), dtype=float)
        return ast.dimension, np.asarray(evaluate(ast, grid, grid))

    def test_floor_preserves_dimension(self):
        dimension, result = self.scalar("floor(2.9m)")
        self.assertEqual(dimension, (1, 0, 0, 0))
        np.testing.assert_allclose(result, 2)

    def test_ceil_preserves_dimension(self):
        dimension, result = self.scalar("ceil(−2.1K)")
        self.assertEqual(dimension, (0, 0, 0, 1))
        np.testing.assert_allclose(result, -2)

    def test_sign_returns_dimensionless(self):
        for source, expected in (("sign(−4m)", -1), ("sign(0m)", 0), ("sign(5m)", 1)):
            with self.subTest(source=source):
                dimension, result = self.scalar(source)
                self.assertEqual(dimension, DIMENSIONLESS)
                np.testing.assert_allclose(result, expected)

    def test_dimensional_rejection(self):
        with self.assertRaises(ExpressionError):
            parse_expression("floor(1m) + ceil(1s)")

    def test_nested_rounding_and_sign(self):
        dimension, result = self.scalar("sign(floor(−2.2m))")
        self.assertEqual(dimension, DIMENSIONLESS)
        np.testing.assert_allclose(result, -1)


if __name__ == "__main__":
    unittest.main()
