"""Independent 2D two-species Fourier/matrix-exponential numerical oracle.

The Flow program is compiled and run separately through real FlowStudio HTTP
acceptance. These tests independently verify its reference constants and
fourth-order RK4 thresholds, not a replacement compiler or interpreter.
"""
from __future__ import annotations

import math
import unittest


INITIAL_U = (3.6, 1.6, 4.0, 2.8)
INITIAL_V = (1.4, 2.6, 1.8, 3.0)
REFERENCE = (
    3.2214794690416775, 2.1681842224129855,
    3.4911609716374126, 2.7044844899986740,
    1.9550625464474538, 2.2859068293425939,
    2.3015908222169643, 2.6721306489022409,
)
DIFFUSIVITIES = (0.02, 0.04, 0.05, 0.01)
EXCHANGE = 0.15
SPACING = (0.5, 0.5)


def exact_fourier(initial: tuple[float, ...] = INITIAL_U + INITIAL_V,
                  diffusivities: tuple[float, ...] = DIFFUSIVITIES,
                  exchange: float = EXCHANGE, duration: float = 1.0,
                  spacing: tuple[float, ...] = SPACING) -> tuple[float, ...]:
    """Exact 2x2 periodic semidiscrete PDE via independent Walsh modes.

    For each spatial mode, exponentiate the symmetric 2x2 reaction/diffusion
    generator analytically. Unequal species diffusivities mean diffusion and
    exchange DO NOT commute; multiplying separate scalar exponentials would
    give the wrong answer.
    """
    basis = ((1, 1, 1, 1), (1, -1, 1, -1),
             (1, 1, -1, -1), (1, -1, -1, 1))
    result = [0.0] * 8
    for mode, signs in enumerate(basis):
        x_frequency, y_frequency = mode % 2, mode // 2
        amplitude_u = sum(initial[i] * signs[i] for i in range(4)) / 4.0
        amplitude_v = sum(initial[4 + i] * signs[i] for i in range(4)) / 4.0
        eigen_u = -4.0 * (x_frequency * diffusivities[0] / spacing[0] ** 2
                          + y_frequency * diffusivities[1] / spacing[1] ** 2)
        eigen_v = -4.0 * (x_frequency * diffusivities[2] / spacing[0] ** 2
                          + y_frequency * diffusivities[3] / spacing[1] ** 2)
        mean_eigen = (eigen_u + eigen_v) / 2.0 - exchange
        half_difference = (eigen_u - eigen_v) / 2.0
        frequency = math.hypot(half_difference, exchange)
        cosh = math.cosh(frequency * duration)
        sinh_over_frequency = (math.sinh(frequency * duration) / frequency
                               if frequency else duration)
        decay = math.exp(mean_eigen * duration)
        final_u = decay * (cosh * amplitude_u + sinh_over_frequency *
                           (half_difference * amplitude_u + exchange * amplitude_v))
        final_v = decay * (cosh * amplitude_v + sinh_over_frequency *
                           (exchange * amplitude_u - half_difference * amplitude_v))
        for index, sign in enumerate(signs):
            result[index] += sign * final_u
            result[4 + index] += sign * final_v
    return tuple(result)


def independent_derivative(state: tuple[float, ...],
                           diffusivities: tuple[float, ...] = DIFFUSIVITIES,
                           exchange: float = EXCHANGE,
                           spacing: tuple[float, ...] = SPACING) -> tuple[float, ...]:
    """Direct 8x8 finite-difference stencil; no spectral decomposition."""
    result = []
    for species in (0, 1):
        dx, dy = diffusivities[2 * species:2 * species + 2]
        for index in range(4):
            own = 4 * species + index
            horizontal = 4 * species + (index ^ 1)
            vertical = 4 * species + (index ^ 2)
            other = 4 * (1 - species) + index
            result.append(
                2.0 * dx * (state[horizontal] - state[own]) / spacing[0] ** 2
                + 2.0 * dy * (state[vertical] - state[own]) / spacing[1] ** 2
                + exchange * (state[other] - state[own]))
    return tuple(result)


