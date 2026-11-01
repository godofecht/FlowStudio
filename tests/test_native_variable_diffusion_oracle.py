"""Independent 16x16 variable-conductivity PDE acceptance for native Flow."""
from __future__ import annotations

import math
import random
import unittest
from pathlib import Path

SIDE = 16
COUNT = SIDE * SIDE
RATIO = 0.20
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "examples/native_variable_diffusion16.flow"


def index(x: int, y: int) -> int:
    return (x % SIDE) + SIDE * (y % SIDE)


def quarter(value: int) -> float:
    return (1.0, 0.0, -1.0, 0.0)[value % 4]


def initial() -> list[float]:
    return [20.0 + 3.0 * quarter(x) + 2.0 * quarter(y) +
            1.5 * quarter(x + y) for y in range(SIDE) for x in range(SIDE)]


def conductivity() -> list[float]:
    return [(0.75 if x >= 8 else 0.25) + (0.05 if y < 8 else 0.0)
            for y in range(SIDE) for x in range(SIDE)]


def neighbors(x: int, y: int) -> tuple[int, int, int, int]:
    return (index(x - 1, y), index(x + 1, y),
            index(x, y - 1), index(x, y + 1))


def harmonic(a: float, b: float) -> float:
    return 2 * a * b / (a + b)


def direct(values: list[float], coefficients: list[float], steps: int,
           ratio: float = RATIO) -> list[float]:
    if type(steps) is not int or not 0 <= steps <= 128:
        raise ValueError("cell-step budget exceeded")
    if not math.isfinite(ratio) or not 0 <= ratio <= .25:
        raise ValueError("unstable ratio")
    if len(values) != COUNT or len(coefficients) != COUNT:
        raise ValueError("wrong grid shape")
    if any(not math.isfinite(v) or not 0 <= v <= 1000 for v in values):
        raise ValueError("invalid grid")
    if any(not math.isfinite(k) or not .01 <= k <= 1 for k in coefficients):
        raise ValueError("invalid conductivity")
    state = values[:]
    for _ in range(steps):
        output = state[:]
        for y in range(SIDE):
            for x in range(SIDE):
                i = index(x, y)
                divergence = sum(harmonic(coefficients[i], coefficients[j]) *
                                 (state[j] - state[i]) for j in neighbors(x, y))
                output[i] = state[i] + ratio * divergence
        state = output
    return state


def matrix_oracle(values: list[float], coefficients: list[float],
                  steps: int, ratio: float = RATIO) -> list[float]:
    """Independent sparse Markov operator, assembled once then exponentiated."""
    rows = []
    for y in range(SIDE):
        for x in range(SIDE):
            i = index(x, y)
            edges = [(j, ratio * harmonic(coefficients[i], coefficients[j]))
                     for j in neighbors(x, y)]
            rows.append(((i, 1 - sum(weight for _, weight in edges)), *edges))
    current = values[:]
    for _ in range(steps):
        current = [sum(current[j] * weight for j, weight in row) for row in rows]
    return current


def maximum_error(first, second) -> float:
    return max(abs(a - b) for a, b in zip(first, second))


class VariableConductivityOracle(unittest.TestCase):
    def test_independent_operator_all_256_cells_and_checkpoints(self):
        values, coefficients = initial(), conductivity()
        for steps in (0, 8, 24, 48):
            with self.subTest(steps=steps):
                self.assertLess(maximum_error(
                    direct(values, coefficients, steps),
                    matrix_oracle(values, coefficients, steps)), 2e-12)

    def test_conservation_semigroup_replay_and_mutation(self):
        values, coefficients = initial(), conductivity()
        first = direct(values, coefficients, 48)
        self.assertAlmostEqual(sum(first), sum(values), delta=1e-9)
        self.assertEqual(first, direct(values, coefficients, 48))
        self.assertEqual(direct(values, coefficients, 0), values)
        self.assertLess(maximum_error(
            direct(direct(values, coefficients, 24), coefficients, 24),
            first), 1e-12)
        self.assertTrue(all(0 <= v <= 1000 for v in first))
        changed = coefficients[:]
        changed[index(7, 3)] = .95
        self.assertGreater(maximum_error(
            direct(values, changed, 24),
            direct(values, coefficients, 24)), .0001)

    def test_seeded_non_fourier_initial_and_discontinuous_flux(self):
        rng = random.Random(20261101)
        values = [rng.uniform(1, 40) for _ in range(COUNT)]
        coefficients = conductivity()
        first = direct(values, coefficients, 8)
        self.assertLess(maximum_error(first, matrix_oracle(
            values, coefficients, 8)), 1e-12)
        self.assertAlmostEqual(sum(first), sum(values), delta=1e-9)
        transposed = [coefficients[index(y, x)]
                      for y in range(SIDE) for x in range(SIDE)]
        self.assertGreater(maximum_error(
            first, direct(values, transposed, 8)), .01)

    def test_negative_inputs_and_budget(self):
        values, coefficients = initial(), conductivity()
        bad_values = values[:]
        bad_values[-1] = float("nan")
        bad_coefficients = coefficients[:]
        bad_coefficients[-1] = -0.1
        for v, k, steps, ratio in (
            (values, coefficients, -1, RATIO),
            (values, coefficients, 129, RATIO),
            (values, coefficients, 48, -0.1),
            (values, coefficients, 48, .250001),
            (values, coefficients, 48, float("nan")),
            (values[:-1], coefficients, 48, RATIO),
            (values, coefficients[:-1], 48, RATIO),
            (bad_values, coefficients, 48, RATIO),
            (values, bad_coefficients, 48, RATIO),
        ):
            with self.subTest(steps=steps, ratio=ratio):
                with self.assertRaises(ValueError):
                    direct(v, k, steps, ratio)

    def test_native_source_contract(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertLess(len(source.encode("utf-8")), 128 * 1024)
        for fragment in ("function harmonic(", "function advance(",
                         "function integrate(", "steps > 128",
                         "FLOWSTUDIO_GRID_V1 16 16 1",
                         "native-variable-diffusion16-ok"):
            self.assertIn(fragment, source)


if __name__ == "__main__":
    unittest.main()
