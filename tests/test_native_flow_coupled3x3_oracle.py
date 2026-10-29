"""Independent 18-state, 3x3 periodic coupled PDE numerical oracle.

Real Flow compiler/HTTP/Chromium execution is separately required by
tests/http_smoke.py and tests/native_math_plot_ui.mjs. This module uses only
Python's standard library to verify the Fourier constants and RK4 accuracy.
"""
from __future__ import annotations

import cmath
import math
from pathlib import Path
import re
import unittest

U = (3.5, 2.4011473670974874, 1.8988526329025126,
     3.442153903091735, 3.074820508075689, 2.6413526329025125,
     3.8578460969082653, 3.143647367097487, 3.0401794919243113)
V = (1.4, 2.7, 2.3, 1.8, 2.1, 3.0, 2.4, 1.6, 2.8)
REFERENCE = (
    3.1581340010827912, 2.5914949698255807, 2.2760932837023149,
    3.2168228247013446, 2.8970305231209301, 2.6927912152645277,
    3.4637441620604452, 2.9276076523602041, 2.8821042292337902,
    1.9565045000838235, 2.4361839418700968, 2.258233258660332,
    2.1953612803045823, 2.2975103757734465, 2.6746768759442805,
    2.4740552312339101, 2.0882835690409842, 2.6133681057366132,
)
DX = (0.02, 0.05)
DY = (0.04, 0.01)
EXCHANGE = 0.15
SPACING = 0.5
NAMES = ("Northwest", "North", "Northeast", "West", "Center",
         "East", "Southwest", "South", "Southeast")


def exact_fourier(initial=U + V, dx=DX, dy=DY, exchange=EXCHANGE,
                  duration=1.0):
    """Exact semidiscrete solution via nine 2x2 matrix exponentials.

    Unlike separate scalar decay factors, each Fourier block exponentiates
    unequal diffusion eigenvalues jointly with species exchange. The spatial
    DFT has all nine phases; no Walsh 2x2 shortcut applies.
    """
    out = [0j] * 18
    for ky in range(3):
        for kx in range(3):
            amplitudes = [
                sum(initial[9 * species + 3 * y + x] *
                    cmath.exp(-2j * math.pi * (kx * x + ky * y) / 3)
                    for y in range(3) for x in range(3)) / 9
                for species in range(2)
            ]
            wave_x = 4 * math.sin(math.pi * kx / 3) ** 2 / SPACING ** 2
            wave_y = 4 * math.sin(math.pi * ky / 3) ** 2 / SPACING ** 2
            eigen_u = -wave_x * dx[0] - wave_y * dy[0]
            eigen_v = -wave_x * dx[1] - wave_y * dy[1]
            mean = (eigen_u + eigen_v) / 2 - exchange
            half = (eigen_u - eigen_v) / 2
            frequency = math.hypot(half, exchange)
            c = math.cosh(frequency * duration)
            s = math.sinh(frequency * duration) / frequency if frequency else duration
            decay = math.exp(mean * duration)
            modes = (
                decay * (c * amplitudes[0] +
                         s * (half * amplitudes[0] + exchange * amplitudes[1])),
                decay * (c * amplitudes[1] +
                         s * (exchange * amplitudes[0] - half * amplitudes[1])),
            )
            for species in range(2):
                for y in range(3):
                    for x in range(3):
                        out[9 * species + 3 * y + x] += modes[species] * cmath.exp(
                            2j * math.pi * (kx * x + ky * y) / 3)
    if max(abs(value.imag) for value in out) > 1e-12:
        raise AssertionError("Conjugate Fourier symmetry was lost")
    return tuple(value.real for value in out)


def independent_derivative(state, dx=DX, dy=DY, exchange=EXCHANGE):
    """Direct periodic 18x18 five-point stencil; no Fourier operations."""
    result = []
    for species in range(2):
        for y in range(3):
            for x in range(3):
                index = 9 * species + 3 * y + x
                left = state[9 * species + 3 * y + (x - 1) % 3]
                right = state[9 * species + 3 * y + (x + 1) % 3]
                up = state[9 * species + 3 * ((y - 1) % 3) + x]
                down = state[9 * species + 3 * ((y + 1) % 3) + x]
                result.append(
                    dx[species] * (left + right - 2 * state[index]) / SPACING ** 2
                    + dy[species] * (up + down - 2 * state[index]) / SPACING ** 2
                    + exchange * (state[9 * (1 - species) + 3 * y + x]
                                  - state[index])
                )
    return tuple(result)


def independent_rk4(steps, initial=U + V, dx=DX, dy=DY,
                    exchange=EXCHANGE, duration=1.0):
    """Explicit RK4 independent of Flow's generated step implementation."""
    state = tuple(initial)
    dt = duration / steps

    def derivative(values):
        return independent_derivative(values, dx, dy, exchange)

    for _ in range(steps):
        first = derivative(state)
        second = derivative(tuple(v + dt * d / 2 for v, d in zip(state, first)))
        third = derivative(tuple(v + dt * d / 2 for v, d in zip(state, second)))
        fourth = derivative(tuple(v + dt * d for v, d in zip(state, third)))
        state = tuple(v + dt * (a + 2 * b + 2 * c + d) / 6
                      for v, a, b, c, d in
                      zip(state, first, second, third, fourth))
    return state


def permutation(values, indices):
    return tuple(values[9 * species + index]
                 for species in range(2) for index in indices)


