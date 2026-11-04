"""Executable Greek typed-variable acceptance for the mathematical Flow AST."""
import unittest

import numpy as np

from src.math_flow_expr import (
    DIMENSIONLESS, LENGTH, ExpressionError, evaluate, parse_expression, tokenize,
)


class GreekTypedSymbolsTests(unittest.TestCase):
    def test_unicode_tokenization_and_dimension(self):
        self.assertEqual(tokenize("ρ × α + β"), ("ρ", "×", "α", "+", "β"))
        ast = parse_expression("ρ × α + β", symbols={
            "ρ": LENGTH, "α": DIMENSIONLESS, "β": LENGTH,
        })
        self.assertEqual(ast.dimension, LENGTH)
        x = np.arange(12, dtype=float).reshape(3, 4)
        y = np.zeros_like(x)
        actual = evaluate(ast, x, y, values={"ρ": x, "α": 2., "β": 3.})
        np.testing.assert_allclose(actual, 2 * x + 3)

    def test_implicit_product(self):
        symbols = {"α": DIMENSIONLESS, "β": DIMENSIONLESS}
        ast = parse_expression("αβ", symbols=symbols)
        result = evaluate(ast, np.zeros((2, 2)), np.zeros((2, 2)),
                          values={"α": 4., "β": 5.})
        np.testing.assert_allclose(result, 20.)

    def test_incompatible_dimensions_rejected(self):
        with self.assertRaises(ExpressionError):
            parse_expression("ρ + α", symbols={"ρ": LENGTH, "α": DIMENSIONLESS})

    def test_missing_value_rejected(self):
        ast = parse_expression("ρ", symbols={"ρ": LENGTH})
        with self.assertRaises(ExpressionError):
            evaluate(ast, np.zeros((2, 2)), np.zeros((2, 2)))


if __name__ == "__main__":
    unittest.main()
