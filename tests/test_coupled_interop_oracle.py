"""Independent local numerical acceptance for the checked-in coupled PDE.

The production R integration and Python HTTP oracle are exercised separately
by tests/http_smoke.py; these tests validate the discrete Fourier solution
against a distinct direct two-dimensional midpoint stencil.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import random
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "examples/coupled_interop_python.py"
SPEC = importlib.util.spec_from_file_location("coupled_interop_python", SOURCE)
assert SPEC and SPEC.loader
model = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(model)


class CoupledInteropOracleTests(unittest.TestCase):
    def test_all_2048_cells_match_independent_direct_stencil(self):
        direct = model.direct_integrate(model.initial_fields())
        exact = model.expected_fields()
        self.assertLess(max(abs(a - b) for x, y in zip(direct, exact)
                            for a, b in zip(x, y)), 3e-12)
        self.assertLess(abs(sum(direct[0]) + sum(direct[1]) -
                            model.COUNT * sum(model.MEANS)), 2e-9)
        self.assertLess(model.verify_result({"u":direct[0], "v":direct[1]}), 3e-12)

    def test_replay_semigroup_and_seeded_conservation(self):
        rng = random.Random(73129)
        fields = tuple([mean + rng.uniform(-0.25, 0.25)
                        for _ in range(model.COUNT)] for mean in model.MEANS)
        full = model.direct_integrate(fields)
        half = model.direct_integrate(fields, model.STEPS // 2)
        replay = model.direct_integrate(half, model.STEPS // 2)
        self.assertEqual(full, model.direct_integrate(fields))
        self.assertLess(max(abs(a - b) for x, y in zip(full, replay)
                            for a, b in zip(x, y)), 1e-12)
        self.assertLess(abs(sum(full[0]) + sum(full[1]) -
                            sum(fields[0]) - sum(fields[1])), 2e-9)

    def test_mutations_malformed_and_resource_bound(self):
        u, v = model.expected_fields()
        for species, index in (("u", 0), ("u", 511), ("v", 512), ("v", 1023)):
            values = {"u":u[:], "v":v[:]}
            values[species][index] += 0.1
            with self.assertRaisesRegex(AssertionError, "Fourier mismatch"):
                model.verify_result(values)
        for invalid in ({"u":u[:-1], "v":v},
                        {"u":[None, *u[1:]], "v":v},
                        {"u":u, "v":v, "extra":[]}):
            with self.assertRaises(ValueError):
                model.verify_result(invalid)
        with self.assertRaisesRegex(ValueError, "resource limit"):
            model.direct_integrate((u, v), model.STEPS + 1)
        with self.assertRaises(ValueError):
            model.expected_fields(True)



    def test_uniform_exchange_exact_midpoint_and_zero_step(self):
        fields = ([10.0] * model.COUNT, [20.0] * model.COUNT)
        baseline = (fields[0][:], fields[1][:])
        for steps in (0, 1, 32, 64):
            actual = model.direct_integrate(fields, steps)
            decay = (1 - 2 * model.EXCHANGE * model.STEP +
                     0.5 * (2 * model.EXCHANGE * model.STEP) ** 2) ** steps
            expected = (15.0 - 5.0 * decay, 15.0 + 5.0 * decay)
            self.assertLess(max(abs(value - expected[species])
                                for species, field in enumerate(actual)
                                for value in field), 2e-12)
            self.assertLess(abs(sum(actual[0]) + sum(actual[1]) -
                                30 * model.COUNT), 2e-9)
        self.assertEqual(fields, baseline)
        self.assertEqual(model.direct_integrate(fields, 0), fields)

    def test_seeded_translation_equivariance_and_invalid_numbers(self):
        rng = random.Random(73129)
        fields = tuple([mean + rng.uniform(-0.25, 0.25)
                        for _ in range(model.COUNT)] for mean in model.MEANS)

        def shifted(field):
            return [field[((y - 5) % model.SIDE) * model.SIDE +
                          (x - 3) % model.SIDE]
                    for y in range(model.SIDE) for x in range(model.SIDE)]

        original = model.direct_integrate(fields, 32)
        translated = model.direct_integrate(tuple(map(shifted, fields)), 32)
        self.assertLess(max(abs(a - b)
                            for a_field, b_field in zip(
                                translated, tuple(map(shifted, original)))
                            for a, b in zip(a_field, b_field)), 2e-12)
        self.assertTrue(all(value > 0 for field in original for value in field))
        for invalid in (float("nan"), float("inf"), -float("inf"), True, "1"):
            corrupted = (fields[0][:], fields[1][:])
            corrupted[0][5] = invalid
            with self.assertRaisesRegex(ValueError, "finite"):
                model.direct_integrate(corrupted, 0)
            with self.assertRaisesRegex(ValueError, "finite"):
                model.verify_result({"u": corrupted[0], "v": corrupted[1]})
        for invalid_steps in (-1, 65, True, 1.5):
            with self.assertRaises(ValueError):
                model.direct_integrate(fields, invalid_steps)
            with self.assertRaises(ValueError):
                model.expected_fields(invalid_steps)


if __name__ == "__main__":
    unittest.main()
