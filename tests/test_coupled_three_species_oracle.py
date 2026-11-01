"""Independent 3x3 Fourier-matrix and direct-stencil numerical acceptance."""
from __future__ import annotations

import importlib.util
import math
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "examples/coupled_three_species_python.py"
SPEC = importlib.util.spec_from_file_location("coupled_three_species_python", SOURCE)
assert SPEC and SPEC.loader
model = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(model)


def spectral_amplitudes(steps, wave_x, wave_y, amplitudes):
    eigen_x = 2 * math.cos(2 * math.pi * wave_x / model.SIDE) - 2
    eigen_y = 2 * math.cos(2 * math.pi * wave_y / model.SIDE) - 2

    def slope(values):
        return [
            (model.DIFFUSION_X[s] * eigen_x +
             model.DIFFUSION_Y[s] * eigen_y - model.EXCHANGE) * values[s]
            + model.EXCHANGE * values[(s - 1) % 3]
            for s in range(3)
        ]

    values = list(amplitudes)
    for _ in range(steps):
        first = slope(values)
        middle = [v + 0.5 * model.DT * d for v, d in zip(values, first)]
        second = slope(middle)
        values = [v + model.DT * d for v, d in zip(values, second)]
    return values


class ThreeSpeciesOracleTests(unittest.TestCase):
    def test_full_fourier_mode_against_independent_three_by_three_matrix(self):
        amplitudes = (0.8, -0.4, 0.3)
        for steps in (0, 24, 48):
            means = spectral_amplitudes(steps, 0, 0, model.MEANS)
            modes = spectral_amplitudes(steps, 2, 3, amplitudes)
            fields = tuple([
                model.MEANS[s] + amplitudes[s] *
                math.cos(4 * math.pi * x / model.SIDE) *
                math.cos(6 * math.pi * y / model.SIDE)
                for y in range(model.SIDE) for x in range(model.SIDE)
            ] for s in range(3))
            actual = model.integrate(fields, steps)
            error = max(abs(actual[s][y * model.SIDE + x] -
                            (means[s] + modes[s] *
                             math.cos(4 * math.pi * x / model.SIDE) *
                             math.cos(6 * math.pi * y / model.SIDE)))
                        for s in range(3)
                        for y in range(model.SIDE) for x in range(model.SIDE))
            self.assertLess(error, 3e-12)

    def test_seeded_replay_semigroup_mass_and_no_mutation(self):
        fields = model.initial_fields()
        snapshot = tuple(f[:] for f in fields)
        full = model.integrate(fields)
        half = model.integrate(fields, 24)
        replay = model.integrate(half, 24)
        self.assertEqual(full, model.integrate(fields))
        self.assertLess(max(abs(a - b) for f, g in zip(full, replay)
                            for a, b in zip(f, g)), 3e-12)
        self.assertLess(abs(sum(map(sum, full)) - sum(map(sum, fields))), 3e-9)
        self.assertEqual(fields, snapshot)
        self.assertLess(model.verify_result(dict(zip(model.NAMES, full))), 3e-12)

    def test_axis_orientation_and_directed_coupling(self):
        fields = model.initial_fields()
        actual = model.integrate(fields, 1)
        transposed = tuple([f[x * model.SIDE + y]
                            for y in range(model.SIDE) for x in range(model.SIDE)]
                           for f in fields)
        wrong = model.integrate(transposed, 1)
        self.assertGreater(max(abs(a - b) for f, g in zip(actual, wrong)
                               for a, b in zip(f, g)), 0.1)
        for species in range(3):
            self.assertGreater(max(abs(a - b) for a, b in zip(
                actual[species], fields[species])), 0.001)

    def test_negative_frames_and_work_ceiling(self):
        fields = model.initial_fields()
        result = dict(zip(model.NAMES, model.integrate(fields)))
        for species, index in (("a", 0), ("b", 511), ("c", 1023)):
            corrupt = {name: values[:] for name, values in result.items()}
            corrupt[species][index] += 0.1
            with self.assertRaisesRegex(AssertionError, "anisotropic stencil mismatch"):
                model.verify_result(corrupt)
        for invalid in ({**result, "a": result["a"][:-1]},
                        {**result, "c": [None, *result["c"][1:]]},
                        {**result, "extra": []}):
            with self.assertRaises(ValueError):
                model.verify_result(invalid)
        for invalid_steps in (49, -1, True, 0.5):
            with self.assertRaises(ValueError):
                model.integrate(fields, invalid_steps)
        for invalid in (float("nan"), float("inf"), True, "1"):
            broken = [f[:] for f in fields]
            broken[0][3] = invalid
            with self.assertRaisesRegex(ValueError, "finite"):
                model.integrate(broken, 0)
        self.assertEqual(model.integrate(fields, 0), fields)


if __name__ == "__main__":
    unittest.main()
