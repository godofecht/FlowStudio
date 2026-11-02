"""Seeded 3D periodic conservative diffusion qualification for native Flow.

The exact Fraction reference is independent of the Flow compiler/runtime.
Face coefficients are shared by neighboring cells, not sampled per stencil.
"""
from __future__ import annotations

from fractions import Fraction
import unittest

from test_diffusion3_oracle import diffusion3, expression

SEED = 20261102
SIDE = 3
CELL_COUNT = SIDE ** 3
MARKER = 'println("native-math-finite-difference-ok")'
DT = Fraction(1, 16)


def index(x: int, y: int, z: int) -> int:
    return ((z % SIDE) * SIDE + (y % SIDE)) * SIDE + (x % SIDE)


def seeded_periodic_grid():
    state = SEED

    def draw(low: int, high: int) -> int:
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return low + state % (high - low + 1)

    field = tuple(Fraction(draw(-12, 12), 4) for _ in range(CELL_COUNT))
    faces = tuple(tuple(Fraction(draw(1, 12), 8)
                        for _ in range(CELL_COUNT)) for _ in range(3))
    return field, faces


def assemble(field, faces):
    if len(field) != CELL_COUNT or len(faces) != 3 or any(
            len(axis) != CELL_COUNT for axis in faces):
        raise ValueError("periodic 3D grid shape mismatch")
    kx, ky, kz = faces
    h = (Fraction(1), Fraction(2), Fraction(4))
    cases = []
    for z in range(SIDE):
        for y in range(SIDE):
            for x in range(SIDE):
                center = index(x, y, z)
                left, right = index(x-1, y, z), index(x+1, y, z)
                down, up = index(x, y-1, z), index(x, y+1, z)
                back, front = index(x, y, z-1), index(x, y, z+1)
                values = (field[center], field[left], field[right],
                          field[down], field[up], field[back], field[front],
                          kx[left], kx[center], ky[down], ky[center],
                          kz[back], kz[center], *h)
                cases.append((expression(values), diffusion3(values), values))
    return cases


def periodic_cases():
    return assemble(*seeded_periodic_grid())


def inject_periodic_assertions(source: str, *, start: int = 0,
                               stop: int = 4, sabotage: bool = False) -> str:
    cases = periodic_cases()
    assert 0 <= start < stop <= CELL_COUNT and stop - start <= 4
    assert source.count(MARKER) == 1
    statements = []
    for number in range(start, stop):
        expr, expected, _ = cases[number]
        target = float(expected + (1 if sabotage and number == start else 0))
        statements.extend((
            f'    result = evaluate_math_expression("{expr}")',
            f'    if not result.valid or not near(result.result.value,{target}) '
            f'{{ return {600 + number} }}',
        ))
    return source.replace(MARKER, "\n".join(statements) + "\n" + MARKER)


class PeriodicDiffusion3Tests(unittest.TestCase):
    def test_conservative_faces_and_energy_decay(self):
        cases = periodic_cases()
        self.assertEqual(len(cases), CELL_COUNT)
        rates = tuple(case[1] for case in cases)
        field, _ = seeded_periodic_grid()
        self.assertEqual(sum(rates), 0, "periodic face fluxes must cancel")
        self.assertLess(sum(u*r for u, r in zip(field, rates)), 0)
        updated = tuple(u + DT*r for u, r in zip(field, rates))
        self.assertEqual(sum(updated), sum(field))
        self.assertTrue(all(min(field) <= u <= max(field) for u in updated))
        self.assertLess(sum(u*u for u in updated), sum(u*u for u in field))

    def test_translation_covariance(self):
        field, faces = seeded_periodic_grid()
        shifted_field = [Fraction(0)] * CELL_COUNT
        shifted_faces = [[Fraction(0)] * CELL_COUNT for _ in range(3)]
        for z in range(SIDE):
            for y in range(SIDE):
                for x in range(SIDE):
                    dst, src = index(x, y, z), index(x-1, y, z)
                    shifted_field[dst] = field[src]
                    for axis in range(3):
                        shifted_faces[axis][dst] = faces[axis][src]
        baseline = periodic_cases()
        translated = assemble(shifted_field, shifted_faces)
        for z in range(SIDE):
            for y in range(SIDE):
                for x in range(SIDE):
                    self.assertEqual(translated[index(x, y, z)][1],
                                     baseline[index(x-1, y, z)][1])

    def test_bounded_native_injection_and_negative(self):
        source = MARKER
        for start in range(0, CELL_COUNT, 4):
            end = min(start+4, CELL_COUNT)
            injected = inject_periodic_assertions(source, start=start, stop=end)
            self.assertEqual(injected.count("evaluate_math_expression"), end-start)
        self.assertNotEqual(inject_periodic_assertions(source),
                            inject_periodic_assertions(source, sabotage=True))
        with self.assertRaises(AssertionError):
            inject_periodic_assertions(source, stop=5)
        with self.assertRaises(ValueError):
            assemble([Fraction(0)], seeded_periodic_grid()[1])


if __name__ == "__main__":
    unittest.main()
