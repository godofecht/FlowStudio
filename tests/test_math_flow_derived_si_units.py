"""Analytic dimension regression tests for derived SI quantity literals."""

import unittest

from math_flow_expr import _quantity, ExpressionError


class DerivedSIUnitsTests(unittest.TestCase):
    def test_derived_dimensions(self):
        expected = {
            "Hz": (0, 0, -1, 0),
            "N": (1, 1, -2, 0),
            "J": (2, 1, -2, 0),
            "W": (2, 1, -3, 0),
            "Pa": (-1, 1, -2, 0),
        }
        for unit, dimension in expected.items():
            with self.subTest(unit=unit):
                value, actual = _quantity("2" + unit)
                self.assertEqual(value, 2.0)
                self.assertEqual(actual, dimension)

    def test_inverse_and_power_dimensions(self):
        self.assertEqual(_quantity("3Hz²"), (3.0, (0, 0, -2, 0)))
        self.assertEqual(_quantity("4J/s"), (4.0, (2, 1, -3, 0)))
        self.assertEqual(_quantity("5N/m²"), (5.0, (-1, 1, -2, 0)))

    def test_invalid_derived_unit_suffix_is_rejected(self):
        for literal in ("1Hz⁻", "1N⁹⁹", "1W/m⁻"):
            with self.subTest(literal=literal), self.assertRaises(ExpressionError):
                _quantity(literal)


if __name__ == "__main__":
    unittest.main()
