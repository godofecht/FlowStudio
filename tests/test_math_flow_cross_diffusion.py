"""Executable periodic cross-diffusion: typed AST, discrete Fourier, CLI."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_expr import TEMPERATURE, evaluate, parse_expression, ExpressionError

SOURCE = (ROOT / "examples/heat_cross_diffusion.flow").read_text(encoding="utf-8")


class CrossDiffusionTest(unittest.TestCase):
    def test_discrete_fourier_eigenvalue_and_grid_refinement(self):
        import numpy as np
        model = parse(SOURCE)
        self.assertAlmostEqual(model.cross_diffusivity, .01)
        errors = []
        for n in (16, 32, 64):
            result = simulate(model, grid=n)
            dt = result["time"] / result["steps"]
            h = 1/n
            rate = (-4 * (.01 + .02) / h**2 * math.sin(math.pi/n)**2
                    - .01 / h**2 * math.sin(2*math.pi/n)**2)
            amplification = (1 + dt*rate + .5*(dt*rate)**2)**result["steps"]
            continuum = math.exp(-(.01 + .02 + .01) * (2*math.pi)**2 * result["time"])
            errors.append(abs(amplification - continuum))
            self.assertLess(abs(result["mean_temperature"] - 300), 1e-9)
            self.assertLess(abs(result["temperature_variance"] - 50*amplification**2), 5e-9)
            if n == 16:
                x, y = np.meshgrid((np.arange(n)+.5)/n,
                                   (np.arange(n)+.5)/n, indexing="ij")
                expected = 300 + 10*amplification*np.sin(2*math.pi*(x+y))
                np.testing.assert_allclose(result["spatial"]["fields"]["temperature"],
                                           expected, rtol=0, atol=3e-9)
        self.assertGreater(errors[0], 3*errors[1])
        self.assertGreater(errors[1], 3*errors[2])

    def test_signed_cross_coefficient_changes_mode_decay(self):
        negative = SOURCE.replace("crossDiffusivity = 0.01m²/s",
                                  "crossDiffusivity = -0.01m²/s")
        model = parse(negative)
        result = simulate(model)
        n = model.width
        dt = result["time"] / result["steps"]
        rate = (-4*(.01+.02)*n*n*math.sin(math.pi/n)**2
                + .01*n*n*math.sin(2*math.pi/n)**2)
        amplification = (1+dt*rate+.5*(dt*rate)**2)**result["steps"]
        self.assertLess(abs(result["temperature_variance"] - 50*amplification**2), 5e-9)

    def test_typed_nested_derivative_and_numpy_lowering(self):
        import numpy as np
        n = 16
        x,y = np.meshgrid((np.arange(n)+.5)/n,
                          (np.arange(n)+.5)/n, indexing="ij")
        field = 300 + 10*np.sin(2*math.pi*(x+y))
        expression = parse_expression("∂ₓ(∂ᵧ(temperature))",
                                      symbols={"temperature":TEMPERATURE})
        self.assertEqual(expression.dimension, (-2,0,0,1))
        expected = -10*(n*math.sin(2*math.pi/n))**2*np.sin(2*math.pi*(x+y))
        np.testing.assert_allclose(evaluate(expression,x,y,values={"temperature":field}),
                                   expected,atol=1e-10,rtol=0)
        with self.assertRaises(ExpressionError):
            parse_expression("∂ₓ(∂ᵧ(temperature)) + 1K",
                             symbols={"temperature":TEMPERATURE})

    def test_rejects_unsafe_or_unsupported_tensor(self):
        for original, replacement in (
            ("0.01m²/s\n    field", "0.5m²/s\n    field"),
            ("0.01m²/s\n    field", "0.01m/s\n    field"),
            ("const crossDiffusivity = 0.01m²/s", ""),
            (" + crossDiffusivity ∂ₓ(∂ᵧ(temperature))", ""),
            ("∂ₓ(∂ᵧ(temperature))", "∂ₓ²(temperature)"),
            ("boundaries = Periodic", "boundaries = Dirichlet(300K)"),
            ("const diffusivityY = 0.02m²/s", ""),
        ):
            with self.subTest(replacement=replacement), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(original, replacement))

    def test_checked_in_program_executes_through_cli(self):
        result = subprocess.run([sys.executable, "src/math_flow.py",
                                 "examples/heat_cross_diffusion.flow"],
                                cwd=ROOT,text=True,capture_output=True,timeout=45)
        self.assertEqual(result.returncode,0,result.stderr)
        data = json.loads(result.stdout)
        self.assertTrue(data["ok"])
        self.assertEqual(data["steps"],100)
        self.assertIn("temperature",data["spatial"]["fields"])


if __name__ == "__main__":
    unittest.main()
