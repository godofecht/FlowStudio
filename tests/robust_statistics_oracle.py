"""Exact seeded oracle for native Flow median and unscaled MAD over HTTP.

Only Python's rational arithmetic computes expectations. Flow source is
compiled and executed by the production native HTTP server in the smoke gate.
"""
from __future__ import annotations

from fractions import Fraction
import random

SEED = 20261103
MAX_CASES = 60
MAX_SOURCE_BYTES = 128 * 1024


def _median(values: tuple[Fraction, ...]) -> Fraction:
    ordered = sorted(values)
    n = len(ordered)
    return (ordered[(n - 1) // 2] + ordered[n // 2]) / 2


def robust_cases() -> tuple[tuple[str, str, Fraction, str], ...]:
    """(kind, expression, exact rational result, expected SI dimension)."""
    rng = random.Random(SEED)
    cases: list[tuple[str, str, Fraction, str]] = []
    for operation in ("median", "mad"):
        for index in range(12):
            arity = 2 + index % 7
            values = rng.sample(range(-25, 26), arity)
            if index % 3 == 0:
                values[-1] = 100 + index  # deliberately asymmetric outlier
            suffix = ("m", "s", "", "m")[index % 4]
            dimension = {"m": "length", "s": "time_dimension()",
                         "": "dimensionless()"}[suffix]
            pairs = [(value, "km" if suffix == "m" and index % 4 == 0 and j == 0
                      else suffix) for j, value in enumerate(values)]
            for ordered in (pairs, list(reversed(pairs))):
                rational = tuple(Fraction(value * (1000 if unit == "km" else 1))
                                 for value, unit in ordered)
                center = _median(rational)
                expected = (center if operation == "median" else
                            _median(tuple(abs(value - center) for value in rational)))
                expression = operation + "(" + ",".join(
                    f"{value}{unit}" for value, unit in ordered) + ")"
                cases.append(("valid", expression, expected, dimension))

    negatives = (
        ("parse", "median()"), ("parse", "mad()"),
        ("parse", "median(1,2,3,4,5,6,7,8,9)"),
        ("parse", "mad(1,2,3,4,5,6,7,8,9)"),
        ("parse", "median(1,)"), ("parse", "mad(,1)"),
        ("runtime", "median(1m,2s)"), ("runtime", "mad(1kg,2K)"),
        ("runtime", "median(true,2)"), ("runtime", "mad(false,3)"),
        ("runtime", "median(1m,2)"), ("runtime", "mad(1s,3m)"),
    )
    cases.extend((kind, expression, Fraction(0), "") for kind, expression in negatives)
    assert len(cases) == MAX_CASES
    assert len({expression for _, expression, _, _ in cases}) == MAX_CASES
    assert all(abs(value) < 10_000 for kind, _, value, _ in cases if kind == "valid")
    return tuple(cases)


def inject_robust_assertions(source: str, *, start: int, stop: int,
                             sabotage: bool = False) -> str:
    """Insert real compiler/runtime assertions into checked-in native main."""
    marker = 'println("native-math-robust-statistics-ok")'
    if source.count(marker) != 1:
        raise ValueError("missing or ambiguous native robust-statistics marker")
    cases = robust_cases()
    if start < 0 or start >= stop or stop > len(cases):
        raise ValueError("invalid robust-statistics batch")
    statements: list[str] = []
    for index in range(start, stop):
        kind, expression, expected, dimension = cases[index]
        if kind == "valid":
            wanted = expected + (1 if sabotage and index == start else 0)
            assert wanted.denominator in (1, 2)
            expected_literal = f"{float(wanted):.1f}"
            statements.append(f'result = evaluate_math_expression("{expression}")')
            statements.append(
                f'if not result.valid or not near(result.result.value, {expected_literal}, 0.000000001) or '
                f'not same_dimension(result.result.dimension, {dimension}) '
                '{ return 90 }'
            )
            statements.append(f'inferred = infer_math_expression_source("{expression}")')
            statements.append(
                f'if not inferred.valid or inferred.is_predicate or '
                f'not same_dimension(inferred.dimension, {dimension}) '
                '{ return 91 }'
            )
        elif kind == "parse":
            statements.append(
                f'if parse_math_expression("{expression}").valid '
                '{ return 92 }'
            )
        else:
            statements.append(
                f'if evaluate_math_expression("{expression}").valid or '
                f'infer_math_expression_source("{expression}").valid '
                '{ return 93 }'
            )
    expanded = source.replace(marker, "\n".join(statements) + "\n" + marker, 1)
    if len(expanded.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise ValueError("robust-statistics source exceeds production 128 KiB budget")
    return expanded
