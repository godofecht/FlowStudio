"""Seeded exact-rational 3D heterogeneous zero-Dirichlet finite-volume oracle.

The native Flow compiler executes sampled fluxdiv3 values in the mandatory
production HTTP gate. This file computes the full evolution independently.
"""
from decimal import Decimal, localcontext
from fractions import Fraction
from itertools import product
import random
import unittest

SEED = 20261102
SIDE = 3
COORDS = tuple(product(range(SIDE), repeat=3))
SPACING = (Fraction(1, 2), Fraction(3, 4), Fraction(5, 4))
DT = Fraction(1, 128)
STEPS = 24
_rng = random.Random(SEED + 503)
# Every internal face is shared; exterior faces couple to a zero value at h/2.
INTERIOR = {(axis, c): Fraction(_rng.randint(1, 8), 16)
            for axis in range(3) for c in COORDS if c[axis] < SIDE - 1}
BOUNDARY = {(axis, c, sign): Fraction(_rng.randint(1, 8), 16)
            for axis in range(3) for c in COORDS for sign in (-1, 1)
            if c[axis] == (0 if sign == -1 else SIDE - 1)}
INITIAL = {c: Fraction(_rng.randint(1, 24), 8) for c in COORDS}


def adjacent(c, axis, sign):
    p = list(c)
    p[axis] += sign
    return tuple(p)


def face_flux(state, c, axis, sign):
    h = SPACING[axis]
    if sign == -1:
        if c[axis] == 0:
            return 2 * BOUNDARY[axis, c, -1] * state[c] / h
        left = adjacent(c, axis, -1)
        return INTERIOR[axis, left] * (state[c] - state[left]) / h
    if c[axis] == SIDE - 1:
        return -2 * BOUNDARY[axis, c, 1] * state[c] / h
    right = adjacent(c, axis, 1)
    return INTERIOR[axis, c] * (state[right] - state[c]) / h


def divergence(state):
    return {c: sum(((face_flux(state, c, axis, 1) -
                     face_flux(state, c, axis, -1)) / SPACING[axis]
                    for axis in range(3)), Fraction(0)) for c in COORDS}


def dissipation(state):
    interior = sum((k * (state[adjacent(c, axis, 1)] - state[c]) ** 2 /
                    SPACING[axis] ** 2 for (axis, c), k in INTERIOR.items()), Fraction(0))
    boundary = sum((2 * k * state[c] ** 2 / SPACING[axis] ** 2
                    for (axis, c, _), k in BOUNDARY.items()), Fraction(0))
    return interior + boundary


def energy(state):
    return sum((v * v for v in state.values()), Fraction(0))


def evolve(initial=INITIAL, steps=STEPS):
    if type(steps) is not int or not 0 <= steps <= STEPS:
        raise ValueError("Dirichlet timestep budget exceeded")
    if set(initial) != set(COORDS) or any(not isinstance(v, Fraction) for v in initial.values()):
        raise ValueError("Invalid 3D Dirichlet state")
    state = dict(initial)
    states = [state]
    for _ in range(steps):
        d = divergence(state)
        state = {c: state[c] + DT * d[c] for c in COORDS}
        states.append(state)
    return states


STATES = evolve()
SAMPLE = tuple(COORDS[i] for i in (0, 1, 2, 4, 6, 8, 10, 13, 17, 20, 24, 26))


def source_case(state, c):
    values = [face_flux(state, c, axis, sign)
              for axis in range(3) for sign in (-1, 1)]
    expression = "fluxdiv3(" + ",".join(
        [f"{float(v):.17g}K" for v in values] +
        [f"{float(h):.17g}m" for h in SPACING]) + ")"
    return expression, divergence(state)[c]


CASES = (tuple(source_case(STATES[0], c) for c in COORDS) +
         tuple(source_case(STATES[-1], c) for c in SAMPLE))


def inject(source, start=0, stop=3, sabotage=False):
    marker = 'println("native-math-flux-divergence-ok")'
    assert source.count(marker) == 1
    assert 0 <= start < stop <= len(CASES) and stop - start <= 3
    statements = []
    for index in range(start, stop):
        expression, expected = CASES[index]
        if sabotage and index == start:
            expected += 1
        statements.append(
            f'    result = evaluate_math_expression("{expression}")\n'
            f'    if not result.valid or not near(result.result.value,{float(expected):.17g}) '
            f'{{ return {500 + index} }}\n')
    return source.replace(marker, "".join(statements) + "    " + marker)