def independent_rk4(steps: int, duration: float = 1.0,
                    initial: tuple[float, ...] = INITIAL_U + INITIAL_V,
                    diffusivities: tuple[float, ...] = DIFFUSIVITIES,
                    exchange: float = EXCHANGE,
                    spacing: tuple[float, ...] = SPACING) -> tuple[float, ...]:
    dt = duration / steps
    state = tuple(initial)
    def derivative(values: tuple[float, ...]) -> tuple[float, ...]:
        return independent_derivative(values, diffusivities, exchange, spacing)
    for _ in range(steps):
        k1 = derivative(state)
        k2 = derivative(tuple(x + dt * v / 2 for x, v in zip(state, k1)))
        k3 = derivative(tuple(x + dt * v / 2 for x, v in zip(state, k2)))
        k4 = derivative(tuple(x + dt * v for x, v in zip(state, k3)))
        state = tuple(x + dt * (a + 2 * b + 2 * c + d) / 6
                      for x, a, b, c, d in zip(state, k1, k2, k3, k4))
    return state


class NativeFlowCoupledOracleTests(unittest.TestCase):
    def test_eight_reference_constants_match_exact_noncommuting_system(self):
        exact = exact_fourier()
        for value, reference in zip(exact, REFERENCE):
            self.assertAlmostEqual(value, reference, delta=2e-15)
        self.assertAlmostEqual(sum(exact), 20.8, delta=5e-15)
        expected_u_mean = 2.6 + 0.4 * math.exp(-0.3)
        self.assertAlmostEqual(sum(exact[:4]) / 4, expected_u_mean, delta=1e-15)
        self.assertTrue(all(1.4 <= value <= 4.0 for value in exact))

    def test_fourth_order_thresholds_and_mass_conservation(self):
        errors = []
        for steps in (8, 16, 32, 64):
            state = independent_rk4(steps)
            errors.append(max(abs(a - b) for a, b in zip(state, REFERENCE)))
            self.assertAlmostEqual(sum(state), 20.8, delta=2e-13)
            self.assertTrue(all(1.4 <= value <= 4.0 for value in state))
        self.assertGreater(errors[0], 1e-7)
        self.assertLess(errors[-1], 1e-9)
        for previous, current in zip(errors, errors[1:]):
            self.assertLess(current, 0.09 * previous)

    def test_species_swap_transpose_and_rate_time_symmetries(self):
        initial = INITIAL_U + INITIAL_V
        base = independent_rk4(64)
        swapped = independent_rk4(64, initial=initial[4:] + initial[:4],
                                  diffusivities=DIFFUSIVITIES[2:] + DIFFUSIVITIES[:2])
        for a, b in zip(swapped, base[4:] + base[:4]):
            self.assertAlmostEqual(a, b, delta=2e-14)
        transpose = (initial[0], initial[2], initial[1], initial[3],
                     initial[4], initial[6], initial[5], initial[7])
        transposed = independent_rk4(64, initial=transpose,
                                     diffusivities=(0.04, 0.02, 0.01, 0.05))
        for a, b in zip(transposed, (base[0], base[2], base[1], base[3],
                                     base[4], base[6], base[5], base[7])):
            self.assertAlmostEqual(a, b, delta=2e-14)
        scaled = independent_rk4(64, duration=2.0,
                                 diffusivities=tuple(x / 2 for x in DIFFUSIVITIES),
                                 exchange=EXCHANGE / 2)
        self.assertEqual(base, scaled)

    def test_exchange_off_and_uniform_equilibrium(self):
        uncoupled = independent_rk4(64, exchange=0.0)
        self.assertAlmostEqual(sum(uncoupled[:4]), 12.0, delta=2e-14)
        self.assertAlmostEqual(sum(uncoupled[4:]), 8.8, delta=2e-14)
        self.assertGreater(abs(sum(independent_rk4(64)[:4]) - 12.0), 0.1)
        equilibrium = (2.6,) * 8
        self.assertEqual(independent_rk4(64, initial=equilibrium), equilibrium)
        self.assertEqual(independent_rk4(8, diffusivities=(0.0,) * 4,
                                          exchange=0.0), INITIAL_U + INITIAL_V)

    def test_detect_mutation_of_species_diffusivity_or_exchange(self):
        baseline = exact_fourier()
        for altered in ((0.02, 0.04, 0.02, 0.01), (0.02, 0.04, 0.05, 0.04)):
            wrong = exact_fourier(diffusivities=altered)
            self.assertGreater(max(abs(a - b) for a, b in zip(wrong, baseline)), 0.01)
        no_exchange = exact_fourier(exchange=0.0)
        self.assertGreater(max(abs(a - b) for a, b in zip(no_exchange, baseline)), 0.1)


if __name__ == "__main__":
    unittest.main()
