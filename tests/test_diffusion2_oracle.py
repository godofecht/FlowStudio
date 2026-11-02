"""Independent exact-rational periodic 2D face-flux oracle for native Flow."""
from fractions import Fraction
import unittest

SIDE = 3
CELL_COUNT = SIDE * SIDE
MARKER = 'println("native-math-diffusion2-ok")'
DT = Fraction(1, 32)


def index(x: int, y: int) -> int:
    return (y % SIDE) * SIDE + (x % SIDE)


def diffusion2(values: tuple[Fraction, ...]) -> Fraction:
    if len(values) != 11 or any(h <= 0 for h in values[9:]):
        raise ValueError("diffusion2 requires 11 arguments and positive spacings")
    if any(k < 0 for k in values[5:9]):
        raise ValueError("diffusivity must be nonnegative")
    center = values[0]
    return sum(
        (values[6 + 2*a] * (values[2 + 2*a] - center)
         - values[5 + 2*a] * (center - values[1 + 2*a]))
        / values[9 + a] ** 2 for a in range(2)
    )


def seeded_grid():
    state = 20261102

    def draw(low: int, high: int) -> int:
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return low + state % (high - low + 1)

    field = tuple(Fraction(draw(-12, 12), 4) for _ in range(CELL_COUNT))
    faces = tuple(tuple(Fraction(draw(1, 12), 8)
                        for _ in range(CELL_COUNT)) for _ in range(2))
    return field, faces


def _decimal(value: Fraction) -> str:
    if value.denominator & (value.denominator - 1):
        raise ValueError("non-binary fraction")
    return str(value.numerator) if value.denominator == 1 else str(float(value))


def expression(values: tuple[Fraction, ...]) -> str:
    return "diffusion2(" + ",".join(
        [_decimal(v) + "K" for v in values[:5]] +
        ["(" + _decimal(v) + "*1m²/1s)" for v in values[5:9]] +
        [_decimal(v) + "m" for v in values[9:]]
    ) + ")"


def assemble(field, faces):
    if len(field) != CELL_COUNT or len(faces) != 2 or any(
            len(axis) != CELL_COUNT for axis in faces):
        raise ValueError("periodic 2D grid shape mismatch")
    kx, ky = faces
    cases = []
    for y in range(SIDE):
        for x in range(SIDE):
            c, l, r = index(x, y), index(x-1, y), index(x+1, y)
            d, u = index(x, y-1), index(x, y+1)
            values = (field[c], field[l], field[r], field[d], field[u],
                      kx[l], kx[c], ky[d], ky[c], Fraction(1), Fraction(2))
            cases.append((expression(values), diffusion2(values), values))
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
            f'{{ return {700 + number} }}',
        ))
    return source.replace(MARKER, "\n".join(statements) + "\n" + MARKER)


class Diffusion2OracleTests(unittest.TestCase):
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
        shifted_faces = [[Fraction(0)] * CELL_COUNT for _ in range(2)]
        for y in range(SIDE):
            for x in range(SIDE):
                dst, src = index(x, y), index(x-1, y)
                shifted_field[dst] = field[src]
                for axis in range(2):
                    shifted_faces[axis][dst] = faces[axis][src]
        translated = assemble(shifted_field, shifted_faces)
        baseline = periodic_cases()
        for y in range(SIDE):
            for x in range(SIDE):
                self.assertEqual(translated[index(x, y)][1],
                                 baseline[index(x-1, y)][1])

    def test_invalid_and_corrupted(self):
        values = periodic_cases()[0][2]
        with self.assertRaises(ValueError):
            diffusion2(values[:5] + (Fraction(-1),) + values[6:])
        with self.assertRaises(ValueError):
            diffusion2(values[:9] + (Fraction(0),) + values[10:])
        self.assertNotEqual(inject_periodic_assertions(MARKER),
                            inject_periodic_assertions(MARKER, sabotage=True))
        with self.assertRaises(AssertionError):
            inject_periodic_assertions(MARKER, stop=4)


if __name__ == "__main__":
    unittest.main()
