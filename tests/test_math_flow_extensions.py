"""Real typed AST and analytic heat equation acceptance, not source-string tests."""
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow_expr import (parse_expression, evaluate, ExpressionError,
                            VELOCITY, TEMPERATURE, LENGTH)
from math_flow import parse, simulate, FlowMathError
from math_flow_heat import HeatModel

HEAT = (ROOT / "examples/heat_equation_smoke.flow").read_text(encoding="utf-8")
NAVIER = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")


class MathematicalFlowExtensionTest(unittest.TestCase):
    def test_typed_unicode_expression_tree(self):
        import numpy as np
        x = np.array([.25, .5])
        y = np.array([.25, .5])
        expr = parse_expression("sin(2πy / 1m) * 1m/s")
        self.assertEqual(expr.dimension, VELOCITY)
        np.testing.assert_allclose(evaluate(expr, x, y, expected_dimension=VELOCITY), [1, 0], atol=1e-12)
        self.assertEqual(parse_expression("sqrt(4m²)").dimension, LENGTH)
        self.assertEqual(parse_expression("10⁻⁴s").dimension, (0, 0, 1, 0))
        self.assertEqual(parse_expression("300K + 10K").dimension, TEMPERATURE)

    def test_dimensions_and_unsafe_syntax_fail_closed(self):
        for source in ("sin(x)", "1m + 1s", "1m / 0m + 2s", "sqrt(1m)",
                       "__import__('os')", "x.__class__", "x[0]", "x**2", "unknown"):
            with self.subTest(source=source), self.assertRaises(ExpressionError):
                parse_expression(source)
        with self.assertRaises(ExpressionError):
            evaluate(parse_expression("1m / 0s"), 0, 0)
        with self.assertRaises(ExpressionError):
            parse_expression("(" * 40 + "1m" + ")" * 40)
        with self.assertRaises(ExpressionError):
            parse_expression("1" * 4097)

    def test_navier_initial_conditions_are_dimension_checked_at_compile_time(self):
        with self.assertRaisesRegex(FlowMathError, "velocity dimension"):
            parse(NAVIER.replace("1m/s", "1kg"))
        with self.assertRaisesRegex(FlowMathError, "dimensionless"):
            parse(NAVIER.replace("2πy / 1m", "2πy"))
        result = simulate(parse(NAVIER))
        self.assertLess(result["max_divergence"], 1e-5)

    def test_heat_equation_is_executable_with_analytic_convergence(self):
        model = parse(HEAT)
        self.assertIsInstance(model, HeatModel)
        self.assertEqual((model.width, model.height), (32, 32))
        target = math.exp(-4 * model.diffusivity * (2 * math.pi)**2 * model.until)
        errors = []
        for grid in (16, 32):
            result = simulate(model, grid=grid)
            ratio = result["temperature_variance"] / result["initial_temperature_variance"]
            errors.append(abs(ratio - target))
            self.assertAlmostEqual(result["mean_temperature"], 300.0, places=10)
            self.assertLess(result["temperature_variance"], result["initial_temperature_variance"])
            self.assertEqual(result["steps"], 100)
        self.assertLess(errors[1], errors[0])
        self.assertLess(errors[1], 6e-5)

    def test_heat_rejects_invalid_units_dynamics_and_methods(self):
        for original, replacement in (("0.01m²/s", "0.01m/s"),
                                      ("diffusivity ∇²temperature", "diffusivity temperature"),
                                      ("300K", "300m"),
                                      ("CentralDifference", "Spectral"),
                                      ("Periodic", "Dirichlet")):
            with self.subTest(replacement=replacement), self.assertRaises(FlowMathError):
                parse(HEAT.replace(original, replacement))

    def test_heat_stability_and_input_guards(self):
        model = parse(HEAT)
        with self.assertRaises(FlowMathError):
            simulate(model, until=1e10)
        with self.assertRaises(FlowMathError):
            simulate(model, grid=513)


if __name__ == "__main__":
    unittest.main()
