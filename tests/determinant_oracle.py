"""Deterministic exact-integer oracle for production Flow det2/det3 HTTP tests.

The runtime evaluates floating-point postfix IR; this oracle uses fraction-free
integer elimination and cross-checks it against independent permutation sums.
No mocked Flow compiler or HTTP endpoint is used.
"""
from __future__ import annotations

from itertools import permutations
import random


SEED = 20261101
MAX_CASES = 34
MAX_ABS_ENTRY = 12


def determinant_bareiss(rows: tuple[tuple[int, ...], ...]) -> int:
    n = len(rows)
    if n not in (2, 3) or any(len(row) != n for row in rows):
        raise ValueError("only 2x2 and 3x3 square matrices are supported")
    if any(type(value) is not int or abs(value) > MAX_ABS_ENTRY
           for row in rows for value in row):
        raise ValueError("matrix entry outside exact bounded integer domain")
    a = [list(row) for row in rows]
    sign = 1
    previous = 1
    for k in range(n - 1):
        pivot_row = next((i for i in range(k, n) if a[i][k] != 0), None)
        if pivot_row is None:
            return 0
        if pivot_row != k:
            a[k], a[pivot_row] = a[pivot_row], a[k]
            sign = -sign
        pivot = a[k][k]
        for i in range(k + 1, n):
            for j in range(k + 1, n):
                numerator = pivot * a[i][j] - a[i][k] * a[k][j]
                quotient, remainder = divmod(numerator, previous)
                if remainder:
                    raise ArithmeticError("nonexact fraction-free elimination")
                a[i][j] = quotient
            a[i][k] = 0
        previous = pivot
    return sign * a[-1][-1]


def determinant_permutations(rows: tuple[tuple[int, ...], ...]) -> int:
    n = len(rows)
    if n not in (2, 3) or any(len(row) != n for row in rows):
        raise ValueError("invalid square matrix")
    total = 0
    for columns in permutations(range(n)):
        inversions = sum(columns[i] > columns[j]
                         for i in range(n) for j in range(i + 1, n))
        term = 1
        for row, column in enumerate(columns):
            term *= rows[row][column]
        total += -term if inversions % 2 else term
    return total


def matrix_cases() -> tuple[tuple[str, tuple[tuple[int, ...], ...], int], ...]:
    """Four nondegenerate seeds per size, each with three metamorphic transforms.

    Transpose and row addition preserve determinant; swapping two rows flips
    its sign. Include one exactly singular matrix per size. All cases have
    small signed entries and exact integer expected results.
    """
    rng = random.Random(SEED)
    result = []
    for n in (2, 3):
        for _ in range(4):
            for attempt in range(128):
                rows = tuple(tuple(rng.randint(-4, 4) for _ in range(n))
                             for _ in range(n))
                determinant = determinant_bareiss(rows)
                if determinant != 0:
                    break
            else:
                raise AssertionError("deterministic nonsingular seed exhausted")
            transposed = tuple(tuple(rows[j][i] for j in range(n))
                               for i in range(n))
            swapped = (rows[1], rows[0], *rows[2:])
            sheared = (tuple(a + b for a, b in zip(rows[0], rows[1])),
                       *rows[1:])
            for variant, expected in (
                (rows, determinant),
                (transposed, determinant),
                (swapped, -determinant),
                (sheared, determinant),
            ):
                assert determinant_bareiss(variant) == expected
                assert determinant_permutations(variant) == expected
                result.append((f"det{n}", variant, expected))
        singular = tuple(tuple(1 if i == j else 0 for j in range(n))
                         for i in range(n))
        singular = (singular[0], singular[0], *singular[2:])
        result.append((f"det{n}", singular, 0))
    assert len(result) == MAX_CASES
    return tuple(result)


def inject_native_assertions(source: str, sabotage: bool = False) -> str:
    """Append actual Flow runtime assertions inside the existing native main.

    The tampered variant deliberately expects the wrong first determinant;
    successful compilation followed by HTTP 422 proves nonzero exit status
    is propagated by the production transport.
    """
    marker = 'println("native-math-determinants-ok")'
    if source.count(marker) != 1:
        raise ValueError("missing or ambiguous native determinant main marker")
    statements = []
    for index, (function, rows, expected) in enumerate(matrix_cases()):
        arguments = ",".join(str(value) for row in rows for value in row)
        wanted = expected + (1 if sabotage and index == 0 else 0)
        statements.append(
            f'result = evaluate_math_expression("{function}({arguments})")'
        )
        statements.append(
            f'if not result.valid or not near(result.result.value, {wanted}.0) or '
            'not same_dimension(result.result.dimension, dimensionless()) '
            '{ return 70 }'
        )
    expanded = source.replace(marker, "\n".join(statements) + "\n" + marker, 1)
    if len(expanded.encode("utf-8")) > 128 * 1024:
        raise ValueError("determinant HTTP source exceeds production 128 KiB limit")
    return expanded
