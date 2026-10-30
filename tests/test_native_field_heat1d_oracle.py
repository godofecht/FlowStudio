"""Independent 32-cell Dirichlet field/evolution numerical oracle.

Native execution of the upstream Flow compiler, field lowering, production HTTP
and browser is performed separately by the existing CI acceptance.
"""
import math
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "examples/native_field_heat1d.flow"
N = 32
RATIO = 0.4


def source_array(name):
    source = SOURCE.read_text(encoding="utf-8")
    match = re.search(
        rf"let {name}: array<f64, 32> = \\[([^\\]]+)\\]",
        source, re.MULTILINE)
    if match is None:
        raise AssertionError(f"Missing checked-in {name} array")
    result = [float(item.strip()) for item in match.group(1).split(",")]
    if len(result) != N:
        raise AssertionError(f"Expected {N} {name} values, got {len(result)}")
    return result


def initial_value(i):
    if i == 0 or i == N - 1:
        return 0.0
    return 2.0 * math.sin(math.pi * i / (N - 1)) + (
        0.3 * math.sin(3.0 * math.pi * i / (N - 1)))


def analytic_value(i, steps):
    if i == 0 or i == N - 1:
        return 0.0
    eigenvalue1 = 1.0 - 4.0 * RATIO * math.sin(math.pi / (2 * (N - 1))) ** 2
    eigenvalue3 = 1.0 - 4.0 * RATIO * math.sin(3 * math.pi / (2 * (N - 1))) ** 2
    return (2.0 * math.sin(math.pi * i / (N - 1)) * eigenvalue1 ** steps +
            0.3 * math.sin(3.0 * math.pi * i / (N - 1)) * eigenvalue3 ** steps)


def step(state, ratio=RATIO):
    return ([0.0] +
            [state[i] + ratio * (state[i - 1] - 2 * state[i] + state[i + 1])
             for i in range(1, N - 1)] + [0.0])


def evolve(initial, steps, ratio=RATIO):
    state = initial[:]
    for _ in range(steps):
        state = step(state, ratio)
    return state


def max_error(a, b):
    return max(abs(x - y) for x, y in zip(a, b))


class NativeFieldHeatOracle(unittest.TestCase):
    def test_all_32_source_values_against_independent_modes(self):
        self.assertLess(max_error(source_array("initial"),
                                  [initial_value(i) for i in range(N)]), 2e-14)
        for steps in (16, 64):
            expected = source_array(f"expected{steps}")
            self.assertLess(max_error(expected,
                                      [analytic_value(i, steps) for i in range(N)]),
                            2e-14)

    def test_all_cells_against_independent_direct_stencil(self):
        initial = source_array("initial")
        for steps in (16, 64):
            expected = source_array(f"expected{steps}")
            self.assertLess(max_error(evolve(initial, steps), expected), 1e-12)

    def test_dirichlet_energy_positivity_and_semigroup(self):
        initial = source_array("initial")
        first = evolve(initial, 16)
        final = evolve(initial, 64)
        self.assertEqual(final[0], 0.0)
        self.assertEqual(final[-1], 0.0)
        self.assertGreaterEqual(min(final), 0.0)
        energy = lambda values: sum(v * v for v in values)
        self.assertGreater(energy(initial), energy(first))
        self.assertGreater(energy(first), energy(final))
        self.assertLess(max_error(evolve(evolve(initial, 32), 32), final), 1e-13)
        self.assertEqual(final, evolve(initial, 64))

    def test_two_distinct_eigenvalues_and_mutation_detection(self):
        initial = source_array("initial")
        first = 1 - 4 * RATIO * math.sin(math.pi / (2 * (N - 1))) ** 2
        third = 1 - 4 * RATIO * math.sin(3 * math.pi / (2 * (N - 1))) ** 2
        self.assertGreater(first, third)
        self.assertLess(first, 1)
        wrong = [2 * math.sin(math.pi * i / (N - 1)) * first ** 64
                 for i in range(N)]
        self.assertGreater(max_error(evolve(initial, 64), wrong), 0.01)
        changed = initial[:]
        changed[15] += 0.1
        self.assertGreater(max_error(evolve(changed, 64), evolve(initial, 64)),
                           0.001)

    def test_resource_guard_and_native_syntax_contract(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("field T : f64[32] on Line", source)
        self.assertIn("T evolves as laplacian(T)", source)
        self.assertIn("boundary T { left = 0.0  right = 0.0 }", source)
        self.assertIn("T_field_step(current, next, ratio)", source)
        self.assertIn("steps > 4096", source)
        self.assertIn("ratio > 0.5", source)
        self.assertIn('native-field-heat1d-ok', source)


if __name__ == "__main__":
    unittest.main()
