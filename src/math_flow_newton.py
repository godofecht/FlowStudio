"""Damped Newton solver for finite, square scalar mathematical constraint systems.

Opt-in NumPy-backed execution, not upstream Flow compiler lowering.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np

from math_flow_expr import Dimension, ExpressionError
from math_flow_jacobian import system_jacobian
from math_flow_system import ConstraintSystem, system_residuals


@dataclass(frozen=True)
class NewtonResult:
    values: dict[str, float]
    residuals: tuple[float, ...]
    iterations: int
    converged: bool


def solve_scalar_system(
    system: ConstraintSystem,
    x,
    y,
    *,
    values: dict[str, object],
    variables: tuple[str, ...],
    dimensions: dict[str, Dimension],
    tolerance: float = 1e-9,
    max_iterations: int = 40,
) -> NewtonResult:
    """Solve a square system with backtracking; never silently accept divergence.

    Residual magnitudes are compared numerically, so callers must nondimensionalize
    equations before solving systems with substantially different physical scales.
    """
    count = len(variables)
    if not 1 <= count <= 32 or count != len(system.equations):
        raise ExpressionError("Newton solver requires 1 to 32 equations and variables")
    if len(set(variables)) != count:
        raise ExpressionError("Newton variables must be distinct")
    if not math.isfinite(tolerance) or not 0 < tolerance <= 0.1:
        raise ExpressionError("Invalid Newton tolerance")
    if not isinstance(max_iterations, int) or not 1 <= max_iterations <= 1000:
        raise ExpressionError("Invalid Newton iteration limit")
    current = dict(values)
    for name in variables:
        if name not in current or name not in dimensions:
            raise ExpressionError("Missing Newton variable or dimension")
        entry = np.asarray(current[name], dtype=float)
        if entry.ndim != 0 or not math.isfinite(float(entry)):
            raise ExpressionError("Newton variables must be finite scalars")
        current[name] = float(entry)

    def residual(state: dict[str, object]) -> np.ndarray:
        entries = system_residuals(system, x, y, values=state)
        if len(entries) != count or any(np.asarray(v).ndim != 0 for v in entries):
            raise ExpressionError("Newton equations must yield scalar residuals")
        result = np.asarray([float(v) for v in entries], dtype=float)
        if not np.all(np.isfinite(result)):
            raise ExpressionError("Nonfinite Newton residual")
        return result

    r = residual(current)
    completed_iterations = 0
    for iteration in range(max_iterations + 1):
        norm = float(np.max(np.abs(r)))
        if norm <= tolerance:
            return NewtonResult(
                {name: current[name] for name in variables},
                tuple(float(v) for v in r), iteration, True,
            )
        if iteration == max_iterations:
            break
        jac = system_jacobian(
            system, x, y, values=current, variables=variables,
            dimensions=dimensions,
        )
        if any(np.asarray(v).ndim != 0 for row in jac for v in row):
            raise ExpressionError("Newton Jacobian must be scalar")
        matrix = np.asarray(jac, dtype=float)
        if not np.all(np.isfinite(matrix)):
            raise ExpressionError("Nonfinite Newton Jacobian")
        try:
            delta = np.linalg.solve(matrix, -r)
        except np.linalg.LinAlgError as exc:
            raise ExpressionError("Singular Newton Jacobian") from exc
        if not np.all(np.isfinite(delta)):
            raise ExpressionError("Nonfinite Newton update")
        accepted = False
        alpha = 1.0
        for _ in range(24):
            candidate = dict(current)
            for name, change in zip(variables, delta):
                candidate[name] = current[name] + alpha * float(change)
            try:
                trial = residual(candidate)
            except (ExpressionError, ValueError, OverflowError, FloatingPointError):
                alpha *= 0.5
                continue
            if float(np.max(np.abs(trial))) < norm:
                current, r = candidate, trial
                accepted = True
                completed_iterations += 1
                break
            alpha *= 0.5
        if not accepted:
            break
    return NewtonResult(
        {name: current[name] for name in variables},
        tuple(float(v) for v in r), completed_iterations, False,
    )
