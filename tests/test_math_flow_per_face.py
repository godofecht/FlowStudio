"""Four independent face conditions, analytic eigenmodes and exact discrete flux."""
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

SOURCE = (ROOT / "examples/heat_per_face_boundaries.flow").read_text(encoding="utf-8")
FACES = "(Dirichlet(300K), Neumann(0K/m), Neumann(0K/m), Neumann(0K/m))"


class PerFaceHeatBoundaryTest(unittest.TestCase):
    def test_exact_discrete_half_sine_eigenmode_and_refinement(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertEqual(model.boundary_faces, (
            ("Dirichlet", 300.0), ("Neumann", 0.0),
            ("Neumann", 0.0), ("Neumann", 0.0)))
        errors = []
        for n in (16, 32):
            result = simulate(model, grid=n)
            self.assertEqual(result["boundary_condition"], "Faces")
            self.assertEqual(result["boundary_faces"]["x_min"],
                             {"type": "Dirichlet", "value": 300.0})
            self.assertEqual(result["boundary_faces"]["x_max"],
                             {"type": "Neumann", "value": 0.0})
            dt = result["time"] / result["steps"]
            eigenvalue = -4 * model.diffusivity * n*n * math.sin(math.pi / (4*n))**2
            amplification = (1 + dt*eigenvalue + .5*(dt*eigenvalue)**2)**result["steps"]
            continuum = math.exp(-model.diffusivity * math.pi**2 * model.until / 4)
            errors.append(abs(amplification - continuum))
            x = (np.arange(n) + .5) / n
            expected = np.broadcast_to(
                300 + 10 * amplification * np.sin(math.pi*x[:, None] / 2), (n, n))
            np.testing.assert_allclose(result["spatial"]["fields"]["temperature"],
                                       expected, atol=2e-10, rtol=0)
            self.assertGreater(result["mean_temperature"], 300)
        self.assertLess(errors[1], errors[0] / 3)

    def test_independent_outward_gradients_give_exact_integrated_flux(self):
        import numpy as np
        source = SOURCE.replace(
            FACES, "(Neumann(1K/m), Neumann(3K/m), Neumann(0K/m), Neumann(0K/m))"
        ).replace("300K + 10K * sin(πx / 2m)", "300K")
        model = parse(source)
        result = simulate(model)
        self.assertAlmostEqual(result["mean_temperature"],
                               300 + model.diffusivity * 4 * model.until,
                               places=10)
        n = 16
        x, y = np.meshgrid((np.arange(n) + .5)/n, (np.arange(n) + .5)/n,
                           indexing="ij")
        expr = parse_expression("∇²(temperature)", symbols={"temperature": TEMPERATURE})
        lap = evaluate(expr, x, y, values={"temperature": np.full((n, n), 300.0)},
                       boundary_faces=model.boundary_faces)
        self.assertAlmostEqual(float(lap.mean()), 4.0, places=11)
        np.testing.assert_allclose(lap[1:-1], 0.0, atol=1e-10, rtol=0)

    def test_face_parser_and_evaluator_reject_invalid_conditions(self):
        for bad in (
            "(Periodic, Neumann(0K/m), Neumann(0K/m), Neumann(0K/m))",
            "(Neumann(0K/m), Periodic, Neumann(0K/m), Neumann(0K/m))",
            "(Periodic, Periodic, Neumann(0K/m), Periodic)",
            "(Dirichlet(300m), Neumann(0K/m), Neumann(0K/m), Neumann(0K/m))",
            "(Dirichlet(300K), Neumann(0K), Neumann(0K/m), Neumann(0K/m))",
            "(Dirichlet(300K), Neumann(0K/m), Neumann(0K/m))",
            "(Dirichlet(300K), Neumann(0K/m), Neumann(0K/m), Neumann(0K/m), Periodic)",
        ):
            with self.subTest(bad=bad), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(FACES, bad))
        import numpy as np
        x, y = np.meshgrid((np.arange(8) + .5)/8, (np.arange(8) + .5)/8,
                           indexing="ij")
        expr = parse_expression("∇²(temperature)", symbols={"temperature": TEMPERATURE})
        for bad in ((("Periodic", None),), (("Neumann", float("nan")),)*4,
                    (("Periodic", None), ("Neumann", 0.0),
                     ("Neumann", 0.0), ("Neumann", 0.0))):
            with self.subTest(bad=bad), self.assertRaises(ExpressionError):
                evaluate(expr, x, y, values={"temperature": np.full((8, 8), 300.0)},
                         boundary_faces=bad)

    def test_checked_in_program_executes_cli(self):
        run = subprocess.run([sys.executable, "src/math_flow.py",
                              "examples/heat_per_face_boundaries.flow"],
                             cwd=ROOT, capture_output=True, text=True, timeout=45)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["steps"], 100)
        self.assertEqual(result["boundary_condition"], "Faces")
        self.assertEqual(result["spatial"]["grid"], [16, 16])


if __name__ == "__main__":
    unittest.main()
