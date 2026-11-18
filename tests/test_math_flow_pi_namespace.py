"""Unicode mathematical constant namespace regression tests."""
import unittest

from src.math_flow_expr import DIMENSIONLESS, LENGTH, ExpressionError, parse_expression


class MathematicalConstantNamespaceTests(unittest.TestCase):
    def test_pi_is_a_reserved_constant_in_both_spellings(self):
        for spelling in ("pi", "π"):
            with self.subTest(spelling=spelling):
                with self.assertRaises(ExpressionError):
                    parse_expression(spelling, symbols={spelling: LENGTH})

    def test_pi_constant_remains_available(self):
        for spelling in ("pi", "π"):
            with self.subTest(spelling=spelling):
                expression = parse_expression(spelling)
                self.assertEqual(expression.operator, "name")
                self.assertEqual(expression.value, "pi")
                self.assertEqual(expression.dimension, DIMENSIONLESS)

    def test_other_typed_greek_symbols_remain_available(self):
        expression = parse_expression("ρ", symbols={"ρ": LENGTH})
        self.assertEqual(expression.value, "ρ")
        self.assertEqual(expression.dimension, LENGTH)


if __name__ == "__main__":
    unittest.main()
