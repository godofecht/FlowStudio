"""Independent standard-library oracle for the production native 32x32 tensor grid.

This checks the exact semidiscrete Fourier modes and a separate stencil/RK2
implementation; the Flow compiler and HTTP routes are exercised by CI.
"""
import math
import unittest
from pathlib import Path

WIDTH = 32
DIFFUSION_XX = 0.012
DIFFUSION_XY = 0.004
DIFFUSION_YY = 0.018
DURATION = 0.025
SPECIES_V_XX = 0.008
SPECIES_V_XY = -0.002
SPECIES_V_YY = 0.010


def quarter_cosine(index):
    phase = index % 4
    return 1.0 if phase == 0 else (-1.0 if phase == 2 else 0.0)


def initial_grid():
    return [300.0 + 7.0 * quarter_cosine(x + y) +
            3.0 * quarter_cosine(x - y)
            for y in range(WIDTH) for x in range(WIDTH)]


def exact_grid(duration=DURATION, cross=DIFFUSION_XY):
    plus = math.exp(-2.0 * WIDTH ** 2 *
                    (DIFFUSION_XX + DIFFUSION_YY + cross) * duration)
    minus = math.exp(-2.0 * WIDTH ** 2 *
                     (DIFFUSION_XX + DIFFUSION_YY - cross) * duration)
    return [300.0 + 7.0 * plus * quarter_cosine(x + y) +
            3.0 * minus * quarter_cosine(x - y)
            for y in range(WIDTH) for x in range(WIDTH)]


def derivative(grid, cross=DIFFUSION_XY, xx=DIFFUSION_XX,
               yy=DIFFUSION_YY):
    xx_coefficient, yy_coefficient = xx, yy
    result = [0.0] * (WIDTH * WIDTH)
    for y in range(WIDTH):
        upper, lower = (y + 1) % WIDTH, (y - 1) % WIDTH
        for x in range(WIDTH):
            right, left = (x + 1) % WIDTH, (x - 1) % WIDTH
            center = y * WIDTH + x
            xx = (grid[y * WIDTH + left] - 2.0 * grid[center] +
                  grid[y * WIDTH + right]) * WIDTH ** 2
            yy = (grid[lower * WIDTH + x] - 2.0 * grid[center] +
                  grid[upper * WIDTH + x]) * WIDTH ** 2
            xy = ((grid[upper * WIDTH + right] - grid[upper * WIDTH + left] -
                   grid[lower * WIDTH + right] + grid[lower * WIDTH + left]) *
                  (WIDTH ** 2 / 4.0))
            result[center] = (xx_coefficient * xx + 2.0 * cross * xy +
                              yy_coefficient * yy)
    return result


def integrate(grid, steps, duration=DURATION, cross=DIFFUSION_XY,
              xx=DIFFUSION_XX, yy=DIFFUSION_YY):
    step = duration / steps
    state = grid[:]
    for _ in range(steps):
        slope = derivative(state, cross, xx, yy)
        midpoint = [value + step * slope_value / 2.0
                    for value, slope_value in zip(state, slope)]
        midpoint_slope = derivative(midpoint, cross, xx, yy)
        state = [value + step * slope_value
                 for value, slope_value in zip(state, midpoint_slope)]
    return state


def species_v_initial():
    return [5.0 + 0.8 * quarter_cosine(x + y) -
            0.3 * quarter_cosine(x - y)
            for y in range(WIDTH) for x in range(WIDTH)]


def species_v_exact(duration=DURATION, cross=SPECIES_V_XY):
    plus = math.exp(-2.0 * WIDTH ** 2 *
                    (SPECIES_V_XX + SPECIES_V_YY + cross) * duration)
    minus = math.exp(-2.0 * WIDTH ** 2 *
                     (SPECIES_V_XX + SPECIES_V_YY - cross) * duration)
    return [5.0 + 0.8 * plus * quarter_cosine(x + y) -
            0.3 * minus * quarter_cosine(x - y)
            for y in range(WIDTH) for x in range(WIDTH)]


