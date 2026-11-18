"""Executable regression tests for Unicode BULLET OPERATOR scalar multiplication.

The vector cross-product glyph is deliberately not an alias: tensor lowering
must implement its distinct semantics before it can be accepted.
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from math_flow_expr import ExpressionError, evaluate, parse_expression, tokenize


class UnicodeBulletOperatorTests(unittest.TestCase):
    def test_tokenization(self):
        self.assertEqual(tokenize("2 ∙ 3"), ("2", "∙", "3"))

    def test_evaluation_and_precedence(self):
        self.assertEqual(float(evaluate(parse_expression("2 + 3 ∙ 4"), 0, 0)), 14.0)
        self.assertEqual(float(evaluate(parse_expression("2 ∙ 3 + 4"), 0, 0)), 10.0)

    def test_dimensional_inference(self):
        expression = parse_expression("2m ∙ 3s")
        self.assertEqual(expression.dimension, (1, 0, 1, 0))
        self.assertEqual(float(evaluate(expression, 0, 0)), 6.0)

    def test_dimensional_mismatch_rejected(self):
        with self.assertRaises(ExpressionError):
            parse_expression("2m ∙ 3s + 1m")

    def test_vector_cross_not_silently_scalarized(self):
        with self.assertRaises(ExpressionError):
            parse_expression("2 ⨯ 3")


if __name__ == "__main__":
    unittest.main()
