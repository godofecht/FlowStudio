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

    def test_ascii_negation_matches_unicode_ast(self):
        ascii_expression = parse_expression("where(!(x < 1m), 2m, 3m)")
        unicode_expression = parse_expression("where(¬(x < 1m), 2m, 3m)")
        self.assertEqual(ascii_expression, unicode_expression)
        self.assertEqual(tokenize("!(x < 1m)"), ("!", "(", "x", "<", "1m", ")"))

    def test_ascii_negation_rejects_numeric_operands_and_top_level_predicates(self):
        for source in ("where(!1, 2m, 3m)", "!(x < 1m)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)


    def test_ascii_implication_and_equivalence_match_unicode_ast(self):
        for ascii_source, unicode_source in (
            ("where((x < 1m) -> (y >= 0m), 2m, 3m)",
             "where((x < 1m) ⇒ (y ≥ 0m), 2m, 3m)"),
            ("where((x < 1m) <-> (y >= 0m), 2m, 3m)",
             "where((x < 1m) ⇔ (y ≥ 0m), 2m, 3m)"),
        ):
            with self.subTest(source=ascii_source):
                self.assertEqual(parse_expression(ascii_source), parse_expression(unicode_source))

    def test_ascii_arrows_tokenize_without_swallowing_comparisons(self):
        self.assertEqual(
            tokenize("x < 1m -> y >= 0m <-> x == y"),
            ("x", "<", "1m", "->", "y", ">=", "0m", "<->", "x", "==", "y"),
        )

    def test_ascii_arrows_reject_numerical_operands_and_unscoped_predicates(self):
        for source in (
            "where(1 -> (x < 1m), 2m, 3m)",
            "where((x < 1m) <-> 0, 2m, 3m)",
            "(x < 1m) -> (y > 0m)",
        ):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)

    def test_ascii_arrows_execute_independent_truth_tables(self):
        import numpy as np
        from math_flow_expr import evaluate

        x = np.array([0.0, 0.0, 2.0, 2.0])
        y = np.array([0.0, 2.0, 0.0, 2.0])
        cases = (
            ("where((x < 1m) -> (y < 1m), 2m, 3m)", [2.0, 3.0, 2.0, 2.0]),
            ("where((x < 1m) <-> (y < 1m), 2m, 3m)", [2.0, 3.0, 3.0, 2.0]),
        )
        for source, expected in cases:
            with self.subTest(source=source):
                actual = evaluate(parse_expression(source), x, y)
                np.testing.assert_array_equal(actual, expected)

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
