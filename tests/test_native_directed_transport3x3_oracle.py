"""Independent semidiscrete Fourier/Markov oracle for compiler-generated Flow RK4.

The real Flow compiler and HTTP/browser acceptance execute the checked-in
examples/native_evolution_heat3x3.flow; this standard-library suite checks
its independent numerical reference and detects mutated directional stencils.
"""
import math
import re
from pathlib import Path
import unittest

DRIFT_X = 0.7
DRIFT_Y = 0.35
DIFFUSION_X = 0.12
DIFFUSION_Y = 0.08
DURATION = 1.3
SOURCE = Path(__file__).resolve().parents[1] / "examples/native_evolution_heat3x3.flow"


def ring_probability(index, drift, diffusion, duration):
    decay = math.exp(-(1.5 * drift + 3.0 * diffusion) * duration)
    phase = math.sqrt(3.0) * drift * duration / 2.0
    return (1.0 + 2.0 * decay * math.cos(phase - 2.0 * math.pi * index / 3.0)) / 3.0


def analytical(duration=DURATION):
    return [ring_probability(x, DRIFT_X, DIFFUSION_X, duration) *
            ring_probability(y, DRIFT_Y, DIFFUSION_Y, duration)
            for y in range(3) for x in range(3)]


def derivative(state, drift_x=DRIFT_X, drift_y=DRIFT_Y,
               diffusion_x=DIFFUSION_X, diffusion_y=DIFFUSION_Y):
    output = []
    for y in range(3):
        for x in range(3):
            center = state[3 * y + x]
            left = state[3 * y + (x - 1) % 3]
            right = state[3 * y + (x + 1) % 3]
            up = state[3 * ((y - 1) % 3) + x]
            down = state[3 * ((y + 1) % 3) + x]
            output.append(drift_x * (left - center) +
                          drift_y * (up - center) +
                          diffusion_x * (left + right - 2.0 * center) +
                          diffusion_y * (up + down - 2.0 * center))
    return output


def rk4(initial, steps, duration=DURATION, **rates):
    state = initial[:]
    step = duration / steps
    for _ in range(steps):
        k1 = derivative(state, **rates)
        k2 = derivative([x + step * y / 2.0 for x, y in zip(state, k1)], **rates)
        k3 = derivative([x + step * y / 2.0 for x, y in zip(state, k2)], **rates)
        k4 = derivative([x + step * y for x, y in zip(state, k3)], **rates)
        state = [x + step * (a + 2.0 * b + 2.0 * c + d) / 6.0
                 for x, a, b, c, d in zip(state, k1, k2, k3, k4)]
    return state


def maximum_error(first, second):
    return max(abs(a - b) for a, b in zip(first, second))


class NativeDirectedTransport3x3Oracle(unittest.TestCase):
    def setUp(self):
        self.delta = [1.0] + [0.0] * 8

    def test_nine_independent_analytical_values_and_source(self):
        expected = analytical()
        self.assertEqual(len(expected), 9)
        self.assertAlmostEqual(sum(expected), 1.0, delta=1e-15)
        self.assertTrue(all(0.0 < x < 1.0 for x in expected))
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("flow DirectedTransport3x3 {", source)
        self.assertIn("DirectedTransport3x3_step(&state, dt)", source)
        self.assertIn("native-directed-transport3x3-ok", source)
        reference = source.split("function directedReference()", 1)[1].split("return reference", 1)[0]
        names = ("northwest", "north", "northeast", "west", "center", "east",
                 "southwest", "south", "southeast")
        for name, value in zip(names, expected):
            match = re.search(r"reference\\." + name + r"\\s*=\\s*([0-9.]+)", reference)
            self.assertIsNotNone(match, name)
            self.assertAlmostEqual(float(match.group(1)), value, delta=1e-14)

    def test_generator_is_conservative_and_directional(self):
        generator = derivative(self.delta)
        self.assertAlmostEqual(sum(generator), 0.0, delta=1e-14)
        self.assertAlmostEqual(generator[0], -1.45, delta=1e-14)
        self.assertAlmostEqual(generator[1], 0.82, delta=1e-14)
        self.assertAlmostEqual(generator[2], 0.12, delta=1e-14)
        self.assertAlmostEqual(generator[3], 0.43, delta=1e-14)
        self.assertAlmostEqual(generator[6], 0.08, delta=1e-14)
        self.assertGreater(analytical()[1], analytical()[2] + 0.05)
        self.assertGreater(analytical()[3], analytical()[6] + 0.05)

    def test_fourth_order_refinement_every_cell(self):
        exact = analytical()
        errors = [maximum_error(rk4(self.delta, steps), exact)
                  for steps in (4, 8, 16, 32, 64)]
        self.assertGreater(errors[0], 0.0001)
        self.assertLess(errors[-1], 0.000000005)
        for first, second in zip(errors, errors[1:]):
            self.assertLess(second, first * 0.08)
        self.assertLess(maximum_error(rk4(self.delta, 64), exact), 5e-9)

    def test_conservation_replay_and_semigroup(self):
        result = rk4(self.delta, 64)
        self.assertEqual(result, rk4(self.delta, 64))
        self.assertAlmostEqual(sum(result), 1.0, delta=1e-14)
        self.assertTrue(all(0.0 < value < 1.0 for value in result))
        half = rk4(self.delta, 32, duration=DURATION / 2.0)
        self.assertLess(maximum_error(rk4(half, 32, duration=DURATION / 2.0), result), 1e-14)
        self.assertEqual(rk4(self.delta, 8, duration=0.0), self.delta)
        self.assertEqual(rk4([1.0 / 9.0] * 9, 8), [1.0 / 9.0] * 9)

    def test_periodic_shift_rate_scaling_and_mutation_detection(self):
        def shift_x(state):
            return [state[3 * y + (x - 1) % 3] for y in range(3) for x in range(3)]
        evolved = rk4(self.delta, 64)
        self.assertLess(maximum_error(rk4(shift_x(self.delta), 64), shift_x(evolved)), 1e-14)
        scaled = rk4(self.delta, 64, duration=2.0 * DURATION,
                     drift_x=DRIFT_X / 2.0, drift_y=DRIFT_Y / 2.0,
                     diffusion_x=DIFFUSION_X / 2.0,
                     diffusion_y=DIFFUSION_Y / 2.0)
        self.assertLess(maximum_error(scaled, evolved), 1e-14)
        reversed_x = rk4(self.delta, 64, drift_x=0.0, diffusion_x=DIFFUSION_X + DRIFT_X / 2.0)
        self.assertGreater(maximum_error(reversed_x, analytical()), 0.03)


if __name__ == "__main__":
    unittest.main()