def species_v_integrate(grid, steps, duration=DURATION, cross=SPECIES_V_XY):
    return integrate(grid, steps, duration, cross, SPECIES_V_XX, SPECIES_V_YY)


def maximum_error(left, right):
    return max(abs(a - b) for a, b in zip(left, right))


class NativeTensor32Oracle(unittest.TestCase):
    def test_full_grid_and_two_distinct_eigenvalues(self):
        initial = initial_grid()
        self.assertEqual(len(initial), 1024)
        self.assertEqual(initial[0], 310.0)
        self.assertEqual(initial[2], 290.0)
        self.assertEqual(sum(initial) / len(initial), 300.0)
        derivative_grid = derivative(initial)
        plus_eigenvalue = -2.0 * WIDTH ** 2 * (
            DIFFUSION_XX + DIFFUSION_YY + DIFFUSION_XY)
        minus_eigenvalue = -2.0 * WIDTH ** 2 * (
            DIFFUSION_XX + DIFFUSION_YY - DIFFUSION_XY)
        self.assertAlmostEqual(plus_eigenvalue, -69.632)
        self.assertAlmostEqual(minus_eigenvalue, -53.248)
        for y in range(WIDTH):
            for x in range(WIDTH):
                expected = (7.0 * plus_eigenvalue * quarter_cosine(x + y) +
                            3.0 * minus_eigenvalue * quarter_cosine(x - y))
                self.assertAlmostEqual(derivative_grid[y * WIDTH + x], expected,
                                       delta=1e-10)

    def test_full_grid_analytic_oracle_and_refinement(self):
        initial, expected = initial_grid(), exact_grid()
        errors = [maximum_error(integrate(initial, count), expected)
                  for count in (32, 64, 128)]
        self.assertGreater(errors[0], 0.001)
        self.assertLess(errors[2], 0.00009)
        self.assertLess(errors[1], errors[0] * 0.30)
        self.assertLess(errors[2], errors[1] * 0.30)
        self.assertAlmostEqual(expected[0], 302.0201405199376, delta=1e-11)
        self.assertAlmostEqual(expected[2], 297.9798594800624, delta=1e-11)

    def test_conservation_semigroup_and_replay(self):
        initial = initial_grid()
        full = integrate(initial, 128)
        half = integrate(initial, 64, duration=DURATION / 2.0)
        composed = integrate(half, 64, duration=DURATION / 2.0)
        self.assertLess(maximum_error(full, composed), 1e-11)
        self.assertEqual(full, integrate(initial, 128))
        self.assertAlmostEqual(sum(full) / len(full), 300.0, delta=1e-11)
        self.assertGreaterEqual(min(full), min(initial) - 1e-11)
        self.assertLessEqual(max(full), max(initial) + 1e-11)

    def test_periodic_translation_and_cross_tensor_mutation(self):
        initial = initial_grid()
        shift = lambda grid: [grid[y * WIDTH + (x - 1) % WIDTH]
                              for y in range(WIDTH) for x in range(WIDTH)]
        evolved = integrate(initial, 128)
        self.assertLess(maximum_error(integrate(shift(initial), 128), shift(evolved)),
                        1e-11)
        opposite = integrate(initial, 128, cross=-DIFFUSION_XY)
        self.assertGreater(maximum_error(evolved, opposite), 0.3)
        self.assertLess(maximum_error(opposite, exact_grid(cross=-DIFFUSION_XY)),
                        0.00009)

    def test_compiler_computed_grid_frame_is_not_the_reference(self):
        source = (Path(__file__).resolve().parents[1] /
                  "examples/native_tensor_grid.flow").read_text(encoding="utf-8")
        self.assertIn('println("FLOWSTUDIO_GRID_V1 32 32 2")', source)
        self.assertIn("print(fine32.grid.values[cell])", source)
        self.assertIn("print(speciesVFine.grid.values[cell])", source)
        self.assertIn("diagonalFourier32SpeciesV()", source)
        self.assertIn('println("FLOWSTUDIO_GRID_END")', source)
        self.assertLess(source.index('if integrateTensor(largest, initial32, 100.0, 1).valid'),
                        source.index('println("FLOWSTUDIO_GRID_V1 32 32 2")'))

    def test_second_species_independent_fourier_eigenvalues_and_refinement(self):
        initial, reference = species_v_initial(), species_v_exact()
        self.assertEqual(len(initial), 1024)
        self.assertAlmostEqual(sum(initial) / 1024, 5.0, delta=1e-12)
        self.assertAlmostEqual(-2 * WIDTH ** 2 *
                               (SPECIES_V_XX + SPECIES_V_YY + SPECIES_V_XY),
                               -32.768, delta=1e-12)
        self.assertAlmostEqual(-2 * WIDTH ** 2 *
                               (SPECIES_V_XX + SPECIES_V_YY - SPECIES_V_XY),
                               -40.96, delta=1e-12)
        errors = [maximum_error(species_v_integrate(initial, count), reference)
                  for count in (32, 64, 128)]
        self.assertGreater(errors[0], 0.00004)
        self.assertGreater(errors[1], 0.00001)
        self.assertLess(errors[2], 0.00001)
        self.assertLess(errors[1], 0.30 * errors[0])
        self.assertLess(errors[2], 0.30 * errors[1])

    def test_second_species_stencil_and_conservation(self):
        initial = species_v_initial()
        slope = derivative(initial, SPECIES_V_XY, SPECIES_V_XX, SPECIES_V_YY)
        plus = -32.768
        minus = -40.96
        for y in range(WIDTH):
            for x in range(WIDTH):
                expected = 0.8 * plus * quarter_cosine(x + y) - (
                    0.3 * minus * quarter_cosine(x - y))
                self.assertAlmostEqual(slope[y * WIDTH + x], expected,
                                       delta=1e-10)
        evolved = species_v_integrate(initial, 128)
        self.assertAlmostEqual(sum(evolved) / 1024, 5.0, delta=1e-11)
        self.assertLess(maximum_error(evolved, species_v_exact()), 0.00001)

    def test_second_species_semigroup_replay_and_negative_mutation(self):
        initial = species_v_initial()
        full = species_v_integrate(initial, 128)
        half = species_v_integrate(initial, 64, duration=DURATION / 2)
        composed = species_v_integrate(half, 64, duration=DURATION / 2)
        self.assertLess(maximum_error(full, composed), 2e-11)
        self.assertEqual(full, species_v_integrate(initial, 128))
        self.assertEqual(initial, species_v_integrate(initial, 128, duration=0))
        reversed_cross = species_v_integrate(initial, 128, cross=-SPECIES_V_XY)
        self.assertGreater(maximum_error(full, reversed_cross), 0.05)

    def test_second_species_deterministic_periodic_translations(self):
        initial = species_v_initial()
        full = species_v_integrate(initial, 128)
        for shift in (1, 3, 7, 13):
            translated = [initial[y * WIDTH + (x - shift) % WIDTH]
                          for y in range(WIDTH) for x in range(WIDTH)]
            shifted_output = [full[y * WIDTH + (x - shift) % WIDTH]
                              for y in range(WIDTH) for x in range(WIDTH)]
            self.assertLess(maximum_error(
                species_v_integrate(translated, 128), shifted_output), 2e-11)

    def test_zero_duration_uniform_equilibrium_and_mode_mutation(self):
        initial = initial_grid()
        self.assertEqual(integrate(initial, 32, duration=0.0), initial)
        uniform = [300.0] * 1024
        self.assertEqual(integrate(uniform, 32), uniform)
        wrong_cross_oracle = exact_grid(cross=0.0)
        self.assertGreater(maximum_error(integrate(initial, 128), wrong_cross_oracle),
                           0.1)


if __name__ == "__main__":
    unittest.main()
