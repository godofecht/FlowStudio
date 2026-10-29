"""Measured first-step Navier-Stokes semantic inspection and analytic shear mode."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import parse, simulate

SOURCE = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")
PROPOSED = (ROOT / "examples/navier_stokes_proposed.flow").read_text(encoding="utf-8")


class NavierSemanticTraceTest(unittest.TestCase):
    def test_real_nonlinear_projection_and_term_decomposition(self):
        result = simulate(parse(SOURCE))
        trace = result["semantic_trace"]
        self.assertEqual((trace["schema"], trace["field"], trace["rateUnit"]),
                         (2, "velocity", "m/s²"))
        self.assertEqual([stage["name"] for stage in trace["stages"]],
                         ["initialSlope", "predictorSlope"])
        self.assertEqual([stage["time"] for stage in trace["stages"]],
                         [0.0, trace["timeStep"]])
        for stage in trace["stages"]:
            self.assertEqual([term["role"] for term in stage["terms"]],
                             ["advection", "diffusion"])
            self.assertLess(stage["maximumDecompositionResidual"], 1e-10)
            self.assertGreater(stage["terms"][0]["maximumMagnitude"], 0)
            for term in stage["terms"]:
                self.assertEqual(term["dimension"], [1, 0, -2, 0])
                self.assertGreaterEqual(term["maximumMagnitude"], term["meanMagnitude"])
        self.assertEqual([entry["name"] for entry in trace["projections"]],
                         ["initial", "predictor", "corrector"])
        for projection in trace["projections"]:
            self.assertLess(projection["maximumDivergenceAfter"], 1e-5)
            self.assertLess(abs(projection["pressureMean"]), 1e-8)
        self.assertAlmostEqual(trace["update"]["updatedKineticEnergy"],
                               result["observations"][1]["kineticEnergy"], places=10)

    def test_analytic_shear_first_step_rk2_fourier_mode(self):
        shear = PROPOSED.replace("sin(2πx / 1m) * 1m/s", "0m/s")
        model = parse(shear)
        grid = 32
        result = simulate(model, grid=grid, until=model.step)
        trace = result["semantic_trace"]
        dt = trace["timeStep"]
        discrete_eigenvalue = 4 * math.sin(math.pi / grid)**2 * grid**2
        rate = model.viscosity * discrete_eigenvalue
        expected_initial_rms = rate / math.sqrt(2)
        expected_predictor_rms = (1 - dt * rate) * expected_initial_rms
        self.assertAlmostEqual(trace["stages"][0]["rhsRms"], expected_initial_rms, places=9)
        self.assertAlmostEqual(trace["stages"][1]["rhsRms"], expected_predictor_rms, places=9)
        for stage in trace["stages"]:
            self.assertLess(stage["terms"][0]["maximumMagnitude"], 1e-10)
        for projection in trace["projections"]:
            self.assertLess(projection["maximumDivergenceAfter"], 1e-9)
        expected_ratio = (1 - dt * rate + .5 * (dt * rate)**2)**2
        self.assertAlmostEqual(result["kinetic_energy"] / result["initial_kinetic_energy"],
                               expected_ratio, places=9)
        self.assertAlmostEqual(trace["update"]["updatedKineticEnergy"],
                               result["kinetic_energy"], places=10)

    def test_cli_executes_checked_in_navier_flow_and_returns_trace(self):
        run = subprocess.run([sys.executable, "src/math_flow.py",
                              "examples/navier_stokes_smoke.flow"], cwd=ROOT,
                             capture_output=True, text=True, timeout=45)
        self.assertEqual(run.returncode, 0, run.stderr)
        output = json.loads(run.stdout)
        self.assertTrue(output["ok"])
        self.assertEqual(output["semantic_trace"]["schema"], 2)
        self.assertLess(output["max_divergence"], 1e-5)


if __name__ == "__main__":
    unittest.main()
