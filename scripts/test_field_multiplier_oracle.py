"""Independent standard-library numerical oracle for the Flow Field DSL fixture.

Run: python3 -m unittest -v scripts/test_field_multiplier_oracle.py
This validates expected arithmetic and convergence, NOT compiler execution.
"""
import math
import unittest


def step(values, coefficient, dt, left, right, dx=1.0):
    if len(values) < 3 or coefficient < 0 or dt < 0 or dx <= 0:
        raise ValueError("invalid field configuration")
    result = list(values)
    result[0], result[-1] = left, right
    factor = coefficient * dt / (dx * dx)
    for i in range(1, len(values) - 1):
        result[i] = values[i] + factor * (values[i - 1] - 2 * values[i] + values[i + 1])
    return result


class FieldMultiplierOracle(unittest.TestCase):
    def test_post_multiplier(self):
        values = [0.5, 1, 1, 1, 1, 1, 1, 1.5]
        expected = [0.5, 0.94, 1, 1, 1, 1, 1.06, 1.5]
        for actual, target in zip(step(values, 0.3, 0.4, 0.5, 1.5), expected):
            self.assertAlmostEqual(actual, target, places=12)

    def test_pre_multiplier(self):
        values = [0, 0, 0, 1, 0, 0, 0, 0]
        expected = [0, 0, 0.2, 0.6, 0.2, 0, 0, 0]
        for actual, target in zip(step(values, 2, 0.1, 0, 0), expected):
            self.assertAlmostEqual(actual, target, places=12)

    def test_identity_and_replay(self):
        values = [0.5, 1, 1, 1, 1, 1, 1, 1.5]
        self.assertEqual(step(values, 0.3, 0, 0.5, 1.5), values)
        self.assertEqual(step(values, 0.3, 0.4, 0.5, 1.5),
                         step(values, 0.3, 0.4, 0.5, 1.5))

    def test_manufactured_heat_solution_refinement(self):
        # u(x,t) = exp(-pi^2*t) sin(pi*x), u_t = u_xx, u(0,t)=u(1,t)=0.
        errors = []
        for n in (16, 32, 64):
            dx = 1 / n
            steps = math.ceil(0.01 / (0.1 * dx * dx))
            dt = 0.01 / steps
            values = [math.sin(math.pi * i * dx) for i in range(n + 1)]
            for _ in range(steps):
                values = step(values, 1, dt, 0, 0, dx)
            errors.append(max(abs(v - math.exp(-math.pi**2 * 0.01) *
                                  math.sin(math.pi * i * dx))
                              for i, v in enumerate(values)))
        self.assertGreater(errors[0] / errors[1], 3.5)
        self.assertGreater(errors[1] / errors[2], 3.5)
        self.assertLess(errors[-1], 1e-5)

    def test_invalid_configurations(self):
        for args in (([0, 0], 1, 0.1, 0, 0),
                     ([0, 0, 0], -1, 0.1, 0, 0),
                     ([0, 0, 0], 1, -0.1, 0, 0),
                     ([0, 0, 0], 1, 0.1, 0, 0, 0)):
            with self.subTest(args=args), self.assertRaises(ValueError):
                step(*args)


if __name__ == "__main__":
    unittest.main()
