"""Executable multiline arithmetic continuation regression tests."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import FlowMathError, assignments, lex, lines


class LeadingArithmeticContinuationTests(unittest.TestCase):
    def test_leading_binary_operators(self):
        for operator in ("+", "*", "/", "÷", "^", "·"):
            with self.subTest(operator=operator):
                source = f"result = a\n {operator} b\nother = 1"
                self.assertEqual(lines(lex(source)), [
                    ["result", "=", "a", operator, "b"],
                    ["other", "=", "1"],
                ])
                self.assertEqual(assignments(lex(source))["result"],
                                 ["a", operator, "b"])

    def test_all_newline_conventions(self):
        for newline in ("\n", "\r", "\r\n", "\u0085", "\u2028", "\u2029"):
            with self.subTest(newline=repr(newline)):
                self.assertEqual(len(lines(lex(
                    f"result = a{newline}+ b{newline}other = 1"
                ))), 2)

    def test_plain_statements_remain_separate(self):
        self.assertEqual(lines(lex("a = 1\nb = 2")),
                         [["a", "=", "1"], ["b", "=", "2"]])

    def test_invalid_character_is_not_hidden(self):
        with self.assertRaises(FlowMathError):
            lex("result = a\n + @ b")


if __name__ == "__main__":
    unittest.main()
