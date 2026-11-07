"""Regression coverage for scientific-literal underflow in mathematical Flow."""
import unittest

from src.math_flow_expr import ExpressionError, parse_expression


class ScientificUnderflowTests(unittest.TestCase):
    def test_nonzero_underflow_is_rejected(self):
        for literal in ("1e-999", "1e−999", "2.5E-400", "1e-999m/s"):
            with self.subTest(literal=literal):
                with self.assertRaisesRegex(ExpressionError, "underflows to zero"):
                    parse_expression(literal)

    def test_exact_zero_is_allowed(self):
        for literal in ("0e-999", "0.000e−999", "0e-999m/s"):
            with self.subTest(literal=literal):
                self.assertEqual(parse_expression(literal).value, 0.0)

    def test_representable_subnormal_is_preserved(self):
        self.assertGreater(parse_expression("5e-324").value, 0.0)


if __name__ == "__main__":
    unittest.main()
