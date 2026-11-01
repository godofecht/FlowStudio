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



def seeded_initial() -> tuple[list[float], list[float]]:
    """Independent seed-9137, three-axis asymmetric residue construction."""
    fields = ([], [])
    for z in range(SIDE):
        for y in range(SIDE):
            for x in range(SIDE):
                residue = (9137 + 71*x + 113*y + 157*z +
                           17*x*y + 19*y*z + 23*z*x) % 251
                fields[0].append(30 + .1 * residue)
                fields[1].append(10 + .07 * ((3*residue + 41) % 251))
    return fields


def sparse_oracle(state: tuple[list[float], list[float]], steps: int,
                  ratio: float = RATIO, exchange: float = EXCHANGE,
                  diffusion=DIFFUSION) -> tuple[list[float], list[float]]:
    """Assemble sparse Markov rows, then apply a separate exchange matrix.

    This does not call the direct stencil or the Fourier reference. Every
    periodic edge is represented by an explicit row weight.
    """
    if type(steps) is not int or not 0 <= steps <= 256:
        raise ValueError("invalid voxel-step budget")
    if not math.isfinite(ratio) or not 0 <= ratio <= .5:
        raise ValueError("invalid ratio")
    if not math.isfinite(exchange) or not 0 <= exchange <= .25:
        raise ValueError("invalid exchange")
    if len(state) != 2 or any(len(field) != COUNT for field in state):
        raise ValueError("invalid state shape")
    if any(not math.isfinite(v) or not -1000 <= v <= 1000
           for field in state for v in field):
        raise ValueError("invalid state values")
    if len(diffusion) != 2 or any(len(tensor) != 3 for tensor in diffusion):
        raise ValueError("invalid tensor shape")
    if any(not math.isfinite(a) or not 0 <= a <= 1
           for tensor in diffusion for a in tensor):
        raise ValueError("invalid tensor")
    if any(ratio * sum(tensor) > .5 for tensor in diffusion):
        raise ValueError("unstable explicit stencil")

    rows = []
    for ax, ay, az in diffusion:
        species_rows = []
        for z in range(SIDE):
            for y in range(SIDE):
                for x in range(SIDE):
                    weights = {index(x, y, z): 1 - 2*ratio*(ax+ay+az)}
                    for left, right, weight in (
                        (index(x-1, y, z), index(x+1, y, z), ratio*ax),
                        (index(x, y-1, z), index(x, y+1, z), ratio*ay),
                        (index(x, y, z-1), index(x, y, z+1), ratio*az),
                    ):
                        weights[left] = weights.get(left, 0) + weight
                        weights[right] = weights.get(right, 0) + weight
                    species_rows.append(tuple(weights.items()))
        rows.append(species_rows)

    current = (state[0][:], state[1][:])
    for _ in range(steps):
        diffused = tuple([
            sum(weight * current[species][neighbor]
                for neighbor, weight in rows[species][i])
            for i in range(COUNT)
        ] for species in range(2))
        current = (
            [(1-exchange)*u + exchange*v for u, v in zip(*diffused)],
            [exchange*u + (1-exchange)*v for u, v in zip(*diffused)],
        )
    return current

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



