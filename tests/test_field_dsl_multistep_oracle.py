"""Independent deterministic oracle for Flow field multiplier lowering.

Run: python3 -m unittest discover -s tests -p 'test_field_dsl_multistep_oracle.py'
This checks reference numerics, NOT the production Flow compiler.
"""
import math
import unittest


def evolve(values, coefficient, dt, steps, left, right):
    if not isinstance(steps, int) or isinstance(steps, bool) or not 0 <= steps <= 4096:
        raise ValueError("steps must be a bounded integer")
    if len(values) < 3 or len(values) > 1024:
        raise ValueError("grid must have 3..1024 cells")
    if not all(math.isfinite(x) for x in (*values, coefficient, dt, left, right)):
        raise ValueError("all values must be finite")
    if coefficient < 0 or dt < 0 or coefficient * dt > 0.5:
        raise ValueError("explicit diffusion stability bound exceeded")
    state = list(values)
    state[0], state[-1] = left, right
    for _ in range(steps):
        state = [left] + [state[i] + coefficient * dt *
                (state[i-1] - 2 * state[i] + state[i+1])
                for i in range(1, len(state)-1)] + [right]
    return state


class FieldMultiplierOracle(unittest.TestCase):
    def test_upstream_fixture_post_multiplier(self):
        result = evolve([0.5] + [1.] * 6 + [1.5], .3, .4, 1, .5, 1.5)
        self.assertEqual(len(result), 8)
        self.assertAlmostEqual(result[1], .94, places=12)
        self.assertAlmostEqual(result[6], 1.06, places=12)
        self.assertEqual((result[0], result[-1]), (.5, 1.5))

    def test_upstream_fixture_pre_multiplier(self):
        result = evolve([0., 0., 0., 1., 0., 0., 0., 0.], 2., .1, 1, 0., 0.)
        self.assertEqual(result, [0., 0., .2, .6, .2, 0., 0., 0.])

    def test_multistep_semigroup_and_determinism(self):
        initial = [0., 0., 0., 1., 0., 0., 0., 0.]
        first = evolve(initial, 2., .1, 3, 0., 0.)
        combined = evolve(initial, 2., .1, 7, 0., 0.)
        split = evolve(first, 2., .1, 4, 0., 0.)
        self.assertEqual(combined, split)
        self.assertEqual(combined, evolve(initial, 2., .1, 7, 0., 0.))
        self.assertTrue(all(0 <= x <= 1 for x in combined))
        leakage = sum(.2 * (evolve(initial, 2., .1, k, 0., 0.)[1] +
                             evolve(initial, 2., .1, k, 0., 0.)[-2])
                      for k in range(7))
        self.assertAlmostEqual(sum(combined), sum(initial) - leakage, places=12)

    def test_constant_equilibrium(self):
        self.assertEqual(evolve([3.] * 8, .3, .4, 50, 3., 3.), [3.] * 8)

    def test_invalid_inputs(self):
        initial = [0.] * 8
        for coefficient, dt, steps in [(2., .3, 1), (-1., .1, 1),
                                       (1., -1., 1), (1., .1, 4097),
                                       (1., .1, 1.5), (math.inf, .1, 1)]:
            with self.subTest(coefficient=coefficient, dt=dt, steps=steps):
                with self.assertRaises(ValueError):
                    evolve(initial, coefficient, dt, steps, 0., 0.)
        with self.assertRaises(ValueError):
            evolve([0., math.nan, 0.], .1, .1, 1, 0., 0.)


if __name__ == "__main__":
    unittest.main()
