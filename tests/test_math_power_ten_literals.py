"""Regression tests for bounded scientific power-of-ten literals."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import ExpressionError, parse_expression


class PowerOfTenLiteralTests(unittest.TestCase):
    def test_negative_exponents(self):
        for source in ("10-3", "10−3", "10⁻³", "10⁻3", "10-³"):
            with self.subTest(source=source):
                expression = parse_expression(source)
                self.assertEqual(expression.operator, "literal")
                self.assertAlmostEqual(expression.value, 0.001)

    def test_bounded_exponents(self):
        for source in ("10-301", "10−301", "10⁻³⁰¹"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source)

    def test_unit_dimensions(self):
        expression = parse_expression("10−3m")
        self.assertAlmostEqual(expression.value, 0.001)
        self.assertEqual(expression.dimension, (1, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
