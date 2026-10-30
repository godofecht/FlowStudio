"""Independent 5x7 three-mode Fourier oracle for native Flow transport.

This standard-library test does NOT execute Flow. The production Flow 2.0
compiler, HTTP transport and browser are exercised by their separate gates.
"""
from __future__ import annotations

import math
from pathlib import Path
import re
import unittest

WIDTH, HEIGHT = 5, 7
SPACING_X, SPACING_Y = 0.2, 1.0 / 7.0
VELOCITY_X, VELOCITY_Y = 0.23, -0.31
DIFFUSIVITY_X, DIFFUSIVITY_Y = 0.008, 0.013
DURATION = 0.7
MEAN = 2.75
MODES = ((1, 1, 0.65, 0.18), (2, 3, -0.24, 0.31), (1, 2, 0.17, -0.13))
SOURCE = Path(__file__).resolve().parents[1] / "examples/native_advection_diffusion_2d.flow"


def exact_field(time, *, vx=VELOCITY_X, vy=VELOCITY_Y):
    """Exact SEMIDISCRETE solution of centered periodic advection/diffusion."""
    field = []
    for y in range(HEIGHT):
        for x in range(WIDTH):
            value = MEAN
            for kx, ky, cosine, sine in MODES:
                theta_x = 2 * math.pi * kx / WIDTH
                theta_y = 2 * math.pi * ky / HEIGHT
                real = (2 * DIFFUSIVITY_X * (math.cos(theta_x) - 1) / SPACING_X**2
                        + 2 * DIFFUSIVITY_Y * (math.cos(theta_y) - 1) / SPACING_Y**2)
                imaginary = (-vx * math.sin(theta_x) / SPACING_X
                             - vy * math.sin(theta_y) / SPACING_Y)
                phase = theta_x * x + theta_y * y + imaginary * time
                value += math.exp(real * time) * (
                    cosine * math.cos(phase) + sine * math.sin(phase))
            field.append(value)
    return field


def derivative(field, *, vx=VELOCITY_X, vy=VELOCITY_Y):
    """Independent direct periodic stencil; no Fourier implementation reused."""
    def cell(x, y):
        return field[(y % HEIGHT) * WIDTH + (x % WIDTH)]

    result = []
    for y in range(HEIGHT):
        for x in range(WIDTH):
            center = cell(x, y)
            result.append(
                -vx * (cell(x + 1, y) - cell(x - 1, y)) / (2 * SPACING_X)
                -vy * (cell(x, y + 1) - cell(x, y - 1)) / (2 * SPACING_Y)
                + DIFFUSIVITY_X * (cell(x - 1, y) - 2 * center
                                   + cell(x + 1, y)) / SPACING_X**2
                + DIFFUSIVITY_Y * (cell(x, y - 1) - 2 * center
                                   + cell(x, y + 1)) / SPACING_Y**2)
    return result


def integrate(initial, steps, duration=DURATION):
    state = list(initial)
    dt = duration / steps
    for _ in range(steps):
        first = derivative(state)
        second = derivative([v + 0.5 * dt * d for v, d in zip(state, first)])
        third = derivative([v + 0.5 * dt * d for v, d in zip(state, second)])
        fourth = derivative([v + dt * d for v, d in zip(state, third)])
        state = [v + dt * (a + 2*b + 2*c + d) / 6
                 for v, a, b, c, d in
                 zip(state, first, second, third, fourth)]
    return state


def maximum_error(left, right):
    assert len(left) == len(right) == WIDTH * HEIGHT
    return max(abs(a - b) for a, b in zip(left, right))


def embedded_grid(source, function_name):
    match = re.search(
        r"function " + re.escape(function_name)
        + r"\(\) -> TransportGrid \{(.*?)\n\}", source, re.S)
    if not match:
        raise AssertionError(f"missing {function_name} in native Flow source")
    entries = re.findall(r"values\[(\d+)\] = ([0-9.eE+-]+)", match.group(1))
    if len(entries) != WIDTH * HEIGHT:
        raise AssertionError(f"expected 35 embedded values in {function_name}")
    if [int(index) for index, _ in entries] != list(range(WIDTH * HEIGHT)):
        raise AssertionError(f"incorrect grid indices in {function_name}")
    return [float(value) for _, value in entries]


class NativeTransportMultimodeOracle(unittest.TestCase):
    def test_exact_35_cell_constants_are_independently_derived(self):
        source = SOURCE.read_text(encoding="utf-8")
        for name, time in (("initialMultimode5x7", 0.0),
                           ("referenceMultimode5x7", DURATION)):
            observed = embedded_grid(source, name)
            expected = exact_field(time)
            self.assertLess(maximum_error(observed, expected), 3e-14)
        self.assertIn("if not verifyMultimode5x7() { return 30 }", source)
        self.assertIn("native-advection-diffusion2d-ok", source)

    def test_direct_stencil_matches_analytic_time_derivative(self):
        initial = exact_field(0)
        epsilon = 1e-5
        numerical = derivative(initial)
        analytical = [(a-b)/(2*epsilon)
                      for a, b in zip(exact_field(epsilon),
                                      exact_field(-epsilon))]
        self.assertLess(maximum_error(numerical, analytical), 2e-9)
        # Opposite transport signs must not accidentally pass the oracle.
        reversed_transport = derivative(initial, vx=-VELOCITY_X,
                                        vy=-VELOCITY_Y)
        self.assertGreater(maximum_error(numerical, reversed_transport), 0.2)

    def test_fourth_order_convergence_all_35_cells(self):
        initial, expected = exact_field(0), exact_field(DURATION)
        errors = [maximum_error(integrate(initial, steps), expected)
                  for steps in (16, 32, 64, 128)]
        self.assertGreater(errors[0], 1e-7)
        self.assertLess(errors[-1], 2e-10)
        for coarse, fine in zip(errors, errors[1:]):
            self.assertLess(fine, 0.09 * coarse)

    def test_conservation_semigroup_and_replay(self):
        initial = exact_field(0)
        final = integrate(initial, 128)
        self.assertAlmostEqual(sum(final) / len(final), MEAN, places=12)
        self.assertEqual(final, integrate(initial, 128))
        first_half = integrate(initial, 64, DURATION / 2)
        second_half = integrate(first_half, 64, DURATION / 2)
        self.assertLess(maximum_error(second_half, final), 1e-12)

    def test_periodic_translation_commutes_with_derivative(self):
        initial = exact_field(0)
        def shift(field):
            return [field[y*WIDTH+(x-1)%WIDTH]
                    for y in range(HEIGHT) for x in range(WIDTH)]
        self.assertLess(maximum_error(derivative(shift(initial)),
                                      shift(derivative(initial))), 1e-12)

    def test_oracle_rejects_mutated_source_reference(self):
        source = SOURCE.read_text(encoding="utf-8")
        original = embedded_grid(source, "referenceMultimode5x7")
        altered = source.replace(
            f"values[17] = {original[17]:.17g}",
            f"values[17] = {original[17] + 0.01:.17g}", 1)
        self.assertNotEqual(altered, source)
        changed = embedded_grid(altered, "referenceMultimode5x7")
        self.assertGreater(maximum_error(changed, exact_field(DURATION)), 0.009)


if __name__ == "__main__":
    unittest.main()
