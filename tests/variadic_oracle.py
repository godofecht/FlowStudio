"""Independent seeded integer oracle for native Flow SI-aware reductions.

Cases are generated without using Flow's parser, evaluator or unit inference.
The injected assertions run in the real compiler/runtime over HTTP.
"""
from __future__ import annotations

import math
import random

SEED = 20261101
MAX_SOURCE_BYTES = 128 * 1024
MAX_CASES = 48


def variadic_cases() -> tuple[tuple[str, str, int, str], ...]:
    """(kind, expression, exact integer result, expected Flow dimension)."""
    rng = random.Random(SEED)
    cases: list[tuple[str, str, int, str]] = []
    sum_units = (("", "dimensionless()"), ("m", "length"),
                 ("s", "time_dimension()"), ("K", "temperature_dimension()"),
                 ("kg", "mass_dimension()"))
    for index in range(8):
        suffix, dimension = sum_units[index % len(sum_units)]
        values = [rng.randint(-8, 8) for _ in range(2 + index % 7)]
        for order in (values, list(reversed(values))):
            expression = "sum(" + ",".join(f"{value}{suffix}" for value in order) + ")"
            cases.append(("valid", expression, sum(order), dimension))

    for index in range(8):
        arity = 2 + index % 7
        values = [rng.choice((-4, -3, -2, -1, 1, 2, 3, 4)) for _ in range(arity)]
        # Reversing argument order must preserve the exact product and SI
        # dimensions; the oracle never calls Flow's own unit inference.
        suffixes = ["m", "s", "K", "kg"][:min(arity, index % 4 + 1)]
        suffixes += [""] * (arity - len(suffixes))
        rng.shuffle(suffixes)
        dimensions = {"m": "length", "s": "time_dimension()",
                      "K": "temperature_dimension()", "kg": "mass_dimension()"}
        for ordered in (list(zip(values, suffixes)), list(reversed(list(zip(values, suffixes))))):
            dimension = "dimensionless()"
            for _, suffix in ordered:
                if suffix:
                    dimension = f"product_dimension({dimension}, {dimensions[suffix]})"
            expression = "product(" + ",".join(
                f"{value}{suffix}" for value, suffix in ordered) + ")"
            cases.append(("valid", expression, math.prod(values), dimension))

    for _ in range(8):
        a, b, c, d = (rng.choice((-5, -4, -3, -2, -1, 1, 2, 3, 4, 5))
                      for _ in range(4))
        expression = f"sum(product({a}m,{b}s),product({c}m,{d}s))"
        cases.append(("valid", expression, a * b + c * d, "length_time"))

    negatives = (
        ("parse", "sum()"), ("parse", "product()"),
        ("parse", "sum(1,2,3,4,5,6,7,8,9)"),
        ("parse", "product(1,2,3,4,5,6,7,8,9)"),
        ("runtime", "sum(1m,2s)"),
        ("runtime", "sum(1K,2kg)"),
        ("runtime", "product(true,2m)"),
        ("overflow", "product(1e20,1e20)"),
    )
    cases.extend((kind, expression, 0, "") for kind, expression in negatives)
    assert len(cases) == MAX_CASES
    assert len({case[1] for case in cases}) == MAX_CASES
    assert all(abs(value) <= 65536 for kind, _, value, _ in cases if kind == "valid")
    return tuple(cases)


def inject_variadic_assertions(source: str, sabotage: bool = False) -> str:
    """Inject reproducible numerical assertions into the real native main."""
    marker = 'println("native-math-variadic-ok")'
    if source.count(marker) != 1:
        raise ValueError("missing or ambiguous native Flow main marker")
    statements = []
    for index, (kind, expression, expected, dimension) in enumerate(variadic_cases()):
        if kind == "valid":
            wanted = expected + (1 if sabotage and index == 0 else 0)
            statements.append(f'result = evaluate_math_expression("{expression}")')
            statements.append(
                f'if not result.valid or not near(result.result.value, {wanted}.0) or '
                f'not same_dimension(result.result.dimension, {dimension}) '
                '{ return 70 }'
            )
            statements.append(
                f'if not infer_math_expression_source("{expression}").valid '
                '{ return 71 }'
            )
        elif kind == "parse":
            statements.append(
                f'if parse_math_expression("{expression}").valid '
                '{ return 72 }'
            )
        elif kind == "runtime":
            statements.append(
                f'if evaluate_math_expression("{expression}").valid or '
                f'infer_math_expression_source("{expression}").valid '
                '{ return 73 }'
            )
        else:
            # Static dimensional inference deliberately does not evaluate
            # numeric intermediates, so overflow is a runtime-only rejection.
            statements.append(
                f'if evaluate_math_expression("{expression}").valid or '
                f'not infer_math_expression_source("{expression}").valid '
                '{ return 74 }'
            )
    expanded = source.replace(marker, "\n".join(statements) + "\n" + marker, 1)
    if len(expanded.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise ValueError("seeded variadic source exceeds production 128 KiB budget")
    return expanded
