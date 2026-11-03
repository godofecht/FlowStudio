"""Executable lexer/assignment regressions for multiline Unicode logic."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import lex, lines, assignments, FlowMathError


class UnicodeLogicalContinuationTests(unittest.TestCase):
    def test_each_operator_continues_assignment(self):
        for operator in ("∧", "∨", "⊻", "⇒", "⇔", "→", "↔"):
            with self.subTest(operator=operator):
                source = f"condition = a {operator}\n b\nother = 1\n"
                parsed = lines(lex(source))
                self.assertEqual(parsed, [
                    ["condition", "=", "a", operator, "b"],
                    ["other", "=", "1"],
                ])
                self.assertEqual(assignments(lex(source))["condition"],
                                 ["a", operator, "b"])

    def test_all_supported_newline_conventions(self):
        for newline in ("\n", "\r", "\r\n", "\u0085", "\u2028", "\u2029"):
            with self.subTest(newline=repr(newline)):
                source = f"condition = a →{newline}b{newline}other = 1"
                self.assertEqual(len(lines(lex(source))), 2)

    def test_no_continuation_without_operator(self):
        self.assertEqual(lines(lex("a = 1\nb = 2")),
                         [["a", "=", "1"], ["b", "=", "2"]])

    def test_invalid_character_still_rejected(self):
        with self.assertRaises(FlowMathError):
            lex("condition = a →\n b @ c")


if __name__ == "__main__":
    unittest.main()
