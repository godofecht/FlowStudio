"""Program-level Unicode lexer acceptance; not a claim of general PDE lowering."""
import unittest

from src.math_flow import Parser, FlowMathError, lex


class GreekProgramLexerTests(unittest.TestCase):
    def test_greek_identifiers_reach_program_parser(self):
        source = "ρ = α + β\nvelocity_ρ = ρ"
        tokens = lex(source)
        self.assertEqual([t.text for t in tokens],
                         ["ρ", "=", "α", "+", "β", "velocity_ρ", "=", "ρ"])
        parser = Parser(lex("ρ"))
        self.assertEqual(parser.identifier(), "ρ")
        self.assertEqual(parser.peek(), "<EOF>")

    def test_unknown_unicode_character_rejected(self):
        with self.assertRaises(FlowMathError):
            lex("ρ = 😀")

    def test_greek_identifier_not_a_numeric_literal(self):
        self.assertEqual([t.text for t in lex("ρ2 + 2ρ")],
                         ["ρ2", "+", "2", "ρ"])


if __name__ == "__main__":
    unittest.main()
