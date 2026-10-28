"""Real cubic/quartic mathematical Flow reaction PDEs and analytic RK2 checks."""
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
from math_flow_expr import evaluate, parse_expression
from math_flow_equations import TEMPERATURE_RATE

SOURCE = (ROOT / "examples/heat_cubic_reaction.flow").read_text(encoding="utf-8")
INITIAL = "330K + 10K * sin(2πx / 1m) * sin(2πy / 1m)"


def quartic(source):
    return source.replace("(temperature − ambientTemperature)³",
                          "(temperature − ambientTemperature)⁴").replace(
                          "/ ambientTemperature²", "/ ambientTemperature³")


class PolynomialKineticsTest(unittest.TestCase):
    def test_unicode_powers_four_through_eight_lower_to_numpy(self):
        x = np.zeros((3, 3))
        for exponent, glyph in ((4, "⁴"), (5, "⁵"), (6, "⁶"), (7, "⁷"), (8, "⁸")):
            with self.subTest(exponent=exponent):
                tree = parse_expression("(2m)" + glyph)
                self.assertEqual(tree.dimension, (exponent, 0, 0, 0))
                np.testing.assert_allclose(evaluate(tree, x, x), 2**exponent)

    def test_typed_cubic_ast_and_discrete_fourier_rhs(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.reaction_power, 3)
        self.assertTrue(model.equation.nonlinear)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        n = model.width
        coordinate = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coordinate, coordinate, indexing="ij")
        mode = np.sin(2 * np.pi * x) * np.sin(2 * np.pi * y)
        temperature = 330 + 10 * mode
        result = evaluate(model.equation.rhs, x, y,
                          expected_dimension=TEMPERATURE_RATE,
                          values={"temperature": temperature,
                                  "diffusivity": model.diffusivity,
                                  "reactionRate": model.reaction_rate,
                                  "ambientTemperature": model.ambient_temperature})
        discrete_eigenvalue = 8 * n * n * math.sin(math.pi / n)**2
        expected = (-model.diffusivity * discrete_eigenvalue * 10 * mode
                    - model.reaction_rate * (temperature - 300)**3 / 300**2)
        np.testing.assert_allclose(result, expected, atol=2e-10, rtol=0)

    def test_cubic_and_quartic_exact_uniform_kinetics_rk2_convergence(self):
        for order, source, rate in ((3, SOURCE, 100), (4, quartic(SOURCE), 500)):
            with self.subTest(order=order):
                uniform = source.replace(INITIAL, "330K").replace("2s⁻¹", f"{rate}s⁻¹")
                model = parse(uniform)
                self.assertEqual(model.equation.reaction_power, order)
                initial_excess, ambient, duration = 30.0, 300.0, model.until
                exact_excess = (initial_excess**(1-order)
                                + (order - 1) * rate * duration / ambient**(order - 1)
                                ) ** (-1 / (order - 1))
                errors = []
                for step in ("0.02s", "0.01s", "0.005s"):
                    run = simulate(parse(uniform.replace("0.001s", step)))
                    self.assertLess(run["temperature_variance"], 1e-18)
                    self.assertLess(run["mean_temperature"], 330)
                    errors.append(abs(run["mean_temperature"] - ambient - exact_excess))
                self.assertGreater(errors[0], errors[1] * 3)
                self.assertGreater(errors[1], errors[2] * 3)
                self.assertLess(errors[-1], 1e-4)

    def test_rejects_unsupported_or_unsafe_polynomial_equations(self):
        for source in (
            SOURCE.replace("ambientTemperature²", "ambientTemperature"),
            SOURCE.replace("ambientTemperature²", "temperature²"),
            SOURCE.replace("(temperature − ambientTemperature)³",
                           "(temperature + ambientTemperature)³"),
            SOURCE.replace("(temperature − ambientTemperature)³",
                           "(temperature − ambientTemperature)⁵"),
            SOURCE.replace("− reactionRate", "+ reactionRate"),
            quartic(SOURCE).replace("ambientTemperature³", "ambientTemperature²"),
        ):
            with self.subTest(source=source[-120:]), self.assertRaises(FlowMathError):
                parse(source)
        with self.assertRaisesRegex(FlowMathError, "temperature >= ambientTemperature"):
            simulate(parse(SOURCE.replace(INITIAL, "290K")))
        with self.assertRaisesRegex(FlowMathError, "nonlinear reaction stability"):
            simulate(replace(parse(SOURCE), reaction_rate=1000000))

    def test_checked_in_program_runs_from_real_cli(self):
        completed = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_cubic_reaction.flow"],
            cwd=ROOT, capture_output=True, text=True, timeout=45)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["steps"], 100)
        self.assertLess(result["mean_temperature"], result["initial_mean_temperature"])
        self.assertEqual(result["spatial"]["grid"], [24, 24])


if __name__ == "__main__":
    unittest.main()