def independent_matrix():
    """Assemble a substochastic Euler operator without using face_flux/divergence."""
    n = len(COORDS)
    positions = {c: i for i, c in enumerate(COORDS)}
    matrix = [[Fraction(int(i == j)) for j in range(n)] for i in range(n)]
    for (axis, c), k in INTERIOR.items():
        i, j = positions[c], positions[adjacent(c, axis, 1)]
        w = DT * k / SPACING[axis] ** 2
        matrix[i][i] -= w
        matrix[j][j] -= w
        matrix[i][j] += w
        matrix[j][i] += w
    for (axis, c, _), k in BOUNDARY.items():
        matrix[positions[c]][positions[c]] -= 2 * DT * k / SPACING[axis] ** 2
    return matrix


class DirichletDiffusion3Tests(unittest.TestCase):
    def test_face_count_and_exact_discrete_green_identity(self):
        self.assertEqual((len(COORDS), len(INTERIOR), len(BOUNDARY)), (27, 54, 54))
        for state in STATES:
            d = divergence(state)
            self.assertEqual(sum((state[c] * d[c] for c in COORDS), Fraction(0)),
                             -dissipation(state))
            self.assertGreater(dissipation(state), 0)

    def test_24_steps_positive_mass_loss_energy_and_maximum(self):
        self.assertEqual(len(STATES), 25)
        high = max(INITIAL.values())
        for old, new in zip(STATES, STATES[1:]):
            self.assertGreater(sum(old.values()), sum(new.values()))
            self.assertLess(energy(new), energy(old))
            self.assertGreater(min(new.values()), 0)
            self.assertLessEqual(max(new.values()), high)
        self.assertEqual(evolve(STATES[12], 12)[-1], STATES[-1])
        self.assertEqual(evolve(), STATES)
        self.assertEqual(evolve({c: Fraction(0) for c in COORDS}, 3)[-1],
                         {c: Fraction(0) for c in COORDS})

    def test_independent_substochastic_matrix_all_675_values(self):
        matrix = independent_matrix()
        self.assertEqual(len(matrix), 27)
        self.assertTrue(all(min(row) >= 0 and 0 < sum(row) <= 1 for row in matrix))
        self.assertTrue(any(sum(row) < 1 for row in matrix))
        state = [INITIAL[c] for c in COORDS]
        for expected in STATES:
            self.assertEqual(state, [expected[c] for c in COORDS])
            state = [sum((matrix[i][j] * state[j] for j in range(27)), Fraction(0))
                     for i in range(27)]

    def test_zero_boundary_is_not_periodic_or_neumann(self):
        state = {c: Fraction(1) for c in COORDS}
        d = divergence(state)
        self.assertTrue(all(d[c] < 0 for c in COORDS if 0 in c or 2 in c))
        self.assertEqual(d[(1, 1, 1)], 0)
        self.assertLess(sum(d.values()), 0)

    def test_decimal_reconstructs_all_native_stencils(self):
        with localcontext() as context:
            context.prec = 55
            for expression, expected in CASES:
                args = expression.removeprefix("fluxdiv3(").removesuffix(")").split(",")
                flux = [Decimal(x[:-1]) for x in args[:6]]
                h = [Decimal(x[:-1]) for x in args[6:]]
                value = sum(((flux[2 * axis + 1] - flux[2 * axis]) / h[axis]
                             for axis in range(3)), Decimal(0))
                exact = Decimal(expected.numerator) / Decimal(expected.denominator)
                self.assertLess(abs(value - exact), Decimal("1e-12"))

    def test_source_contract_corruption_and_budgets(self):
        self.assertEqual(len(CASES), 39)
        self.assertTrue(all(e.startswith("fluxdiv3(") and isinstance(v, Fraction)
                            for e, v in CASES))
        base = 'function main() -> i32 { println("native-math-flux-divergence-ok"); return 0 }'
        self.assertNotEqual(inject(base), inject(base, sabotage=True))
        self.assertIn("return 500", inject(base))
        with self.assertRaises(AssertionError):
            inject(base, 0, 4)

    def test_negative_state_and_step_budgets(self):
        for steps in (-1, STEPS + 1, 1.5, True):
            with self.assertRaises(ValueError):
                evolve(steps=steps)
        with self.assertRaises(ValueError):
            evolve({(0, 0, 0): Fraction(1)}, 1)
        invalid = dict(INITIAL)
        invalid[(0, 0, 0)] = float("nan")
        with self.assertRaises(ValueError):
            evolve(invalid, 1)


if __name__ == "__main__":
    unittest.main()
