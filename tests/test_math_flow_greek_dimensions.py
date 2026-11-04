"""Executable dimensional inference and numerical lowering for Greek scalar names."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import (
    DIMENSIONLESS, LENGTH, ExpressionError, evaluate, parse_expression,
)


class GreekDimensionalAcceptanceTests(unittest.TestCase):
    def test_dimensioned_greek_scalars_execute(self):
        symbols = {"Δ": LENGTH, "Σ": LENGTH, "ς": DIMENSIONLESS}
        expr = parse_expression("Δ + Σ × ς", symbols=symbols)
        self.assertEqual(expr.dimension, LENGTH)
        result = evaluate(expr, 0.0, 0.0, values={"Δ": 2.0, "Σ": 3.0, "ς": 4.0})
        np.testing.assert_allclose(result, 14.0)

    def test_distinct_upper_and_lowercase_bindings(self):
        symbols = {"Σ": DIMENSIONLESS, "σ": DIMENSIONLESS, "ς": DIMENSIONLESS}
        expr = parse_expression("Σ + 2*σ + 3*ς", symbols=symbols)
        result = evaluate(expr, 0.0, 0.0, values={"Σ": 5.0, "σ": 7.0, "ς": 11.0})
        np.testing.assert_allclose(result, 52.0)

    def test_dimension_mismatch_is_rejected_before_execution(self):
        for source in ("Δ + 1s", "Δ == 1s", "sin(Δ)"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    parse_expression(source, symbols={"Δ": LENGTH})

    def test_missing_runtime_binding_is_rejected(self):
        expr = parse_expression("Δ + 1m", symbols={"Δ": LENGTH})
        with self.assertRaises(ExpressionError):
            evaluate(expr, 0.0, 0.0, values={})


if __name__ == "__main__":
    unittest.main()
