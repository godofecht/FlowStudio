"""Real face-Dirichlet heat PDE acceptance against the discrete sine eigenmode."""
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

SOURCE = (ROOT / "examples/heat_dirichlet.flow").read_text(encoding="utf-8")
PERIODIC = (ROOT / "examples/heat_equation_smoke.flow").read_text(encoding="utf-8")


class DirichletHeatTest(unittest.TestCase):
    def test_exact_discrete_dirichlet_eigenmode_and_refinement(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertEqual(model.boundary_temperature, 300.0)
        errors = []
        for n in (16, 32):
            result = simulate(model, grid=n)
            self.assertEqual(result["boundary_condition"], "Dirichlet")
            self.assertEqual(result["boundary_temperature"], 300.0)
            dt = result["time"] / result["steps"]
            eigenvalue = -8 * model.diffusivity * n**2 * math.sin(math.pi / (2 * n))**2
            discrete_factor = (1 + dt * eigenvalue + .5 * (dt * eigenvalue)**2)**result["steps"]
            continuum_factor = math.exp(-2 * model.diffusivity * math.pi**2 * model.until)
            errors.append(abs(discrete_factor - continuum_factor))
            self.assertEqual(result["steps"], 100)
            self.assertLess(result["temperature_max"], 310)
            if n == 16:
                coordinates = (np.arange(n) + .5) / n
                x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
                expected = 300 + 10 * discrete_factor * np.sin(math.pi * x) * np.sin(math.pi * y)
                np.testing.assert_allclose(result["spatial"]["fields"]["temperature"], expected,
                                           rtol=0, atol=2e-10)
            self.assertAlmostEqual(result["observations"][-1]["meanTemperature"],
                                   result["mean_temperature"], places=10)
        self.assertLess(errors[1], errors[0] / 3)

    def test_dirichlet_ghost_cell_laplacian_and_periodic_default(self):
        import numpy as np
        n = 16
        coords = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coords, coords, indexing="ij")
        expression = parse_expression("∇²(temperature)", symbols={"temperature": TEMPERATURE})
        field = 300 + 10 * np.sin(math.pi * x) * np.sin(math.pi * y)
        discrete = evaluate(expression, x, y, values={"temperature": field},
                            boundary_temperature=300.0)
        eigenvalue = -8 * n**2 * math.sin(math.pi / (2 * n))**2
        np.testing.assert_allclose(discrete, eigenvalue * (field - 300), atol=1e-9, rtol=0)
        with self.assertRaisesRegex(ExpressionError, "finite"):
            evaluate(expression, x, y, values={"temperature": field},
                     boundary_temperature=float("nan"))
        self.assertIsNone(parse(PERIODIC).boundary_temperature)
        self.assertEqual(simulate(parse(PERIODIC))["boundary_condition"], "Periodic")

    def test_dirichlet_transport_reaction_preserves_constant_equilibrium(self):
        import numpy as np
        transport = (ROOT / "examples/heat_transport_reaction.flow").read_text(encoding="utf-8")
        transport = transport.replace("boundaries = Periodic",
                                      "boundaries = Dirichlet(300K)")
        transport = transport.replace(
            "temperature = 300K + 10K * sin(2πx / 1m) + 5K * cos(2πy / 1m)",
            "temperature = 300K").replace("+ 2K/s", "")
        model = parse(transport)
        self.assertTrue(model.equation.advection)
        self.assertIsNotNone(model.equation.reaction)
        result = simulate(model)
        self.assertAlmostEqual(result["mean_temperature"], 300.0, places=10)
        self.assertAlmostEqual(result["temperature_variance"], 0.0, places=15)
        np.testing.assert_allclose(result["spatial"]["fields"]["temperature"],
                                   300.0, atol=1e-10)

    def test_invalid_boundary_declarations_fail_closed(self):
        for boundary in ("Neumann(300K)", "Dirichlet(300m)", "Dirichlet()",
                         "Dirichlet(300K, 301K)", "Dirichlet(300K) + Periodic"):
            with self.subTest(boundary=boundary), self.assertRaises(FlowMathError):
                parse(SOURCE.replace("Dirichlet(300K)", boundary))
        with self.assertRaisesRegex(FlowMathError, "stability"):
            simulate(replace(parse(SOURCE), diffusivity=100.0))

    def test_checked_in_dirichlet_program_executes_via_cli(self):
        run = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_dirichlet.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["boundary_condition"], "Dirichlet")
        self.assertEqual(result["steps"], 100)
        self.assertEqual(result["spatial"]["grid"], [16, 16])


if __name__ == "__main__":
    unittest.main()
