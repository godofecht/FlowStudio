"""Independent exact-Fraction periodic 1D face-flux oracle for native Flow."""
from fractions import Fraction
import unittest

SIDE = 5
CELL_COUNT = SIDE
MARKER = 'println("native-math-diffusion1-ok")'
DX = Fraction(2)
DT = Fraction(1, 16)


def index(x: int) -> int:
    return x % SIDE


def diffusion1(values: tuple[Fraction, ...]) -> Fraction:
    if len(values) != 6 or values[5] <= 0:
        raise ValueError("diffusion1 requires six arguments and positive spacing")
    if values[3] < 0 or values[4] < 0:
        raise ValueError("diffusivity must be nonnegative")
    center, left, right, kl, kr, dx = values
    return (kr * (right - center) - kl * (center - left)) / (dx * dx)


def seeded_grid():
    # Fixed nonuniform field and positive shared-face coefficients.
    return (
        tuple(Fraction(v) for v in (3, -2, 5, 1, 4)),
        tuple(Fraction(v) for v in (1, 3, 2, 4, 5)),
    )


def expression(values: tuple[Fraction, ...]) -> str:
    return "diffusion1(" + ",".join(
        [str(v) + "K" for v in values[:3]] +
        ["(" + str(v) + "*1m²/1s)" for v in values[3:5]] +
        [str(values[5]) + "m"]
    ) + ")"


def assemble(field, faces):
    cases = []
    for x in range(SIDE):
        c, l, r = index(x), index(x-1), index(x+1)
        values = (field[c], field[l], field[r], faces[l], faces[c], DX)
        cases.append((expression(values), diffusion1(values), values))
    return cases


def periodic_cases():
    return assemble(*seeded_grid())


def inject_periodic_assertions(source: str, *, start: int = 0,
                               stop: int = 3, sabotage: bool = False) -> str:
    cases = periodic_cases()
    assert 0 <= start < stop <= CELL_COUNT and stop - start <= 3
    assert source.count(MARKER) == 1
    statements = []
    for number in range(start, stop):
        expr, expected, _ = cases[number]
        target = float(expected + (1 if sabotage and number == start else 0))
        statements.extend((
            f'    result = evaluate_math_expression("{expr}")',
            f'    if not result.valid or not near(result.result.value,{target}) '
            f'{{ return {800 + number} }}',
        ))
    return source.replace(MARKER, "\n".join(statements) + "\n" + MARKER)


class Diffusion1OracleTests(unittest.TestCase):
    def test_exact_conservation_and_energy_decay(self):
        cases = periodic_cases()
        self.assertEqual(len(cases), CELL_COUNT)
        rates = tuple(c[1] for c in cases)
        field, _ = seeded_grid()
        self.assertEqual(sum(rates), 0)
        self.assertLess(sum(u*r for u, r in zip(field, rates)), 0)
        updated = tuple(u + DT*r for u, r in zip(field, rates))
        self.assertEqual(sum(updated), sum(field))
        self.assertTrue(all(min(field) <= u <= max(field) for u in updated))
        self.assertLess(sum(u*u for u in updated), sum(u*u for u in field))

    def test_translation_covariance(self):
        field, faces = seeded_grid()
        shifted_field = [Fraction(0)] * CELL_COUNT
        shifted_faces = [Fraction(0)] * CELL_COUNT
        for x in range(SIDE):
            shifted_field[index(x)] = field[index(x-1)]
            shifted_faces[index(x)] = faces[index(x-1)]
        translated = assemble(shifted_field, shifted_faces)
        baseline = periodic_cases()
        for x in range(SIDE):
            self.assertEqual(translated[index(x)][1], baseline[index(x-1)][1])

    def test_invalid_and_corrupted(self):
        values = periodic_cases()[0][2]
        with self.assertRaises(ValueError):
            diffusion1(values[:3] + (Fraction(-1),) + values[4:])
        with self.assertRaises(ValueError):
            diffusion1(values[:5] + (Fraction(0),))
        self.assertNotEqual(inject_periodic_assertions(MARKER),
                            inject_periodic_assertions(MARKER, sabotage=True))
        with self.assertRaises(AssertionError):
            inject_periodic_assertions(MARKER, stop=4)
