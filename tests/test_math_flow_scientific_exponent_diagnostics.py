"""Executable mathematical Flow lexer regression coverage."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import FlowMathError, lex


class ScientificExponentLexerTests(unittest.TestCase):
    def test_valid_exponents(self):
        for literal in ("1e3", "1.e3", "2.E-2", ".5e+2", "1.0E-10"):
            with self.subTest(literal=literal):
                self.assertEqual([token.text for token in lex(literal)], [literal])

    def test_incomplete_exponents_report_source_position(self):
        for literal in ("1e", "1e+", "1e-", "1.e", "2.E+", ".5e-"):
            with self.subTest(literal=literal):
                with self.assertRaisesRegex(FlowMathError, r"2:3: malformed scientific exponent"):
                    lex("x\n  " + literal)

    def test_separate_identifier_and_number_remain_lexable(self):
        self.assertEqual([token.text for token in lex("1 foo")], ["1", "foo"])


if __name__ == "__main__":
    unittest.main()
