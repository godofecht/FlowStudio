"""Typed Robin ambient profile: physical face, RK2 stage time and CLI acceptance."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_expr import TEMPERATURE, ExpressionError, evaluate, parse_expression

SOURCE = (ROOT / "examples/heat_robin_profile.flow").read_text(encoding="utf-8")
AMBIENT = "300K + 2K*sin(2πy / 1m) + 1K*t / 1s"


class RobinProfileTest(unittest.TestCase):
    def test_face_ghost_and_time(self):
        model = parse(SOURCE)
        self.assertEqual(model.boundary_faces[0][0], "RobinProfile")
        n = model.width
        dx = model.length_x / n
        x, y = np.meshgrid((np.arange(n) + .5) * dx,
                           (np.arange(n) + .5) * dx, indexing="ij")
        state = np.full((n, n), 310.)
        expr = parse_expression("∇²temperature", symbols={"temperature": TEMPERATURE})
        for time in (0., .25, .75):
            lap = evaluate(expr, x, y, values={"temperature": state, "t": time},
                           boundary_faces=model.boundary_faces)
            ambient = 300 + 2 * np.sin(2 * np.pi * y[0, :]) + time
            expected = (ambient - 310) / (dx * (0.2 + dx/2))
            np.testing.assert_allclose(lap[0, :], expected, atol=1e-10, rtol=0)
            np.testing.assert_allclose(lap[1:, :], 0, atol=1e-10, rtol=0)

    def test_exact_one_step_rk2_temporal_robin(self):
        source = SOURCE.replace(AMBIENT, "310K + 1K*t / 1s")
        source = source.replace("timeStep = 10⁻⁴s", "timeStep = 0.01s")
        model = parse(source)
        result = simulate(model)
        self.assertEqual(result["steps"], 1)
        dx = model.length_x / model.width
        expected = 310 + model.diffusivity * model.until**2 / (
            2 * model.width * dx * (0.2 + dx/2))
        self.assertAlmostEqual(result["mean_temperature"], expected, delta=1e-9)
        self.assertGreater(result["temperature_variance"], 0)

    def test_reject_bad_ambient_units_and_dependencies(self):
        for bad in ("300m", "300K + 1K*t", "300K + 2m",
                    "300K + sin(2πy / 1s)*1K", "temperature", "∂ₓ(300K)"):
            with self.subTest(bad=bad), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(AMBIENT, bad))
        with self.assertRaises(FlowMathError):
            parse(SOURCE.replace("0.2m)", "0m)"))
        n = 8
        x, y = np.meshgrid((np.arange(n)+.5)/n, (np.arange(n)+.5)/n, indexing="ij")
        expr = parse_expression("∇²temperature", symbols={"temperature": TEMPERATURE})
        with self.assertRaises(ExpressionError):
            evaluate(expr, x, y, values={"temperature": np.full((n, n), 310.), "t": 0.},
                     boundary_faces=(("RobinProfile", ("300m", 0.2)), ("Neumann", 0.),
                                     ("Periodic", None), ("Periodic", None)))

    def test_axis_and_uniform_profiles(self):
        face = "("+ "Robin("+AMBIENT+", 0.2m), Neumann(0K/m), Periodic, Periodic)"
        uniform = parse(SOURCE.replace(face, "Robin("+AMBIENT+", 0.2m)"))
        self.assertEqual(uniform.boundary_axes[0][0], "RobinProfile")
        self.assertEqual(simulate(uniform)["boundary_condition"], "Robin")
        axis = parse(SOURCE.replace(face, "(Robin("+AMBIENT+", 0.2m), Neumann(0K/m))"))
        self.assertEqual(axis.boundary_axes[0][0], "RobinProfile")
        self.assertEqual(simulate(axis)["boundary_condition"], "Mixed")

    def test_cli_real_program(self):
        result = simulate(parse(SOURCE))
        self.assertGreater(result["temperature_variance"], 0)
        self.assertEqual(result["boundary_faces"]["x_min"]["type"], "RobinProfile")
        completed = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_robin_profile.flow"],
            cwd=ROOT, capture_output=True, text=True, timeout=45)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertTrue(payload["ok"])
        self.assertAlmostEqual(payload["mean_temperature"], result["mean_temperature"], places=9)


if __name__ == "__main__":
    unittest.main()
