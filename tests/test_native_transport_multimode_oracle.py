"""Independent 8x8 Fourier oracle for native Flow transport acceptance.

Production Flow compiler, HTTP and browser execution are separately exercised
by the existing native CI jobs. This standard-library-only test independently
checks the semidiscrete Fourier spectrum and a direct-stencil RK4 solver.
"""
from __future__ import annotations

import cmath
import math
from pathlib import Path
import re
import unittest

WIDTH = 8
SPACING = 0.125
DURATION = 0.4
VELOCITY_X = 0.11
VELOCITY_Y = -0.07
DIFFUSIVITY_X = 0.003
DIFFUSIVITY_Y = 0.006
MODES = ((2, 2, 1.2), (2, -2, 0.7), (2, 0, 0.5))
COEFFICIENTS = (
    (0.7507422380871157, 0.096623275672496),
    (0.3703009986552596, 0.24049804867401264),
    (0.4025151840914567, 0.1478424768143327),
)


def eigenvalue(kx, ky, *, velocity_x=VELOCITY_X, velocity_y=VELOCITY_Y,
               diffusivity_x=DIFFUSIVITY_X, diffusivity_y=DIFFUSIVITY_Y):
    theta_x = 2 * math.pi * kx / WIDTH
    theta_y = 2 * math.pi * ky / WIDTH
    decay = (-4 * diffusivity_x * math.sin(theta_x / 2) ** 2 / SPACING ** 2
             -4 * diffusivity_y * math.sin(theta_y / 2) ** 2 / SPACING ** 2)
    drift = (velocity_x * math.sin(theta_x) / SPACING
             + velocity_y * math.sin(theta_y) / SPACING)
    return complex(decay, -drift)


def four_phase(phase, cosine, sine):
    return (cosine, sine, -cosine, -sine)[phase % 4]


def exact_field(duration=DURATION, *, modes=MODES,
                velocity_x=VELOCITY_X, velocity_y=VELOCITY_Y,
                diffusivity_x=DIFFUSIVITY_X, diffusivity_y=DIFFUSIVITY_Y):
    return tuple(sum(
        (amplitude * cmath.exp(
            eigenvalue(kx, ky, velocity_x=velocity_x, velocity_y=velocity_y,
                       diffusivity_x=diffusivity_x,
                       diffusivity_y=diffusivity_y) * duration
            + 2j * math.pi * (kx * x + ky * y) / WIDTH)).real
        for kx, ky, amplitude in modes)
        for y in range(WIDTH) for x in range(WIDTH))


def derivative(values):
    result = []
    for y in range(WIDTH):
        for x in range(WIDTH):
            center = values[y * WIDTH + x]
            left = values[y * WIDTH + (x - 1) % WIDTH]
            right = values[y * WIDTH + (x + 1) % WIDTH]
            down = values[((y - 1) % WIDTH) * WIDTH + x]
            up = values[((y + 1) % WIDTH) * WIDTH + x]
            result.append(
                -VELOCITY_X * (right - left) / (2 * SPACING)
                -VELOCITY_Y * (up - down) / (2 * SPACING)
                +DIFFUSIVITY_X * (left - 2 * center + right) / SPACING ** 2
                +DIFFUSIVITY_Y * (down - 2 * center + up) / SPACING ** 2)
    return tuple(result)


def independent_rk4(steps, *, initial=None):
    if steps <= 0:
        raise ValueError("steps must be positive")
    state = exact_field(0) if initial is None else initial
    dt = DURATION / steps
    for _ in range(steps):
        first = derivative(state)
        second = derivative(tuple(a + dt * b / 2 for a, b in zip(state, first)))
        third = derivative(tuple(a + dt * b / 2 for a, b in zip(state, second)))
        fourth = derivative(tuple(a + dt * b for a, b in zip(state, third)))
        state = tuple(a + dt * (b + 2 * c + 2 * d + e) / 6
                      for a, b, c, d, e in
                      zip(state, first, second, third, fourth))
    return state


