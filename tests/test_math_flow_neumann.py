"""Real cell-centered Neumann heat PDE acceptance against discrete cosine modes."""
from dataclasses import replace
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

SOURCE = (ROOT / "examples/heat_neumann.flow").read_text(encoding="utf-8")


class NeumannHeatTest(unittest.TestCase):
    def test_exact_insulated_cosine_eigenmode_and_refinement(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertEqual(model.boundary_gradient, 0.0)
        self.assertIsNone(model.boundary_temperature)
        errors = []
        for n in (16, 32):
            result = simulate(model, grid=n)
            self.assertEqual(result["boundary_condition"], "Neumann")
            self.assertEqual(result["boundary_gradient"], 0.0)
            dt = result["time"] / result["steps"]
            eigenvalue = -8 * model.diffusivity * n**2 * math.sin(math.pi / (2 * n))**2
            factor = (1 + dt * eigenvalue + .5 * (dt * eigenvalue)**2)**result["steps"]
            continuum = math.exp(-2 * model.diffusivity * math.pi**2 * model.until)
            errors.append(abs(factor - continuum))
            self.assertAlmostEqual(result["mean_temperature"], 300.0, places=10)
            self.assertAlmostEqual(result["observations"][-1]["meanTemperature"],
                                   result["mean_temperature"], places=10)
            if n == 16:
                coords = (np.arange(n) + .5) / n
                x, y = np.meshgrid(coords, coords, indexing="ij")
                expected = 300 + 10 * factor * np.cos(math.pi * x) * np.cos(math.pi * y)
                np.testing.assert_allclose(result["spatial"]["fields"]["temperature"],
                                           expected, atol=2e-10, rtol=0)
        self.assertLess(errors[1], errors[0] / 3)

    def test_nonzero_outward_gradient_gives_exact_integrated_flux(self):
        import numpy as np
        source = SOURCE.replace("Neumann(0K/m)", "Neumann(2K/m)").replace(
            "300K + 10K * cos(πx / 1m) * cos(πy / 1m)", "300K")
        model = parse(source)
        self.assertEqual(model.boundary_gradient, 2.0)
        result = simulate(model)
        # Discrete telescoping of face ghost-cell fluxes makes this exact
        # for every RK2 stage: d mean(T)/dt = 2 kappa g (1/Lx + 1/Ly).
        expected_mean = 300 + 2 * model.diffusivity * model.boundary_gradient * (
            1 / model.length_x + 1 / model.length_y) * model.until
        self.assertAlmostEqual(result["mean_temperature"], expected_mean, places=10)
        self.assertGreater(result["temperature_variance"], 0)
        self.assertTrue(np.all(np.isfinite(result["spatial"]["fields"]["temperature"])))

    def test_neumann_ghost_cells_and_reject_invalid_boundaries(self):
        import numpy as np
        n = 16
        coords = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coords, coords, indexing="ij")
        field = 300 + 10 * np.cos(math.pi * x) * np.cos(math.pi * y)
        expression = parse_expression("∇²(temperature)", symbols={"temperature": TEMPERATURE})
        laplacian = evaluate(expression, x, y, values={"temperature": field},
                             boundary_gradient=0.0)
        eigenvalue = -8 * n**2 * math.sin(math.pi / (2 * n))**2
        np.testing.assert_allclose(laplacian, eigenvalue * (field - 300),
                                   atol=1e-9, rtol=0)
        for boundary in ("Neumann(300K)", "Neumann(2m/s)", "Neumann()",
                         "Neumann(1K/m,2K/m)", "Neumann(0K/m) + Periodic"):
            with self.subTest(boundary=boundary), self.assertRaises(FlowMathError):
                parse(SOURCE.replace("Neumann(0K/m)", boundary))
        with self.assertRaisesRegex(ExpressionError, "finite"):
            evaluate(expression, x, y, values={"temperature": field},
                     boundary_gradient=float("nan"))
        with self.assertRaisesRegex(ExpressionError, "Cannot combine"):
            evaluate(expression, x, y, values={"temperature": field},
                     boundary_gradient=0.0, boundary_temperature=300.0)
        with self.assertRaisesRegex(FlowMathError, "stability"):
            simulate(replace(parse(SOURCE), diffusivity=100.0))

    def test_checked_in_neumann_program_executes_via_cli(self):
        run = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_neumann.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["boundary_condition"], "Neumann")
        self.assertEqual(result["boundary_gradient"], 0.0)
        self.assertEqual(result["steps"], 100)
        self.assertEqual(result["spatial"]["grid"], [16, 16])


if __name__ == "__main__":
    unittest.main()
