"""Independent exact-rational 3D periodic flux and axis covariance qualification.

These Python reference calculations are intentionally independent of the Flow
runtime. Native Flow HTTP evaluation is mandatory in the companion smoke gate.
"""
from fractions import Fraction
from itertools import product
import random
import unittest

SEED = 20261102
SHAPE = (3, 3, 3)
SPACINGS = (Fraction(1, 2), Fraction(3, 4), Fraction(5, 4))
COORDS = tuple(product(*(range(n) for n in SHAPE)))
_rng = random.Random(SEED + 101)
FACE = {(axis, coord): Fraction(_rng.randint(-48, 48), 16)
        for axis in range(3) for coord in COORDS}


def divergence(coord, face=FACE, shape=SHAPE, spacings=SPACINGS):
    total = Fraction(0)
    for axis in range(3):
        previous = list(coord)
        previous[axis] = (previous[axis] - 1) % shape[axis]
        total += (face[axis, coord] - face[axis, tuple(previous)]) / spacings[axis]
    return total


def source_case(coord, order=(0, 1, 2)):
    faces = []
    for axis in order:
        previous = list(coord)
        previous[axis] = (previous[axis] - 1) % SHAPE[axis]
        faces.extend((FACE[axis, tuple(previous)], FACE[axis, coord]))
    args = [f"{float(value):.17g}K" for value in faces]
    args += [f"{float(SPACINGS[axis]):.17g}m" for axis in order]
    return "fluxdiv3(" + ",".join(args) + ")", divergence(coord)


# Fixed, deterministic spread across the whole periodic volume, including seams.
SAMPLED = tuple(COORDS[i] for i in (0, 2, 5, 11, 15, 20, 24, 26))
CASES = (tuple(source_case(coord) for coord in SAMPLED) +
         tuple(source_case(coord, (2, 0, 1)) for coord in SAMPLED[:4]))


def inject(source, start=0, stop=3):
    marker = 'println("native-math-flux-divergence-ok")'
    assert source.count(marker) == 1
    assert 0 <= start < stop <= len(CASES)
    statements = []
    for index in range(start, stop):
        expression, expected = CASES[index]
        statements.append(
            f'    result = evaluate_math_expression("{expression}")\n'
            f'    if not result.valid or not near(result.result.value,{float(expected):.17g}) '
            f'{{ return {200 + index} }}\n'
        )
    return source.replace(marker, "".join(statements) + "    " + marker)


class FluxDivergenceCovarianceTests(unittest.TestCase):
    def test_exact_periodic_gauss_conservation(self):
        self.assertEqual(len(COORDS), 27)
        self.assertEqual(sum(map(divergence, COORDS), Fraction(0)), 0)
        self.assertTrue(any(divergence(c) != 0 for c in COORDS))

    def test_axis_permutation_covariance(self):
        # Permute x/y/z together with grid coordinates, spacings and face fields.
        order = (2, 0, 1)
        perm_shape = tuple(SHAPE[a] for a in order)
        perm_spacings = tuple(SPACINGS[a] for a in order)
        perm_face = {(new_axis, tuple(coord[a] for a in order)): FACE[old_axis, coord]
                     for new_axis, old_axis in enumerate(order)
                     for coord in COORDS}
        for coord in COORDS:
            perm_coord = tuple(coord[a] for a in order)
            self.assertEqual(divergence(coord), divergence(
                perm_coord, perm_face, perm_shape, perm_spacings))

    def test_periodic_translation_covariance(self):
        shift = (1, 2, 1)
        translated = {(axis, tuple((coord[a] + shift[a]) % SHAPE[a]
                                    for a in range(3))): value
                      for (axis, coord), value in FACE.items()}
        for coord in COORDS:
            translated_coord = tuple((coord[a] + shift[a]) % SHAPE[a]
                                     for a in range(3))
            self.assertEqual(divergence(coord), divergence(translated_coord, translated))

    def test_native_sample_injection(self):
        self.assertEqual(len(CASES), 12)
        for index in range(4):
            self.assertEqual(CASES[index][1], CASES[8 + index][1])
            self.assertNotEqual(CASES[index][0], CASES[8 + index][0])
        source = 'function main() -> i32 { println("native-math-flux-divergence-ok"); return 0 }'
        generated = inject(source)
        self.assertIn('fluxdiv3(', generated)
        self.assertIn('return 200', generated)
        self.assertEqual(generated.count('println("native-math-flux-divergence-ok")'), 1)
        for expression, expected in CASES:
            self.assertTrue(expression.startswith('fluxdiv3('))
            self.assertIsInstance(expected, Fraction)


if __name__ == '__main__':
    unittest.main()
