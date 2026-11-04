"""Manufactured analytic fields through the executable Greek scalar AST."""

import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import DIMENSIONLESS, LENGTH, ExpressionError, evaluate, parse_expression


class GreekManufacturedFieldTests(unittest.TestCase):
    def test_periodic_field_on_rectangular_mesh(self):
        x = np.linspace(0.0, 1.0, 24, endpoint=False)[:, None]
        y = np.linspace(0.0, 1.0, 40, endpoint=False)[None, :]
        expr = parse_expression(
            "Α*sin(2πx) + β*cos(2πy)",
            symbols={"Α": DIMENSIONLESS, "β": DIMENSIONLESS},
        )
        actual = evaluate(expr, x, y, values={"Α": 2.5, "β": -0.75})
        expected = 2.5 * np.sin(2 * math.pi * x) - 0.75 * np.cos(2 * math.pi * y)
        np.testing.assert_allclose(actual, expected, rtol=1e-12, atol=1e-12)
        self.assertEqual(actual.shape, (24, 40))

    def test_dimensional_linear_combination_on_mesh(self):
        x = np.linspace(0.0, 1.0, 12, endpoint=False)[:, None]
        y = np.linspace(0.0, 1.0, 20, endpoint=False)[None, :]
        expr = parse_expression("Δ + Σ*ς", symbols={
            "Δ": LENGTH, "Σ": LENGTH, "ς": DIMENSIONLESS,
        })
        self.assertEqual(expr.dimension, LENGTH)
        actual = evaluate(expr, x, y, values={
            "Δ": np.broadcast_to(x, (12, 20)),
            "Σ": np.broadcast_to(y, (12, 20)),
            "ς": 3.0,
        })
        np.testing.assert_allclose(actual, x + 3.0 * y, rtol=1e-12, atol=1e-12)

    def test_incompatible_greek_dimensions_rejected(self):
        with self.assertRaises(ExpressionError):
            parse_expression("Δ + β", symbols={"Δ": LENGTH, "β": DIMENSIONLESS})


if __name__ == "__main__":
    unittest.main()
