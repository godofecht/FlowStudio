"""Fail-closed scientific literal acceptance for the typed expression lexer."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import tokenize, ExpressionError


class TypedExpressionExponentTests(unittest.TestCase):
    def test_complete_exponents_are_single_quantity_tokens(self):
        for literal in ("1e2", "1.e-2", "1.E+2", ".5e3", "1e-2m"):
            with self.subTest(literal=literal):
                self.assertEqual(tokenize(literal), (literal,))

    def test_incomplete_exponents_are_not_split_into_identifiers(self):
        for literal in ("1e", "1E", "1e+", "1e-", "1.e", "1.E+", ".5e-"):
            with self.subTest(literal=literal):
                with self.assertRaisesRegex(ExpressionError, "Malformed scientific exponent"):
                    tokenize(literal)

    def test_regular_identifiers_remain_valid(self):
        self.assertEqual(tokenize("1 + energy"), ("1", "+", "energy"))


if __name__ == "__main__":
    unittest.main()
