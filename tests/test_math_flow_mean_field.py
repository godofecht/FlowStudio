"""Real nonlocal mean-field heat equation, dimensional checks, and analytic RK2."""
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
from math_flow_expr import TEMPERATURE, ExpressionError, evaluate, parse_expression
from math_flow_equations import TEMPERATURE_RATE, semantic_heat_terms

PROGRAM = ROOT / "examples/heat_mean_field_feedback.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class MeanFieldFlowTest(unittest.TestCase):
    def setUp(self):
        coordinates = (np.arange(32) + .5) / 32
        self.x, self.y = np.meshgrid(coordinates, coordinates, indexing="ij")

    def test_mean_is_a_typed_spatial_reduction(self):
        expression = parse_expression("mean(300K + 10K*sin(2πx/1m))")
        self.assertEqual(expression.operator, "mean")
        self.assertEqual(expression.dimension, TEMPERATURE)
        self.assertAlmostEqual(float(evaluate(expression, self.x, self.y)), 300, places=12)
        state = 300 + 10 * np.sin(2 * np.pi * self.x)
        field_mean = parse_expression("mean(temperature)", symbols={"temperature": TEMPERATURE})
        self.assertAlmostEqual(float(evaluate(field_mean, self.x, self.y,
                                              values={"temperature": state})), 300, places=12)
        self.assertEqual(parse_expression("mean(2m)").dimension, (1, 0, 0, 0))

    def test_mean_rejects_bad_dimensions_unknowns_and_arity(self):
        for source in ("mean()", "mean(1K, 2K)", "mean(unknown)",
                       "mean(1K) + 1m", "mean(1K, 2m)"):
            with self.subTest(source=source), self.assertRaises(ExpressionError):
                parse_expression(source)

    def test_compiler_accepts_only_negative_live_mean_feedback(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        self.assertEqual(model.equation.reaction_kind, "meanField")
        self.assertFalse(model.equation.nonlinear)
        terms = semantic_heat_terms(model.equation)
        self.assertEqual([(sign, role) for _, sign, role in terms],
                         [(1, "diffusion"), (-1, "meanField")])
        for bad in (
            SOURCE.replace("− reactionRate", "+ reactionRate"),
            SOURCE.replace("mean(temperature)", "mean(temperature * temperature)"),
            SOURCE.replace("mean(temperature)", "mean(temperature − 295K)"),
        ):
            with self.subTest(bad=bad[bad.index("dynamics"):bad.index("initial")]):
                with self.assertRaises(FlowMathError):
                    parse(bad)

    def test_existing_local_relaxation_remains_valid(self):
        local = parse(SOURCE.replace("mean(temperature)", "temperature"))
        self.assertEqual(local.equation.reaction_kind, "linear")
        self.assertEqual([role for _, _, role in semantic_heat_terms(local.equation)],
                         ["diffusion", "reaction"])

    def test_analytic_mean_and_fourier_mode_are_independent(self):
        model = parse(SOURCE)
        result = simulate(model)
        duration = model.until
        mean = 295 + 5 * math.exp(-model.reaction_rate * duration)
        discrete_wave_number_squared = 4 * model.width**2 * math.sin(math.pi / model.width)**2
        amplitude = 10 * math.exp(-model.diffusivity * discrete_wave_number_squared * duration)
        self.assertEqual(result["steps"], 100)
        self.assertAlmostEqual(result["mean_temperature"], mean, delta=1e-7)
        self.assertAlmostEqual(result["temperature_variance"], amplitude**2 / 2, delta=1e-7)
        self.assertLess(result["mean_temperature"], 300)
        self.assertGreater(result["mean_temperature"], 295)
        self.assertIn("temperature", result["spatial"]["fields"])
        trace = result["semantic_trace"]
        self.assertEqual([term["role"] for term in trace["stages"][0]["terms"]],
                         ["diffusion", "meanField"])
        self.assertAlmostEqual(trace["stages"][0]["rhsMean"], -10, delta=1e-10)
        self.assertAlmostEqual(trace["stages"][1]["rhsMean"], -9.998, delta=1e-8)
        for stage in trace["stages"]:
            self.assertLess(stage["maximumDecompositionResidual"], 1e-9)

    def test_native_cli_checks_and_executes_checked_in_program(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                run = subprocess.run([sys.executable, "src/math_flow.py", *flags, str(PROGRAM)],
                                     cwd=ROOT, capture_output=True, text=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                payload = json.loads(run.stdout)
                self.assertTrue(payload["ok"])
                if not flags:
                    self.assertEqual(payload["steps"], 100)
                    self.assertLess(abs(payload["mean_temperature"] -
                                        (295 + 5 * math.exp(-.02))), 1e-7)


if __name__ == "__main__":
    unittest.main()
