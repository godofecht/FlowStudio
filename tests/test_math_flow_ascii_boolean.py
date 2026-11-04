"""Regression tests for executable ASCII predicate aliases in mathematical Flow."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from math_flow_expr import ExpressionError, parse_expression, tokenize


class AsciiBooleanOperatorsTests(unittest.TestCase):
    def test_tokenization_prefers_double_character_operators(self):
        self.assertEqual(
            tokenize("x < 1m && y >= 0m || x == y"),
            ("x", "<", "1m", "&&", "y", ">=", "0m", "||", "x", "==", "y"),
        )

    def test_ascii_unicode_ast_equivalence(self):
        ascii_expression = parse_expression("where(x < 1m && y >= 0m || x == y, 2m, 3m)")
        unicode_expression = parse_expression("where(x < 1m ∧ y ≥ 0m ∨ x == y, 2m, 3m)")
        self.assertEqual(ascii_expression, unicode_expression)

    def test_boolean_operators_reject_numeric_operands(self):
        for source in ("where(1 && x < 1m, 2m, 3m)", "where(x < 1m || 0, 2m, 3m)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)

    def test_predicates_cannot_escape_where(self):
        with self.assertRaises(ExpressionError):
            parse_expression("x < 1m && y > 0m")


if __name__ == "__main__":
    unittest.main()
