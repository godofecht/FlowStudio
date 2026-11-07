"""Analytic numerical acceptance for damped scalar constraint solving."""
import unittest

from math_flow_expr import LENGTH, ExpressionError
from math_flow_system import parse_constraint_system
from math_flow_newton import solve_scalar_system


class NewtonTests(unittest.TestCase):
    def test_linear_two_by_two(self):
        symbols = {"a": LENGTH, "b": LENGTH}
        system = parse_constraint_system(
            "a + 2*b = 3m; a - b = 0m", symbols=symbols,
        )
        result = solve_scalar_system(
            system, 0.0, 0.0, values={"a": 0.0, "b": 0.0},
            variables=("a", "b"), dimensions=symbols,
        )
        self.assertTrue(result.converged)
        self.assertAlmostEqual(result.values["a"], 1.0, places=7)
        self.assertAlmostEqual(result.values["b"], 1.0, places=7)
        self.assertLess(max(map(abs, result.residuals)), 1e-9)

    def test_nonlinear_root(self):
        system = parse_constraint_system("a² = 4m²", symbols={"a": LENGTH})
        result = solve_scalar_system(
            system, 0.0, 0.0, values={"a": 3.0},
            variables=("a",), dimensions={"a": LENGTH},
        )
        self.assertTrue(result.converged)
        self.assertAlmostEqual(result.values["a"], 2.0, places=7)

    def test_initial_root_reports_zero_iterations(self):
        system = parse_constraint_system("a = 1m", symbols={"a": LENGTH})
        result = solve_scalar_system(
            system, 0.0, 0.0, values={"a": 1.0},
            variables=("a",), dimensions={"a": LENGTH},
        )
        self.assertTrue(result.converged)
        self.assertEqual(result.iterations, 0)

    def test_iteration_limit_reports_actual_steps(self):
        system = parse_constraint_system("a² = 4m²", symbols={"a": LENGTH})
        result = solve_scalar_system(
            system, 0.0, 0.0, values={"a": 3.0},
            variables=("a",), dimensions={"a": LENGTH},
            tolerance=1e-12, max_iterations=1,
        )
        self.assertFalse(result.converged)
        self.assertEqual(result.iterations, 1)
        self.assertLess(abs(result.residuals[0]), 5.0)

    def test_singular_jacobian(self):
        system = parse_constraint_system("a² = 1m²", symbols={"a": LENGTH})
        with self.assertRaises(ExpressionError):
            solve_scalar_system(
                system, 0.0, 0.0, values={"a": 0.0},
                variables=("a",), dimensions={"a": LENGTH},
            )

    def test_rejects_vector_variable(self):
        system = parse_constraint_system("a = 1m", symbols={"a": LENGTH})
        with self.assertRaises(ExpressionError):
            solve_scalar_system(
                system, 0.0, 0.0, values={"a": [1.0, 2.0]},
                variables=("a",), dimensions={"a": LENGTH},
            )


if __name__ == "__main__":
    unittest.main()
