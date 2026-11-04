"""Independent Fourier-symbol acceptance for executable mixed derivatives."""
from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow_expr import ExpressionError, evaluate, parse_expression


class MixedFourierDerivativeTest(unittest.TestCase):
    def test_mixed_derivative_exact_discrete_fourier_symbol(self):
        for n in (16, 32, 64):
            with self.subTest(grid=n):
                h = 1.0 / n
                coordinates = (np.arange(n, dtype=float) + 0.5) * h
                x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
                field = np.sin(2 * np.pi * x) * np.cos(4 * np.pi * y)
                expected = -(np.sin(2 * np.pi / n) * np.sin(4 * np.pi / n) / h**2) * np.cos(2 * np.pi * x) * np.sin(4 * np.pi * y)
                for source in ("∂ₓᵧ(u)", "∂ᵧₓ(u)", "∂ₓ(∂ᵧ(u))", "∂ᵧ(∂ₓ(u))"):
                    with self.subTest(expression=source):
                        expression = parse_expression(source, symbols={"u": (0, 0, 0, 1)})
                        self.assertEqual(expression.dimension, (-2, 0, 0, 1))
                        actual = evaluate(expression, x, y, values={"u": field})
                        np.testing.assert_allclose(actual, expected, rtol=1e-10, atol=1e-10)
                        self.assertLess(abs(float(np.mean(actual))), 1e-10)

    def test_mixed_derivative_rejects_incompatible_sum(self):
        with self.assertRaises(ExpressionError):
            parse_expression("∂ₓᵧ(u) + u", symbols={"u": (0, 0, 0, 1)})


if __name__ == "__main__":
    unittest.main()
