"""Executable Robin transfer-length profiles: dimensional and numerical acceptance."""
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

SOURCE = (ROOT / "examples/heat_robin_transfer_profile.flow").read_text(encoding="utf-8")
AMBIENT = "300K + 2K*sin(2πy / 1m) + 1K*t / 1s"
LENGTH = "0.2m + 0.05m*sin(2πy / 1m) + 0.01m*t / 1s"


class RobinTransferProfileTest(unittest.TestCase):
    def test_exact_discrete_face_flux_at_three_stage_times(self):
        model = parse(SOURCE)
        self.assertEqual(model.boundary_faces[0][0], "RobinProfile")
        n = model.width
        dx = model.length_x / n
        x, y = np.meshgrid((np.arange(n) + .5) * dx,
                           (np.arange(n) + .5) * dx, indexing="ij")
        field = np.full((n, n), 310.)
        laplacian = parse_expression("∇²temperature", symbols={"temperature": TEMPERATURE})
        for time in (0., .25, .75):
            actual = evaluate(laplacian, x, y, values={"temperature": field, "t": time},
                              boundary_faces=model.boundary_faces)
            ambient = 300 + 2 * np.sin(2 * np.pi * y[0, :]) + time
            length = .2 + .05 * np.sin(2 * np.pi * y[0, :]) + .01 * time
            expected = (ambient - 310) / (dx * (length + dx / 2))
            np.testing.assert_allclose(actual[0, :], expected, rtol=0, atol=1e-10)
            np.testing.assert_allclose(actual[1:, :], 0., rtol=0, atol=1e-10)

    def test_exact_rk2_time_varying_transfer_length(self):
        source = SOURCE.replace(AMBIENT, "310K + 1K*t / 1s")
        source = source.replace(LENGTH, "0.2m + 0.1m*t / 1s")
        source = source.replace("timeStep = 10⁻⁴s", "timeStep = 0.01s")
        model = parse(source)
        result = simulate(model)
        self.assertEqual(result["steps"], 1)
        dx = model.length_x / model.width
        time = model.until
        expected = 310 + .5 * model.diffusivity * time**2 / (
            model.width * dx * (.2 + .1 * time + dx/2))
        self.assertAlmostEqual(result["mean_temperature"], expected, delta=1e-9)

    def test_constant_ambient_variable_length_and_axis_syntax(self):
        source = SOURCE.replace(AMBIENT, "300K")
        model = parse(source)
        self.assertEqual(model.boundary_faces[0], ("RobinProfile", (300., LENGTH.replace(" ", ""))))
        self.assertGreater(simulate(model)["temperature_variance"], 0)
        face = "("+ "Robin("+AMBIENT+", "+LENGTH+"), Neumann(0K/m), Periodic, Periodic)"
        uniform = parse(SOURCE.replace(face, "Robin("+AMBIENT+", "+LENGTH+")"))
        self.assertEqual(simulate(uniform)["boundary_condition"], "Robin")
        axis = parse(SOURCE.replace(face, "(Robin("+AMBIENT+", "+LENGTH+"), Neumann(0K/m))"))
        self.assertEqual(simulate(axis)["boundary_condition"], "Mixed")

    def test_reject_bad_units_and_runtime_nonpositive_profile(self):
        for bad in ("0m", "-0.2m", "0.2K", "0.2m + 1K*t/1s",
                    "temperature", "∂ₓ(0.2m)", "0.2m + 1m*t"):
            with self.subTest(bad=bad), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(LENGTH, bad))
        model = parse(SOURCE.replace(LENGTH, "0.2m - 100m*t / 1s"))
        with self.assertRaises((ExpressionError, ValueError)):
            simulate(model, until=.01)
        x, y = np.meshgrid((np.arange(8)+.5)/8, (np.arange(8)+.5)/8, indexing="ij")
        laplacian = parse_expression("∇²temperature", symbols={"temperature": TEMPERATURE})
        with self.assertRaises(ExpressionError):
            evaluate(laplacian, x, y, values={"temperature": np.full((8, 8), 310.), "t": 0.},
                     boundary_faces=(("RobinProfile", (300., "0.2K")), ("Neumann", 0.),
                                     ("Periodic", None), ("Periodic", None)))

    def test_cli_executes_checked_in_flow_source(self):
        completed = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_robin_transfer_profile.flow"],
            cwd=ROOT, capture_output=True, text=True, timeout=45)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["boundary_faces"]["x_min"]["value"][1], LENGTH.replace(" ", ""))
        self.assertGreater(payload["temperature_variance"], 0)


if __name__ == "__main__":
    unittest.main()
