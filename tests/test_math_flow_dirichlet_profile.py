"""Executable typed Dirichlet face profiles, analytic ghost cells and RK2 stages."""
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

SOURCE = (ROOT / "examples/heat_dirichlet_profile.flow").read_text(encoding="utf-8")


class DirichletProfileTest(unittest.TestCase):
    def test_exact_spatial_and_temporal_face_ghost(self):
        model = parse(SOURCE)
        self.assertEqual(model.boundary_faces[0][0], "DirichletProfile")
        nx, ny = model.width, model.height
        dx, dy = model.length_x / nx, model.length_y / ny
        x, y = np.meshgrid((np.arange(nx) + .5) * dx,
                           (np.arange(ny) + .5) * dy, indexing="ij")
        state = np.full((nx, ny), 300.)
        laplacian = parse_expression("∇²temperature",
                                     symbols={"temperature": TEMPERATURE})
        for stage_time in (0., .25, .75):
            observed = evaluate(laplacian, x, y,
                                values={"temperature": state, "t": stage_time},
                                boundary_faces=model.boundary_faces)
            expected = 2 * (2 * np.sin(2 * np.pi * y[0, :] / model.length_y)
                            + stage_time) / dx**2
            np.testing.assert_allclose(observed[0, :], expected, atol=2e-10, rtol=0)
            np.testing.assert_allclose(observed[1:, :], 0, atol=1e-10, rtol=0)

    def test_exact_one_step_rk2_temporal_ramp(self):
        # Initial field is uniform and x-min boundary starts at 300K.
        # At t=0, k1=0. At t=dt, k2=2*diffusivity*dt/dx^2
        # in exactly the first column. The RK2 mean is known analytically.
        source = SOURCE.replace("300K + 2K*sin(2πy / 1m) + 1K*t / 1s",
                                "300K + 1K*t / 1s")
        source = source.replace("timeStep = 10⁻⁴s", "timeStep = 0.01s")
        model = parse(source)
        self.assertEqual(model.boundary_faces[0][0], "DirichletProfile")
        result = simulate(model)
        self.assertEqual(result["steps"], 1)
        dx = model.length_x / model.width
        expected = 300 + model.diffusivity * model.until**2 / (model.width * dx**2)
        self.assertAlmostEqual(result["mean_temperature"], expected, delta=1e-9)
        self.assertGreater(result["temperature_variance"], 0)

    def test_real_program_and_native_json_payload(self):
        model = parse(SOURCE)
        result = simulate(model)
        self.assertGreater(result["temperature_variance"], 0)
        self.assertLess(result["temperature_min"], result["temperature_max"])
        self.assertEqual(result["boundary_faces"]["x_min"]["type"], "DirichletProfile")
        self.assertIn("temperature", result["spatial"]["fields"])
        completed = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_dirichlet_profile.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertTrue(payload["ok"])
        self.assertAlmostEqual(payload["mean_temperature"],
                               result["mean_temperature"], places=9)

    def test_dimension_and_dependency_rejection(self):
        for bad in ("300K + 2m", "300K + 1K*t",
                    "300K + sin(2πy / 1s)*1K",
                    "temperature", "∂ₓ(300K)"):
            with self.subTest(bad=bad), self.assertRaises(FlowMathError):
                parse(SOURCE.replace("300K + 2K*sin(2πy / 1m) + 1K*t / 1s", bad))
        with self.assertRaises(ExpressionError):
            parse_expression("temperature", symbols={"t": (0, 0, 1, 0)})


if __name__ == "__main__":
    unittest.main()
