"""Real scalar transport + reaction equation AST, Fourier and native CLI acceptance."""
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
from math_flow_equations import TEMPERATURE_RATE

SOURCE = (ROOT / "examples/heat_transport_reaction.flow").read_text(encoding="utf-8")


class ComposedTransportReactionTest(unittest.TestCase):
    def test_discrete_fourier_phase_amplitude_and_forced_mean(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertTrue(model.equation.advection)
        self.assertIsNotNone(model.equation.reaction)
        self.assertIsNotNone(model.equation.forcing)
        self.assertFalse(model.equation.nonlinear)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        result = simulate(model)
        n = model.width
        steps = result["steps"]
        self.assertEqual(steps, 200)
        dt = result["time"] / steps
        coordinates = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
        discrete_laplacian = -4 * n**2 * math.sin(math.pi / n)**2
        discrete_gradient = n * math.sin(2 * math.pi / n)

        def rk2(eigenvalue):
            return (1 + dt * eigenvalue + .5 * (dt * eigenvalue)**2)**steps

        base = model.diffusivity * discrete_laplacian - model.reaction_rate
        ax = rk2(base - 1j * model.advection_velocity_x * discrete_gradient)
        ay = rk2(base - 1j * model.advection_velocity_y * discrete_gradient)
        uniform = rk2(-model.reaction_rate)
        expected_mean = model.ambient_temperature + 2 / model.reaction_rate * (1 - uniform)
        expected = (expected_mean
                    + 10 * np.imag(ax * np.exp(2j * math.pi * x))
                    + 5 * np.real(ay * np.exp(2j * math.pi * y)))
        np.testing.assert_allclose(result["spatial"]["fields"]["temperature"], expected,
                                   rtol=0, atol=1e-9)
        self.assertAlmostEqual(result["mean_temperature"], expected_mean, places=9)
        self.assertAlmostEqual(result["temperature_variance"],
                               50 * abs(ax)**2 + 12.5 * abs(ay)**2, places=9)
        self.assertEqual(result["observations"][-1]["time"], result["time"])

    def test_continuum_fourier_variance_converges_under_refinement(self):
        model = parse(SOURCE)
        decay = model.diffusivity * (2 * math.pi)**2 + model.reaction_rate
        expected = 62.5 * math.exp(-2 * decay * model.until)
        errors = [abs(simulate(model, grid=n)["temperature_variance"] - expected)
                  for n in (16, 32)]
        self.assertLess(errors[1], errors[0] / 3)

    def test_rejects_partial_declarations_sign_errors_and_wrong_units(self):
        for old, new in (
            ("    const ambientTemperature = 300K\n", ""),
            ("    const advectionVelocityY = 0.1m/s\n", ""),
            ("0.5s⁻¹", "0.5m/s"),
            ("− reactionRate (temperature − ambientTemperature)",
             "+ reactionRate (temperature − ambientTemperature)"),
            ("− advectionVelocityX ∂ₓ(temperature)",
             "+ advectionVelocityX ∂ₓ(temperature)"),
            ("− advectionVelocityY ∂ᵧ(temperature)",
             "− advectionVelocityY ∂ₓ(temperature)"),
            ("+ 2K/s", "+ 2m/s"),
            ("− reactionRate (temperature − ambientTemperature)",
             "− reactionRate (temperature − ambientTemperature) − reactionRate (temperature − ambientTemperature)"),
        ):
            with self.subTest(replacement=new), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(old, new))
        with self.assertRaisesRegex(FlowMathError, "stability"):
            simulate(replace(parse(SOURCE), reaction_rate=100000.0))
        with self.assertRaisesRegex(FlowMathError, "stability"):
            simulate(replace(parse(SOURCE), advection_velocity_x=100.0))

    def test_nonlinear_relaxation_can_compose_with_transport(self):
        original = "− reactionRate (temperature − ambientTemperature)"
        quadratic = ("− reactionRate (temperature − ambientTemperature) "
                     "(temperature − ambientTemperature) / ambientTemperature")
        initial = "temperature = 300K + 10K * sin(2πx / 1m) + 5K * cos(2πy / 1m)"
        source = SOURCE.replace(original, quadratic).replace("+ 2K/s", "").replace(
            initial, "temperature = 320K")
        model = parse(source)
        self.assertTrue(model.equation.nonlinear)
        self.assertTrue(model.equation.advection)
        result = simulate(model)
        expected = 300 + 20 / (1 + model.reaction_rate * 20 * model.until / 300)
        self.assertAlmostEqual(result["mean_temperature"], expected, places=7)
        self.assertLess(result["temperature_variance"], 1e-20)

    def test_checked_in_composed_program_executes_through_cli(self):
        run = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_transport_reaction.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["steps"], 200)
        self.assertEqual(result["spatial"]["grid"], [16, 16])
        self.assertGreater(result["mean_temperature"], 300.0)


if __name__ == "__main__":
    unittest.main()
