"""Seeded, independent integer oracle for Unicode Flow scalar reductions.

The generated assertions execute through the production Flow compiler/HTTP
runtime; this module does not emulate Flow parsing or numerical execution.
"""
from __future__ import annotations

import math
import random

SEED = 20261102
MAX_CASES = 48
MAX_SOURCE_BYTES = 128 * 1024


def unicode_variadic_cases() -> tuple[tuple[str, str, int, str], ...]:
    """Return (expected outcome, expression, exact value, SI dimension)."""
    rng = random.Random(SEED)
    cases: list[tuple[str, str, int, str]] = []
    sum_units = (("", "dimensionless()"), ("m", "length"),
                 ("s", "time_dimension()"), ("K", "temperature_dimension()"),
                 ("kg", "mass_dimension()"))
    for index in range(8):
        suffix, dimension = sum_units[index % len(sum_units)]
        values = [rng.randint(-8, 8) for _ in range(3 + index % 6)]
        for ordered in (values, list(reversed(values))):
            expression = "∑(" + ",".join(f"{value}{suffix}" for value in ordered) + ")"
            cases.append(("valid", expression, sum(ordered), dimension))

    dimensions = {"m": "length", "s": "time_dimension()",
                  "K": "temperature_dimension()", "kg": "mass_dimension()"}
    for index in range(8):
        values = [rng.choice((-3, -2, -1, 1, 2, 3)) for _ in range(3 + index % 6)]
        suffixes = ["m", "s", "K", "kg"][:index % 4 + 1]
        suffixes += [""] * (len(values) - len(suffixes))
        rng.shuffle(suffixes)
        paired = list(zip(values, suffixes))
        for ordered in (paired, list(reversed(paired))):
            dimension = "dimensionless()"
            for _, suffix in ordered:
                if suffix:
                    dimension = f"product_dimension({dimension}, {dimensions[suffix]})"
            expression = "∏(" + ",".join(f"{value}{suffix}" for value, suffix in ordered) + ")"
            cases.append(("valid", expression, math.prod(values), dimension))

    for _ in range(8):
        a, b, c, d = (rng.choice((-5, -4, -3, -2, -1, 1, 2, 3, 4, 5))
                      for _ in range(4))
        cases.append(("valid", f"∑(∏({a}m,{b}s),∏({c}m,{d}s))",
                      a * b + c * d, "length_time"))

    negatives = (
        ("parse", "∑()"), ("parse", "∏()"),
        ("parse", "∑(1,2,3,4,5,6,7,8,9)"),
        ("parse", "∏(1,2,3,4,5,6,7,8,9)"),
        ("runtime", "∑(1m,2s)"), ("runtime", "∑(true,1)"),
        ("runtime", "∏(true,2m)"),
        ("overflow", "∏(1e20,1e20)"),
    )
    cases.extend((kind, expression, 0, "") for kind, expression in negatives)
    assert len(cases) == MAX_CASES
    assert len({expression for _, expression, _, _ in cases}) == MAX_CASES
    assert all(abs(expected) <= 65536 for kind, _, expected, _ in cases if kind == "valid")
    return tuple(cases)


def inject_unicode_variadic_assertions(source: str, sabotage: bool = False,
                                      start: int = 0, stop: int | None = None) -> str:
    """Add independently computed Unicode cases to checked-in native Flow main."""
    marker = 'println("native-math-variadic-ok")'
    if source.count(marker) != 1:
        raise ValueError("missing or ambiguous native Flow main marker")
    cases = unicode_variadic_cases()
    if stop is None:
        stop = len(cases)
    if start < 0 or stop > len(cases) or start >= stop:
        raise ValueError("invalid Unicode variadic batch")
    statements: list[str] = []
    for index in range(start, stop):
        kind, expression, expected, dimension = cases[index]
        if kind == "valid":
            wanted = expected + (1 if sabotage and index == 0 else 0)
            statements.append(f'result = evaluate_math_expression("{expression}")')
            statements.append(
                f'if not result.valid or not near(result.result.value, {wanted}.0) or '
                f'not same_dimension(result.result.dimension, {dimension}) '
                '{ return 80 }'
            )
            statements.append(f'inferred = infer_math_expression_source("{expression}")')
            statements.append(
                f'if not inferred.valid or inferred.is_predicate or '
                f'not same_dimension(inferred.dimension, {dimension}) '
                '{ return 81 }'
            )
        elif kind == "parse":
            statements.append(
                f'if parse_math_expression("{expression}").valid '
                '{ return 82 }'
            )
        elif kind == "runtime":
            statements.append(
                f'if evaluate_math_expression("{expression}").valid or '
                f'infer_math_expression_source("{expression}").valid '
                '{ return 83 }'
            )
        else:
            statements.append(
                f'if evaluate_math_expression("{expression}").valid or '
                f'not infer_math_expression_source("{expression}").valid '
                '{ return 84 }'
            )
    # Check byte spans after a preceding multibyte operator, not merely at 0.
    statements.extend((
        'parsed = parse_math_expression("∑(1,2)+∏(3,4)")',
        'if not parsed.valid or parsed.program.count != 7 or '
        'parsed.program.instructions[2].opcode != 73 or '
        'parsed.program.instructions[2].source_start != 0 or '
        'parsed.program.instructions[2].source_end != 3 or '
        'parsed.program.instructions[5].opcode != 74 or '
        'parsed.program.instructions[5].source_start != 9 or '
        'parsed.program.instructions[5].source_end != 12 { return 85 }',
        'parsed = parse_math_expression("2∑(1,2)")',
        'if not parsed.valid or parsed.program.count != 5 or '
        'parsed.program.instructions[3].opcode != 73 or '
        'parsed.program.instructions[3].source_start != 1 or '
        'parsed.program.instructions[3].source_end != 4 { return 86 }',
        'if parse_math_expression("∑ (1,2)").valid or '
        'parse_math_expression("∑_{i=1}^n").valid or '
        'parse_math_expression("∏(1,2))").valid { return 87 }',
    ))
    expanded = source.replace(marker, "\n".join(statements) + "\n" + marker, 1)
    if len(expanded.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise ValueError("Unicode variadic source exceeds production 128 KiB budget")
    return expanded
