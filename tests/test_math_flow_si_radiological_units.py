"""Dimension and tokenizer regression coverage for additional SI derived units."""

import unittest

from math_flow_expr import _quantity, tokenize, ExpressionError


class RadiologicalSIUnitsTests(unittest.TestCase):
    def test_si_dimensions(self):
        cases = {
            "2rad": (2.0, (0, 0, 0, 0)),
            "3sr": (3.0, (0, 0, 0, 0)),
            "4Bq": (4.0, (0, 0, -1, 0)),
            "5Gy": (5.0, (2, 0, -2, 0)),
            "6Sv": (6.0, (2, 0, -2, 0)),
            "7Gy/s": (7.0, (2, 0, -3, 0)),
            "8Bq²": (8.0, (0, 0, -2, 0)),
            "9Sv/m²": (9.0, (0, 0, -2, 0)),
        }
        for literal, expected in cases.items():
            with self.subTest(literal=literal):
                self.assertEqual(_quantity(literal), expected)
                self.assertEqual(tokenize(literal), (literal,))

    def test_invalid_exponents_rejected(self):
        for literal in ("1Gy⁻", "1Bq⁹⁹", "1Sv/m⁻"):
            with self.subTest(literal=literal), self.assertRaises(ExpressionError):
                _quantity(literal)


if __name__ == "__main__":
    unittest.main()
