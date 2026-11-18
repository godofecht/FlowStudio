"""General typed scalar equality constraints with executable NumPy residuals.

Opt-in mathematical Flow utility; not an upstream Flow 2.0 grammar extension.
"""
from __future__ import annotations

from dataclasses import dataclass
from math_flow_expr import Dimension, Expression, ExpressionError, evaluate, parse_expression


@dataclass(frozen=True)
class ScalarConstraint:
    lhs: Expression
    rhs: Expression
    dimension: Dimension


def parse_constraint(source: str, *, symbols: dict[str, Dimension] | None = None) -> ScalarConstraint:
    """Compile one equality, rejecting comparisons and dimension mismatches."""
    if len(source.encode("utf-8")) > 4096:
        raise ExpressionError("Constraint exceeds 4096 bytes")
    if source.count("=") != 1:
        raise ExpressionError("Constraint requires exactly one '='")
    lhs_source, rhs_source = source.split("=", 1)
    if not lhs_source.strip() or not rhs_source.strip():
        raise ExpressionError("Constraint requires two nonempty sides")
    if lhs_source.rstrip().endswith(("!", "<", ">")) or rhs_source.lstrip().startswith(("=", ">")):
        raise ExpressionError("Comparison is not a constraint equality")
    lhs = parse_expression(lhs_source, symbols=symbols)
    rhs = parse_expression(rhs_source, symbols=symbols)
    if lhs.dimension != rhs.dimension:
        raise ExpressionError(f"Constraint dimension mismatch: {lhs.dimension} != {rhs.dimension}")
    return ScalarConstraint(lhs, rhs, lhs.dimension)


def constraint_residual(constraint: ScalarConstraint, x, y, *, values: dict[str, object] | None = None):
    """Evaluate lhs - rhs with the existing checked NumPy expression runtime."""
    return evaluate(constraint.lhs, x, y, values=values) - evaluate(
        constraint.rhs, x, y, values=values
    )
