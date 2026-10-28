"""Real periodic reaction-diffusion numerical and native CLI acceptance."""
from dataclasses import replace
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_equations import compile_heat_equation
from math_flow_expr import ExpressionError, TEMPERATURE_RATE, evaluate

SOURCE = (ROOT / "examples/heat_reaction_diffusion.flow").read_text(encoding="utf-8")


class ReactionDiffusionTest(unittest.TestCase):
    def test_real_typed_equation_and_discrete_analytic_solution(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertAlmostEqual(model.reaction_rate, 0.5)
        self.assertAlmostEqual(model.ambient_temperature, 300.0)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        self.assertIsNotNone(model.equation.reaction)
        self.assertIsNotNone(model.equation.forcing)
        n = model.width
        coordinates = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
        initial = 300.0 + 10.0 * np.sin(2 * np.pi * x) * np.sin(2 * np.pi * y)
        rhs = evaluate(model.equation.rhs, x, y,
                       expected_dimension=TEMPERATURE_RATE,
                       values={"temperature": initial, "diffusivity": model.diffusivity,
                               "reactionRate": model.reaction_rate,
                               "ambientTemperature": model.ambient_temperature})
        eigenvalue = 8 * n * n * math.sin(math.pi / n)**2
        np.testing.assert_allclose(
            rhs, 2.0 - (model.diffusivity * eigenvalue + model.reaction_rate)
            * (initial - 300.0), atol=1e-10, rtol=0)

        result = simulate(model)
        self.assertEqual(result["steps"], 100)
        dt = result["time"] / result["steps"]
        amplification = (1 - dt * (model.diffusivity * eigenvalue + model.reaction_rate)
                         + 0.5 * (dt * (model.diffusivity * eigenvalue + model.reaction_rate))**2)
        expected_variance = 25.0 * amplification ** (2 * result["steps"])
        mean_amplification = 1 - dt * model.reaction_rate + 0.5 * (dt * model.reaction_rate)**2
        expected_mean = 300.0 + 2.0 / model.reaction_rate * (
            1 - mean_amplification ** result["steps"])
        self.assertAlmostEqual(result["mean_temperature"], expected_mean, places=9)
        self.assertAlmostEqual(result["temperature_variance"], expected_variance, places=9)
        self.assertAlmostEqual(result["observations"][-1]["meanTemperature"],
                               expected_mean, places=9)
        self.assertEqual(result["spatial"]["grid"], [24, 24])

    def test_fourier_mode_converges_under_refinement(self):
        model = parse(SOURCE)
        continuous_rate = model.diffusivity * 8 * math.pi**2 + model.reaction_rate
        target = math.exp(-2 * continuous_rate * model.until)
        errors = []
        for n in (16, 32):
            result = simulate(model, grid=n)
            errors.append(abs(result["temperature_variance"] /
                              result["initial_temperature_variance"] - target))
        self.assertLess(errors[1], errors[0] / 3)

    def test_rejects_unsafe_and_unsupported_reactions(self):
        for old, new in (
            ("0.5s⁻¹", "-0.5s⁻¹"),
            ("0.5s⁻¹", "0.5m/s"),
            ("ambientTemperature = 300K", "ambientTemperature = 300m"),
            ("− reactionRate (temperature − ambientTemperature)",
             "+ reactionRate (temperature − ambientTemperature)"),
            ("− reactionRate (temperature − ambientTemperature)",
             "− reactionRate temperature"),
            ("− reactionRate (temperature − ambientTemperature)",
             "− reactionRate (temperature − ambientTemperature) "
             "− reactionRate (temperature − ambientTemperature)"),
            ("+ 2K/s", "+ temperature / 1s"),
        ):
            with self.subTest(replacement=new), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(old, new))
        with self.assertRaises(ExpressionError):
            compile_heat_equation(
                ["∂ₜtemperature=diffusivity∇²temperature-reactionRate(temperature-ambientTemperature)"])
        with self.assertRaises(FlowMathError):
            simulate(replace(parse(SOURCE), reaction_rate=100000.0))

    def test_checked_in_program_executes_in_cli(self):
        run = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_reaction_diffusion.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        output = json.loads(run.stdout)
        self.assertTrue(output["ok"])
        self.assertEqual(output["steps"], 100)
        self.assertGreater(output["mean_temperature"], 300.0)
        self.assertLess(output["temperature_variance"], output["initial_temperature_variance"])


if __name__ == "__main__":
    unittest.main()
