"""Exact-rational heterogeneous 2D zero-normal-flux diffusion oracle.

Native Flow evaluates sampled fluxdiv2 stencils in http_neumann_diffusion2_smoke.py.
This independent oracle does not use the production parser or floating-point math.
"""
from fractions import Fraction
from itertools import product
import random
import unittest

SEED = 20261102
SIDE = 4
COORDS = tuple(product(range(SIDE), repeat=2))
SPACING = (Fraction(1, 2), Fraction(3, 4))
DT = Fraction(1, 64)
STEPS = 32
rng = random.Random(SEED + 271)
# Only interior shared faces exist; no periodic wrap or ghost cells.
FACES = {(axis, c): Fraction(rng.randint(1, 8), 16)
         for axis in range(2) for c in COORDS if c[axis] < SIDE - 1}
INITIAL = {c: Fraction(rng.randint(-20, 20), 8) for c in COORDS}


def adjacent(c, axis, direction):
    result = list(c)
    result[axis] += direction
    return tuple(result)


def fluxes(state):
    return {(axis, c): k * (state[adjacent(c, axis, 1)] - state[c]) / SPACING[axis]
            for (axis, c), k in FACES.items()}


def divergence(flux):
    result = {}
    for c in COORDS:
        total = Fraction(0)
        for axis in range(2):
            left = flux.get((axis, adjacent(c, axis, -1)), Fraction(0))
            right = flux.get((axis, c), Fraction(0))
            total += (right - left) / SPACING[axis]
        result[c] = total
    return result


def dissipation(state):
    return sum((k * (state[adjacent(c, axis, 1)] - state[c]) ** 2 /
                SPACING[axis] ** 2 for (axis, c), k in FACES.items()), Fraction(0))


def energy(state):
    return sum((v * v for v in state.values()), Fraction(0))


def evolve(initial=INITIAL, steps=STEPS):
    state = dict(initial)
    states = [state]
    for _ in range(steps):
        deriv = divergence(fluxes(state))
        state = {c: state[c] + DT * deriv[c] for c in COORDS}
        states.append(state)
    return states


STATES = evolve()


def source_case(state, c):
    flux = fluxes(state)
    values = []
    for axis in range(2):
        values.extend((flux.get((axis, adjacent(c, axis, -1)), Fraction(0)),
                       flux.get((axis, c), Fraction(0))))
    values = [f"{float(value):.17g}K" for value in values]
    values += [f"{float(h):.17g}m" for h in SPACING]
    return "fluxdiv2(" + ",".join(values) + ")", divergence(flux)[c]


CASES = (tuple(source_case(STATES[0], c) for c in COORDS) +
         tuple(source_case(STATES[-1], c) for c in
               ((0, 0), (0, 3), (3, 0), (3, 3))))


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
            f'{{ return {400 + index} }}\n')
    return source.replace(marker, "".join(statements) + "    " + marker)


class NeumannDiffusionTests(unittest.TestCase):
    def test_exact_zero_flux_boundary_and_green_identity(self):
        self.assertEqual(len(COORDS), 16)
        self.assertEqual(len(FACES), 24)
        for state in STATES:
            f = fluxes(state)
            d = divergence(f)
            self.assertEqual(sum(d.values(), Fraction(0)), 0)
            self.assertEqual(sum((state[c] * d[c] for c in COORDS), Fraction(0)),
                             -dissipation(state))
            for axis in range(2):
                for c in COORDS:
                    if c[axis] == SIDE - 1:
                        self.assertNotIn((axis, c), f)

    def test_mass_energy_maximum_restart_and_determinism(self):
        self.assertEqual(len(STATES), STEPS + 1)
        mass = sum(INITIAL.values(), Fraction(0))
        minimum, maximum = min(INITIAL.values()), max(INITIAL.values())
        for old, new in zip(STATES, STATES[1:]):
            self.assertEqual(sum(new.values(), Fraction(0)), mass)
            self.assertLess(energy(new), energy(old))
            self.assertGreaterEqual(min(new.values()), minimum)
            self.assertLessEqual(max(new.values()), maximum)
        self.assertEqual(evolve(STATES[16], 16)[-1], STATES[-1])
        self.assertEqual(evolve(), STATES)

    def test_transpose_covariance(self):
        def swap(c):
            return c[1], c[0]
        transposed = {swap(c): v for c, v in INITIAL.items()}
        swapped_faces = {(1 - axis, swap(c)): k for (axis, c), k in FACES.items()}
        swapped_spacing = SPACING[::-1]
        for c in COORDS:
            lhs = divergence(fluxes(INITIAL))[c]
            rhs = Fraction(0)
            tc = swap(c)
            for axis in range(2):
                prev = adjacent(tc, axis, -1)
                nxt = adjacent(tc, axis, 1)
                left = swapped_faces.get((axis, prev), Fraction(0)) * (
                    transposed[tc] - transposed.get(prev, transposed[tc])) / swapped_spacing[axis]
                right = swapped_faces.get((axis, tc), Fraction(0)) * (
                    transposed.get(nxt, transposed[tc]) - transposed[tc]) / swapped_spacing[axis]
                rhs += (right - left) / swapped_spacing[axis]
            self.assertEqual(lhs, rhs)

    def test_native_cases_and_corruption(self):
        self.assertEqual(len(CASES), 20)
        self.assertTrue(all(expr.startswith("fluxdiv2(") for expr, _ in CASES))
        self.assertTrue(all(isinstance(expected, Fraction) for _, expected in CASES))
        src = 'function main() -> i32 { println("native-math-flux-divergence-ok"); return 0 }'
        self.assertNotEqual(inject(src), inject(src, sabotage=True))
        self.assertIn("return 400", inject(src))
        self.assertEqual(inject(src).count('println("native-math-flux-divergence-ok")'), 1)


if __name__ == "__main__":
    unittest.main()
