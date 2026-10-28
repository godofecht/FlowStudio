"""Executable Unicode and ASCII powers with dimension inference and analytic PDE checks."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_expr import ExpressionError, TEMPERATURE, evaluate, parse_expression
from math_flow_equations import TEMPERATURE_RATE

SOURCE = (ROOT / "examples/heat_power_reaction.flow").read_text(encoding="utf-8")
INITIAL = "330K + 10K * sin(2πx / 1m) * sin(2πy / 1m)"


class TypedPowersTest(unittest.TestCase):
    def test_typed_ast_powers_and_numpy_lowering(self):
        x = np.array([[.25, .5], [.75, 1.]])
        y = x.copy()
        for expression in ("(3m)^2 / 9m²", "(3m)² / 9m²",
                           "(3m) ^ 2 / 9m²"):
            tree = parse_expression(expression)
            self.assertEqual(tree.dimension, (0, 0, 0, 0))
            np.testing.assert_allclose(evaluate(tree, x, y), 1.)
        tree = parse_expression("(2m)^-2")
        self.assertEqual(tree.dimension, (-2, 0, 0, 0))
        np.testing.assert_allclose(evaluate(tree, x, y), .25)
        self.assertEqual(parse_expression("(2K)³").dimension, (0, 0, 0, 3))
        self.assertEqual(float(evaluate(parse_expression("−2² + 5"), x, y)), 1.)
        self.assertEqual(float(evaluate(parse_expression("2^3 * 2"), x, y)), 16.)

    def test_fail_closed_on_unbounded_or_nonliteral_powers(self):
        for source in ("2m^9", "2m^-9", "2m^1.5", "2m^1K",
                       "2m^(1+1)", "2m^x", "2m^3^2",
                       "(0m)^-1"):
            with self.subTest(source=source):
                with self.assertRaises(ExpressionError):
                    tree = parse_expression(source)
                    evaluate(tree, np.zeros((3, 3)), np.zeros((3, 3)))
        with self.assertRaises(FlowMathError):
            parse(SOURCE.replace(
                "diffusivity ∇²temperature",
                "diffusivity ∇²temperature + temperature² / 1K/s"))

    def test_real_nonlinear_equation_ast_and_analytic_rk2(self):
        model = parse(SOURCE)
        self.assertTrue(model.equation.nonlinear)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        n = model.width
        coordinates = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
        mode = np.sin(2 * np.pi * x) * np.sin(2 * np.pi * y)
        temperature = 330 + 10 * mode
        actual = evaluate(
            model.equation.rhs, x, y, expected_dimension=TEMPERATURE_RATE,
            values={"temperature": temperature, "diffusivity": model.diffusivity,
                    "reactionRate": model.reaction_rate,
                    "ambientTemperature": model.ambient_temperature})
        eigenvalue = 8 * n * n * math.sin(math.pi / n)**2
        expected = -model.diffusivity * eigenvalue * 10 * mode - (
            model.reaction_rate * (temperature - 300)**2 / 300)
        np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-10)
        exact = 300 + 30 / (1 + 2 * 30 * model.until / 300)
        errors = []
        for step in ("0.01s", "0.005s", "0.001s"):
            uniform = SOURCE.replace(INITIAL, "330K").replace("0.001s", step)
            result = simulate(parse(uniform))
            self.assertAlmostEqual(result["temperature_variance"], 0., places=15)
            errors.append(abs(result["mean_temperature"] - exact))
        self.assertLess(errors[1], errors[0] / 3)
        self.assertLess(errors[2], errors[1] / 15)
        self.assertLess(errors[2], 2e-8)

    def test_ascii_power_in_full_equation_and_cli_execution(self):
        source = SOURCE.replace("(temperature − ambientTemperature)²",
                                "(temperature − ambientTemperature)^2")
        result = simulate(parse(source))
        self.assertGreater(result["mean_temperature"], 300)
        self.assertLess(result["mean_temperature"], 330)
        completed = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_power_reaction.flow"],
            cwd=ROOT, capture_output=True, text=True, timeout=45)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["steps"], 100)
        self.assertLess(payload["temperature_variance"],
                        payload["initial_temperature_variance"])


if __name__ == "__main__":
    unittest.main()
