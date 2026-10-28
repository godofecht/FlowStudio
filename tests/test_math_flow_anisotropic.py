"""Real typed anisotropic heat PDE, exact discrete Fourier eigenmodes, CLI."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_expr import TEMPERATURE, ExpressionError, evaluate, parse_expression

SOURCE = (ROOT / "examples/heat_anisotropic.flow").read_text(encoding="utf-8")


class AnisotropicHeatTest(unittest.TestCase):
    def test_exact_discrete_fourier_amplification_and_refinement(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertEqual((model.diffusivity, model.diffusivity_y), (.01, .02))
        errors = []
        for n in (16, 32, 64):
            result = simulate(model, grid=n)
            dt = result["time"] / result["steps"]
            rate = -4 * (.01 + .02) * n*n * math.sin(math.pi/n)**2
            amplification = (1 + dt*rate + .5*(dt*rate)**2)**result["steps"]
            continuum = math.exp(-(.01 + .02) * (2*math.pi)**2 * result["time"])
            errors.append(abs(amplification - continuum))
            self.assertLess(abs(result["mean_temperature"] - 300), 1e-9)
            self.assertLess(abs(result["temperature_variance"] -
                                25 * amplification**2), 3e-9)
            if n == 16:
                x, y = np.meshgrid((np.arange(n) + .5)/n,
                                   (np.arange(n) + .5)/n, indexing="ij")
                expected = 300 + 10 * amplification * np.sin(2*np.pi*x) * np.sin(2*np.pi*y)
                np.testing.assert_allclose(result["spatial"]["fields"]["temperature"],
                                           expected, rtol=0, atol=3e-9)
        self.assertGreater(errors[0], errors[1] * 3)
        self.assertGreater(errors[1], errors[2] * 3)

    def test_directional_derivatives_and_dimensions(self):
        import numpy as np
        n = 16
        x, y = np.meshgrid((np.arange(n) + .5)/n,
                           (np.arange(n) + .5)/n, indexing="ij")
        field = 300 + 10*np.sin(2*np.pi*x)
        symbols = {"temperature": TEMPERATURE}
        dx = parse_expression("∂ₓ²(temperature)", symbols=symbols)
        dy = parse_expression("∂ᵧ²(temperature)", symbols=symbols)
        expected = -4*n*n*math.sin(math.pi/n)**2 * (field-300)
        np.testing.assert_allclose(evaluate(dx, x, y, values={"temperature":field}),
                                   expected, atol=1e-9, rtol=0)
        np.testing.assert_allclose(evaluate(dy, x, y, values={"temperature":field}),
                                   0, atol=1e-9, rtol=0)
        self.assertEqual(dx.dimension, (-2, 0, 0, 1))
        with self.assertRaises(ExpressionError):
            parse_expression("∂ₓ²(temperature) + 1K", symbols=symbols)

    def test_boundary_operator_reuses_real_ghost_cells(self):
        import numpy as np
        n = 8
        x, y = np.meshgrid((np.arange(n)+.5)/n, (np.arange(n)+.5)/n, indexing="ij")
        field = np.full((n,n), 300.)
        expr = parse_expression("∂ₓ²(temperature)", symbols={"temperature":TEMPERATURE})
        result = evaluate(expr, x, y, values={"temperature":field},
                          boundary_axes=(("Neumann",1.), ("Periodic",None)))
        self.assertAlmostEqual(float(result.mean()), 2.0, places=10)
        np.testing.assert_allclose(result[1:-1], 0., atol=1e-10)

    def test_rejects_partial_wrong_unit_and_duplicate_diffusion(self):
        for old, new in (
            ("const diffusivityY = 0.02m²/s", ""),
            ("0.02m²/s", "0.02m/s"),
            ("0.02m²/s", "-0.02m²/s"),
            ("diffusivityY ∂ᵧ²(temperature)", "diffusivityY ∂ₓ²(temperature)"),
            (" + diffusivityY ∂ᵧ²(temperature)", ""),
            ("const diffusivityX", "const diffusivity"),
            ("∂ₓ²(temperature)", "∂ₓ(temperature)"),
        ):
            with self.subTest(new=new), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(old, new))

    def test_checked_in_program_executes_cli(self):
        run = subprocess.run([sys.executable, "src/math_flow.py",
                              "examples/heat_anisotropic.flow"],
                             cwd=ROOT, text=True, capture_output=True, timeout=45)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["steps"], 100)
        self.assertIn("temperature", result["spatial"]["fields"])


if __name__ == "__main__":
    unittest.main()
