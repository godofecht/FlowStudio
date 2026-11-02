"""Exact-rational heterogeneous 3D face-flux oracle for native Flow diffusion3.

All numerical fixtures are independent of the production Flow evaluator.
"""
from __future__ import annotations

from fractions import Fraction
import unittest

SEED = 20261102
MARKER = 'println("native-math-finite-difference-ok")'


def diffusion3(values: tuple[Fraction, ...]) -> Fraction:
    if len(values) != 16 or any(h <= 0 for h in values[13:]):
        raise ValueError("diffusion3 expects 16 values and positive spacings")
    if any(k < 0 for k in values[7:13]):
        raise ValueError("diffusion coefficients must be nonnegative")
    center = values[0]
    return sum(
        (values[8 + 2 * axis] * (values[2 + 2 * axis] - center)
         - values[7 + 2 * axis] * (center - values[1 + 2 * axis]))
        / values[13 + axis] ** 2
        for axis in range(3)
    )


def _decimal(value: Fraction) -> str:
    if value.denominator & (value.denominator - 1):
        raise ValueError("non-binary fraction not exactly representable")
    return str(value.numerator) if value.denominator == 1 else str(float(value))


def expression(values: tuple[Fraction, ...]) -> str:
    assert len(values) == 16
    return "diffusion3(" + ",".join(
        [_decimal(v) + "K" for v in values[:7]] +
        ["(" + _decimal(v) + "m²/1s)" for v in values[7:13]] +
        [_decimal(v) + "m" for v in values[13:]]
    ) + ")"


def seeded_diffusion3_cases() -> list[tuple[str, Fraction, tuple[Fraction, ...]]]:
    """24 reproducible heterogeneous cases in 12 axis-swap pairs."""
    state = SEED

    def draw(low: int, high: int) -> int:
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return low + state % (high - low + 1)

    cases = []
    for i in range(12):
        field = tuple(Fraction(draw(-12, 12)) for _ in range(7))
        coeff = tuple(Fraction(draw(0, 16), 4) for _ in range(6))
        spacing = tuple(Fraction(1 << draw(0, 2)) for _ in range(3))
        if i == 0:
            field = (Fraction(7),) * 7
        if i == 1:
            coeff = (Fraction(0),) * 6
        if i == 2:
            coeff = (Fraction(2),) * 6
        values = field + coeff + spacing
        swapped = (field[0], field[3], field[4], field[1], field[2], field[5], field[6],
                   coeff[2], coeff[3], coeff[0], coeff[1], coeff[4], coeff[5],
                   spacing[1], spacing[0], spacing[2])
        expected = diffusion3(values)
        assert expected == diffusion3(swapped)
        cases.extend(((expression(values), expected, values),
                      (expression(swapped), expected, swapped)))
    assert len(cases) == 24
    return cases


def inject_diffusion3_assertions(source: str, *, start: int = 0, stop: int = 4,
                                 sabotage: bool = False) -> str:
    cases = seeded_diffusion3_cases()
    assert 0 <= start < stop <= len(cases) and stop - start <= 4
    assert source.count(MARKER) == 1
    statements = []
    for index in range(start, stop):
        expr, expected, _ = cases[index]
        target = float(expected + (1 if sabotage and index == start else 0))
        statements.extend((
            f'    result = evaluate_math_expression("{expr}")',
            f'    if not result.valid or not near(result.result.value,{target}) '
            f'{{ return {500 + index} }}',
        ))
    return source.replace(MARKER, "\n".join(statements) + "\n" + MARKER)


class Diffusion3OracleTests(unittest.TestCase):
    def test_seeded_axis_permutations(self) -> None:
        cases = seeded_diffusion3_cases()
        self.assertEqual(len(cases), 24)
        for i in range(0, 24, 2):
            self.assertEqual(cases[i][1], cases[i + 1][1])
            self.assertEqual(diffusion3(cases[i][2]), cases[i][1])
            self.assertEqual(diffusion3(cases[i + 1][2]), cases[i][1])
        self.assertEqual(cases[0][1], 0)
        self.assertEqual(cases[2][1], 0)

    def test_constant_coefficient_and_conservation(self) -> None:
        v = (Fraction(2), Fraction(3), Fraction(5), Fraction(-1), Fraction(7),
             Fraction(0), Fraction(4), *(Fraction(2),) * 6,
             Fraction(1), Fraction(2), Fraction(4))
        ordinary = sum((v[1+2*a]+v[2+2*a]-2*v[0])/v[13+a]**2 for a in range(3))
        self.assertEqual(diffusion3(v), 2 * ordinary)
        k, left, right, h = Fraction(3, 4), Fraction(5), Fraction(-2), Fraction(2)
        self.assertEqual(k * (right - left) / h**2 +
                         k * (left - right) / h**2, 0)

    def test_negative_parameters_and_injected_corruption(self) -> None:
        values = seeded_diffusion3_cases()[4][2]
        with self.assertRaises(ValueError):
            diffusion3(values[:7] + (Fraction(-1),) + values[8:])
        with self.assertRaises(ValueError):
            diffusion3(values[:13] + (Fraction(0),) + values[14:])
        normal = inject_diffusion3_assertions(MARKER)
        corrupt = inject_diffusion3_assertions(MARKER, sabotage=True)
        self.assertNotEqual(normal, corrupt)
        self.assertEqual(normal.count("evaluate_math_expression"), 4)
        with self.assertRaises(AssertionError):
            inject_diffusion3_assertions(MARKER, stop=5)


if __name__ == "__main__":
    unittest.main()
