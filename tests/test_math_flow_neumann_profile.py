"""Executable typed Neumann profiles: face geometry, outward flux, RK2 stages."""
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

SOURCE = (ROOT / "examples/heat_neumann_profile.flow").read_text(encoding="utf-8")
PROFILE = "2K/m*sin(2πy / 1m) + 1K/m*t / 1s"


class NeumannProfileTest(unittest.TestCase):
    def test_exact_spacetime_face_ghost_and_conservation(self):
        model = parse(SOURCE)
        self.assertEqual(model.boundary_faces[0][0], "NeumannProfile")
        nx, ny = model.width, model.height
        dx, dy = model.length_x / nx, model.length_y / ny
        x, y = np.meshgrid((np.arange(nx) + .5) * dx,
                           (np.arange(ny) + .5) * dy, indexing="ij")
        field = np.full((nx, ny), 300.)
        laplacian = parse_expression("∇²temperature", symbols={"temperature": TEMPERATURE})
        for stage_time in (0., .25, .75):
            observed = evaluate(laplacian, x, y,
                                values={"temperature": field, "t": stage_time},
                                boundary_faces=model.boundary_faces)
            gradient = 2 * np.sin(2 * np.pi * y[0, :] / model.length_y) + stage_time
            np.testing.assert_allclose(observed[0, :], gradient / dx,
                                       rtol=0, atol=2e-10)
            np.testing.assert_allclose(observed[1:, :], 0, rtol=0, atol=1e-10)
            self.assertAlmostEqual(float(np.mean(observed)), stage_time / model.length_x,
                                   delta=1e-12)

    def test_exact_one_step_rk2_temporal_ramp_and_spatial_flux(self):
        model = parse(SOURCE.replace(PROFILE, "1K/m*t / 1s").replace(
            "timeStep = 10⁻⁴s", "timeStep = 0.01s"))
        result = simulate(model)
        self.assertEqual(result["steps"], 1)
        expected = 300 + model.diffusivity * model.until**2 / (2 * model.length_x)
        self.assertAlmostEqual(result["mean_temperature"], expected, delta=1e-9)
        self.assertGreater(result["temperature_variance"], 0)
        # With a zero-mean sinusoidal gradient, only the temporal ramp changes
        # the integrated temperature. Trapezoidal RK2 integrates it exactly.
        full = simulate(parse(SOURCE))
        self.assertAlmostEqual(full["mean_temperature"], expected, delta=1e-9)

    def test_face_coordinate_is_geometric_boundary_not_cell_center(self):
        source = SOURCE.replace(
            "Neumann(" + PROFILE + "), Neumann(0K/m)",
            "Neumann(0K/m), Neumann(1K/m*x / 1m)")
        model = parse(source)
        self.assertEqual(model.boundary_faces[1][0], "NeumannProfile")
        n = model.width
        dx = model.length_x / n
        x, y = np.meshgrid((np.arange(n) + .5) * dx,
                           (np.arange(n) + .5) * dx, indexing="ij")
        lap = evaluate(parse_expression("∇²temperature",
                        symbols={"temperature": TEMPERATURE}), x, y,
                       values={"temperature": np.full((n, n), 300.), "t": 0.},
                       boundary_faces=model.boundary_faces)
        np.testing.assert_allclose(lap[-1, :], 1 / dx, atol=1e-10, rtol=0)
        np.testing.assert_allclose(lap[:-1, :], 0, atol=1e-10, rtol=0)

    def test_dimension_and_dependency_rejection(self):
        for bad in ("300K", "2K/m + t", "2K/m + sin(2πy / 1s)*1K/m",
                    "temperature", "∂ₓ(300K)", "2m/s"):
            with self.subTest(bad=bad), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(PROFILE, bad))
        n = 8
        x, y = np.meshgrid((np.arange(n) + .5)/n,
                           (np.arange(n) + .5)/n, indexing="ij")
        lap = parse_expression("∇²temperature", symbols={"temperature": TEMPERATURE})
        with self.assertRaises(ExpressionError):
            evaluate(lap, x, y, values={"temperature": np.full((n, n), 300.), "t": 0.},
                     boundary_faces=(("NeumannProfile", "300K"), ("Neumann", 0.),
                                     ("Neumann", 0.), ("Neumann", 0.)))
        with self.assertRaises(ExpressionError):
            evaluate(lap, x, y, values={"temperature": np.full((n, n), 300.), "t": 0.},
                     boundary_faces=(("NeumannProfile", "∂ₓ(300K)"), ("Neumann", 0.),
                                     ("Neumann", 0.), ("Neumann", 0.)))

    def test_cli_executes_real_checked_in_program(self):
        result = simulate(parse(SOURCE))
        self.assertGreater(result["temperature_variance"], 0)
        self.assertEqual(result["boundary_faces"]["x_min"]["type"], "NeumannProfile")
        self.assertIn("temperature", result["spatial"]["fields"])
        completed = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_neumann_profile.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertTrue(payload["ok"])
        self.assertAlmostEqual(payload["mean_temperature"],
                               result["mean_temperature"], places=9)


if __name__ == "__main__":
    unittest.main()
