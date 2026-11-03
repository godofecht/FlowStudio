"""Source-position regressions for mathematical Flow statement grouping."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import FlowMathError, lex, lines


class ParenthesisLocationTests(unittest.TestCase):
    def test_outer_opening_is_reported_after_inner_closes(self):
        with self.assertRaisesRegex(FlowMathError, r"1:5: unclosed parenthesized expression"):
            lines(lex("a = (\n  (b + c)\n"))

    def test_innermost_opening_is_reported(self):
        with self.assertRaisesRegex(FlowMathError, r"2:3: unclosed parenthesized expression"):
            lines(lex("a = (\n  (b + c\n"))

    def test_unmatched_closing_reports_location(self):
        with self.assertRaisesRegex(FlowMathError, r"2:1: unmatched closing parenthesis"):
            lines(lex("a = 1\n)"))

    def test_valid_multiline_nested_expression(self):
        self.assertEqual(lines(lex("a = (\n  (b + c)\n)\nd = 2")),
                         [["a", "=", "(", "(", "b", "+", "c", ")", ")"],
                          ["d", "=", "2"]])


if __name__ == "__main__":
    unittest.main()
