"""Exact-rational heterogeneous periodic 3D flux-divergence energy oracle.

The production Flow compiler and HTTP router execute the sampled stencils in
http_flux_energy_smoke.py. This oracle is deliberately independent of Flow.
"""
from fractions import Fraction
from itertools import product
import random
import unittest

SEED = 20261102
SIDE = 3
COORDS = tuple(product(range(SIDE), repeat=3))
SPACING = (Fraction(1, 2), Fraction(3, 4), Fraction(5, 4))
DT = Fraction(1, 64)
_rng = random.Random(SEED + 203)
CONDUCTANCE = {(axis, coord): Fraction(_rng.randint(1, 8), 16)
               for axis in range(3) for coord in COORDS}
INITIAL = {coord: Fraction(_rng.randint(-20, 20), 8) for coord in COORDS}


def neighbor(coord, axis, direction):
    point = list(coord)
    point[axis] = (point[axis] + direction) % SIDE
    return tuple(point)


def face_flux(state):
    return {(axis, coord): CONDUCTANCE[axis, coord] *
            (state[neighbor(coord, axis, 1)] - state[coord]) / SPACING[axis]
            for axis in range(3) for coord in COORDS}


def divergence(flux):
    return {coord: sum(((flux[axis, coord] -
                         flux[axis, neighbor(coord, axis, -1)]) / SPACING[axis]
                        for axis in range(3)), Fraction(0))
            for coord in COORDS}


def dissipation(state):
    return sum((CONDUCTANCE[axis, coord] *
                (state[neighbor(coord, axis, 1)] - state[coord]) ** 2 /
                SPACING[axis] ** 2
                for axis in range(3) for coord in COORDS), Fraction(0))


def energy(state):
    return sum((value * value for value in state.values()), Fraction(0))


def evolve(steps=8):
    state = INITIAL.copy()
    states = [state]
    for _ in range(steps):
        derivative = divergence(face_flux(state))
        state = {coord: state[coord] + DT * derivative[coord] for coord in COORDS}
        states.append(state)
    return states


STATES = evolve()
SAMPLE = tuple(COORDS[i] for i in (0, 1, 2, 5, 6, 8, 11, 14, 15, 20, 24, 26))


def source_case(state, coord):
    flux = face_flux(state)
    faces = []
    for axis in range(3):
        faces.extend((flux[axis, neighbor(coord, axis, -1)], flux[axis, coord]))
    values = [f"{float(value):.17g}K" for value in faces]
    values += [f"{float(spacing):.17g}m" for spacing in SPACING]
    return "fluxdiv3(" + ",".join(values) + ")", divergence(flux)[coord]


CASES = (tuple(source_case(STATES[0], coord) for coord in SAMPLE) +
         tuple(source_case(STATES[-1], coord) for coord in SAMPLE))


def inject(source, start=0, stop=3, sabotage=False):
    marker = 'println("native-math-flux-divergence-ok")'
    assert source.count(marker) == 1
    assert 0 <= start < stop <= len(CASES)
    statements = []
    for index in range(start, stop):
        expression, expected = CASES[index]
        if sabotage and index == start:
            expected += 1
        statements.append(
            f'    result = evaluate_math_expression("{expression}")\n'
            f'    if not result.valid or not near(result.result.value,{float(expected):.17g}) '
            f'{{ return {300 + index} }}\n')
    return source.replace(marker, "".join(statements) + "    " + marker)


class HeterogeneousFluxEnergyTests(unittest.TestCase):
    def test_exact_periodic_conservation_and_discrete_integration_by_parts(self):
        self.assertEqual(len(COORDS), 27)
        for state in STATES:
            derivative = divergence(face_flux(state))
            self.assertEqual(sum(derivative.values(), Fraction(0)), 0)
            self.assertEqual(sum((state[c] * derivative[c] for c in COORDS),
                                 Fraction(0)), -dissipation(state))
            self.assertGreater(dissipation(state), 0)

    def test_eight_steps_mass_energy_and_maximum_principle(self):
        self.assertEqual(len(STATES), 9)
        mass = sum(INITIAL.values(), Fraction(0))
        minimum, maximum = min(INITIAL.values()), max(INITIAL.values())
        for previous, state in zip(STATES, STATES[1:]):
            self.assertEqual(sum(state.values(), Fraction(0)), mass)
            self.assertLess(energy(state), energy(previous))
            self.assertGreaterEqual(min(state.values()), minimum)
            self.assertLessEqual(max(state.values()), maximum)
        self.assertEqual(evolve(), STATES)

    def test_native_sampled_oracle_and_sabotage(self):
        self.assertEqual(len(CASES), 24)
        self.assertEqual(len(CONDUCTANCE), 81)
        self.assertEqual(len(set(SAMPLE)), 12)
        for expression, expected in CASES:
            self.assertTrue(expression.startswith('fluxdiv3('))
            self.assertIsInstance(expected, Fraction)
        source = 'function main() -> i32 { println("native-math-flux-divergence-ok"); return 0 }'
        normal = inject(source)
        corrupted = inject(source, sabotage=True)
        self.assertNotEqual(normal, corrupted)
        self.assertIn('return 300', normal)
        self.assertEqual(normal.count('println("native-math-flux-divergence-ok")'), 1)


if __name__ == '__main__':
    unittest.main()
