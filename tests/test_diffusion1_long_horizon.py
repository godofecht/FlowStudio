"""Seeded 64-step periodic heterogeneous 1D diffusion; independent exact matrix oracle."""
from fractions import Fraction
from random import Random
import unittest

SIDE = 5
SEED = 20261102
STEPS = 64
SAMPLE_STEPS = (1, 8, 32, 64)
CASE_COUNT = SIDE * len(SAMPLE_STEPS)
DX = Fraction(2)
DT = Fraction(1, 16)
MARKER = 'println("native-math-diffusion1-ok")'


def initial_state():
    rng = Random(SEED)
    return (tuple(Fraction(rng.randrange(-6, 8)) for _ in range(SIDE)),
            tuple(Fraction(rng.randrange(1, 7)) for _ in range(SIDE)))


def flux_step(field, faces):
    """Direct conservative face-flux evolution, independent of the matrix path."""
    return tuple(field[i] + DT * (
        faces[i] * (field[(i + 1) % SIDE] - field[i]) -
        faces[(i - 1) % SIDE] * (field[i] - field[(i - 1) % SIDE])) / (DX * DX)
        for i in range(SIDE))


def transition_matrix(faces):
    """Assemble a stochastic Markov transition matrix from shared faces."""
    matrix = [[Fraction(i == j) for j in range(SIDE)] for i in range(SIDE)]
    for i in range(SIDE):
        left = DT * faces[(i - 1) % SIDE] / (DX * DX)
        right = DT * faces[i] / (DX * DX)
        matrix[i][i] -= left + right
        matrix[i][(i - 1) % SIDE] += left
        matrix[i][(i + 1) % SIDE] += right
    return tuple(tuple(row) for row in matrix)


def matrix_product(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(SIDE))
                       for j in range(SIDE)) for i in range(SIDE))


def matrix_power_apply(matrix, field, steps):
    """Binary exponentiation, unlike direct time stepping."""
    assert steps >= 0
    power = matrix
    result = tuple(tuple(Fraction(i == j) for j in range(SIDE))
                   for i in range(SIDE))
    while steps:
        if steps & 1:
            result = matrix_product(result, power)
        steps //= 2
        if steps:
            power = matrix_product(power, power)
    return tuple(sum(result[i][j] * field[j] for j in range(SIDE))
                 for i in range(SIDE))


def trajectory():
    field, faces = initial_state()
    states = [field]
    for _ in range(STEPS):
        field = flux_step(field, faces)
        states.append(field)
    return tuple(states), faces


def rate_at(field, faces, i):
    return (faces[i] * (field[(i + 1) % SIDE] - field[i]) -
            faces[(i - 1) % SIDE] * (field[i] - field[(i - 1) % SIDE])) / (DX * DX)


def decimal(value):
    # Bounded decimal input avoids unbounded Fraction numerator growth in Flow.
    return format(float(value), '.15f')


def native_expression(field, faces, i):
    center = decimal(field[i])
    left = decimal(field[(i - 1) % SIDE])
    right = decimal(field[(i + 1) % SIDE])
    kl = decimal(faces[(i - 1) % SIDE])
    kr = decimal(faces[i])
    return (f'diffusion1(({center}*1K),({left}*1K),({right}*1K),'
            f'({kl}*1m²/1s),({kr}*1m²/1s),2m)')


def cases():
    states, faces = trajectory()
    return tuple((step, i, native_expression(states[step], faces, i),
                  rate_at(states[step], faces, i))
                 for step in SAMPLE_STEPS for i in range(SIDE))


def inject_assertions(source, *, start=0, stop=3, sabotage=False):
    assert 0 <= start < stop <= CASE_COUNT and stop - start <= 3
    assert source.count(MARKER) == 1
    statements = []
    for n in range(start, stop):
        step, i, expression, expected = cases()[n]
        target = decimal(expected + (1 if sabotage and n == start else 0))
        statements.append(f'    result = evaluate_math_expression("{expression}")')
        statements.append(
            f'    if not result.valid or not near(result.result.value,{target}) or '
            f'not same_dimension(result.result.dimension,rate) '
            f'{{ return {900 + n} }}')
    return source.replace(MARKER, '\n'.join(statements) + '\n' + MARKER)


class LongHorizonDiffusionTests(unittest.TestCase):
    def test_exact_64_step_matrix_and_invariants(self):
        states, faces = trajectory()
        self.assertEqual(len(states), STEPS + 1)
        matrix = transition_matrix(faces)
        self.assertTrue(all(sum(row) == 1 and min(row) >= 0 for row in matrix))
        self.assertTrue(all(sum(matrix[i][j] for i in range(SIDE)) == 1
                            for j in range(SIDE)))
        initial_mass = sum(states[0])
        initial_min, initial_max = min(states[0]), max(states[0])
        for step, field in enumerate(states):
            self.assertEqual(sum(field), initial_mass)
            self.assertTrue(all(initial_min <= v <= initial_max for v in field))
            if step:
                self.assertLessEqual(sum(v * v for v in field),
                                     sum(v * v for v in states[step - 1]))
            if step in (0, 1, 8, 32, 64):
                self.assertEqual(field, matrix_power_apply(matrix, states[0], step))
        self.assertEqual(states[64], matrix_power_apply(matrix, states[32], 32))

    def test_translation_covariance_and_determinism(self):
        states, faces = trajectory()
        self.assertEqual(trajectory(), (states, faces))
        rotated_field = states[0][-1:] + states[0][:-1]
        rotated_faces = faces[-1:] + faces[:-1]
        for step in range(STEPS + 1):
            self.assertEqual(rotated_field, states[step][-1:] + states[step][:-1])
            if step < STEPS:
                rotated_field = flux_step(rotated_field, rotated_faces)

    def test_bounded_native_cases_and_corruption(self):
        sample = cases()
        self.assertEqual(len(sample), CASE_COUNT)
        self.assertEqual({s for s, _, _, _ in sample}, set(SAMPLE_STEPS))
        self.assertTrue(all('diffusion1(' in e for _, _, e, _ in sample))
        self.assertNotEqual(inject_assertions(MARKER),
                            inject_assertions(MARKER, sabotage=True))
        with self.assertRaises(AssertionError):
            inject_assertions(MARKER, stop=4)
        with self.assertRaises(AssertionError):
            inject_assertions('no marker')


if __name__ == '__main__':
    unittest.main()
