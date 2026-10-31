"""Independent three-dimensional two-species Fourier oracle for native Flow execution.

No Flow interpreter is mocked. The actual compiler/HTTP/Chromium acceptance
runs examples/native_coupled_volume8.flow; this file independently verifies
its 8x8x8 periodic stencil, 3-mode matrix evolution and conservation.
"""
from __future__ import annotations

import math
from pathlib import Path
import random
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "examples/native_coupled_volume8.flow"
SIDE = 8
COUNT = SIDE ** 3
CHECKPOINTS = (8, 32, 64)
RATIO = 0.20
EXCHANGE = 0.03
DIFFUSION = ((0.10, 0.08, 0.06), (0.04, 0.07, 0.05))
MEANS = (300.0, 5.0)
AMPLITUDES = ((7.0, 3.0, 2.0), (0.8, -0.5, 1.1))


def index(x: int, y: int, z: int) -> int:
    return (z % SIDE) * SIDE * SIDE + (y % SIDE) * SIDE + (x % SIDE)


def quarter(value: int) -> float:
    return (1.0, 0.0, -1.0, 0.0)[value % 4]


def initial() -> tuple[list[float], list[float]]:
    state = ([], [])
    for z in range(SIDE):
        for y in range(SIDE):
            for x in range(SIDE):
                modes = (quarter(x + y), quarter(y + z), quarter(x + y + z))
                for species in range(2):
                    state[species].append(MEANS[species] + sum(
                        a * mode for a, mode in zip(AMPLITUDES[species], modes)))
    return state


def direct(state: tuple[list[float], list[float]], steps: int,
           ratio: float = RATIO, exchange: float = EXCHANGE,
           diffusion=DIFFUSION) -> tuple[list[float], list[float]]:
    if not isinstance(steps, int) or not 0 <= steps <= 256:
        raise ValueError("steps outside 262144 species-voxel budget")
    if not math.isfinite(ratio) or not 0 <= ratio <= 0.5:
        raise ValueError("invalid ratio")
    if not math.isfinite(exchange) or not 0 <= exchange <= 0.25:
        raise ValueError("invalid exchange")
    if any(len(field) != COUNT for field in state):
        raise ValueError("invalid 3D field dimensions")
    if any(not math.isfinite(value) or not -1000 <= value <= 1000
           for field in state for value in field):
        raise ValueError("invalid initial field")
    if any(not math.isfinite(value) or not 0 <= value <= 1
           for tensor in diffusion for value in tensor):
        raise ValueError("invalid tensor")
    if any(ratio * sum(tensor) > 0.5 for tensor in diffusion):
        raise ValueError("unstable explicit diffusion")
    current = (state[0][:], state[1][:])
    for _ in range(steps):
        diffused = ([0.0] * COUNT, [0.0] * COUNT)
        for z in range(SIDE):
            for y in range(SIDE):
                for x in range(SIDE):
                    i = index(x, y, z)
                    neighbors = (
                        (index(x-1, y, z), index(x+1, y, z)),
                        (index(x, y-1, z), index(x, y+1, z)),
                        (index(x, y, z-1), index(x, y, z+1)),
                    )
                    for species in range(2):
                        field = current[species]
                        slope = sum(coefficient * (field[a] + field[b] - 2 * field[i])
                                    for coefficient, (a, b) in
                                    zip(diffusion[species], neighbors))
                        diffused[species][i] = field[i] + ratio * slope
        current = (
            [(1-exchange)*u + exchange*v for u, v in zip(*diffused)],
            [exchange*u + (1-exchange)*v for u, v in zip(*diffused)],
        )
    return current


def spectral(steps: int, ratio: float = RATIO, exchange: float = EXCHANGE,
             diffusion=DIFFUSION) -> tuple[list[float], list[float]]:
    """Independent six-amplitude discrete Fourier / 2x2 matrix-power oracle."""
    means = list(MEANS)
    amplitudes = [list(row) for row in AMPLITUDES]
    axes = ((0, 1), (1, 2), (0, 1, 2))
    factors = [[1 - 2*ratio*sum(diffusion[s][axis] for axis in mode)
                for mode in axes] for s in range(2)]
    for _ in range(steps):
        means = [(1-exchange)*means[0] + exchange*means[1],
                 exchange*means[0] + (1-exchange)*means[1]]
        for mode in range(3):
            u, v = (factors[s][mode] * amplitudes[s][mode] for s in range(2))
            amplitudes[0][mode] = (1-exchange)*u + exchange*v
            amplitudes[1][mode] = exchange*u + (1-exchange)*v
    result = ([], [])
    for z in range(SIDE):
        for y in range(SIDE):
            for x in range(SIDE):
                modes = (quarter(x+y), quarter(y+z), quarter(x+y+z))
                for species in range(2):
                    result[species].append(means[species] + sum(
                        a * mode for a, mode in zip(amplitudes[species], modes)))
    return result


