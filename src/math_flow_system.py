"""Bounded systems of dimension-checked mathematical equality constraints.

This is executable NumPy-backed mathematical Flow support, not upstream
Flow 2.0 grammar integration or a PDE solver.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from math_flow_constraints import ScalarConstraint, constraint_residual, parse_constraint
from math_flow_expr import Dimension, ExpressionError


@dataclass(frozen=True)
class ConstraintSystem:
    equations: tuple[ScalarConstraint, ...]


def parse_constraint_system(
    source: str, *, symbols: dict[str, Dimension] | None = None
) -> ConstraintSystem:
    """Parse 1..32 semicolon-separated equalities with shared typed symbols."""
    if len(source.encode("utf-8")) > 16384:
        raise ExpressionError("Constraint system exceeds 16384 bytes")
    parts = source.split(";")
    if not 1 <= len(parts) <= 32:
        raise ExpressionError("Constraint system requires 1 to 32 equations")
    if any(not part.strip() for part in parts):
        raise ExpressionError("Constraint system contains an empty equation")
    return ConstraintSystem(
        tuple(parse_constraint(part, symbols=symbols) for part in parts)
    )


def system_residuals(
    system: ConstraintSystem, x, y, *, values: dict[str, object] | None = None
) -> tuple[np.ndarray, ...]:
    """Evaluate each equation independently, retaining its physical dimension.

    Return a tuple rather than stacking residuals of potentially different units.
    NumPy broadcasting is supported within each equation, not across equations.
    """
    return tuple(
        np.asarray(constraint_residual(eq, x, y, values=values))
        for eq in system.equations
    )


def system_max_abs_residual(
    system: ConstraintSystem, x, y, *, values: dict[str, object] | None = None
) -> tuple[float, ...]:
    """Per-equation maximum absolute residual; never combine unlike dimensions."""
    residuals = system_residuals(system, x, y, values=values)
    if any(not residual.size or not np.all(np.isfinite(residual)) for residual in residuals):
        raise ExpressionError("Constraint residual is empty or non-finite")
    return tuple(float(np.max(np.abs(residual))) for residual in residuals)
