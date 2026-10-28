"""Executable nonlinear thermal PDE acceptance against an analytic Riccati solution."""
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
from math_flow_expr import evaluate
from math_flow_equations import TEMPERATURE_RATE

SOURCE = (ROOT / "examples/heat_nonlinear_reaction.flow").read_text(encoding="utf-8")
INITIAL = "330K + 10K * sin(2πx / 1m) * sin(2πy / 1m)"


class NonlinearThermalReactionTest(unittest.TestCase):
    def test_full_typed_rhs_is_executed_on_actual_field_arrays(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertTrue(model.equation.nonlinear)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        n = model.width
        coordinates = (np.arange(n) + 0.5) / n
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
        result = simulate(model)
        self.assertEqual(result["steps"], 100)
        self.assertGreater(result["temperature_min"], 300)
        self.assertLess(result["mean_temperature"], result["initial_mean_temperature"])
        self.assertLess(result["temperature_variance"], result["initial_temperature_variance"])
        self.assertEqual(result["spatial"]["grid"], [24, 24])
        self.assertAlmostEqual(result["observations"][-1]["meanTemperature"],
                               result["mean_temperature"], places=10)

    def test_uniform_quadratic_sink_converges_to_exact_solution(self):
        uniform = SOURCE.replace(INITIAL, "330K")
        exact = 300 + 30 / (1 + 2 * 30 * 0.1 / 300)
        errors = []
        for step in ("0.01s", "0.005s", "0.001s"):
            model = parse(uniform.replace("0.001s", step))
            result = simulate(model)
            self.assertAlmostEqual(result["temperature_variance"], 0.0, places=15)
            errors.append(abs(result["mean_temperature"] - exact))
        self.assertLess(errors[1], errors[0] / 3)
        self.assertLess(errors[2], errors[1] / 15)
        self.assertLess(errors[2], 2e-8)

    def test_unsupported_or_unsafe_nonlinear_equations_fail_closed(self):
        for old, new in (
            ("2s⁻¹", "-2s⁻¹"),
            ("2s⁻¹", "2m/s"),
            ("ambientTemperature = 300K", "ambientTemperature = 0K"),
            ("ambientTemperature = 300K", "ambientTemperature = 300m"),
            ("− reactionRate", "+ reactionRate"),
            ("/ ambientTemperature", "/ temperature"),
            ("(temperature − ambientTemperature)\n                                       (temperature − ambientTemperature)",
             "(temperature − ambientTemperature)\n                                       (temperature + ambientTemperature)"),
        ):
            with self.subTest(replacement=new), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(old, new))
        with self.assertRaisesRegex(FlowMathError, "temperature >= ambientTemperature"):
            simulate(parse(SOURCE.replace(INITIAL, "290K")))
        with self.assertRaisesRegex(FlowMathError, "nonlinear reaction stability"):
            simulate(replace(parse(SOURCE), reaction_rate=100000.0))

    def test_real_cli_executes_checked_in_program(self):
        run = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_nonlinear_reaction.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["steps"], 100)
        self.assertLess(result["mean_temperature"], 330.0)
        self.assertGreater(result["temperature_min"], 300.0)


if __name__ == "__main__":
    unittest.main()
