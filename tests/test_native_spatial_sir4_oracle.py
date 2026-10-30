"""Independent 12-state nonlinear periodic SIR oracle for native Flow 2.0.

The numerical reference is computed without importing or executing the Flow
compiler. Native compilation and HTTP/browser execution are separate CI gates.
"""
import math
from pathlib import Path
import re
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "examples/native_spatial_sir4.flow"
INITIAL = (
    .96, .04, 0., .91, .07, .02, .85, .10, .05, .98, .01, .01,
)
RATES = (1.3, .4, .15, .09, .06)
DURATION = 1.25
NAMES = ("North", "East", "South", "West")
FIELDS = ("susceptible", "infected", "recovered")


def derivative(state, rates=RATES):
    beta, gamma, ds, di, dr = rates
    result = []
    for cell in range(4):
        s, i, r = state[3 * cell:3 * cell + 3]
        left = state[3 * ((cell - 1) % 4):3 * ((cell - 1) % 4) + 3]
        right = state[3 * ((cell + 1) % 4):3 * ((cell + 1) % 4) + 3]
        result.extend((
            -beta * s * i + ds * (left[0] + right[0] - 2 * s),
            beta * s * i - gamma * i + di * (left[1] + right[1] - 2 * i),
            gamma * i + dr * (left[2] + right[2] - 2 * r),
        ))
    return tuple(result)


def rk4(initial=INITIAL, steps=64, duration=DURATION, rates=RATES):
    state = tuple(initial)
    dt = duration / steps
    for _ in range(steps):
        k1 = derivative(state, rates)
        k2 = derivative(tuple(x + dt * v / 2 for x, v in zip(state, k1)), rates)
        k3 = derivative(tuple(x + dt * v / 2 for x, v in zip(state, k2)), rates)
        k4 = derivative(tuple(x + dt * v for x, v in zip(state, k3)), rates)
        state = tuple(
            x + dt * (a + 2 * b + 2 * c + d) / 6
            for x, a, b, c, d in zip(state, k1, k2, k3, k4)
        )
    return state


def error(a, b):
    return max(abs(x - y) for x, y in zip(a, b))


def rotate(state):
    return state[-3:] + state[:-3]


class SpatialSIR4Oracle(unittest.TestCase):
    def test_all_twelve_reference_values_and_real_evolution_syntax(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("flow SpatialSIR4 {", source)
        self.assertIn("SpatialSIR4_step(&state, dt)", source)
        self.assertIn('println("native-spatial-sir4-ok")', source)
        block = source.split("function independentReference()", 1)[1].split("return expected", 1)[0]
        reference = rk4(steps=32768)
        self.assertLess(error(reference, rk4(steps=65536)), 1e-13)
        for name, value in zip(
            (field + cell for cell in NAMES for field in FIELDS), reference
        ):
            match = re.search(r"expected\." + name + r"\s*=\s*([0-9.]+)", block)
            self.assertIsNotNone(match, name)
            self.assertAlmostEqual(float(match.group(1)), value, delta=3e-13)

    def test_compiler_generated_equations_match_independent_stencil(self):
        source = SOURCE.read_text(encoding="utf-8")
        for index, cell in enumerate(NAMES):
            left, right = NAMES[(index - 1) % 4], NAMES[(index + 1) % 4]
            for field in FIELDS:
                self.assertIn(
                    field + left + " + " + field + right + " - 2.0 * " + field + cell,
                    source,
                )
        baseline = derivative(INITIAL)
        self.assertAlmostEqual(sum(baseline), 0.0, delta=1e-14)
        self.assertGreater(error(baseline, derivative(INITIAL, (1.3, .4, .15, 0., .06))), 1e-3)

    def test_fourth_order_refinement_and_bounded_work(self):
        reference = rk4(steps=32768)
        errors = [error(rk4(steps=n), reference) for n in (4, 8, 16, 32, 64)]
        self.assertGreater(errors[0], 1e-6)
        self.assertLess(errors[-1], 1e-9)
        for previous, current in zip(errors, errors[1:]):
            self.assertLess(current, .11 * previous)
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("steps > 8192", source)
        self.assertIn("duration <= 10.0", source)
        self.assertIn("rateBound", source)

    def test_mass_positivity_semigroup_and_replay(self):
        evolved = rk4()
        self.assertEqual(evolved, rk4())
        self.assertAlmostEqual(sum(evolved), 4., delta=2e-14)
        self.assertTrue(all(0 < value < 1 for value in evolved))
        half = rk4(steps=32, duration=DURATION / 2)
        self.assertLess(error(rk4(half, 32, DURATION / 2), evolved), 1e-14)
        self.assertEqual(rk4(duration=0.), INITIAL)

    def test_cyclic_equivariance_and_rate_time_scaling(self):
        evolved = rk4()
        self.assertLess(error(rk4(rotate(INITIAL)), rotate(evolved)), 1e-14)
        self.assertLess(error(rk4(duration=2 * DURATION,
                                  rates=tuple(x / 2 for x in RATES)), evolved), 1e-14)

    def test_exact_nonlinear_logistic_limits_and_mutation_detection(self):
        logistic = rk4(steps=128, rates=(1.3, 0., 0., 0., 0.))
        for index in range(4):
            s, i, r = INITIAL[3 * index:3 * index + 3]
            mass = s + i
            growth = math.exp(1.3 * mass * DURATION)
            exact_i = mass * i * growth / (s + i * growth)
            self.assertAlmostEqual(logistic[3 * index + 1], exact_i, delta=1e-8)
            self.assertAlmostEqual(logistic[3 * index], mass - exact_i, delta=1e-8)
            self.assertEqual(logistic[3 * index + 2], r)
        self.assertGreater(error(rk4(), rk4(rates=(1.3, .4, .15, 0., .06))), 1e-3)
        self.assertGreater(error(rk4(), rk4(rates=(1.3, 0., .15, .09, .06))), 1e-2)
        self.assertEqual(rk4(rates=(0., 0., 0., 0., 0.)), INITIAL)


if __name__ == "__main__":
    unittest.main()