def spatial_energy(state) -> float:
    """Sum of centered U/V variances, independent of their exchanged means."""
    return sum(sum((v - sum(field) / COUNT) ** 2 for v in field)
               for field in state)


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

    def test_every_3d_intermediate_energy_and_full_volume(self):
        state = initial()
        initial_low = min(min(field) for field in state)
        initial_high = max(max(field) for field in state)
        previous_energy = spatial_energy(state)
        self.assertGreater(previous_energy, 1000)
        for step in range(1, 65):
            state = direct(state, 1)
            reference = spectral(step)
            self.assertLess(maximum_error(state, reference), 2e-10)
            self.assertLessEqual(spatial_energy(state), previous_energy + 1e-8)
            self.assertGreaterEqual(min(min(field) for field in state), initial_low - 1e-9)
            self.assertLessEqual(max(max(field) for field in state), initial_high + 1e-9)
            previous_energy = spatial_energy(state)
        self.assertLess(previous_energy, spatial_energy(initial()))
        self.assertEqual(sum(len(field) for field in state), 1024)


    def test_seeded_non_fourier_all_1024_voxels_against_sparse_oracle(self):
        state = seeded_initial()
        self.assertEqual(tuple(map(len, state)), (512, 512))
        self.assertTrue(all(10 <= v <= 55 for field in state for v in field))
        for steps in (0, 8, 32, 64):
            with self.subTest(steps=steps):
                actual = direct(state, steps)
                expected = sparse_oracle(state, steps)
                self.assertLess(maximum_error(actual, expected), 2e-10)
                self.assertAlmostEqual(sum(map(sum, actual)),
                                       sum(map(sum, state)), delta=1e-8)
        self.assertEqual(direct(state, 64), direct(state, 64))
        self.assertLess(maximum_error(
            sparse_oracle(sparse_oracle(state, 32), 32),
            sparse_oracle(state, 64)), 2e-11)
        altered = ((.03, .08, .06), DIFFUSION[1])
        self.assertGreater(maximum_error(
            sparse_oracle(state, 32, diffusion=altered),
            sparse_oracle(state, 32)), .01)

    def test_seeded_all_64_intermediate_energies_and_maximum_principle(self):
        initial_state = seeded_initial()
        state = initial_state
        mass = sum(map(sum, state))
        low = min(min(field) for field in state)
        high = max(max(field) for field in state)
        previous = spatial_energy(state)
        for step in range(1, 65):
            state = sparse_oracle(state, 1)
            energy = spatial_energy(state)
            self.assertLessEqual(energy, previous + 1e-7, step)
            self.assertAlmostEqual(sum(map(sum, state)), mass, delta=1e-8)
            self.assertGreaterEqual(min(min(field) for field in state), low-1e-9)
            self.assertLessEqual(max(max(field) for field in state), high+1e-9)
            previous = energy
        self.assertLess(previous, spatial_energy(initial_state))
        self.assertLess(maximum_error(state, direct(initial_state, 64)), 2e-10)

    def test_seeded_sparse_negative_inputs_and_work_budget(self):
        state = seeded_initial()
        malformed = (state[0][:-1], state[1])
        bad = (state[0][:], state[1][:])
        bad[1][511] = float("nan")
        for fields, steps, ratio, exchange, coefficients in (
            (state, -1, RATIO, EXCHANGE, DIFFUSION),
            (state, 257, RATIO, EXCHANGE, DIFFUSION),
            (state, 64, -.01, EXCHANGE, DIFFUSION),
            (state, 64, RATIO, .26, DIFFUSION),
            (state, 64, float("nan"), EXCHANGE, DIFFUSION),
            (state, 64, RATIO, EXCHANGE, ((2, .08, .06), DIFFUSION[1])),
            (bad, 64, RATIO, EXCHANGE, DIFFUSION),
            (malformed, 64, RATIO, EXCHANGE, DIFFUSION),
        ):
            with self.subTest(steps=steps, ratio=ratio):
                with self.assertRaises(ValueError):
                    sparse_oracle(fields, steps, ratio, exchange, coefficients)

    def test_exact_periodic_impulse_on_each_axis_at_cfl_limit(self):
        """Independent closed-form Green function, not just stencil agreement."""
        impulse = ([0.0] * COUNT, [0.0] * COUNT)
        impulse[0][index(0, 0, 0)] = 1.0
        for axis in range(3):
            with self.subTest(axis=axis):
                coeff = tuple(float(i == axis) for i in range(3))
                tensor = (coeff, (0.0, 0.0, 0.0))
                expected = ([0.0] * COUNT, [0.0] * COUNT)
                plus = [0, 0, 0]
                minus = [0, 0, 0]
                plus[axis] = 1
                minus[axis] = -1
                expected[0][index(*plus)] = 0.5
                expected[0][index(*minus)] = 0.5
                for solver in (direct, sparse_oracle):
                    actual = solver(impulse, 1, ratio=0.5,
                                    exchange=0.0, diffusion=tensor)
                    self.assertEqual(actual, expected)
                    self.assertEqual(sum(map(sum, actual)), 1.0)
                excessive = (tuple(value + (0.01 if i == (axis + 1) % 3
                                            else 0.0)
                                   for i, value in enumerate(coeff)),
                             (0.0, 0.0, 0.0))
                for solver in (direct, sparse_oracle):
                    with self.assertRaisesRegex(ValueError, "unstable"):
                        solver(impulse, 1, ratio=0.5,
                               exchange=0.0, diffusion=excessive)
                self.assertEqual(impulse[0][0], 1.0)

    def test_exact_exchange_only_and_constant_fixed_points(self):
        impulse = ([0.0] * COUNT, [0.0] * COUNT)
        impulse[0][0] = 1.0
        zero = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
        expected = ([0.0] * COUNT, [0.0] * COUNT)
        expected[0][0] = 0.625
        expected[1][0] = 0.375
        for solver in (direct, sparse_oracle):
            self.assertEqual(solver(impulse, 16, ratio=0.0,
                                    exchange=0.0, diffusion=zero), impulse)
            self.assertEqual(solver(impulse, 2, ratio=0.0,
                                    exchange=0.25, diffusion=zero), expected)
            flat = ([3.0] * COUNT, [7.0] * COUNT)
            self.assertLess(maximum_error(solver(flat, 16, exchange=0.0), flat), 1e-12)

    def test_native_source_contract_and_plot_slice(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertLess(len(source.encode("utf-8")), 128*1024)
        for fragment in ("function advance(", "function integrate(",
                         "function reference(", "steps > 256",
                         "FLOWSTUDIO_GRID_V1 8 8 2",
                         "FLOWSTUDIO_VOLUME_FIELDS_V1 8 8 8 2",
                         "FLOWSTUDIO_VOLUME_ENERGY_V1 64 1",
                         "FLOWSTUDIO_VOLUME_SEEDED_V1 8 8 8 2",
                         "FLOWSTUDIO_VOLUME_SEEDED_ENERGY_V1 64 1",
                         "seededInitialState",
                         "Exact 3D Green-function checks",
                         "native-coupled-volume8-ok", "index3(x, y, 0)"):
            self.assertIn(fragment, source)
        self.assertEqual(len(z_slice(spectral(64))[0]), 64)
        self.assertGreater(max(z_slice(spectral(64))[0]) -
                           min(z_slice(spectral(64))[0]), 1e-4)


if __name__ == "__main__":
    unittest.main()
