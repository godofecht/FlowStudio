"""Analytic Fourier-mode acceptance for mean-conserving nonlocal mixing."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from math_flow import FlowMathError, parse, simulate
from math_flow_equations import TEMPERATURE_RATE, semantic_heat_terms

PROGRAM = ROOT / "examples/heat_mean_preserving_mixing.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")


class MeanPreservingMixingTest(unittest.TestCase):
    def test_compiler_accepts_typed_live_nonlocal_feedback(self):
        model = parse(SOURCE)
        self.assertEqual(model.equation.rhs.dimension, TEMPERATURE_RATE)
        self.assertEqual(model.equation.reaction_kind, "meanDeviation")
        self.assertEqual(model.ambient_temperature, 0.0)
        self.assertFalse(model.equation.nonlinear)
        self.assertEqual([(sign, role) for _, sign, role in semantic_heat_terms(model.equation)],
                         [(1, "diffusion"), (-1, "meanDeviation")])

    def test_rejects_undeclared_constants_and_unsupported_feedback(self):
        for bad in (
            SOURCE.replace("    const reactionRate      = 2s⁻¹\n", ""),
            SOURCE.replace("    const reactionRate      = 2s⁻¹",
                           "    const reactionRate      = 2s⁻¹\n    const ambientTemperature = 295K"),
            SOURCE.replace("− reactionRate", "+ reactionRate"),
            SOURCE.replace("temperature − mean(temperature)",
                           "mean(temperature) − temperature"),
            SOURCE.replace("mean(temperature)", "mean(temperature * temperature)"),
            SOURCE.replace("mean(temperature)", "mean(temperature − 295K)"),
        ):
            with self.subTest(bad=bad):
                with self.assertRaises(FlowMathError):
                    parse(bad)

    def test_mean_is_conserved_and_mode_decay_matches_discrete_analytic_solution(self):
        model = parse(SOURCE)
        result = simulate(model)
        duration = model.until
        wave_number_squared = 4 * model.width**2 * math.sin(math.pi / model.width)**2
        amplitude = 10 * math.exp(-(model.diffusivity * wave_number_squared
                                    + model.reaction_rate) * duration)
        self.assertEqual(result["steps"], 100)
        self.assertAlmostEqual(result["mean_temperature"], 300.0, delta=1e-9)
        self.assertAlmostEqual(result["temperature_variance"], amplitude**2 / 2, delta=1e-7)
        self.assertLess(result["temperature_variance"], result["initial_temperature_variance"])
        self.assertIn("temperature", result["spatial"]["fields"])
        stages = result["semantic_trace"]["stages"]
        for stage in stages:
            self.assertEqual([term["role"] for term in stage["terms"]],
                             ["diffusion", "meanDeviation"])
            self.assertAlmostEqual(stage["rhsMean"], 0.0, delta=1e-10)
            self.assertLess(stage["maximumDecompositionResidual"], 1e-9)
            self.assertAlmostEqual(stage["terms"][1]["mean"], 0.0, delta=1e-10)
        self.assertGreater(stages[0]["terms"][1]["maximum"], 0.0)
        self.assertLess(stages[0]["terms"][1]["minimum"], 0.0)

    def test_checked_in_program_is_compiled_and_executed_by_cli(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                run = subprocess.run([sys.executable, "src/math_flow.py", *flags, str(PROGRAM)],
                                     cwd=ROOT, capture_output=True, text=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                payload = json.loads(run.stdout)
                self.assertTrue(payload["ok"])
                if not flags:
                    self.assertEqual(payload["steps"], 100)
                    self.assertAlmostEqual(payload["mean_temperature"], 300.0, delta=1e-9)


if __name__ == "__main__":
    unittest.main()
