"""Deterministic exact-rational Type-7 quantile acceptance for native Flow.

Expectations use Python Fraction arithmetic, independently of the Flow IR
and the R quantile implementation exercised by the live HTTP gate.
"""
from __future__ import annotations

from fractions import Fraction
import random

SEED = 20261104
VALID_COUNT = 48
MAX_CASES = 60
MAX_SOURCE_BYTES = 128 * 1024
PROBABILITIES = (Fraction(0), Fraction(1, 8), Fraction(1, 4),
                 Fraction(1, 2), Fraction(3, 4), Fraction(7, 8), Fraction(1))


def type7(probability: Fraction, values: tuple[Fraction, ...]) -> Fraction:
    if not values or not Fraction(0) <= probability <= Fraction(1):
        raise ValueError("invalid Type-7 quantile arguments")
    ordered = sorted(values)
    rank = probability * (len(ordered) - 1)
    lower = rank.numerator // rank.denominator
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _probability_literal(probability: Fraction) -> str:
    return f"{float(probability):.3f}".rstrip("0").rstrip(".") if probability else "0"


def quantile_cases() -> tuple[tuple[str, str, Fraction, str, Fraction, tuple[int, ...]], ...]:
    """(kind, Flow expression, exact SI value, dimension, p, SI values)."""
    rng = random.Random(SEED)
    cases = []
    for index in range(24):
        arity = 2 + index % 6
        probability = PROBABILITIES[index % len(PROBABILITIES)]
        values = rng.sample(range(-30, 31), arity)
        if index % 4 == 0:
            values[-1] = 100 + index
        suffix = ("m", "s", "", "m")[index % 4]
        dimension = {"m": "length_dimension()", "s": "time_dimension()",
                     "": "dimensionless()"}[suffix]
        pairs = [(value, "km" if suffix == "m" and j == 0 and index % 4 == 0
                  else suffix) for j, value in enumerate(values)]
        for ordered in (pairs, list(reversed(pairs))):
            normalized = tuple(value * (1000 if unit == "km" else 1)
                               for value, unit in ordered)
            expected = type7(probability, tuple(Fraction(x) for x in normalized))
            expression = "quantile(" + _probability_literal(probability) + "," + ",".join(
                f"{value}{unit}" for value, unit in ordered) + ")"
            cases.append(("valid", expression, expected, dimension,
                          probability, normalized))
    negatives = (
        ("parse", "quantile()"),
        ("parse", "quantile(0.5)"),
        ("parse", "quantile(0.5,1,2,3,4,5,6,7,8)"),
        ("parse", "quantile(0.5,)"),
        ("runtime", "quantile(1.1,1,2)"),
        ("runtime", "quantile(-0.1,1,2)"),
        ("runtime", "quantile(0.5m,1m,2m)"),
        ("runtime", "quantile(true,1,2)"),
        ("runtime", "quantile(0.5,1m,2s)"),
        ("runtime", "quantile(0.5,1kg,2K)"),
        ("runtime", "quantile(0.5,1m,2)"),
        ("runtime", "quantile(0.5,false,3)"),
    )
    cases.extend((kind, expr, Fraction(0), "", Fraction(0), ())
                 for kind, expr in negatives)
    assert len(cases) == MAX_CASES
    assert len({row[1] for row in cases}) == MAX_CASES
    assert all(abs(row[2]) < 1_000_000 for row in cases)
    return tuple(cases)


def inject_quantile_assertions(source: str, *, start: int, stop: int,
                               sabotage: bool = False) -> str:
    marker = 'println("native-math-robust-statistics-ok")'
    if source.count(marker) != 1:
        raise ValueError("missing or ambiguous native quantile fixture marker")
    cases = quantile_cases()
    if start < 0 or stop <= start or stop > len(cases):
        raise ValueError("invalid quantile batch")
    statements = []
    for index in range(start, stop):
        kind, expression, expected, dimension, _, _ = cases[index]
        if kind == "valid":
            wanted = expected + (1 if sabotage and index == start else 0)
            statements.append(f'result = evaluate_math_expression("{expression}")')
            statements.append(
                f'if not result.valid or not near(result.result.value, {float(wanted):.17g}, 0.0000001) '
                f'or not same_dimension(result.result.dimension, {dimension}) '
                '{ return 90 }')
            statements.append(f'inferred = infer_math_expression_source("{expression}")')
            statements.append(
                f'if not inferred.valid or inferred.is_predicate or '
                f'not same_dimension(inferred.dimension, {dimension}) '
                '{ return 91 }')
        elif kind == "parse":
            statements.append(f'if parse_math_expression("{expression}").valid '
                              '{ return 92 }')
        else:
            statements.append(f'if evaluate_math_expression("{expression}").valid '
                              '{ return 93 }')
    result = source.replace(marker, "\n".join(statements) + "\n" + marker, 1)
    if len(result.encode("utf-8")) >= MAX_SOURCE_BYTES:
        raise ValueError("quantile Flow HTTP source exceeds 128 KiB")
    return result
