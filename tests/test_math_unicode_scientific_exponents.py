"""Regression tests for Unicode minus signs in scientific notation."""
import unittest

from src.math_flow_expr import ExpressionError, parse_expression, tokenize


class UnicodeScientificExponentTests(unittest.TestCase):
    def test_unicode_minus_exponent(self):
        for source in ("1e−3", "1E−3", "2.5e−2", "1e-3"):
            with self.subTest(source=source):
                expression = parse_expression(source)
                self.assertEqual(expression.operator, "literal")
                self.assertAlmostEqual(float(expression.value),
                                       float(source.replace("−", "-")))

    def test_dimensional_unicode_exponent(self):
        expression = parse_expression("1e−3m/s")
        self.assertEqual(expression.dimension, (1, 0, -1, 0))
        self.assertAlmostEqual(float(expression.value), 0.001)

    def test_incomplete_unicode_exponent_rejected(self):
        for source in ("1e−", "1e−x", "1e−3e−"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    tokenize(source)


if __name__ == "__main__":
    unittest.main()
