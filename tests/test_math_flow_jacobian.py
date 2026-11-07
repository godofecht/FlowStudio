"""Analytic checks for the bounded numerical constraint Jacobian."""
import unittest

import numpy as np

from math_flow_expr import DIMENSIONLESS, LENGTH, ExpressionError
from math_flow_system import parse_constraint_system
from math_flow_jacobian import jacobian_dimensions, system_jacobian


class JacobianTests(unittest.TestCase):
    def test_linear_system_and_units(self):
        symbols = {"a": LENGTH, "b": LENGTH}
        system = parse_constraint_system("a + 2*b = 3m; a - b = 0m", symbols=symbols)
        jac = system_jacobian(
            system, 0.0, 0.0, values={"a": 1.0, "b": 1.0},
            variables=("a", "b"), dimensions=symbols,
        )
        np.testing.assert_allclose(
            [[float(entry) for entry in row] for row in jac],
            [[1.0, 2.0], [1.0, -1.0]], atol=1e-9,
        )
        self.assertEqual(jacobian_dimensions(system, ("a", "b"), symbols),
                         ((DIMENSIONLESS, DIMENSIONLESS),) * 2)

    def test_nonlinear_derivative(self):
        system = parse_constraint_system("a² = 4m²", symbols={"a": LENGTH})
        jac = system_jacobian(
            system, 0.0, 0.0, values={"a": np.array([1.0, 2.0, 3.0])},
            variables=("a",), dimensions={"a": LENGTH},
        )
        np.testing.assert_allclose(jac[0][0], [2.0, 4.0, 6.0], atol=1e-8)
        self.assertEqual(jacobian_dimensions(system, ("a",), {"a": LENGTH}),
                         ((LENGTH,),))

    def test_rejects_bad_inputs(self):
        system = parse_constraint_system("a = 1m", symbols={"a": LENGTH})
        for variables, values, step in (
            (("a", "a"), {"a": 1.0}, 1e-5),
            (("missing",), {"a": 1.0}, 1e-5),
            (("a",), {"a": float("nan")}, 1e-5),
            (("a",), {"a": 1.0}, 0.0),
        ):
            with self.subTest(variables=variables, step=step):
                with self.assertRaises(ExpressionError):
                    system_jacobian(system, 0.0, 0.0, values=values,
                                    variables=variables, dimensions={"a": LENGTH},
                                    relative_step=step)


if __name__ == "__main__":
    unittest.main()
