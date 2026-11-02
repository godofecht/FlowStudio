"""Independent exact-rational face-flux divergence oracle and periodic conservation."""
from fractions import Fraction
from itertools import product
import random
import unittest

SEED = 20261102


def cases():
    rng = random.Random(SEED)
    result = []
    for axes in (1, 2, 3):
        for _ in range(6):
            faces = [Fraction(rng.randint(-24, 24), 4) for _ in range(2 * axes)]
            spacings = [Fraction(rng.choice((2, 4, 8, 16)), 4)
                        for _ in range(axes)]
            expected = sum((faces[2 * axis + 1] - faces[2 * axis])
                           / spacings[axis] for axis in range(axes))
            args = ",".join([f"{float(v)}K" for v in faces] +
                            [f"{float(v)}m" for v in spacings])
            result.append((f"fluxdiv{axes}({args})", expected))
    return tuple(result)


CASES = cases()


def inject_oracle_assertions(source, start=0, stop=3, sabotage=False):
    marker = 'println("native-math-flux-divergence-ok")'
    assert source.count(marker) == 1
    assert 0 <= start < len(CASES) and start < stop <= len(CASES)
    statements = []
    for i in range(start, stop):
        expression, expected = CASES[i]
        if sabotage and i == start:
            expected += 1
        statements.append(
            f'    result = evaluate_math_expression("{expression}")\n'
            f'    if not result.valid or not near(result.result.value,{float(expected)}) '
            f'{{ return {100 + i} }}\n')
    return source.replace(marker, "".join(statements) + "    " + marker)


def periodic_divergence(shape):
    axes = len(shape)
    dx = [Fraction(axis + 2, 4) for axis in range(axes)]
    coords = tuple(product(*(range(n) for n in shape)))
    flux = {(axis, coord): Fraction(
        (sum((j + 1) * (v + 1) for j, v in enumerate(coord)) + 7 * axis) % 19 - 9,
        8) for axis in range(axes) for coord in coords}
    total = Fraction(0)
    for coord in coords:
        faces = []
        for axis in range(axes):
            left = list(coord)
            left[axis] = (left[axis] - 1) % shape[axis]
            faces.extend((flux[(axis, tuple(left))], flux[(axis, coord)]))
        divergence = sum((faces[2 * axis + 1] - faces[2 * axis]) / dx[axis]
                         for axis in range(axes))
        total += divergence
    return total


class FluxDivergenceOracleTests(unittest.TestCase):
    def test_18_exact_manufactured_flux_cases(self):
        self.assertEqual(len(CASES), 18)
        for expression, expected in CASES:
            self.assertTrue(expression.startswith("fluxdiv"))
            self.assertIsInstance(expected, Fraction)
            self.assertLess(abs(float(expected)), 100)

    def test_exact_periodic_conservation_in_1d_2d_3d(self):
        for shape in ((7,), (4, 5), (2, 3, 4)):
            self.assertEqual(periodic_divergence(shape), 0)

    def test_injection_and_sabotage(self):
        source = 'function main() -> i32 { println("native-math-flux-divergence-ok"); return 0 }'
        normal = inject_oracle_assertions(source)
        corrupt = inject_oracle_assertions(source, sabotage=True)
        self.assertNotEqual(normal, corrupt)
        self.assertIn(CASES[0][0], normal)
        self.assertIn("return 100", normal)
        self.assertEqual(normal.count('println("native-math-flux-divergence-ok")'), 1)


if __name__ == "__main__":
    unittest.main()
