"""Regression tests for balanced grouping in executable mathematical Flow statements."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import FlowMathError, lex, lines


class MathematicalFlowGroupingTest(unittest.TestCase):
    def test_multiline_parentheses_preserve_one_statement(self):
        for separator in ("\n", "\r\n", "\r", "\u0085", "\u2028", "\u2029"):
            with self.subTest(separator=repr(separator)):
                source = "a = (1 +" + separator + "2)" + separator + "b = 3"
                self.assertEqual(lines(lex(source)),
                                 [["a", "=", "(", "1", "+", "2", ")"],
                                  ["b", "=", "3"]])

    def test_unmatched_closing_parenthesis_fails_with_location(self):
        with self.assertRaisesRegex(FlowMathError, r"1:6: unmatched closing parenthesis"):
            lines(lex("a = 1)"))
        with self.assertRaisesRegex(FlowMathError, r"2:1: unmatched closing parenthesis"):
            lines(lex("a = 1\n)"))

    def test_unclosed_parenthesis_fails_closed(self):
        for source in ("a = (1 + 2", "a = (1 + (2 * 3)", "a = (\n 1 + 2"):
            with self.subTest(source=source):
                with self.assertRaisesRegex(FlowMathError, r"1:5: unclosed parenthesized expression"):
                    lines(lex(source))

    def test_balanced_nested_groups_and_operator_continuation(self):
        self.assertEqual(lines(lex("a = ((1 + 2) * 3)\nb = 4")),
                         [["a", "=", "(", "(", "1", "+", "2", ")", "*", "3", ")"],
                          ["b", "=", "4"]])


if __name__ == "__main__":
    unittest.main()
