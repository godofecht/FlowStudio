"""Typed saturating nonlinear heat equation, analytic solution and native CLI."""
from dataclasses import replace
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
from math_flow_equations import TEMPERATURE_RATE
from math_flow_expr import ExpressionError, evaluate, parse_expression

SOURCE = (ROOT / "examples/heat_saturating_reaction.flow").read_text(encoding="utf-8")
INITIAL = "300K + 10K * sin(2πx / 1m) * sin(2πy / 1m)"
SINK = "tanh((temperature − ambientTemperature) / ambientTemperature)"


def exact_uniform(initial, duration, rate=2.0, ambient=300.0):
    deviation = (initial - ambient) / ambient
    return ambient * (1 + math.asinh(math.sinh(deviation) * math.exp(-rate * duration)))


class SaturatingKineticsTest(unittest.TestCase):
    def test_dimensionless_tanh_ast_and_numerical_lowering(self):
        x = np.zeros((3, 3))
        expression = parse_expression("tanh(2π)")
        self.assertEqual(expression.dimension, (0, 0, 0, 0))
        np.testing.assert_allclose(evaluate(expression, x, x), math.tanh(2 * math.pi))
        with self.assertRaisesRegex(ExpressionError, "dimensionless"):
            parse_expression("tanh(1K)")
        with self.assertRaises(ExpressionError):
            parse_expression("tanh(temperature)", symbols={"temperature": (0, 0, 0, 1)})

    def test_typed_ast_and_exact_discrete_fourier_rhs(self):
        model = parse(SOURCE)
        self.assertTrue(model.equation.nonlinear)
        self.assertEqual(model.equation.reaction_kind, "saturating")
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        n = model.width
        coords = (np.arange(n) + 0.5) / n
        x, y = np.meshgrid(coords, coords, indexing="ij")
        mode = np.sin(2 * np.pi * x) * np.sin(2 * np.pi * y)
        state = 300 + 10 * mode
        result = evaluate(model.equation.rhs, x, y,
                          expected_dimension=TEMPERATURE_RATE,
                          values={"temperature": state,
                                  "diffusivity": model.diffusivity,
                                  "reactionRate": model.reaction_rate,
                                  "ambientTemperature": model.ambient_temperature})
        eigenvalue = 8 * n * n * math.sin(math.pi / n)**2
        expected = (-model.diffusivity * eigenvalue * 10 * mode
                    - model.reaction_rate * model.ambient_temperature
                    * np.tanh((state - 300) / 300))
        np.testing.assert_allclose(result, expected, atol=2e-10, rtol=0)

    def test_exact_signed_uniform_kinetics_and_rk2_convergence(self):
        for initial in (330.0, 270.0):
            with self.subTest(initial=initial):
                uniform = SOURCE.replace(INITIAL, f"{int(initial)}K")
                exact = exact_uniform(initial, 0.1)
                errors = []
                for step in ("0.02s", "0.01s", "0.005s"):
                    result = simulate(parse(uniform.replace("0.001s", step)))
                    self.assertLess(result["temperature_variance"], 1e-18)
                    self.assertLess(abs(result["mean_temperature"] - 300),
                                    abs(initial - 300))
                    errors.append(abs(result["mean_temperature"] - exact))
                self.assertGreater(errors[0], 3 * errors[1])
                self.assertGreater(errors[1], 3 * errors[2])
                self.assertLess(errors[-1], 0.0001)

    def test_rejects_untyped_unsafe_or_unsupported_reactions(self):
        for bad in (
            SOURCE.replace(SINK, "tanh(temperature)"),
            SOURCE.replace(SINK, "tanh((temperature − ambientTemperature) / 1s)"),
            SOURCE.replace(SINK, "sin((temperature − ambientTemperature) / ambientTemperature)"),
            SOURCE.replace(SINK, "tanh((temperature + ambientTemperature) / ambientTemperature)"),
            SOURCE.replace("− reactionRate", "+ reactionRate"),
            SOURCE.replace("reactionRate * ambientTemperature", "reactionRate * temperature"),
        ):
            with self.subTest(source=bad[-160:]), self.assertRaises(FlowMathError):
                parse(bad)
        with self.assertRaisesRegex(FlowMathError, "positive ambientTemperature"):
            parse(SOURCE.replace("300K\n    field", "0K\n    field"))
        with self.assertRaisesRegex(FlowMathError, "nonlinear reaction stability"):
            simulate(replace(parse(SOURCE), reaction_rate=1000000))

    def test_actual_cli_and_spatial_output(self):
        run = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_saturating_reaction.flow"],
            cwd=ROOT, capture_output=True, text=True, timeout=45)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["steps"], 100)
        self.assertLess(abs(result["mean_temperature"] - 300), 1e-9)
        self.assertLess(result["temperature_variance"], result["initial_temperature_variance"])
        self.assertEqual(result["spatial"]["grid"], [24, 24])
        self.assertIn("temperature", result["spatial"]["fields"])


if __name__ == "__main__":
    unittest.main()
