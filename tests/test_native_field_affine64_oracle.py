"""Independent analytical and direct-stencil oracle for nonzero Dirichlet field lowering.

The real Flow compiler, HTTP server and Chromium are exercised by the native
acceptance suites, not by this Python numerical reference.
"""
import math
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "examples/native_field_affine64.flow"
N = 64
RATIO = 0.4


def source_array(name):
    text = SOURCE.read_text(encoding="utf-8")
    match = re.search(rf"let {name}: array<f64, 64> = \\[([^\\]]+)\\]", text, re.MULTILINE)
    if match is None:
        raise AssertionError(f"Missing {name} reference array")
    values = [float(value.strip()) for value in match.group(1).split(",")]
    if len(values) != N:
        raise AssertionError(f"Expected {N} values for {name}, got {len(values)}")
    return values


def equilibrium(i):
    return 1.0 + i / (N - 1)


def mode(i, k):
    return math.sin(k * math.pi * i / (N - 1))


def eigenvalue(k):
    return 1.0 - 4.0 * RATIO * math.sin(k * math.pi / (2 * (N - 1))) ** 2


def analytic(i, steps):
    if i == 0:
        return 1.0
    if i == N - 1:
        return 2.0
    return (equilibrium(i) + 0.7 * mode(i, 1) * eigenvalue(1) ** steps
            - 0.25 * mode(i, 4) * eigenvalue(4) ** steps)


def evolve(state, steps, ratio=RATIO):
    values = state[:]
    for _ in range(steps):
        values = ([1.0] +
                  [values[i] + ratio * (values[i - 1] - 2 * values[i] + values[i + 1])
                   for i in range(1, N - 1)] + [2.0])
    return values


def error(left, right):
    return max(abs(a - b) for a, b in zip(left, right))


class NativeAffineFieldOracle(unittest.TestCase):
    def test_64_initial_and_192_reference_values(self):
        initial = source_array("initial")
        self.assertLess(error(initial, [analytic(i, 0) for i in range(N)]), 2e-14)
        for steps in (16, 64, 128):
            self.assertLess(error(source_array(f"expected{steps}"),
                                  [analytic(i, steps) for i in range(N)]), 2e-14)

    def test_direct_stencil_matches_all_192_reference_values(self):
        initial = source_array("initial")
        for steps in (16, 64, 128):
            self.assertLess(error(evolve(initial, steps),
                                  source_array(f"expected{steps}")), 1e-12)

    def test_nonzero_dirichlet_and_affine_fixed_point(self):
        state = source_array("initial")
        for steps in (1, 16, 64, 128):
            result = evolve(state, steps)
            self.assertEqual((result[0], result[-1]), (1.0, 2.0))
            self.assertGreater(min(result), 0.0)
        affine = [equilibrium(i) for i in range(N)]
        self.assertLess(error(evolve(affine, 128), affine), 1e-12)

    def test_residual_energy_and_semigroup(self):
        initial = source_array("initial")
        states = [initial] + [evolve(initial, n) for n in (16, 64, 128)]
        energies = [sum((value - equilibrium(i)) ** 2
                        for i, value in enumerate(state)) for state in states]
        self.assertTrue(all(a > b for a, b in zip(energies, energies[1:])))
        self.assertLess(error(evolve(evolve(initial, 64), 64), states[-1]), 1e-13)
        self.assertEqual(evolve(initial, 128), states[-1])

    def test_boundary_and_mode_mutation_detection(self):
        initial = source_array("initial")
        exact = evolve(initial, 64)
        incorrect_zero_boundary = initial[:]
        incorrect_zero_boundary[0] = 0.0
        wrong = incorrect_zero_boundary[:]
        for _ in range(64):
            wrong = ([0.0] +
                     [wrong[i] + RATIO * (wrong[i - 1] - 2 * wrong[i] + wrong[i + 1])
                      for i in range(1, N - 1)] + [0.0])
        self.assertGreater(error(wrong, exact), 1.0)
        single_mode = [equilibrium(i) + 0.7 * mode(i, 1) * eigenvalue(1) ** 64
                       for i in range(N)]
        self.assertGreater(error(single_mode, exact), 0.01)
        changed = initial[:]
        changed[30] += 0.2
        self.assertGreater(abs(evolve(changed, 64)[30] - exact[30]), 0.001)

    def test_native_syntax_and_resource_contract(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("field U : f64[64] on Line", source)
        self.assertIn("U evolves as laplacian(U)", source)
        self.assertIn("boundary U { left = 1.0  right = 2.0 }", source)
        self.assertIn("U_field_step(current, next, ratio)", source)
        self.assertIn("steps > 4096", source)
        self.assertIn("ratio > 0.5", source)
        self.assertIn("sentinel[i] != 777.0", source)
        self.assertIn('native-field-affine64-ok', source)


if __name__ == "__main__":
    unittest.main()
