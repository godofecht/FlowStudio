"""Independent standard-library numerical oracle for two coupled native 32x32 PDEs.

This module does not execute Flow. The native compiler, HTTP router and
physical Chromium acceptance are exercised separately in CI.
"""
import math
import random
import unittest
from pathlib import Path

SIZE = 32
COUNT = SIZE * SIZE
DURATION = 0.025
EXCHANGE = 0.35
FIRST = (0.012, 0.004, 0.018)
SECOND = (0.008, -0.002, 0.010)


def quarter(index):
    return (1.0, 0.0, -1.0, 0.0)[index % 4]


def initial():
    return (
        [300.0 + 7.0 * quarter(x + y) + 3.0 * quarter(x - y)
         for y in range(SIZE) for x in range(SIZE)],
        [5.0 + 0.8 * quarter(x + y) - 0.3 * quarter(x - y)
         for y in range(SIZE) for x in range(SIZE)],
    )


def tensor_slope(values, tensor):
    xx, xy, yy = tensor
    output = [0.0] * COUNT
    for y in range(SIZE):
        for x in range(SIZE):
            index = y * SIZE + x
            center = values[index]
            second_x = (values[y * SIZE + (x - 1) % SIZE] - 2 * center +
                        values[y * SIZE + (x + 1) % SIZE]) * SIZE ** 2
            second_y = (values[((y - 1) % SIZE) * SIZE + x] - 2 * center +
                        values[((y + 1) % SIZE) * SIZE + x]) * SIZE ** 2
            mixed = (
                values[((y + 1) % SIZE) * SIZE + (x + 1) % SIZE] -
                values[((y + 1) % SIZE) * SIZE + (x - 1) % SIZE] -
                values[((y - 1) % SIZE) * SIZE + (x + 1) % SIZE] +
                values[((y - 1) % SIZE) * SIZE + (x - 1) % SIZE]
            ) * (SIZE ** 2 / 4)
            output[index] = xx * second_x + 2 * xy * mixed + yy * second_y
    return output


def slope(state, exchange=EXCHANGE, reverse=None):
    u, v = state
    du = tensor_slope(u, FIRST)
    dv = tensor_slope(v, SECOND)
    if reverse is None:
        reverse = exchange
    for i in range(COUNT):
        transfer = exchange * u[i] - reverse * v[i]
        du[i] -= transfer
        dv[i] += transfer
    return du, dv


def scaled(state, derivative, h):
    return tuple([[a + h * b for a, b in zip(values, rates)]
                  for values, rates in zip(state, derivative)])


def integrate(state, steps=128, duration=DURATION, exchange=EXCHANGE, reverse=None):
    h = duration / steps
    u, v = (list(state[0]), list(state[1]))
    for _ in range(steps):
        current = (u, v)
        middle = scaled(current, slope(current, exchange, reverse), h / 2)
        u, v = scaled(current, slope(middle, exchange, reverse), h)
    return u, v


def matrix_exponential_mode(u, v, decay_u, decay_v, duration=DURATION):
    # Exact symmetric 2x2 matrix exponential, not the RK2 recurrence.
    center = -(decay_u + decay_v) / 2 - EXCHANGE
    difference = (decay_v - decay_u) / 2
    radius = math.hypot(difference, EXCHANGE)
    factor = math.exp(center * duration)
    cosine = math.cosh(radius * duration)
    sine = math.sinh(radius * duration) / radius
    return (
        factor * (cosine * u + sine * (difference * u + EXCHANGE * v)),
        factor * (cosine * v + sine * (EXCHANGE * u - difference * v)),
    )


def exact():
    mean_u, mean_v = matrix_exponential_mode(300, 5, 0, 0)
    plus_u, plus_v = matrix_exponential_mode(7, 0.8, 69.632, 32.768)
    minus_u, minus_v = matrix_exponential_mode(3, -0.3, 53.248, 40.96)
    return (
        [mean_u + plus_u * quarter(x + y) + minus_u * quarter(x - y)
         for y in range(SIZE) for x in range(SIZE)],
        [mean_v + plus_v * quarter(x + y) + minus_v * quarter(x - y)
         for y in range(SIZE) for x in range(SIZE)],
    )



def directed_mode(u, v, decay_u, decay_v, forward, reverse, duration=DURATION):
    """Exact two-rate Fourier matrix exponential; independent of the RK2 step."""
    center = -(decay_u + decay_v + forward + reverse) / 2
    difference = (decay_v - decay_u - forward + reverse) / 2
    radius = math.hypot(difference, math.sqrt(forward * reverse))
    hyperbolic = (math.sinh(radius * duration) / radius
                  if radius else duration)
    factor = math.exp(center * duration)
    cosine = math.cosh(radius * duration)
    return (
        factor * (cosine * u + hyperbolic * (difference * u + reverse * v)),
        factor * (cosine * v + hyperbolic * (forward * u - difference * v)),
    )


