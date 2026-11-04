"""Rectangular periodic-grid numerical acceptance for the executable Flow AST.

Exercises non-square cell spacing and continuum second-order convergence,
which square-grid Fourier eigenmode tests cannot distinguish.
"""
from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow_expr import DIMENSIONLESS, evaluate, parse_expression


class RectangularFourierAcceptance(unittest.TestCase):
    def test_rectangular_grid_discrete_symbols_and_integral(self):
        for nx, ny in ((12, 20), (24, 40), (48, 80)):
            with self.subTest(grid=(nx, ny)):
                lx, ly = 2.0, 3.0
                hx, hy = lx / nx, ly / ny
                x1 = (np.arange(nx) + 0.5) * hx
                y1 = (np.arange(ny) + 0.5) * hy
                x, y = np.meshgrid(x1, y1, indexing="ij")
                kx, ky = 2 * np.pi / lx, 4 * np.pi / ly
                u = np.sin(kx * x) * np.cos(ky * y)
                values = {"u": u}
                symbols = {"u": DIMENSIONLESS}
                laplacian = evaluate(parse_expression("∇²(u)", symbols=symbols), x, y, values=values)
                eigenvalue = (2 * np.cos(kx * hx) - 2) / hx**2 + (2 * np.cos(ky * hy) - 2) / hy**2
                np.testing.assert_allclose(laplacian, eigenvalue * u, atol=1e-11, rtol=1e-11)
                mixed = evaluate(parse_expression("∂ₓᵧ(u)", symbols=symbols), x, y, values=values)
                expected_mixed = -(np.sin(kx * hx) / hx) * (np.sin(ky * hy) / hy) * np.cos(kx * x) * np.sin(ky * y)
                np.testing.assert_allclose(mixed, expected_mixed, atol=1e-11, rtol=1e-11)
                integral = evaluate(parse_expression("∫(u)", symbols=symbols), x, y, values=values)
                self.assertAlmostEqual(float(integral), 0.0, delta=1e-12)
                area = evaluate(parse_expression("∫(1)", symbols=symbols), x, y)
                self.assertAlmostEqual(float(area), lx * ly, delta=1e-12)

    def test_second_order_continuum_convergence(self):
        errors = []
        for nx, ny in ((12, 20), (24, 40), (48, 80)):
            lx, ly = 2.0, 3.0
            x, y = np.meshgrid((np.arange(nx) + 0.5) * lx / nx,
                               (np.arange(ny) + 0.5) * ly / ny, indexing="ij")
            kx, ky = 2 * np.pi / lx, 4 * np.pi / ly
            u = np.sin(kx * x) * np.cos(ky * y)
            computed = evaluate(parse_expression("∇²(u)", symbols={"u": DIMENSIONLESS}),
                                x, y, values={"u": u})
            exact = -(kx**2 + ky**2) * u
            errors.append(float(np.sqrt(np.mean((computed - exact)**2))))
        self.assertGreater(errors[0] / errors[1], 3.5)
        self.assertGreater(errors[1] / errors[2], 3.5)


if __name__ == "__main__":
    unittest.main()
