"""Semantic RK2 inspection is measured from the same typed AST as the solver."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import parse, simulate
from math_flow_equations import semantic_heat_terms, TEMPERATURE_RATE

COMPOSED = (ROOT / "examples/heat_composed_forcing.flow").read_text(encoding="utf-8")
TRANSPORT = (ROOT / "examples/heat_transport_reaction.flow").read_text(encoding="utf-8")
NAVIER = ROOT / "examples/navier_stokes_smoke.flow"


class SemanticTraceTest(unittest.TestCase):
    def test_composed_forcing_has_real_signed_terms_and_two_rk2_stages(self):
        model = parse(COMPOSED)
        trace = simulate(model)["semantic_trace"]
        self.assertEqual(trace["schema"], 1)
        self.assertEqual(trace["field"], "temperature")
        self.assertEqual(trace["rateUnit"], "K/s")
        self.assertEqual(trace["integrator"], "RungeKuttaSecondOrder")
        self.assertEqual(trace["timeStep"], model.step)
        self.assertEqual([stage["name"] for stage in trace["stages"]],
                         ["initialSlope", "predictorSlope"])
        self.assertEqual([stage["time"] for stage in trace["stages"]],
                         [0, model.step])
        first, second = trace["stages"]
        self.assertEqual([term["role"] for term in first["terms"]],
                         ["diffusion", "forcing", "forcing", "forcing", "forcing", "forcing"])
        self.assertEqual([term["sign"] for term in first["terms"]],
                         [1, 1, 1, -1, 1, 1])
        self.assertEqual(first["terms"][0]["symbols"], ["diffusivity", "temperature"])
        for stage in (first, second):
            self.assertLess(stage["maximumDecompositionResidual"], 1e-11)
            self.assertLess(abs(sum(term["mean"] for term in stage["terms"]) -
                                stage["rhsMean"]), 1e-11)
            for term in stage["terms"]:
                self.assertEqual(term["dimension"], list(TEMPERATURE_RATE))
                self.assertTrue(term["meaning"])
                self.assertLessEqual(term["minimum"], term["maximum"])
        self.assertAlmostEqual(first["rhsMean"], 2.0, places=11)
        expected_second = (2 * math.sin(2 * math.pi * model.step) +
                           3 * math.cos(2 * math.pi * model.step) - 1)
        self.assertAlmostEqual(second["rhsMean"], expected_second, places=11)
        update = trace["update"]
        self.assertAlmostEqual(update["initialMean"], 300.0, places=11)
        self.assertAlmostEqual(update["predictorMean"], 300 + model.step * 2, places=11)
        self.assertAlmostEqual(update["updatedMean"],
                               300 + .5 * model.step * (2 + expected_second), places=11)
        self.assertGreater(update["maximumCorrectorDifference"], 0)

    def test_reaction_advection_and_diffusion_roles_follow_compiled_ast(self):
        model = parse(TRANSPORT)
        classified = semantic_heat_terms(model.equation)
        self.assertEqual([(sign, role) for _, sign, role in classified],
                         [(1, "diffusion"), (-1, "advection"), (-1, "advection"),
                          (-1, "reaction"), (1, "forcing")])
        trace = simulate(model)["semantic_trace"]
        for stage in trace["stages"]:
            self.assertEqual([term["role"] for term in stage["terms"]],
                             [role for _, _, role in classified])
            self.assertLess(stage["maximumDecompositionResidual"], 1e-10)

    def test_cli_returns_actual_trace_and_navier_stokes_still_executes(self):
        for source in ("examples/heat_composed_forcing.flow",
                       "examples/navier_stokes_smoke.flow"):
            with self.subTest(source=source):
                run = subprocess.run([sys.executable, "src/math_flow.py", source],
                                     cwd=ROOT, capture_output=True, text=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                result = json.loads(run.stdout)
                self.assertTrue(result["ok"])
                self.assertEqual(result["steps"], 100 if "heat_" in source else 10)
                if "heat_" in source:
                    self.assertEqual(len(result["semantic_trace"]["stages"]), 2)
                else:
                    self.assertLess(result["max_divergence"], 1e-4)
                    self.assertNotIn("semantic_trace", result)


if __name__ == "__main__":
    unittest.main()
