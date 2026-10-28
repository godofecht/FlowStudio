"""Composed signed heat sources: typed AST, exact modes, RK2 and real CLI."""
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
from math_flow_expr import evaluate

SOURCE = (ROOT / "examples/heat_composed_forcing.flow").read_text(encoding="utf-8")
INITIAL = "300K + 10K * sin(2πx / 1m) * sin(2πy / 1m)"


def exact_mean(duration):
    return (300 + (1 - math.cos(2 * math.pi * duration)) / math.pi
            + 3 * math.sin(2 * math.pi * duration) / (2 * math.pi) - duration)


class ComposedForcingTest(unittest.TestCase):
    def test_all_signed_terms_are_typed_and_lowered(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        self.assertIsNotNone(model.equation.forcing)
        self.assertEqual(model.equation.forcing.dimension, TEMPERATURE_RATE)
        self.assertEqual(model.equation.forcing.operator, "add")
        n = model.width
        coordinates = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
        for time, mean in ((0., 2.), (.25, 1.), (.5, -4.)):
            with self.subTest(time=time):
                source = evaluate(model.equation.forcing, x, y, values={"t": time})
                self.assertAlmostEqual(float(np.mean(source)), mean, places=12)

    def test_analytic_temporal_integral_and_spatial_fourier_amplitudes(self):
        model = parse(SOURCE.replace(INITIAL, "300K"))
        result = simulate(model)
        self.assertEqual(result["steps"], 100)
        self.assertLess(abs(result["mean_temperature"] - exact_mean(model.until)), 3e-8)
        n = model.width
        eigenvalue = 4 * n * n * math.sin(math.pi / n)**2
        decay = model.diffusivity * eigenvalue
        amplitude = -math.expm1(-decay * model.until) / decay
        expected_variance = (1 + 4) * amplitude**2 / 2
        self.assertLess(abs(result["temperature_variance"] - expected_variance), 1e-8)
        self.assertEqual(result["spatial"]["grid"], [n, n])

    def test_rejects_field_dependent_sources_and_bad_dimensions(self):
        for original, replacement in (
            ("+ 2K/s * sin(2πy / 1m)", "+ temperature / 1s"),
            ("+ 2K/s * sin(2πy / 1m)", "+ 2m/s"),
            ("+ 2K/s * sin(2πy / 1m)", "+ diffusivity ∇²temperature"),
        ):
            with self.subTest(replacement=replacement), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(original, replacement))

    def test_checked_in_program_executes_from_real_cli(self):
        completed = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_composed_forcing.flow"],
            cwd=ROOT, capture_output=True, text=True, timeout=45)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["steps"], 100)
        self.assertLess(abs(result["mean_temperature"] - exact_mean(.01)), 3e-8)
        self.assertIn("temperature", result["spatial"]["fields"])


if __name__ == "__main__":
    unittest.main()
