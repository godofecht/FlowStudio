"""Analytic numerical acceptance for damped scalar constraint solving."""
import unittest
import math
from unittest.mock import patch

import math_flow_newton

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

    def test_mixed_physical_dimensions_with_scaled_convergence(self):
        symbols = {"a": LENGTH, "b": (0, 0, 1, 0)}
        system = parse_constraint_system("a = 1m; b = 2s", symbols=symbols)
        result = solve_scalar_system(
            system, 0.0, 0.0, values={"a": 0.0, "b": 0.0},
            variables=("a", "b"), dimensions=symbols,
            residual_scales=(1e6, 1e-6), tolerance=1e-8,
        )
        self.assertTrue(result.converged)
        self.assertAlmostEqual(result.values["a"], 1.0, places=6)
        self.assertAlmostEqual(result.values["b"], 2.0, places=6)
        self.assertLess(abs(result.residuals[1]) / 1e-6, 1e-8)

    def test_rejects_invalid_residual_scales(self):
        system = parse_constraint_system("a = 1m", symbols={"a": LENGTH})
        for scales in ((), (0.0,), (-1.0,), (float("nan"),),
                       (float("inf"),), (True,), 1.0, "1", {"a": 1.0}):
            with self.subTest(scales=scales), self.assertRaises(ExpressionError):
                solve_scalar_system(
                    system, 0.0, 0.0, values={"a": 0.0},
                    variables=("a",), dimensions={"a": LENGTH},
                    residual_scales=scales,
                )

    def test_rejects_boolean_and_non_numeric_solver_controls(self):
        system = parse_constraint_system("a = 1m", symbols={"a": LENGTH})
        for kwargs in (
            {"tolerance": True},
            {"tolerance": "1e-9"},
            {"tolerance": None},
            {"max_iterations": True},
            {"max_iterations": 2.0},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ExpressionError):
                solve_scalar_system(
                    system, 0.0, 0.0, values={"a": 0.0},
                    variables=("a",), dimensions={"a": LENGTH},
                    **kwargs,
                )

    def test_overflowed_trial_state_never_reaches_expression_evaluator(self):
        system = parse_constraint_system("a = 0m", symbols={"a": LENGTH})
        original = math_flow_newton.system_residuals
        evaluated = []

        def checked_residuals(*args, **kwargs):
            value = kwargs["values"]["a"]
            self.assertTrue(math.isfinite(value))
            evaluated.append(value)
            return original(*args, **kwargs)

        # A deliberately reversed Jacobian produces a finite Newton direction
        # that overflows when added to the already-large current iterate.
        with patch.object(math_flow_newton, "system_jacobian", return_value=((-1.0,),)):
            with patch.object(math_flow_newton, "system_residuals", side_effect=checked_residuals):
                result = solve_scalar_system(
                    system, 0.0, 0.0, values={"a": 1e308},
                    variables=("a",), dimensions={"a": LENGTH},
                    max_iterations=1,
                )
        self.assertFalse(result.converged)
        self.assertEqual(result.iterations, 0)
        self.assertTrue(evaluated)
        self.assertTrue(all(math.isfinite(value) for value in evaluated))

    def test_rejects_compiled_symbol_dimension_mismatch(self):
        # The equations are typed at parse time; passing a different Jacobian
        # dimension must not silently override the compiled AST.
        symbols = {"a": LENGTH}
        system = parse_constraint_system("a = 1m", symbols=symbols)
        for wrong in ((0, 0, 1, 0), (0, 0, 0, 0)):
            with self.subTest(dimension=wrong), self.assertRaises(ExpressionError):
                solve_scalar_system(
                    system, 0.0, 0.0, values={"a": 0.0},
                    variables=("a",), dimensions={"a": wrong},
                )

    def test_dimension_validation_checks_nested_references(self):
        symbols = {"a": LENGTH}
        system = parse_constraint_system("2*(a + 1m) = 4m", symbols=symbols)
        with self.assertRaises(ExpressionError):
            solve_scalar_system(
                system, 0.0, 0.0, values={"a": 1.0},
                variables=("a",), dimensions={"a": (0, 0, 1, 0)},
            )

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
