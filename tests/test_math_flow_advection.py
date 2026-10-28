"""Real typed Unicode scalar advection-diffusion numerical and CLI acceptance."""
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

SOURCE = (ROOT / "examples/heat_advection_diffusion.flow").read_text(encoding="utf-8")


class AdvectionDiffusionTest(unittest.TestCase):
    def test_discrete_fourier_translation_and_diffusion_both_axes(self):
        import numpy as np
        for axis, speed in (("x", 0.2), ("y", 0.1)):
            with self.subTest(axis=axis):
                source = SOURCE if axis == "x" else SOURCE.replace(
                    "sin(2πx / 1m)", "sin(2πy / 1m)")
                model = parse(source)
                self.assertTrue(model.equation.advection)
                self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
                result = simulate(model)
                self.assertEqual(result["steps"], 200)
                self.assertEqual(result["spatial"]["grid"], [16, 16])
                n = 16
                dt = result["time"] / result["steps"]
                wave = 2 * math.pi
                discrete_laplacian = -4 * n**2 * math.sin(math.pi / n)**2
                discrete_derivative = n * math.sin(2 * math.pi / n)
                eigenvalue = (model.diffusivity * discrete_laplacian
                              - 1j * speed * discrete_derivative)
                amplification = 1 + dt * eigenvalue + .5 * (dt * eigenvalue)**2
                coordinates = (np.arange(n) + .5) / n
                x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
                position = x if axis == "x" else y
                expected = 300 + 10 * np.imag(
                    amplification**result["steps"] * np.exp(1j * wave * position))
                np.testing.assert_allclose(
                    result["spatial"]["fields"]["temperature"], expected,
                    rtol=0, atol=1e-9)
                self.assertAlmostEqual(result["mean_temperature"], 300.0, places=10)
                self.assertAlmostEqual(
                    result["temperature_variance"],
                    50 * abs(amplification)**(2 * result["steps"]), places=9)

    def test_diffusive_fourier_variance_converges_with_grid_refinement(self):
        model = parse(SOURCE)
        target = math.exp(-2 * model.diffusivity * (2 * math.pi)**2 * model.until)
        errors = []
        for n in (16, 32):
            result = simulate(model, grid=n)
            ratio = result["temperature_variance"] / result["initial_temperature_variance"]
            errors.append(abs(ratio - target))
        self.assertLess(errors[1], errors[0] / 3)

    def test_rejects_missing_duplicate_wrong_sign_and_wrong_units(self):
        for old, new in (
            ("0.2m/s", "0.2m²/s"),
            ("− advectionVelocityX ∂ₓ(temperature)",
             "+ advectionVelocityX ∂ₓ(temperature)"),
            ("− advectionVelocityY ∂ᵧ(temperature)",
             "− advectionVelocityY ∂ₓ(temperature)"),
            ("− advectionVelocityY ∂ᵧ(temperature)",
             "− advectionVelocityX ∂ₓ(temperature)"),
            ("− advectionVelocityY ∂ᵧ(temperature)", ""),
            ("− advectionVelocityX ∂ₓ(temperature)",
             "− advectionVelocityX temperature / 1m"),
        ):
            with self.subTest(replacement=new), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(old, new))
        with self.assertRaisesRegex(FlowMathError, "stability"):
            simulate(replace(parse(SOURCE), advection_velocity_x=1000.0))

    def test_checked_in_program_runs_through_real_cli(self):
        run = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_advection_diffusion.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["steps"], 200)
        self.assertEqual(result["spatial"]["grid"], [16, 16])
        self.assertLess(result["temperature_variance"], result["initial_temperature_variance"])


if __name__ == "__main__":
    unittest.main()
