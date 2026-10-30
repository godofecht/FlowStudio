"""Independent 16x16 native Flow tensor-diffusion numerical acceptance oracle.

The real Flow compiler and HTTP tests execute examples/native_tensor_grid.flow.
This Python test independently checks the full discrete operator and RK2
against the Fourier symbol; it never substitutes for Flow execution.
"""
from __future__ import annotations

import math
from pathlib import Path
import unittest

GRID = 16
COUNT = GRID * GRID
DXX, DXY, DYY = 0.012, 0.004, 0.018
DURATION = 0.1
BASE, AMPLITUDE = 300.0, 7.0
EIGENVALUE = -2.0 * GRID * GRID * (DXX + DYY + DXY)
EXPECTED_AMPLITUDE = math.exp(EIGENVALUE * DURATION)


def initial() -> list[float]:
    return [BASE + AMPLITUDE * (1.0 if (x+y) % 4 == 0 else
                                -1.0 if (x+y) % 4 == 2 else 0.0)
            for y in range(GRID) for x in range(GRID)]


def derivative(values: list[float], cross: float = DXY) -> list[float]:
    result = []
    for y in range(GRID):
        for x in range(GRID):
            def at(dx: int, dy: int) -> float:
                return values[((y + dy) % GRID) * GRID + (x + dx) % GRID]
            center = at(0, 0)
            xx = (at(-1, 0) - 2 * center + at(1, 0)) * GRID**2
            yy = (at(0, -1) - 2 * center + at(0, 1)) * GRID**2
            xy = (at(1, 1) - at(-1, 1) - at(1, -1) + at(-1, -1)) * GRID**2 / 4
            result.append(DXX * xx + 2 * cross * xy + DYY * yy)
    return result


def integrate(steps: int, start: list[float] | None = None,
              duration: float = DURATION, cross: float = DXY) -> list[float]:
    state = list(initial() if start is None else start)
    h = duration / steps
    for _ in range(steps):
        first = derivative(state, cross)
        midpoint = [v + 0.5 * h * s for v, s in zip(state, first)]
        second = derivative(midpoint, cross)
        state = [v + h * s for v, s in zip(state, second)]
    return state


class Tensor16Oracle(unittest.TestCase):
    def test_all_256_cells_and_second_order_convergence(self):
        initial_values = initial()
        exact = [BASE + (v - BASE) * EXPECTED_AMPLITUDE for v in initial_values]
        errors = []
        for steps in (32, 64, 128):
            state = integrate(steps)
            error = max(abs(a-b) for a, b in zip(state, exact))
            errors.append(error)
            self.assertAlmostEqual(sum(state)/COUNT, BASE, delta=2e-11)
            self.assertGreaterEqual(min(state), BASE - AMPLITUDE)
            self.assertLessEqual(max(state), BASE + AMPLITUDE)
            self.assertEqual(state, integrate(steps))
        self.assertLess(errors[-1], 7e-5)
        self.assertLess(errors[1], errors[0] * 0.30)
        self.assertLess(errors[2], errors[1] * 0.30)

    def test_every_stencil_cell_against_fourier_eigenvalue(self):
        values = initial()
        rhs = derivative(values)
        for i in range(COUNT):
            self.assertAlmostEqual(rhs[i], EIGENVALUE * (values[i] - BASE), delta=2e-11)
        self.assertAlmostEqual(sum(rhs), 0.0, delta=2e-11)

    def test_semigroup_translation_and_cross_tensor_sign(self):
        full = integrate(128)
        half = integrate(64, duration=DURATION / 2)
        second = integrate(64, start=half, duration=DURATION / 2)
        self.assertLess(max(abs(a-b) for a,b in zip(full, second)), 1e-11)
        start = initial()
        shifted = [start[y*GRID+(x-1) % GRID]
                   for y in range(GRID) for x in range(GRID)]
        evolved = integrate(128, start=shifted)
        translated = [full[y*GRID+(x-1) % GRID]
                      for y in range(GRID) for x in range(GRID)]
        self.assertLess(max(abs(a-b) for a,b in zip(evolved, translated)), 1e-11)
        reversed_cross = integrate(128, cross=-DXY)
        self.assertGreater(max(abs(a-b) for a,b in zip(full, reversed_cross)), 0.1)

    def test_checked_in_native_acceptance_contract(self):
        path = Path(__file__).resolve().parents[1] / "examples/native_tensor_grid.flow"
        source = path.read_text(encoding="utf-8")
        for required in ("array<f64, 256>", "function diagonalFourier16()",
                         "width: 16, height: 16", "native-tensor-grid-ok",
                         "0.17538004044805672", "gridMean(fine16.grid, 256)"):
            self.assertIn(required, source)
        self.assertNotIn("width > 8 or equation.height > 8", source)


if __name__ == "__main__":
    unittest.main()