class NativeTransportMultimodeOracleTests(unittest.TestCase):
    def test_three_eigenvalues_and_six_coefficients(self):
        for (kx, ky, amplitude), (cosine, sine), (decay, drift) in zip(
                MODES, COEFFICIENTS,
                ((-1.152, 0.32), (-1.152, 1.44), (-0.384, 0.88))):
            value = eigenvalue(kx, ky)
            self.assertAlmostEqual(value.real, decay, delta=1e-13)
            self.assertAlmostEqual(value.imag, -drift, delta=1e-13)
            propagated = amplitude * cmath.exp(value * DURATION)
            self.assertAlmostEqual(propagated.real, cosine, delta=3e-15)
            self.assertAlmostEqual(-propagated.imag, sine, delta=3e-15)
        expected = exact_field()
        for y in range(WIDTH):
            for x in range(WIDTH):
                reconstructed = sum(four_phase(phase, *coefficients)
                                    for phase, coefficients in zip(
                                        (x + y, x - y, x), COEFFICIENTS))
                self.assertAlmostEqual(expected[y * WIDTH + x],
                                       reconstructed, delta=3e-15)

    def test_all_64_cells_fourth_order_convergence_and_mass(self):
        expected = exact_field()
        errors = []
        for steps in (4, 8, 16, 32):
            state = independent_rk4(steps)
            errors.append(max(abs(a - b) for a, b in zip(state, expected)))
            self.assertAlmostEqual(sum(state), 0, delta=1e-12)
        self.assertGreater(errors[0], 1e-6)
        self.assertLess(errors[-1], 2e-9)
        for before, after in zip(errors, errors[1:]):
            self.assertLess(after, 0.09 * before)

    def test_linearity_translation_and_deterministic_replay(self):
        initial = exact_field(0)
        combined = independent_rk4(32)
        isolated = [independent_rk4(32, initial=exact_field(0, modes=(mode,)))
                    for mode in MODES]
        for index in range(64):
            self.assertAlmostEqual(sum(mode[index] for mode in isolated),
                                   combined[index], delta=1e-12)
        self.assertEqual(combined, independent_rk4(32))
        shifted = tuple(initial[y * WIDTH + (x - 1) % WIDTH]
                        for y in range(WIDTH) for x in range(WIDTH))
        translated = independent_rk4(32, initial=shifted)
        for y in range(WIDTH):
            for x in range(WIDTH):
                self.assertAlmostEqual(translated[y * WIDTH + x],
                                       combined[y * WIDTH + (x - 1) % WIDTH],
                                       delta=1e-12)

    def test_mutation_sensitivity_and_invalid_step_rejection(self):
        expected = exact_field()
        for changed in (
            exact_field(velocity_y=-VELOCITY_Y),
            exact_field(velocity_x=-VELOCITY_X),
            exact_field(diffusivity_x=DIFFUSIVITY_Y),
        ):
            self.assertGreater(max(abs(a - b) for a, b in zip(expected, changed)),
                               0.05)
        with self.assertRaises(ValueError):
            independent_rk4(0)

    def test_checked_in_flow_has_full_cell_assertions(self):
        source = (Path(__file__).resolve().parents[1] /
                  "examples/native_advection_diffusion_2d.flow").read_text("utf-8")
        for fragment in (
            "function multimodeFourier8(",
            "fourPhase(x - y, secondAmplitude, 0.0)",
            "let index: i32 = y * 8 + x",
            "multimodeThirtyTwo.grid.values[index] - expected",
            "combined - multimodeThirtyTwo.grid.values[index]",
        ):
            self.assertIn(fragment, source)
        for name, coefficient in zip(
                ("FirstCosine", "FirstSine", "SecondCosine", "SecondSine",
                 "ThirdCosine", "ThirdSine"),
                (value for pair in COEFFICIENTS for value in pair)):
            match = re.search(rf"let exact{name}: f64 = ([0-9.]+)", source)
            self.assertIsNotNone(match, name)
            self.assertAlmostEqual(float(match.group(1)), coefficient,
                                   delta=3e-15)
        for code in range(30, 39):
            self.assertIn(f"return {code}", source)


if __name__ == "__main__":
    unittest.main()
