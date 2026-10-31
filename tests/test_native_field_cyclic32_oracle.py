"""Independent three-field directed-exchange PDE oracle for real Flow 2.0 field lowering.

The Flow program executes the production compiler; this Python module only
reconstructs its checked-in numerical assertions using a separate direct
stencil and a spectral 3x3 matrix-power solution. No mocked Flow runtime.
"""
from __future__ import annotations

import math
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "examples/native_field_cyclic32.flow"
N = 32
RATIO = 0.2
EXCHANGE = 0.08
CHECKPOINTS = (16, 64, 128)
LABELS = "UVW"


def initial() -> list[list[float]]:
    mode = [0.0 if i in (0, N - 1) else math.sin(math.pi * i / (N - 1))
            for i in range(N)]
    return [[amplitude * value for value in mode] for amplitude in (1.0, 2.0, 4.0)]


def direct_stencil(state: list[list[float]], steps: int, ratio: float = RATIO,
                   exchange: float = EXCHANGE) -> list[list[float]]:
    if not (0 <= steps <= 1024 and 0 <= ratio <= .5 and 0 <= exchange <= .25):
        raise ValueError("invalid evolution parameters")
    current = [row[:] for row in state]
    if len(current) != 3 or any(len(row) != N for row in current):
        raise ValueError("three 32-cell fields required")
    for _ in range(steps):
        diffused = [[0.0] * N for _ in range(3)]
        for species in range(3):
            for i in range(1, N - 1):
                row = current[species]
                diffused[species][i] = row[i] + ratio * (
                    row[i - 1] - 2 * row[i] + row[i + 1])
        current = [[0.0] * N for _ in range(3)]
        for species in range(3):
            successor = (species + 1) % 3
            for i in range(1, N - 1):
                current[species][i] = ((1 - exchange) * diffused[species][i]
                                       + exchange * diffused[successor][i])
    return current


def spectral_solution(steps: int, ratio: float = RATIO,
                      exchange: float = EXCHANGE) -> list[list[float]]:
    eigenvalue = 1 - 4 * ratio * math.sin(math.pi / (2 * (N - 1))) ** 2
    # Only three amplitudes are propagated; this is independent of the
    # spatial finite-difference stencil used by direct_stencil.
    amplitudes = [1.0, 2.0, 4.0]
    for _ in range(steps):
        amplitudes = [eigenvalue * ((1 - exchange) * amplitudes[i]
                       + exchange * amplitudes[(i + 1) % 3]) for i in range(3)]
    return [[0.0 if i in (0, N - 1) else
             amplitudes[k] * math.sin(math.pi * i / (N - 1))
             for i in range(N)] for k in range(3)]


def checked_in(name: str) -> list[float]:
    source = SOURCE.read_text(encoding="utf-8")
    match = re.search(r"let " + re.escape(name)
                      + r": array<f64, 32> = \\[(.*?)\\]", source, re.S)
    if match is None:
        raise AssertionError(f"missing native reference {name}")
    values = [float(item.strip()) for item in match.group(1).split(",")
              if item.strip()]
    if len(values) != N:
        raise AssertionError(f"{name} has {len(values)} cells, expected {N}")
    return values


def error(a: list[list[float]], b: list[list[float]]) -> float:
    return max(abs(x - y) for left, right in zip(a, b)
               for x, y in zip(left, right))


class NativeCyclicThreeFieldOracle(unittest.TestCase):
    def test_288_cells_against_direct_stencil_and_spectral_matrix(self):
        for steps in CHECKPOINTS:
            direct = direct_stencil(initial(), steps)
            spectral = spectral_solution(steps)
            checked = [checked_in(f"expected{species}{steps}") for species in LABELS]
            self.assertLess(error(direct, spectral), 2e-12)
            self.assertLess(error(checked, spectral), 2e-12)
            self.assertLess(error(checked, direct), 2e-12)

    def test_semigroup_replay_and_zero_time(self):
        state = initial()
        self.assertEqual(direct_stencil(state, 0), state)
        after64 = direct_stencil(state, 64)
        after128 = direct_stencil(state, 128)
        self.assertEqual(after128, direct_stencil(state, 128))
        self.assertLess(error(after128, direct_stencil(after64, 64)), 2e-13)

    def test_exchange_is_directed_conservative_and_nontrivial(self):
        state = initial()
        with_exchange = direct_stencil(state, 128)
        without_exchange = direct_stencil(state, 128, exchange=0.0)
        self.assertGreater(error(with_exchange, without_exchange), 0.1)
        for i in range(N):
            self.assertAlmostEqual(sum(with_exchange[k][i] for k in range(3)),
                                   sum(without_exchange[k][i] for k in range(3)),
                                   delta=2e-12)
        # A one-way directed cycle is not symmetric pairwise exchange.
        self.assertNotAlmostEqual(with_exchange[0][15], with_exchange[2][15],
                                  delta=0.01)

    def test_energy_decay_positivity_and_fixed_boundaries(self):
        state = initial()
        energies = []
        for steps in (0, *CHECKPOINTS):
            values = direct_stencil(state, steps)
            energies.append(sum(x*x for row in values for x in row))
            self.assertTrue(all(math.isfinite(x) and -1e-12 <= x <= 10
                                for row in values for x in row))
            for row in values:
                self.assertEqual((row[0], row[-1]), (0.0, 0.0))
        self.assertTrue(all(a > b for a, b in zip(energies, energies[1:])))

    def test_parameter_mutations_and_resource_limits(self):
        state = initial()
        base = direct_stencil(state, 128)
        self.assertGreater(error(base, direct_stencil(state, 128, ratio=.1)), .05)
        self.assertGreater(error(base, direct_stencil(state, 128, exchange=0)), .1)
        for ratio, exchange, steps in ((-.01, .08, 16), (.500001, .08, 16),
                                       (.2, -.01, 16), (.2, .250001, 16),
                                       (.2, .08, -1), (.2, .08, 1025)):
            with self.subTest(ratio=ratio, exchange=exchange, steps=steps):
                with self.assertRaises(ValueError):
                    direct_stencil(state, steps, ratio, exchange)

    def test_compiler_generated_field_contract_and_bounded_execution(self):
        source = SOURCE.read_text(encoding="utf-8")
        for species in LABELS:
            self.assertIn(f"field {species} : f64[32] on Line", source)
            self.assertIn(f"{species} evolves as laplacian({species})", source)
            self.assertIn(f"{species}_field_step(", source)
            self.assertIn(f"print(after{species}128[i])", source)
        self.assertIn("steps > 1024", source)
        self.assertIn("exchange > 0.25", source)
        self.assertIn("FLOWSTUDIO_FIELD_V1 32 3", source)
        self.assertIn("native-field-cyclic32-ok", source)
        self.assertLess(len(source.encode("utf-8")), 128 * 1024)


if __name__ == "__main__":
    unittest.main()
