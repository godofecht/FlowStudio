"""Executable leading-decimal literal regression tests for mathematical Flow."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import FlowMathError, assignments, lex, number


class LeadingDecimalLiteralTests(unittest.TestCase):
    def test_leading_decimal_and_scientific_notation(self):
        for literal, expected in ((".5", 0.5), (".125e2", 12.5),
                                  (".5E-2", 0.005), ("0.5", 0.5),
                                  ("1e-3", 0.001)):
            with self.subTest(literal=literal):
                self.assertEqual([token.text for token in lex(literal)], [literal])
                self.assertAlmostEqual(number([literal]), expected)

    def test_assignment_preserves_literal(self):
        for newline in ("\n", "\r", "\r\n", "\u0085", "\u2028", "\u2029"):
            with self.subTest(newline=repr(newline)):
                parsed = assignments(lex(f"alpha = .5e-2{newline}beta = .25"))
                self.assertEqual(parsed["alpha"], [".5e-2"])
                self.assertEqual(parsed["beta"], [".25"])

    def test_decimal_punctuation_not_swallowed(self):
        self.assertEqual([t.text for t in lex("a.b . 1.0")],
                         ["a", ".", "b", ".", "1.0"])

    def test_invalid_exponent_character_still_rejected(self):
        with self.assertRaises(FlowMathError):
            lex("alpha = .5e-2 @")

    def test_source_limit_remains_enforced(self):
        with self.assertRaisesRegex(FlowMathError, "256 KiB"):
            lex(".5" * 131073)


if __name__ == "__main__":
    unittest.main()
