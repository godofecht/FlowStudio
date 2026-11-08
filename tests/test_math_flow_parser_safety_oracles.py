"""Executable parser safety and analytic precedence regression oracles.

These tests use the actual mathematical expression AST and NumPy evaluator.
They do not claim support in the upstream Flow 2.0 grammar.
"""
import unittest

import numpy as np

from math_flow_expr import DIMENSIONLESS, ExpressionError, evaluate, parse_expression, tokenize


class MathematicalParserSafetyOracles(unittest.TestCase):
    def scalar(self, source):
        ast = parse_expression(source)
        grid = np.zeros((2, 3), dtype=float)
        return ast.dimension, np.asarray(evaluate(ast, grid, grid))

    def test_literal_integer_power_and_reject_nested_power(self):
        dimension, result = self.scalar("2^3")
        self.assertEqual(dimension, DIMENSIONLESS)
        np.testing.assert_allclose(result, 8.0)
        for source in ("2^3^2", "2^(3^2)", "2^9"):
            with self.subTest(source=source), self.assertRaises(ExpressionError):
                parse_expression(source)

    def test_reject_nested_power_exceeding_bounded_exponent(self):
        with self.assertRaisesRegex(ExpressionError, "between -8 and 8"):
            parse_expression("2^3^2")

    def test_unicode_division_and_multiplication_precedence(self):
        dimension, result = self.scalar("12 ∕ 3 ∙ 2 + 1")
        self.assertEqual(dimension, DIMENSIONLESS)
        np.testing.assert_allclose(result, 9.0)

    def test_parenthesized_dimensional_identity(self):
        dimension, result = self.scalar("(3N ∙ 4m) ∕ 12J")
        self.assertEqual(dimension, DIMENSIONLESS)
        np.testing.assert_allclose(result, 1.0)

    def test_reject_vector_cross_product_without_vector_ast(self):
        with self.assertRaises(ExpressionError):
            parse_expression("2 ⨯ 3")

    def test_reject_python_attribute_and_index_access(self):
        for source in ("x.__class__", "x[0]", "__import__('os')"):
            with self.subTest(source=source), self.assertRaises(ExpressionError):
                parse_expression(source)

    def test_reject_unbounded_expression_tokens(self):
        with self.assertRaises(ExpressionError):
            tokenize("+".join(["1"] * 130))

    def test_reject_incompatible_unit_comparison(self):
        with self.assertRaises(ExpressionError):
            parse_expression("where(1m < 1s, 2m, 3m)")

    def test_reject_unbound_predicate_as_scalar(self):
        with self.assertRaises(ExpressionError):
            parse_expression("1m == 1m")


if __name__ == "__main__":
    unittest.main()
