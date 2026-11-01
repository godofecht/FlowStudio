"""Seeded exact-rational oracle for native Flow SI dispersion over production HTTP.

The independent Python oracle only generates expectations. Native results are
compiled and executed by FlowStudio's real Flow 2.0 HTTP server.
"""
from __future__ import annotations

from fractions import Fraction
from math import sqrt
from random import Random

SEED = 20261101
VALID_CASES = 48
NEGATIVE_CASES = 12
MAX_SOURCE_BYTES = 128 * 1024


def _variance(values: tuple[Fraction, ...], sample: bool) -> Fraction:
    mean = sum(values, Fraction(0)) / len(values)
    return sum(((x - mean) ** 2 for x in values), Fraction(0)) / (
        len(values) - 1 if sample else len(values))


def dispersion_cases() -> tuple[tuple[str, str, float, tuple[int, int, int, int]], ...]:
    """Return (kind, native expression, oracle value, SI exponent tuple)."""
    rng = Random(SEED)
    cases: list[tuple[str, str, float, tuple[int, int, int, int]]] = []
    for operation in ("stddev", "sample_variance", "sample_stddev"):
        for index in range(8):
            arity = 2 + index % 7
            numbers = rng.sample(range(-30, 31), arity)
            if index % 3 == 0:
                numbers[-1] = 100 + index  # asymmetric outlier
            unit = ("m", "s", "", "m")[index % 4]
            dimension = (1, 0, 0, 0) if unit == "m" else (
                (0, 0, 1, 0) if unit == "s" else (0, 0, 0, 0))
            if operation == "sample_variance":
                dimension = tuple(2 * x for x in dimension)
            pairs = [(number, "km" if unit == "m" and index % 4 == 0 and j == 0
                      else unit) for j, number in enumerate(numbers)]
            for ordering in (pairs, list(reversed(pairs))):
                values = tuple(Fraction(number * (1000 if suffix == "km" else 1))
                               for number, suffix in ordering)
                variance = _variance(values, operation != "stddev")
                expected = (float(variance) if operation == "sample_variance"
                            else sqrt(float(variance)))
                expression = operation + "(" + ",".join(
                    f"{number}{suffix}" for number, suffix in ordering) + ")"
                cases.append(("valid", expression, expected, dimension))
    negatives = (
        ("parse", "stddev()"),
        ("parse", "sample_variance()"),
        ("parse", "sample_stddev()"),
        ("parse", "stddev(1,)"),
        ("parse", "sample_variance(,1)"),
        ("parse", "sample_stddev(1,2"),
        ("parse", "stddev(1,2,3,4,5,6,7,8,9)"),
        ("runtime", "sample_variance(1m)"),
        ("runtime", "sample_stddev(1m)"),
        ("runtime", "stddev(1m,2s)"),
        ("runtime", "sample_stddev(true,3)"),
        ("runtime", "sample_variance(1e20,-1e20)"),
    )
    cases.extend((kind, expression, 0.0, (0, 0, 0, 0))
                 for kind, expression in negatives)
    assert len(cases) == VALID_CASES + NEGATIVE_CASES
    assert len({expression for _, expression, _, _ in cases}) == len(cases)
    return tuple(cases)


def inject_dispersion_assertions(source: str, *, start: int, stop: int,
                                 sabotage: bool = False) -> str:
    """Inject executable numerical, SI and negative checks into native Flow main."""
    marker = 'println("native-math-dispersion-http-ok")'
    if source.count(marker) != 1:
        raise ValueError("missing or ambiguous native dispersion marker")
    cases = dispersion_cases()
    if start < 0 or start >= stop or stop > len(cases):
        raise ValueError("invalid dispersion batch")
    statements: list[str] = []
    for index in range(start, stop):
        kind, expression, expected, dimension = cases[index]
        if kind == "valid":
            if sabotage and index == start:
                expected += 1.0 + abs(expected) * 0.1
            statements.append(f'result = evaluate_math_expression("{expression}")')
            comparison = (f"dispersion_close(result.result.value / {expected:.17g},1.0)"
                          if expected else "dispersion_close(result.result.value,0.0)")
            dimensional = " or ".join(
                f"result.result.dimension.{name} != {exponent}"
                for name, exponent in zip(("length", "mass", "time", "temperature"), dimension)
            )
            statements.append(
                f"if not result.valid or not {comparison} or {dimensional} "
                "{ return 90 }"
            )
        elif kind == "parse":
            statements.append(
                f'if parse_math_expression("{expression}").valid '
                "{ return 91 }"
            )
        else:
            statements.append(
                f'result = evaluate_math_expression("{expression}")'
            )
            statements.append("if result.valid { return 92 }")
    expanded = source.replace(marker, "\n".join(statements) + "\n" + marker, 1)
    if len(expanded.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise ValueError("native dispersion HTTP source exceeds 128 KiB")
    return expanded
