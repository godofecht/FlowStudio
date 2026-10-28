"""Real Robin heat-transfer numerical acceptance, typed parsing, and CLI."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_expr import ExpressionError, TEMPERATURE, evaluate, parse_expression

SOURCE = (ROOT / "examples/heat_robin.flow").read_text(encoding="utf-8")
FACES = "(Robin(300K, 0.2m), Neumann(0K/m), Periodic, Periodic)"


class RobinHeatTest(unittest.TestCase):
    def test_exact_discrete_robin_heat_evolution(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertEqual(model.boundary_faces[0], ("Robin", (300.0, 0.2)))
        result = simulate(model)
        self.assertEqual(result["boundary_condition"], "Faces")
        self.assertEqual(result["boundary_faces"]["x_min"],
                         {"type": "Robin", "value": (300.0, 0.2)})
        self.assertEqual(result["steps"], 100)
        n = model.width
        h = model.length_x / n
        matrix = np.diag(np.full(n, -2 / h**2))
        matrix += np.diag(np.full(n - 1, 1 / h**2), 1)
        matrix += np.diag(np.full(n - 1, 1 / h**2), -1)
        matrix[0, 0] += 1 / h**2 - 1 / (h * (0.2 + h/2))
        matrix[-1, -1] += 1 / h**2
        eigenvalues, eigenvectors = np.linalg.eigh(matrix)
        dt = result["time"] / result["steps"]
        factor = (1 + dt * model.diffusivity * eigenvalues
                  + 0.5 * (dt * model.diffusivity * eigenvalues)**2)**result["steps"]
        expected_x = 300 + eigenvectors @ (factor * (eigenvectors.T @ np.full(n, 10.0)))
        expected = np.broadcast_to(expected_x[:, None], (n, n))
        np.testing.assert_allclose(result["spatial"]["fields"]["temperature"],
                                   expected, rtol=0, atol=3e-10)
        self.assertLess(result["mean_temperature"], 310)
        self.assertGreater(result["mean_temperature"], 300)

    def test_exact_robin_ghost_flux_and_steady_equilibrium(self):
        import numpy as np
        n = 16
        h = 1/n
        x, y = np.meshgrid((np.arange(n) + 0.5)/n,
                           (np.arange(n) + 0.5)/n, indexing="ij")
        expr = parse_expression("∇²(temperature)", symbols={"temperature": TEMPERATURE})
        lap = evaluate(expr, x, y, values={"temperature": np.full((n, n), 310.)},
                       boundary_faces=parse(SOURCE).boundary_faces)
        np.testing.assert_allclose(lap[0, :], -10/(h*(0.2 + h/2)), rtol=0, atol=1e-10)
        np.testing.assert_allclose(lap[1:, :], 0, rtol=0, atol=1e-10)
        equilibrium = parse(SOURCE.replace("temperature = 310K", "temperature = 300K"))
        self.assertAlmostEqual(simulate(equilibrium)["mean_temperature"], 300., places=10)
        self.assertAlmostEqual(simulate(equilibrium)["temperature_variance"], 0., places=14)

    def test_uniform_and_axis_robin_declarations(self):
        uniform = parse(SOURCE.replace(FACES, "Robin(300K, 0.2m)"))
        self.assertEqual(uniform.boundary_axes,
                         (("Robin", (300., 0.2)), ("Robin", (300., 0.2))))
        self.assertEqual(simulate(uniform)["boundary_condition"], "Robin")
        axis = parse(SOURCE.replace(FACES, "(Robin(300K, 0.2m), Neumann(0K/m))"))
        self.assertEqual(axis.boundary_axes[0], ("Robin", (300., 0.2)))
        self.assertEqual(simulate(axis)["boundary_condition"], "Mixed")

    def test_invalid_robin_dimensions_and_nonfinite_values(self):
        for boundary in ("Robin(300m, 0.2m)", "Robin(300K, 0.2s)",
                         "Robin(300K, 0m)", "Robin(300K, -0.1m)",
                         "Robin(300K)", "Robin(300K, 0.2m, 1m)",
                         "Robin(300K, 0.2m) + Periodic"):
            with self.subTest(boundary=boundary), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(FACES, boundary))
        import numpy as np
        n = 8
        x, y = np.meshgrid((np.arange(n) + .5)/n,
                           (np.arange(n) + .5)/n, indexing="ij")
        expr = parse_expression("∇²(temperature)", symbols={"temperature": TEMPERATURE})
        for value in ((300., 0.), (300., float("nan")), (float("inf"), 0.2)):
            with self.subTest(value=value), self.assertRaises(ExpressionError):
                evaluate(expr, x, y, values={"temperature": np.full((n, n), 310.)},
                         boundary_faces=(("Robin", value), ("Neumann", 0.),
                                         ("Periodic", None), ("Periodic", None)))

    def test_real_cli_execution(self):
        run = subprocess.run([sys.executable, "src/math_flow.py",
                              "examples/heat_robin.flow"], cwd=ROOT,
                             capture_output=True, text=True, timeout=45)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["boundary_faces"]["x_min"]["type"], "Robin")
        self.assertEqual(result["spatial"]["grid"], [16, 16])


if __name__ == "__main__":
    unittest.main()
