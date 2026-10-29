"""Executable typed 2D spatial integrals and analytic Fourier heat equation."""
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

PROGRAM = ROOT / "examples/heat_spatial_integral.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class SpatialIntegralTest(unittest.TestCase):
    def setUp(self):
        coordinates = (np.arange(32) + .5) / 32
        self.x, self.y = np.meshgrid(coordinates, coordinates, indexing="ij")

    def test_typed_area_quadrature_and_unicode_alias(self):
        for source, dimension, expected in (
            ("integral(2K)", (2, 0, 0, 1), 2.0),
            ("∫(2K)", (2, 0, 0, 1), 2.0),
            ("∫(sin(2πx/1m))", (2, 0, 0, 0), 0.0),
            ("integral((10K*sin(2πx/1m))²)", (2, 0, 0, 2), 50.0),
        ):
            with self.subTest(source=source):
                expression = parse_expression(source)
                self.assertEqual(expression.dimension, dimension)
                self.assertAlmostEqual(float(evaluate(expression, self.x, self.y)),
                                       expected, delta=1e-11)

    def test_nonunit_domain_area_and_live_field(self):
        x, y = np.meshgrid((np.arange(20) + .5) * .1,
                           (np.arange(30) + .5) * .1, indexing="ij")
        expression = parse_expression("∫(4K)")
        self.assertAlmostEqual(float(evaluate(expression, x, y)), 24.0, delta=1e-11)
        field = 300 + 10 * np.sin(2 * np.pi * self.x)
        live = parse_expression("integral(temperature)", symbols={"temperature": TEMPERATURE})
        self.assertAlmostEqual(float(evaluate(live, self.x, self.y,
                                              values={"temperature": field})), 300.0, delta=1e-11)

    def test_invalid_dimensions_arity_predicates_and_grid_rejected(self):
        for source in ("integral()", "∫()", "integral(1K,2K)",
                       "∫(1K>0K)", "∫(1K)+1K", "integral(unknown)"):
            with self.subTest(source=source), self.assertRaises(ExpressionError):
                parse_expression(source)
        with self.assertRaises(ExpressionError):
            evaluate(parse_expression("∫(2K)"), np.arange(8), np.arange(8))
        with self.assertRaises(FlowMathError):
            parse(SOURCE.replace("/(1K²*1m²)", "/(1K²*1m)"))

    def test_executable_fourier_heat_matches_analytic_discrete_solution(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        self.assertEqual([role for _, _, role in semantic_heat_terms(model.equation)],
                         ["diffusion", "forcing"])
        rhs = evaluate(model.equation.rhs, self.x, self.y,
                       expected_dimension=TEMPERATURE_RATE,
                       values={"temperature": np.full_like(self.x, 300.0),
                               "diffusivity": model.diffusivity, "t": 0.0})
        np.testing.assert_allclose(rhs, 50 * np.sin(2 * np.pi * self.x),
                                   atol=1e-11, rtol=0)
        result = simulate(model)
        wave_number_squared = 4 * model.width**2 * math.sin(math.pi / model.width)**2
        decay = model.diffusivity * wave_number_squared
        amplitude = 50 * (-math.expm1(-decay * model.until)) / decay
        self.assertEqual(result["steps"], 100)
        self.assertAlmostEqual(result["mean_temperature"], 300.0, delta=1e-9)
        self.assertAlmostEqual(result["temperature_variance"], amplitude**2 / 2, delta=1e-8)
        self.assertIn("temperature", result["spatial"]["fields"])
        for stage in result["semantic_trace"]["stages"]:
            self.assertEqual([term["role"] for term in stage["terms"]],
                             ["diffusion", "forcing"])
            self.assertLess(stage["maximumDecompositionResidual"], 1e-9)

    def test_real_cli_check_and_execution(self):
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
