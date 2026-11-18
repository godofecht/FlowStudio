"""Regression tests for typed diagnostics on malformed unit superscripts."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import ExpressionError, parse_expression


class UnitExponentValidation(unittest.TestCase):
    def test_malformed_unit_exponents_fail_closed(self):
        for source in ("1m⁻", "1m⁻⁻", "1m²⁻", "1m⁻²⁻"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)

    def test_valid_unit_exponents(self):
        self.assertEqual(parse_expression("1m⁻²").dimension, (-2, 0, 0, 0))
        self.assertEqual(parse_expression("1m²").dimension, (2, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
