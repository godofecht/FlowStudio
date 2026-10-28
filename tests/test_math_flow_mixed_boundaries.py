"""Analytic mixed-axis heat boundaries through the actual Unicode compiler and RK2 runtime."""
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

SOURCE = (ROOT / "examples/heat_mixed_boundaries.flow").read_text(encoding="utf-8")


class MixedHeatBoundaryTest(unittest.TestCase):
    def test_exact_discrete_mixed_sine_cosine_eigenmode_and_refinement(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertEqual(model.boundary_axes, (("Dirichlet", 300.0), ("Neumann", 0.0)))
        errors = []
        for n in (16, 32):
            result = simulate(model, grid=n)
            self.assertEqual(result["boundary_condition"], "Mixed")
            self.assertEqual(result["boundary_axes"]["x"], {"type": "Dirichlet", "value": 300.0})
            self.assertEqual(result["boundary_axes"]["y"], {"type": "Neumann", "value": 0.0})
            dt = result["time"] / result["steps"]
            eigenvalue = -8 * model.diffusivity * n**2 * math.sin(math.pi / (2*n))**2
            discrete = (1 + dt*eigenvalue + .5*(dt*eigenvalue)**2)**result["steps"]
            continuum = math.exp(-2*model.diffusivity*math.pi**2*model.until)
            errors.append(abs(discrete - continuum))
            coords = (np.arange(n) + .5) / n
            x, y = np.meshgrid(coords, coords, indexing="ij")
            expected = 300 + 10*discrete*np.sin(math.pi*x)*np.cos(math.pi*y)
            if n == 16:
                np.testing.assert_allclose(result["spatial"]["fields"]["temperature"], expected,
                                           atol=2e-10, rtol=0)
            self.assertAlmostEqual(result["mean_temperature"], 300.0, places=10)
        self.assertLess(errors[1], errors[0] / 3)

    def test_periodic_x_dirichlet_y_and_axis_specific_derivatives(self):
        import numpy as np
        source = SOURCE.replace("(Dirichlet(300K), Neumann(0K/m))",
                                "(Periodic, Dirichlet(300K))").replace(
            "sin(πx / 1m) * cos(πy / 1m)",
            "cos(2πx / 1m) * sin(πy / 1m)")
        model = parse(source)
        result = simulate(model)
        n = 16
        coords = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coords, coords, indexing="ij")
        eigenvalue = -4*model.diffusivity*n*n*(
            math.sin(math.pi/n)**2 + math.sin(math.pi/(2*n))**2)
        dt = result["time"] / result["steps"]
        factor = (1 + dt*eigenvalue + .5*(dt*eigenvalue)**2)**result["steps"]
        expected = 300 + 10*factor*np.cos(2*math.pi*x)*np.sin(math.pi*y)
        np.testing.assert_allclose(result["spatial"]["fields"]["temperature"], expected,
                                   atol=2e-10, rtol=0)
        self.assertEqual(result["boundary_axes"]["x"]["type"], "Periodic")

    def test_axis_ghost_cells_and_invalid_declarations(self):
        import numpy as np
        n = 16
        coords = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coords, coords, indexing="ij")
        field = 300 + 10*np.sin(math.pi*x)*np.cos(math.pi*y)
        expr = parse_expression("∇²(temperature)", symbols={"temperature": TEMPERATURE})
        laplacian = evaluate(expr, x, y, values={"temperature": field},
                             boundary_axes=(("Dirichlet", 300.0), ("Neumann", 0.0)))
        eigenvalue = -8*n*n*math.sin(math.pi/(2*n))**2
        np.testing.assert_allclose(laplacian, eigenvalue*(field-300), atol=1e-9, rtol=0)
        for bad in ("(Dirichlet(300m), Neumann(0K/m))",
                    "(Dirichlet(300K))",
                    "(Periodic, Neumann(0K/m), Periodic)",
                    "(Periodic, Neumann(300K))",
                    "(Periodic, Wrong(0K/m))",
                    "(Periodic, Neumann(0K/m)",
                    "(Periodic, Neumann(0K/m)) + Periodic"):
            with self.subTest(bad=bad), self.assertRaises(FlowMathError):
                parse(SOURCE.replace("(Dirichlet(300K), Neumann(0K/m))", bad))
        with self.assertRaisesRegex(ExpressionError, "finite"):
            evaluate(expr, x, y, values={"temperature": field},
                     boundary_axes=(("Dirichlet", float("nan")), ("Periodic", None)))
        with self.assertRaisesRegex(ExpressionError, "Cannot combine"):
            evaluate(expr, x, y, values={"temperature": field},
                     boundary_temperature=300,
                     boundary_axes=(("Dirichlet", 300.0), ("Periodic", None)))

    def test_checked_in_mixed_example_executes_cli(self):
        run = subprocess.run([sys.executable, "src/math_flow.py",
                              "examples/heat_mixed_boundaries.flow"],
                             cwd=ROOT, capture_output=True, text=True, timeout=45)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["boundary_condition"], "Mixed")
        self.assertEqual(result["steps"], 100)
        self.assertEqual(result["spatial"]["grid"], [16, 16])


if __name__ == "__main__":
    unittest.main()
