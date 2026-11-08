"""Native mathematical expression regression tests for Unicode arithmetic aliases."""
import unittest

import numpy as np

from src.math_flow_expr import ExpressionError, evaluate, parse_expression, tokenize


class UnicodeArithmeticAliasTests(unittest.TestCase):
    def test_multiplication_aliases_execute(self):
        for source in ("2⋅3", "2∗3", "2×3", "2·3"):
            with self.subTest(source=source):
                expression = parse_expression(source)
                self.assertEqual(expression.operator, "mul")
                self.assertEqual(float(evaluate(expression, 0.0, 0.0)), 6.0)

    def test_division_slash_executes(self):
        expression = parse_expression("12∕3")
        self.assertEqual(expression.operator, "div")
        self.assertEqual(float(evaluate(expression, 0.0, 0.0)), 4.0)

    def test_dimension_inference(self):
        expression = parse_expression("6m⋅2m∕3s")
        self.assertEqual(expression.dimension, (2, 0, -1, 0))
        self.assertAlmostEqual(float(evaluate(expression, 0.0, 0.0)), 4.0)

    def test_operator_precedence(self):
        expression = parse_expression("2+3⋅4∕2")
        self.assertAlmostEqual(float(evaluate(expression, 0.0, 0.0)), 8.0)

    def test_dimension_mismatch_rejected(self):
        with self.assertRaises(ExpressionError):
            parse_expression("2m+3s")

    def test_tokenizer_keeps_unicode_operators(self):
        self.assertEqual(tokenize("2⋅3∗4∕5"), ("2", "⋅", "3", "∗", "4", "∕", "5"))


if __name__ == "__main__":
    unittest.main()
