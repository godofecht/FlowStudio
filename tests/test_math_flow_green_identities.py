"""Discrete Green identities for executable mathematical Flow derivatives."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow_expr import DIMENSIONLESS, evaluate, parse_expression


class PeriodicGreenIdentities(unittest.TestCase):
    def test_self_adjoint_laplacian_and_negative_energy(self):
        rng = np.random.default_rng(20261104)
        for nx, ny in ((12, 20), (24, 40), (48, 80)):
            with self.subTest(shape=(nx, ny)):
                lx, ly = 2.0, 3.0
                hx, hy = lx / nx, ly / ny
                x, y = np.meshgrid((np.arange(nx) + 0.5) * hx,
                                   (np.arange(ny) + 0.5) * hy, indexing="ij")
                u, v = rng.normal(size=(nx, ny)), rng.normal(size=(nx, ny))
                symbols = {"u": DIMENSIONLESS, "v": DIMENSIONLESS}
                values = {"u": u, "v": v}
                def run(source):
                    return evaluate(parse_expression(source, symbols=symbols),
                                    x, y, values=values)
                lap_u, lap_v = run("∇²(u)"), run("∇²(v)")
                left = hx * hy * np.sum(u * lap_v)
                right = hx * hy * np.sum(v * lap_u)
                np.testing.assert_allclose(left, right, rtol=1e-12, atol=1e-11)
                dx = (np.roll(u, -1, axis=0) - u) / hx
                dy = (np.roll(u, -1, axis=1) - u) / hy
                energy = hx * hy * np.sum(dx**2 + dy**2)
                np.testing.assert_allclose(hx * hy * np.sum(u * lap_u),
                                           -energy, rtol=1e-12, atol=1e-11)
                np.testing.assert_allclose(np.sum(lap_u), 0, atol=1e-9)
                for axis in ("∂ₓ", "∂ᵧ"):
                    du, dv = run(f"{axis}(u)"), run(f"{axis}(v)")
                    np.testing.assert_allclose(np.sum(u * dv), -np.sum(v * du),
                                               rtol=1e-12, atol=1e-10)


if __name__ == "__main__":
    unittest.main()
