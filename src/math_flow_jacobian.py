"""Numerical Jacobian of dimension-checked mathematical constraint systems.

Opt-in NumPy execution; not upstream Flow 2.0 compiler lowering.
"""
from __future__ import annotations

import math
import numpy as np

from math_flow_expr import Dimension, ExpressionError
from math_flow_system import ConstraintSystem, system_residuals


def system_jacobian(
    system: ConstraintSystem,
    x,
    y,
    *,
    values: dict[str, object],
    variables: tuple[str, ...],
    dimensions: dict[str, Dimension],
    relative_step: float = 1e-5,
) -> tuple[tuple[np.ndarray, ...], ...]:
    """Central-difference residual derivatives, ordered by equation and variable.

    Each derivative has physical dimension equation.dimension / variable.dimension.
    Callers retain the equation and variable dimensions; entries are not stacked
    because their units and broadcast shapes can differ.
    """
    if not 1 <= len(variables) <= 32 or len(set(variables)) != len(variables):
        raise ExpressionError("Jacobian requires 1 to 32 distinct variables")
    if not math.isfinite(relative_step) or not 0 < relative_step <= 0.1:
        raise ExpressionError("Invalid Jacobian relative step")
    if any(name not in dimensions or name not in values for name in variables):
        raise ExpressionError("Jacobian variable requires a value and dimension")
    if any(len(dimensions[name]) != 4 for name in variables):
        raise ExpressionError("Jacobian requires four-component physical dimensions")
    columns = []
    for name in variables:
        value = np.asarray(values[name], dtype=float)
        if not value.size or not np.all(np.isfinite(value)):
            raise ExpressionError("Jacobian variable must be finite and nonempty")
        step = relative_step * np.maximum(1.0, np.abs(value))
        plus = dict(values)
        minus = dict(values)
        plus[name] = value + step
        minus[name] = value - step
        high = system_residuals(system, x, y, values=plus)
        low = system_residuals(system, x, y, values=minus)
        derivatives = []
        for a, b in zip(high, low):
            try:
                derivative = np.asarray((a - b) / (2.0 * step))
            except ValueError as exc:
                raise ExpressionError("Jacobian residual shape mismatch") from exc
            if not derivative.size or not np.all(np.isfinite(derivative)):
                raise ExpressionError("Jacobian contains empty or non-finite derivative")
            derivatives.append(derivative)
        columns.append(tuple(derivatives))
    return tuple(tuple(columns[j][i] for j in range(len(variables)))
                 for i in range(len(system.equations)))


def jacobian_dimensions(
    system: ConstraintSystem, variables: tuple[str, ...],
    dimensions: dict[str, Dimension],
) -> tuple[tuple[Dimension, ...], ...]:
    """Physical dimension of each derivative d(residual_i)/d(variable_j)."""
    if not 1 <= len(variables) <= 32 or len(set(variables)) != len(variables):
        raise ExpressionError("Jacobian requires 1 to 32 distinct variables")
    if any(name not in dimensions or len(dimensions[name]) != 4 for name in variables):
        raise ExpressionError("Missing or invalid Jacobian variable dimension")
    return tuple(
        tuple(tuple(a - b for a, b in zip(eq.dimension, dimensions[name]))
              for name in variables)
        for eq in system.equations
    )