def directed_exact(forward=0.8, reverse=0.2):
    mean = directed_mode(300, 5, 0, 0, forward, reverse)
    plus = directed_mode(7, 0.8, 69.632, 32.768, forward, reverse)
    minus = directed_mode(3, -0.3, 53.248, 40.96, forward, reverse)
    return (
        [mean[0] + plus[0] * quarter(x + y) + minus[0] * quarter(x - y)
         for y in range(SIZE) for x in range(SIZE)],
        [mean[1] + plus[1] * quarter(x + y) + minus[1] * quarter(x - y)
         for y in range(SIZE) for x in range(SIZE)],
    )


def error(first, second):
    return max(abs(a - b) for left, right in zip(first, second)
               for a, b in zip(left, right))


class NativeCoupledTensor32Oracle(unittest.TestCase):
    def test_independent_fourier_symbols_and_coupled_derivative(self):
        state = initial()
        du, dv = slope(state)
        for y in range(SIZE):
            for x in range(SIZE):
                index = y * SIZE + x
                plus, minus = quarter(x + y), quarter(x - y)
                transfer = EXCHANGE * (state[1][index] - state[0][index])
                self.assertAlmostEqual(
                    du[index], -69.632 * 7 * plus - 53.248 * 3 * minus + transfer,
                    delta=1e-10,
                )
                self.assertAlmostEqual(
                    dv[index], -32.768 * 0.8 * plus + 40.96 * 0.3 * minus - transfer,
                    delta=1e-10,
                )

    def test_all_2048_cells_and_second_order_refinement(self):
        state, reference = initial(), exact()
        errors = [error(integrate(state, steps), reference)
                  for steps in (32, 64, 128)]
        self.assertGreater(errors[0], 0.001)
        self.assertGreater(errors[1], 0.0002)
        self.assertLess(errors[2], 0.00012)
        self.assertLess(errors[1], errors[0] * 0.30)
        self.assertLess(errors[2], errors[1] * 0.30)

    def test_conservation_exchange_and_semigroup(self):
        state = initial()
        full = integrate(state)
        half = integrate(state, 64, DURATION / 2)
        composed = integrate(half, 64, DURATION / 2)
        self.assertLess(error(full, composed), 5e-11)
        self.assertEqual(full, integrate(state))
        self.assertAlmostEqual(
            (sum(full[0]) + sum(full[1])) / COUNT, 305.0, delta=5e-11
        )
        self.assertLess(sum(full[0]) / COUNT, 298)
        self.assertGreater(sum(full[1]) / COUNT, 7)
        no_exchange = integrate(state, exchange=0.0)
        self.assertAlmostEqual(sum(no_exchange[0]) / COUNT, 300, delta=5e-11)
        self.assertAlmostEqual(sum(no_exchange[1]) / COUNT, 5, delta=5e-11)
        self.assertGreater(error(full, no_exchange), 2.0)

    def test_translation_and_seeded_derivative_conservation(self):
        rng = random.Random(20261031)
        state = ([rng.uniform(-10, 10) for _ in range(COUNT)],
                 [rng.uniform(-10, 10) for _ in range(COUNT)])
        derivatives = slope(state)
        self.assertAlmostEqual(
            sum(derivatives[0]) + sum(derivatives[1]), 0, delta=1e-8
        )
        shift = lambda grid: [grid[y * SIZE + (x - 1) % SIZE]
                              for y in range(SIZE) for x in range(SIZE)]
        shifted = (shift(state[0]), shift(state[1]))
        expected = tuple(shift(values) for values in derivatives)
        self.assertLess(error(slope(shifted), expected), 1e-11)

    def test_mixed_derivative_sign_is_observable(self):
        state = initial()
        plus = tensor_slope(state[0], FIRST)
        minus = tensor_slope(state[0], (FIRST[0], -FIRST[1], FIRST[2]))
        self.assertGreater(max(abs(a - b) for a, b in zip(plus, minus)), 100)


    def test_directed_exchange_all_2048_cells_against_matrix_exponential(self):
        state = initial()
        reference = directed_exact()
        errors = [error(integrate(state, steps, exchange=0.8, reverse=0.2),
                        reference) for steps in (32, 64, 128)]
        self.assertGreater(errors[0], 0.001)
        self.assertLess(errors[-1], 0.00012)
        self.assertLess(errors[1], errors[0] * 0.30)
        self.assertLess(errors[2], errors[1] * 0.30)
        fine = integrate(state, 128, exchange=0.8, reverse=0.2)
        self.assertEqual(fine, integrate(state, 128, exchange=0.8, reverse=0.2))
        self.assertAlmostEqual(sum(fine[0]) / COUNT, 294.0990689747715,
                               delta=1e-6)
        self.assertAlmostEqual(sum(fine[1]) / COUNT, 10.900931025228488,
                               delta=1e-6)
        self.assertAlmostEqual((sum(fine[0]) + sum(fine[1])) / COUNT,
                               305, delta=5e-11)
        self.assertGreater(error(fine, integrate(state)), 3.0)

    def test_directed_exchange_seeded_conservation_and_orientation(self):
        rng = random.Random(20261031)
        for _ in range(8):
            state = ([rng.uniform(-100, 100) for _ in range(COUNT)],
                     [rng.uniform(-100, 100) for _ in range(COUNT)])
            derivative = slope(state, exchange=0.8, reverse=0.2)
            self.assertAlmostEqual(sum(derivative[0]) + sum(derivative[1]),
                                   0, delta=1e-7)
            reversed_rates = slope(state, exchange=0.2, reverse=0.8)
            self.assertGreater(error(derivative, reversed_rates), 10)
        for forward, reverse in ((0.8, 0.2), (0.2, 0.8), (0.0, 0.0)):
            mean = directed_mode(300, 5, 0, 0, forward, reverse)
            self.assertAlmostEqual(sum(mean), 305, delta=1e-12)

    def test_directed_native_full_grid_coefficients_and_semigroup(self):
        # These coefficients come from the analytic nonsymmetric matrix
        # exponential, not from the midpoint integrator under test.
        modes = (
            (300.0, 5.0, 0.0, 0.0,
             294.09906897477157, 10.900931025228495),
            (7.0, 0.8, 69.632, 32.768,
             1.2045742437862, 0.39074462095173346),
            (3.0, -0.3, 53.248, 40.96,
             0.7763731765973004, -0.08888326676573649),
        )
        source = (Path(__file__).resolve().parents[1] /
                  "examples/native_coupled_tensor32.flow").read_text()
        self.assertIn("function expectedDirectedState() -> Species", source)
        self.assertIn("directedFine.state, directedReference", source)
        self.assertIn("directedMediumError >= 0.30 * directedCoarseError", source)
        for u, v, decay_u, decay_v, expected_u, expected_v in modes:
            actual_u, actual_v = directed_mode(
                u, v, decay_u, decay_v, 0.8, 0.2)
            self.assertAlmostEqual(actual_u, expected_u, delta=1e-12)
            self.assertAlmostEqual(actual_v, expected_v, delta=1e-12)
            self.assertIn(str(expected_u), source)
            self.assertIn(str(expected_v), source)
        state = initial()
        whole = integrate(state, 128, exchange=0.8, reverse=0.2)
        half = integrate(state, 64, duration=DURATION / 2,
                         exchange=0.8, reverse=0.2)
        composed = integrate(half, 64, duration=DURATION / 2,
                             exchange=0.8, reverse=0.2)
        self.assertLess(error(whole, composed), 5e-11)
        self.assertEqual(state, initial())

    def test_directed_zero_rate_triangular_exchange(self):
        # Zero forward/reverse limits must not divide by zero or invent
        # mass transfer. The exact oracle is independent of the RK2 path.
        for forward, reverse in ((0.0, 0.0), (0.8, 0.0), (0.0, 0.2)):
            expected = directed_mode(300.0, 5.0, 0, 0,
                                     forward, reverse)
            evolved = integrate(initial(), 128,
                                exchange=forward, reverse=reverse)
            self.assertAlmostEqual(sum(evolved[0]) / COUNT, expected[0],
                                   delta=1e-6)
            self.assertAlmostEqual(sum(evolved[1]) / COUNT, expected[1],
                                   delta=1e-6)
            self.assertAlmostEqual(sum(expected), 305.0, delta=1e-12)

    def test_checked_in_native_source_and_resource_guard(self):
        source = (Path(__file__).resolve().parents[1] /
                  "examples/native_coupled_tensor32.flow").read_text()
        self.assertIn("coupledSlope(equation, middle)", source)
        self.assertIn("equation.forward * state.u.values[index]", source)
        self.assertIn("equation.reverse * state.v.values[index]", source)
        self.assertIn("maximumRate + equation.forward + equation.reverse", source)
        self.assertIn("steps > 195", source)
        self.assertIn('println("FLOWSTUDIO_GRID_V1 32 32 2")', source)
        self.assertIn("print(fine.state.u.values[cell])", source)
        self.assertIn("print(fine.state.v.values[cell])", source)
        self.assertLess(source.index("if fineError > 0.00012"),
                        source.index('println("FLOWSTUDIO_GRID_V1 32 32 2")'))


if __name__ == "__main__":
    unittest.main()
