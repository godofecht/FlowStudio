"""Executable mathematical Flow lexer boundary and source-location regressions."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import FlowMathError, assignments, lex


class MathLexerBoundaryTests(unittest.TestCase):
    def test_bom_only_at_start(self):
        self.assertEqual([token.text for token in lex("\ufeffα = 2\n")], ["α", "=", "2"])
        with self.assertRaises(FlowMathError):
            lex("α = 2\ufeff")

    def test_unicode_newline_positions(self):
        for newline in ("\n", "\r", "\r\n", "\u0085", "\u2028", "\u2029"):
            with self.subTest(newline=repr(newline)):
                tokens = lex("α = 1" + newline + "β = 2")
                beta = next(token for token in tokens if token.text == "β")
                self.assertEqual((beta.line, beta.column), (2, 1))

    def test_invalid_assignment_targets_fail_closed(self):
        for source in ("2 = α", "∆ = α", "α = 1\nα = 2"):
            with self.subTest(source=source):
                with self.assertRaises(FlowMathError):
                    assignments(lex(source))

    def test_greek_identifiers_remain_distinct(self):
        result = assignments(lex("Δ = 1\nδ = 2\nΣ = 3\nς = 4"))
        self.assertEqual(set(result), {"Δ", "δ", "Σ", "ς"})

    def test_source_size_limit_is_utf8_bytes(self):
        with self.assertRaises(FlowMathError):
            lex("α" * 131073)


if __name__ == "__main__":
    unittest.main()