class NativeCoupled3x3OracleTests(unittest.TestCase):
    def test_all_eighteen_fourier_constants_and_mass(self):
        actual = exact_fourier()
        for index, (value, expected) in enumerate(zip(actual, REFERENCE)):
            self.assertAlmostEqual(value, expected, delta=3e-14, msg=f"cell {index}")
        self.assertAlmostEqual(sum(actual), 47.1, delta=5e-13)
        self.assertAlmostEqual(sum(actual[:9]), 26.10582286135193, delta=5e-13)
        self.assertTrue(all(1.4 <= x <= 3.86 for x in actual))
        self.assertGreater(max(abs(a - b) for a, b in zip(actual, U + V)), 0.01)

    def test_fourth_order_refinement_and_conservation(self):
        errors = []
        for steps in (4, 8, 16, 32, 128):
            state = independent_rk4(steps)
            errors.append(max(abs(a - b) for a, b in zip(state, REFERENCE)))
            self.assertAlmostEqual(sum(state), 47.1, delta=5e-13)
            self.assertTrue(all(1.4 <= x <= 3.86 for x in state))
        self.assertGreater(errors[0], 1e-6)
        self.assertLess(errors[-1], 2e-11)
        for before, after in zip(errors, errors[1:]):
            self.assertLess(after, 0.09 * before)

    def test_symmetries_and_semigroup(self):
        initial = U + V
        base = independent_rk4(128)
        swap = independent_rk4(128, initial=V + U, dx=DX[::-1], dy=DY[::-1])
        for got, expected in zip(swap, base[9:] + base[:9]):
            self.assertAlmostEqual(got, expected, delta=2e-13)
        transpose = (0, 3, 6, 1, 4, 7, 2, 5, 8)
        transposed = independent_rk4(
            128, initial=permutation(initial, transpose), dx=DY, dy=DX)
        for got, expected in zip(transposed, permutation(base, transpose)):
            self.assertAlmostEqual(got, expected, delta=2e-13)
        shifted = (2, 0, 1, 5, 3, 4, 8, 6, 7)
        translated = independent_rk4(128, initial=permutation(initial, shifted))
        for got, expected in zip(translated, permutation(base, shifted)):
            self.assertAlmostEqual(got, expected, delta=2e-13)
        scaled = independent_rk4(128, dx=tuple(v / 2 for v in DX),
                                 dy=tuple(v / 2 for v in DY),
                                 exchange=EXCHANGE / 2, duration=2.0)
        self.assertEqual(scaled, base)
        first_half = independent_rk4(64, duration=0.5)
        second_half = independent_rk4(64, initial=first_half, duration=0.5)
        for got, expected in zip(second_half, base):
            self.assertAlmostEqual(got, expected, delta=2e-13)

    def test_exchange_equilibria_and_mutation_detection(self):
        uncoupled = independent_rk4(128, exchange=0.0)
        self.assertAlmostEqual(sum(uncoupled[:9]), 27.0, delta=2e-13)
        self.assertAlmostEqual(sum(uncoupled[9:]), 20.1, delta=2e-13)
        self.assertGreater(abs(sum(independent_rk4(128)[:9]) - 27.0), 0.1)
        self.assertEqual(independent_rk4(128, initial=(2.6,) * 18), (2.6,) * 18)
        self.assertEqual(independent_rk4(8, dx=(0, 0), dy=(0, 0),
                                         exchange=0), U + V)
        self.assertEqual(independent_rk4(8, duration=0), U + V)
        baseline = exact_fourier()
        for changed in (
            exact_fourier(dx=DX[::-1]),
            exact_fourier(dy=DY[::-1]),
            exact_fourier(exchange=0.0),
        ):
            self.assertGreater(max(abs(a - b) for a, b in zip(changed, baseline)),
                               0.1)

    def test_checked_in_flow_source_matches_actual_eighteen_state_stencil(self):
        source = (Path(__file__).resolve().parents[1] /
                  "examples/native_coupled_evolution3x3.flow").read_text("utf-8")
        declarations = re.findall(r"^\s*state ([uv]\w+): f64 = ([^\n]+)", source,
                                  flags=re.MULTILINE)
        self.assertEqual(len(declarations), 18)
        for species, values in (("u", U), ("v", V)):
            for i, expected in enumerate(values):
                self.assertEqual(
                    (f"{species}{NAMES[i]}", expected),
                    (declarations[9 * (species == "v") + i][0],
                     float(declarations[9 * (species == "v") + i][1])),
                )
        for species in ("u", "v"):
            other = "v" if species == "u" else "u"
            for y in range(3):
                for x in range(3):
                    index = 3 * y + x
                    name = f"{species}{NAMES[index]}"
                    left = f"{species}{NAMES[3 * y + (x - 1) % 3]}"
                    right = f"{species}{NAMES[3 * y + (x + 1) % 3]}"
                    up = f"{species}{NAMES[3 * ((y - 1) % 3) + x]}"
                    down = f"{species}{NAMES[3 * ((y + 1) % 3) + x]}"
                    expected = (
                        f"{name} evolves as diffusivity_{species}x * "
                        f"({left} + {right} - 2.0 * {name}) / "
                        f"(spacing_x * spacing_x) + diffusivity_{species}y * "
                        f"({up} + {down} - 2.0 * {name}) / "
                        f"(spacing_y * spacing_y) + exchange_rate * "
                        f"({other}{NAMES[index]} - {name})"
                    )
                    self.assertIn(expected, source)
        for species in ("u", "v"):
            for index in range(9):
                self.assertIn(
                    f"expected.{species}{NAMES[index]} = "
                    f"{REFERENCE[9 * (species == 'v') + index]}",
                    source,
                )


if __name__ == "__main__":
    unittest.main()
