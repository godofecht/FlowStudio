"""ASCII comparison aliases must compile through the executable typed AST."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import parse_expression, tokenize, ExpressionError


class AsciiComparisonTests(unittest.TestCase):
    def test_ascii_aliases_are_single_tokens(self):
        self.assertEqual(tokenize("x <= 2m"), ("x", "<=", "2m"))
        self.assertEqual(tokenize("x >= 2m"), ("x", ">=", "2m"))

    def test_aliases_lower_to_same_typed_ast(self):
        for ascii_op, unicode_op, expected in (("<=", "≤", "le"), (">=", "≥", "ge")):
            with self.subTest(operator=ascii_op):
                ascii_ast = parse_expression(f"where(x {ascii_op} 2m, 1m, 3m)")
                unicode_ast = parse_expression(f"where(x {unicode_op} 2m, 1m, 3m)")
                self.assertEqual(ascii_ast, unicode_ast)
                self.assertEqual(ascii_ast.operands[0].operator, expected)

    def test_mismatched_dimensions_fail_closed(self):
        for operator in ("<=", ">="):
            with self.subTest(operator=operator):
                with self.assertRaisesRegex(ExpressionError, "matching physical dimensions"):
                    parse_expression(f"where(x {operator} 2s, 1m, 3m)")

    def test_chained_comparisons_remain_unsupported(self):
        with self.assertRaises(ExpressionError):
            parse_expression("where(x <= 2m >= 1m, 1m, 3m)")


if __name__ == "__main__":
    unittest.main()
