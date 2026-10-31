"""Independent exact-rational oracle for the checked-in native fourth-root constraints.

This does not execute or replace the Flow compiler. Native Flow, HTTP and
Chromium execute the same checked-in case in the separate production gates.
"""
from fractions import Fraction
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/math_dimension_variable_four_smoke.flow"
QUARTER = Fraction(1, 4)
BASE_ROWS = (
    ((QUARTER, 0, 0, 0), (1, 0)),
    ((-QUARTER, 1, 0, 0), (0, 0)),
    ((0, -1, 1, 0), (-1, 1)),
    ((0, 0, 1, 1), (1, 1)),
)
EXTRA_ROWS = (
    ((QUARTER, 0, 0, 0), (1, 0)),  # Unicode fourth root in addition
    ((0, 1, 0, 0), (1, 0)),
    ((QUARTER, 0, 0, 1), (2, 0)),
    ((1, 0, 0, 0), (4, 0)),
    ((0, 0, 1, 0), (0, 1)),
)


def solve_exact(rows, component):
    """Gauss-Jordan elimination with exact rational coefficients."""
    matrix = [[Fraction(v) for v in coefficients] +
              [Fraction(rhs[component])] for coefficients, rhs in rows]
    rank = 0
    for column in range(4):
        pivot = next((i for i in range(rank, len(matrix))
                      if matrix[i][column] != 0), None)
        if pivot is None:
            continue
        matrix[rank], matrix[pivot] = matrix[pivot], matrix[rank]
        divisor = matrix[rank][column]
        matrix[rank] = [value / divisor for value in matrix[rank]]
        for i in range(len(matrix)):
            if i == rank:
                continue
            multiplier = matrix[i][column]
            matrix[i] = [left - multiplier * right for left, right
                         in zip(matrix[i], matrix[rank])]
        rank += 1
    if rank != 4 or any(all(v == 0 for v in row[:4]) and row[4] != 0
                        for row in matrix):
        return None
    return tuple(matrix[i][4] for i in range(4))


def holds(row, dimensions, component):
    coefficients, rhs = row
    return sum(Fraction(c) * value for c, value in
               zip(coefficients, dimensions)) == rhs[component]


class FourthRootConstraintOracle(unittest.TestCase):
    def test_exact_full_rank_dimensions(self):
        self.assertEqual(solve_exact(BASE_ROWS, 0), (4, 1, 0, 1))
        self.assertEqual(solve_exact(BASE_ROWS, 1), (0, 0, 1, 0))

    def test_all_sixteen_equations_consistent(self):
        length = solve_exact(BASE_ROWS, 0)
        time = solve_exact(BASE_ROWS, 1)
        rows = BASE_ROWS + EXTRA_ROWS + (EXTRA_ROWS[0],) * 8
        for row in rows:
            self.assertTrue(holds(row, length, 0))
            self.assertTrue(holds(row, time, 1))

    def test_late_contradiction_and_cubic_exponent(self):
        length = solve_exact(BASE_ROWS, 0)
        time = solve_exact(BASE_ROWS, 1)
        self.assertFalse(holds(((QUARTER, 0, 0, 0), (0, 1)), length, 0))
        self.assertFalse(holds(((QUARTER, 0, 0, 0), (0, 1)), time, 1))
        self.assertFalse(holds(((1, 0, 0, 0), (3, 0)), length, 0))

    def test_rank_deficient_system_rejected(self):
        rows = (BASE_ROWS[1], BASE_ROWS[1],
                ((0, 0, 1, -1), (0, 0)),
                ((0, 0, 1, -1), (0, 0)))
        self.assertIsNone(solve_exact(rows, 0))

    def test_native_source_matches_oracle_fixture(self):
        source = SOURCE.read_text(encoding="utf-8")
        for equation in (
            'system.equations[0] = "root4(x) = 1m"',
            'system.equations[1] = "y/root4(x) = 1"',
            'system.equations[2] = "z/y = 1s/1m"',
            'system.equations[3] = "w*z = 1m*1s"',
            'system.equations[4] = "∜(x)+y = 2m"',
            'system.equations[5] = "root4(x)*w = 1m²"',
            'system.equations[6] = "x = 1m⁴"',
            'system.equations[7] = "z = 1s"',
            'system.equations[15] = "root4(x)+y = 2s"',
        ):
            self.assertIn(equation, source)
        self.assertIn("system.count = 16", source)


if __name__ == "__main__":
    unittest.main()