def maximum_error(a, b) -> float:
    return max(abs(x-y) for fa, fb in zip(a, b) for x, y in zip(fa, fb))


def z_slice(state, z: int = 0) -> tuple[list[float], list[float]]:
    return tuple([field[index(x, y, z)] for y in range(SIDE)
                  for x in range(SIDE)] for field in state)


class NativeCoupledVolumeOracle(unittest.TestCase):
    def test_all_3072_checkpoint_voxels_against_independent_fourier_matrix(self):
        for steps in CHECKPOINTS:
            with self.subTest(steps=steps):
                self.assertLess(maximum_error(direct(initial(), steps),
                                              spectral(steps)), 2e-10)

    def test_mass_conservation_replay_semigroup_and_no_exchange(self):
        original = initial()
        total = sum(map(sum, original))
        for steps in (0, *CHECKPOINTS):
            state = direct(original, steps)
            self.assertAlmostEqual(sum(map(sum, state)), total, delta=2e-8)
            self.assertEqual(state, direct(original, steps))
            self.assertTrue(all(math.isfinite(value) and value >= 0
                                for field in state for value in field))
        self.assertEqual(direct(original, 0), original)
        self.assertLess(maximum_error(direct(direct(original, 32), 32),
                                      direct(original, 64)), 2e-11)
        self.assertGreater(maximum_error(direct(original, 32, exchange=0),
                                         direct(original, 32)), 10)
        altered = ((0.03, 0.08, 0.06), DIFFUSION[1])
        self.assertGreater(maximum_error(direct(original, 32, diffusion=altered),
                                         direct(original, 32)), .01)

    def test_seeded_arbitrary_volumes_preserve_mass_and_semigroup(self):
        rng = random.Random(20261031)
        state = ([rng.uniform(10, 20) for _ in range(COUNT)],
                 [rng.uniform(40, 50) for _ in range(COUNT)])
        first = direct(state, 3)
        self.assertAlmostEqual(sum(map(sum, first)), sum(map(sum, state)), delta=1e-9)
        self.assertLess(maximum_error(direct(first, 5), direct(state, 8)), 1e-12)

    def test_negative_inputs_and_work_ceiling(self):
        original = initial()
        bad = [original[0][:], original[1][:]]
        bad[0][511] = float("nan")
        for state, steps, ratio, exchange, tensor in (
            (original, -1, RATIO, EXCHANGE, DIFFUSION),
            (original, 257, RATIO, EXCHANGE, DIFFUSION),
            (original, 8, -0.01, EXCHANGE, DIFFUSION),
            (original, 8, RATIO, 0.26, DIFFUSION),
            (original, 8, float("nan"), EXCHANGE, DIFFUSION),
            (original, 8, RATIO, EXCHANGE, ((2.0, .08, .06), DIFFUSION[1])),
            (bad, 8, RATIO, EXCHANGE, DIFFUSION),
            ((original[0][:-1], original[1]), 8, RATIO, EXCHANGE, DIFFUSION),
        ):
            with self.subTest(steps=steps, ratio=ratio, exchange=exchange):
                with self.assertRaises(ValueError):
                    direct(state, steps, ratio, exchange, tensor)

    def test_native_source_contract_and_plot_slice(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertLess(len(source.encode("utf-8")), 128*1024)
        for fragment in ("function advance(", "function integrate(",
                         "function reference(", "steps > 256",
                         "FLOWSTUDIO_GRID_V1 8 8 2",
                         "native-coupled-volume8-ok", "index3(x, y, 0)"):
            self.assertIn(fragment, source)
        self.assertEqual(len(z_slice(spectral(64))[0]), 64)
        self.assertGreater(max(z_slice(spectral(64))[0]) -
                           min(z_slice(spectral(64))[0]), 1e-4)


if __name__ == "__main__":
    unittest.main()
