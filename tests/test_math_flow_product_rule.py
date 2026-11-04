"""Manufactured-solution consistency checks for executable Flow derivatives."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import DIMENSIONLESS, LENGTH, ExpressionError, evaluate, parse_expression


class DiscreteProductRule(unittest.TestCase):
    def test_periodic_product_rule_converges_at_second_order(self):
        errors = []
        for n in (16, 32, 64):
            length = 2.0 * np.pi
            h = length / n
            x, y = np.meshgrid(np.arange(n) * h, np.arange(n) * h, indexing="ij")
            u = np.sin(x) * np.cos(2.0 * y)
            v = np.cos(2.0 * x) * np.sin(y)
            symbols = {"u": DIMENSIONLESS, "v": DIMENSIONLESS}
            values = {"u": u, "v": v}
            def run(source):
                return evaluate(parse_expression(source, symbols=symbols), x, y, values=values)
            lhs = run("∂ₓ(u*v)")
            rhs = run("u*∂ₓ(v)+v*∂ₓ(u)")
            errors.append(float(np.sqrt(np.mean((lhs - rhs) ** 2))))
            np.testing.assert_allclose(np.sum(lhs), 0.0, atol=1e-10)
            self.assertEqual(parse_expression("∂ₓ(u*v)", symbols=symbols).dimension,
                             (-1, 0, 0, 0))
        self.assertGreater(errors[0], errors[1])
        self.assertGreater(errors[1], errors[2])
        self.assertGreater(errors[0] / errors[1], 3.0)
        self.assertGreater(errors[1] / errors[2], 3.0)

    def test_dimensioned_product_derivative(self):
        symbols = {"a": LENGTH, "b": (-1, 0, 0, 0)}
        expression = parse_expression("∂ₓ(a*b)", symbols=symbols)
        self.assertEqual(expression.dimension, (-1, 0, 0, 0))
        with self.assertRaises(ExpressionError):
            parse_expression("∂ₓ(a+b)", symbols=symbols)


if __name__ == "__main__":
    unittest.main()
