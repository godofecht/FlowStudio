"""Production mathematical Flow lexer regressions for trailing-dot floats."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import FlowMathError, lex, number


class TrailingDecimalTests(unittest.TestCase):
    def test_valid_literals(self):
        for literal, expected in (("1.", 1.0), ("1.e3", 1000.0),
                                  ("2.E-2", 0.02), (".5", 0.5),
                                  ("1.25e-2", 0.0125)):
            with self.subTest(literal=literal):
                tokens = lex(literal)
                self.assertEqual([t.text for t in tokens], [literal])
                self.assertAlmostEqual(number([t.text for t in tokens]), expected)

    def test_invalid_exponent_is_not_silently_accepted(self):
        for literal in ("1.e", "1.e+", "1.e-"):
            with self.subTest(literal=literal):
                tokens = lex(literal)
                self.assertNotEqual([t.text for t in tokens], [literal])
                with self.assertRaises(FlowMathError):
                    number([t.text for t in tokens])


if __name__ == "__main__":
    unittest.main()
