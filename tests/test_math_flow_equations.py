"""Typed Unicode equation AST, real forced PDE integration and analytic checks."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_expr import ExpressionError, TEMPERATURE, evaluate, parse_expression
from math_flow_equations import compile_heat_equation, TEMPERATURE_RATE

HEAT = (ROOT / "examples/heat_equation_smoke.flow").read_text(encoding="utf-8")
FORCED = (ROOT / "examples/heat_equation_forced.flow").read_text(encoding="utf-8")


class TypedHeatEquationTest(unittest.TestCase):
    def test_typed_equation_ast_and_actual_numpy_lowering(self):
        import numpy as np
        eq = compile_heat_equation(
            ["∂", "ₜ", "temperature", "=", "diffusivity", "∇", "²",
             "temperature", "+", "2", "K", "/", "s"])
        self.assertEqual(eq.field, "temperature")
        self.assertEqual(eq.rhs.dimension, TEMPERATURE_RATE)
        self.assertEqual(eq.rhs.operator, "add")
        self.assertEqual(eq.rhs.operands[0].operator, "mul")
        self.assertEqual(eq.rhs.operands[0].operands[1].operator, "∇²")
        n = 32
        coordinates = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
        field = 300.0 + 10.0 * np.sin(2 * np.pi * x) * np.sin(2 * np.pi * y)
        result = evaluate(eq.rhs, x, y, expected_dimension=TEMPERATURE_RATE,
                          values={"temperature": field, "diffusivity": .01})
        laplacian = ((np.roll(field, -1, 0) + np.roll(field, 1, 0) - 2 * field) * n**2
                     + (np.roll(field, -1, 1) + np.roll(field, 1, 1) - 2 * field) * n**2)
        np.testing.assert_allclose(result, .01 * laplacian + 2.0, rtol=0, atol=1e-10)
        with self.assertRaisesRegex(ExpressionError, "Missing numerical value"):
            evaluate(eq.rhs, x, y)

    def test_forced_uniform_heat_matches_analytic_mean_and_decay(self):
        model = parse(FORCED)
        self.assertIsNotNone(model.equation.forcing)
        result = simulate(model)
        self.assertEqual(result["steps"], 100)
        self.assertAlmostEqual(result["mean_temperature"], 300 + 2 * model.until, places=9)
        self.assertAlmostEqual(result["observations"][-1]["meanTemperature"],
                               result["mean_temperature"], places=10)
        self.assertLess(result["temperature_variance"], result["initial_temperature_variance"])
        n = model.width
        eigenvalue = 8 * n * n * math.sin(math.pi / n)**2
        target = math.exp(-2 * model.diffusivity * eigenvalue * model.until)
        ratio = result["temperature_variance"] / result["initial_temperature_variance"]
        self.assertLess(abs(ratio - target), 1e-6)

    def test_spatial_fourier_forcing_matches_analytic_amplitude(self):
        source = HEAT.replace(
            "diffusivity ∇²temperature",
            "diffusivity ∇²temperature + 1K/s * sin(2πx / 1m) * sin(2πy / 1m)")
        model = parse(source)
        result = simulate(model)
        n = model.width
        decay_rate = model.diffusivity * 8 * n * n * math.sin(math.pi / n)**2
        amplitude = 10 * math.exp(-decay_rate * model.until) + (
            1 - math.exp(-decay_rate * model.until)) / decay_rate
        self.assertAlmostEqual(result["mean_temperature"], 300, places=9)
        self.assertLess(abs(result["temperature_variance"] - amplitude**2 / 4), 1e-5)

    def test_rejects_dimensionally_wrong_and_nonparabolic_equations(self):
        for replacement in (
            "temperature / 1s",
            "diffusivity ∇²temperature + temperature / 1s",
            "diffusivity ∇²temperature + 1m/s",
            "diffusivity ∇²temperature + unknown",
            "diffusivity ∇²temperature + __import__('os')",
            "diffusivity ∇²temperature + diffusivity ∇²temperature",
        ):
            with self.subTest(replacement=replacement):
                with self.assertRaises(FlowMathError):
                    parse(HEAT.replace("diffusivity ∇²temperature", replacement))
        with self.assertRaises(FlowMathError):
            parse(HEAT.replace("∂ₜtemperature", "∂ₜvelocity"))
        with self.assertRaises(ExpressionError):
            parse_expression("temperature")

    def test_release_archive_includes_equation_compiler(self):
        packaging = (ROOT / "scripts/package.sh").read_text(encoding="utf-8")
        self.assertIn('cp src/math_flow_equations.py "$stage/$name/src/math_flow_equations.py"', packaging)

    def test_checked_in_forced_equation_executes_through_cli(self):
        run = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_equation_forced.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        output = json.loads(run.stdout)
        self.assertTrue(output["ok"])
        self.assertAlmostEqual(output["mean_temperature"], 300.02, places=9)
        self.assertIn("temperature", output["spatial"]["fields"])


if __name__ == "__main__":
    unittest.main()
