"""Executable multiline Unicode logic continuation regression tests."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import lex, lines, assignments, FlowMathError


class LeadingUnicodeOperatorTests(unittest.TestCase):
    def test_leading_unicode_operator_continues_assignment(self):
        for operator in ("∧", "∨", "⊻", "⇒", "⇔", "→", "↔"):
            with self.subTest(operator=operator):
                source = f"condition = a\n {operator} b\nother = 1"
                self.assertEqual(lines(lex(source)), [
                    ["condition", "=", "a", operator, "b"],
                    ["other", "=", "1"],
                ])
                self.assertEqual(assignments(lex(source))["condition"],
                                 ["a", operator, "b"])

    def test_leading_operator_all_newline_conventions(self):
        for newline in ("\n", "\r", "\r\n", "\u0085", "\u2028", "\u2029"):
            with self.subTest(newline=repr(newline)):
                source = f"condition = a{newline}→ b{newline}other = 1"
                self.assertEqual(len(lines(lex(source))), 2)

    def test_plain_lines_still_separate(self):
        self.assertEqual(lines(lex("a = 1\nb = 2")),
                         [["a", "=", "1"], ["b", "=", "2"]])

    def test_invalid_character_remains_rejected(self):
        with self.assertRaises(FlowMathError):
            lex("condition = a\n → @ b")


if __name__ == "__main__":
    unittest.main()
