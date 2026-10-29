"""Typed spatial moments and analytic Fourier heat forcing via native mathematical Flow."""
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

PROGRAM = ROOT / "examples/heat_spatial_moments.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class SpatialMomentsTest(unittest.TestCase):
    def setUp(self):
        coordinates = (np.arange(32) + .5) / 32
        self.x, self.y = np.meshgrid(coordinates, coordinates, indexing="ij")
        self.wave = 10 * np.sin(2 * np.pi * self.x)

    def test_moment_dimensions_and_real_spatial_numpy_reductions(self):
        for source, expected_dimension, expected_value in (
            ("mean(10K*sin(2πx/1m))", TEMPERATURE, 0.0),
            ("variance(10K*sin(2πx/1m))", (0, 0, 0, 2), 50.0),
            ("std(10K*sin(2πx/1m))", TEMPERATURE, 10 / math.sqrt(2)),
            ("rms(10K*sin(2πx/1m))", TEMPERATURE, 10 / math.sqrt(2)),
            ("variance(3m)", (2, 0, 0, 0), 0.0),
            ("std(3m)", (1, 0, 0, 0), 0.0),
            ("rms(3m)", (1, 0, 0, 0), 3.0),
        ):
            with self.subTest(source=source):
                expression = parse_expression(source)
                self.assertEqual(expression.dimension, expected_dimension)
                self.assertAlmostEqual(float(evaluate(expression, self.x, self.y)),
                                       expected_value, delta=1e-12)

    def test_moments_of_live_field_are_distinct_from_rms(self):
        state = 300 + self.wave
        symbols = {"temperature": TEMPERATURE}
        expected = {"mean": 300., "variance": 50., "std": 10 / math.sqrt(2),
                    "rms": math.sqrt(300**2 + 50)}
        for name, value in expected.items():
            with self.subTest(name=name):
                expression = parse_expression(f"{name}(temperature)", symbols=symbols)
                actual = evaluate(expression, self.x, self.y, values={"temperature": state})
                self.assertAlmostEqual(float(actual), value, delta=1e-11)

    def test_rms_is_stable_for_large_finite_values(self):
        for source, expected in (("rms(1e200K)", 1e200),
                                 ("rms(1e308K)", 1e308),
                                 ("rms(0K)", 0.0)):
            with self.subTest(source=source):
                actual = float(evaluate(parse_expression(source), self.x, self.y))
                self.assertTrue(math.isfinite(actual))
                self.assertAlmostEqual(actual / expected if expected else actual, 1.0 if expected else 0.0)

    def test_invalid_arity_units_and_predicates_fail_closed(self):
        for source in ("variance()", "std()", "rms()",
                       "variance(1K,2K)", "std(1K,2K)", "rms(1K,2K)",
                       "variance(unknown)", "std(1K > 0K)",
                       "variance(1K)+1K", "rms(1K)+1m"):
            with self.subTest(source=source), self.assertRaises(ExpressionError):
                parse_expression(source)
        for bad in (
            SOURCE.replace("/1K²", "/1K"),
            SOURCE.replace("rms(10K*sin(2πx/1m))", "rms(temperature)"),
        ):
            with self.subTest(bad=bad), self.assertRaises(FlowMathError):
                parse(bad)

    def test_checked_in_heat_program_matches_discrete_analytic_fourier_mode(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        self.assertEqual([role for _, _, role in semantic_heat_terms(model.equation)],
                         ["diffusion", "forcing"])
        forcing = 50 + 20 / math.sqrt(2)
        rhs = evaluate(model.equation.rhs, self.x, self.y,
                       expected_dimension=TEMPERATURE_RATE,
                       values={"temperature": np.full_like(self.x, 300.),
                               "diffusivity": model.diffusivity, "t": 0.})
        np.testing.assert_allclose(rhs, forcing * np.sin(2 * np.pi * self.x),
                                   atol=1e-12, rtol=0)
        result = simulate(model)
        wave_number_squared = 4 * model.width**2 * math.sin(math.pi / model.width)**2
        decay = model.diffusivity * wave_number_squared
        amplitude = forcing * (-math.expm1(-decay * model.until)) / decay
        self.assertEqual(result["steps"], 100)
        self.assertAlmostEqual(result["mean_temperature"], 300., delta=1e-9)
        self.assertAlmostEqual(result["temperature_variance"], amplitude**2 / 2,
                               delta=1e-8)
        self.assertIn("temperature", result["spatial"]["fields"])
        for stage in result["semantic_trace"]["stages"]:
            self.assertEqual([term["role"] for term in stage["terms"]],
                             ["diffusion", "forcing"])
            self.assertLess(stage["maximumDecompositionResidual"], 1e-9)

    def test_real_cli_check_and_numerical_execution(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                run = subprocess.run([sys.executable, "src/math_flow.py", *flags,
                                      str(PROGRAM)], cwd=ROOT,
                                     capture_output=True, text=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                payload = json.loads(run.stdout)
                self.assertTrue(payload["ok"])
                if not flags:
                    self.assertEqual(payload["steps"], 100)
                    self.assertGreater(payload["temperature_variance"], 0)


if __name__ == "__main__":
    unittest.main()
