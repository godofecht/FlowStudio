"""Independent numerical oracle for native Flow's generated ring evolution.

These stdlib-only tests validate the analytical values and fourth-order
acceptance thresholds; they DO NOT substitute for compiling or running Flow.
The real compiler/run acceptance is in tests/http_smoke.py.
"""
from __future__ import annotations

import math
import unittest


REFERENCE = (
    0.25724291005472283,
    0.34071466397213435,
    0.26313819193446030,
    0.13890423403868257,
)


def poisson_ring(rate: float, duration: float) -> tuple[float, ...]:
    """Independent stochastic construction: jumps ~ Poisson(rate * duration)."""
    mean = rate * duration
    probability = math.exp(-mean)
    cells = [probability, 0.0, 0.0, 0.0]
    for jumps in range(1, 150):
        probability *= mean / jumps
        cells[jumps % 4] += probability
    return tuple(cells)


def fourier_ring(rate: float, duration: float) -> tuple[float, ...]:
    """Exact spectral solution for the four-node directed-cycle generator."""
    decay = math.exp(-rate * duration)
    opposite = math.exp(-2.0 * rate * duration)
    phase = rate * duration
    return tuple(
        0.25 + 0.5 * decay * math.cos(phase - index * math.pi / 2)
        + 0.25 * opposite * (-1) ** index
        for index in range(4)
    )


def rk4_ring(rate: float, duration: float, steps: int) -> tuple[float, ...]:
    """Separate Python reference implementation; NOT the Flow runtime."""
    state = (1.0, 0.0, 0.0, 0.0)
    dt = duration / steps

    def derivative(values: tuple[float, ...]) -> tuple[float, ...]:
        return tuple(rate * (values[(i - 1) % 4] - values[i])
                     for i in range(4))

    for _ in range(steps):
        first = derivative(state)
        second = derivative(tuple(state[i] + 0.5 * dt * first[i]
                                  for i in range(4)))
        third = derivative(tuple(state[i] + 0.5 * dt * second[i]
                                 for i in range(4)))
        fourth = derivative(tuple(state[i] + dt * third[i]
                                  for i in range(4)))
        state = tuple(state[i] + dt * (first[i] + 2 * second[i]
                      + 2 * third[i] + fourth[i]) / 6.0 for i in range(4))
    return state


class NativeFlowRingOracleTests(unittest.TestCase):
    def test_fourier_constants_match_independent_poisson_probabilities(self):
        poisson = poisson_ring(0.8, 2.0)
        fourier = fourier_ring(0.8, 2.0)
        for index in range(4):
            self.assertAlmostEqual(REFERENCE[index], poisson[index], delta=3e-15)
            self.assertAlmostEqual(fourier[index], poisson[index], delta=3e-15)
        self.assertAlmostEqual(sum(poisson), 1.0, delta=2e-15)
        self.assertTrue(all(0.0 < value < 1.0 for value in poisson))

    def test_fourth_order_error_thresholds_used_by_native_program(self):
        errors = []
        for steps in (8, 16, 32, 64):
            state = rk4_ring(0.8, 2.0, steps)
            errors.append(max(abs(state[i] - REFERENCE[i]) for i in range(4)))
            self.assertAlmostEqual(sum(state), 1.0, delta=2e-14)
            self.assertTrue(all(0.0 <= value <= 1.0 for value in state))
        self.assertGreater(errors[0], 1e-6)
        self.assertLess(errors[-1], 1e-8)
        for previous, current in zip(errors, errors[1:]):
            self.assertLess(current, 0.09 * previous)

    def test_rate_time_scaling_and_deterministic_replay(self):
        first = rk4_ring(0.8, 2.0, 64)
        self.assertEqual(first, rk4_ring(0.8, 2.0, 64))
        scaled = rk4_ring(0.4, 4.0, 64)
        for a, b in zip(first, scaled):
            self.assertAlmostEqual(a, b, delta=1e-14)

    def test_poisson_limit_cases_and_long_time_equilibrium(self):
        self.assertEqual(poisson_ring(0.0, 2.0), (1.0, 0.0, 0.0, 0.0))
        self.assertEqual(poisson_ring(0.8, 0.0), (1.0, 0.0, 0.0, 0.0))
        equilibrium = poisson_ring(0.8, 40.0)
        for cell in equilibrium:
            self.assertAlmostEqual(cell, 0.25, delta=1e-12)


if __name__ == "__main__":
    unittest.main()
