"""Independent analytical/direct-stencil reference for two upstream Flow fields.

Native compilation and HTTP/Chromium acceptance are separate CI gates.
"""
import math
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "examples/native_field_dual48.flow"
N = 48
SPECS = {
    "A": (1.0, 2.0, 0.4, ((1, 0.6), (4, -0.2))),
    "B": (-0.5, 0.5, 0.2, ((2, 0.3), (7, 0.15))),
}


def source_array(name):
    text = SOURCE.read_text(encoding="utf-8")
    match = re.search(rf"let {name}: array<f64, 48> = \\[([^\\]]+)\\]", text, re.MULTILINE)
    if match is None:
        raise AssertionError(f"Missing {name} array")
    values = [float(value.strip()) for value in match.group(1).split(",") if value.strip()]
    if len(values) != N:
        raise AssertionError(f"{name}: expected {N} values, got {len(values)}")
    return values


def equilibrium(spec, i):
    left, right, _, _ = spec
    return left + (right - left) * i / (N - 1)


def analytic(spec, i, steps):
    left, right, ratio, modes = spec
    if i == 0:
        return left
    if i == N - 1:
        return right
    value = equilibrium(spec, i)
    for k, amplitude in modes:
        eigenvalue = 1.0 - 4.0 * ratio * math.sin(k * math.pi / (2 * (N - 1))) ** 2
        value += amplitude * math.sin(k * math.pi * i / (N - 1)) * eigenvalue ** steps
    return value


def evolve(spec, values, steps):
    left, right, ratio, _ = spec
    state = list(values)
    for _ in range(steps):
        state = ([left] + [state[i] + ratio * (state[i - 1] - 2 * state[i] + state[i + 1])
                            for i in range(1, N - 1)] + [right])
    return state


def max_error(left, right):
    return max(abs(a - b) for a, b in zip(left, right))


class NativeDualFieldOracle(unittest.TestCase):
    def test_all_96_initial_and_288_checkpoint_values(self):
        for name, spec in SPECS.items():
            for steps in (0, 16, 64, 128):
                label = f"initial{name}" if steps == 0 else f"expected{name}{steps}"
                self.assertLess(max_error(source_array(label),
                                          [analytic(spec, i, steps) for i in range(N)]), 2e-14)

    def test_direct_stencil_independent_of_sine_eigenvalue(self):
        for name, spec in SPECS.items():
            initial = source_array(f"initial{name}")
            for steps in (16, 64, 128):
                self.assertLess(max_error(evolve(spec, initial, steps),
                                          source_array(f"expected{name}{steps}")), 1e-12)

    def test_distinct_boundary_and_equilibrium_preservation(self):
        for name, spec in SPECS.items():
            affine = [equilibrium(spec, i) for i in range(N)]
            self.assertLess(max_error(evolve(spec, affine, 128), affine), 1e-12)
            result = evolve(spec, source_array(f"initial{name}"), 128)
            self.assertEqual((result[0], result[-1]), spec[:2])

    def test_separate_energy_decay_and_semigroup(self):
        for name, spec in SPECS.items():
            initial = source_array(f"initial{name}")
            states = [initial] + [evolve(spec, initial, n) for n in (16, 64, 128)]
            energies = [sum((x - equilibrium(spec, i)) ** 2 for i, x in enumerate(state))
                        for state in states]
            self.assertTrue(all(a > b for a, b in zip(energies, energies[1:])))
            self.assertLess(max_error(evolve(spec, states[2], 64), states[3]), 1e-13)

    def test_mutation_catches_wrong_boundary_and_ratio(self):
        for name, spec in SPECS.items():
            initial = source_array(f"initial{name}")
            correct = evolve(spec, initial, 64)
            left, right, ratio, modes = spec
            wrong_ratio = (left, right, ratio * 0.5, modes)
            self.assertGreater(max_error(evolve(wrong_ratio, initial, 64), correct), 0.005)
            wrong_boundary = (left + 1.0, right, ratio, modes)
            self.assertGreater(max_error(evolve(wrong_boundary, initial, 64), correct), 0.9)

    def test_two_real_field_declarations_and_limits(self):
        source = SOURCE.read_text(encoding="utf-8")
        for name, spec in SPECS.items():
            self.assertIn(f"field {name} : f64[48] on Line", source)
            self.assertIn(f"{name} evolves as laplacian({name})", source)
            self.assertIn(f"{name}_field_step(", source)
        self.assertIn("steps > 2048", source)
        self.assertIn("ratioA > 0.5", source)
        self.assertIn("ratioB > 0.5", source)
        self.assertIn("sentinelA[i] != 777.0 or sentinelB[i] != 777.0", source)
        self.assertIn("native-field-dual48-ok", source)


if __name__ == "__main__":
    unittest.main()
