"""Explicitly scaled diagnostics for executable mathematical constraint systems.

Each scale is expressed in the physical units of its corresponding equation.
This module does not modify the upstream Flow grammar or implicitly mix units.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np

from math_flow_expr import Dimension, ExpressionError
from math_flow_system import ConstraintSystem, system_residuals


@dataclass(frozen=True)
class ResidualDiagnostic:
    dimension: Dimension
    scale: float
    max_abs: float
    normalized_max_abs: float
    satisfied: bool


def scaled_system_diagnostics(
    system: ConstraintSystem,
    x,
    y,
    *,
    scales: tuple[float, ...],
    tolerance: float = 1e-9,
    values: dict[str, object] | None = None,
) -> tuple[ResidualDiagnostic, ...]:
    """Evaluate residuals against explicit per-equation physical scales.

    A dimensionless tolerance is meaningful only after every residual is
    divided by a caller-supplied positive scale in the same physical units.
    No aggregation of raw residuals with unlike dimensions is performed.
    """
    if len(scales) != len(system.equations):
        raise ExpressionError("Expected one physical scale per equation")
    if not math.isfinite(tolerance) or tolerance < 0:
        raise ExpressionError("Normalized tolerance must be finite and nonnegative")
    checked_scales = []
    for scale in scales:
        if type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0:
            raise ExpressionError("Physical residual scales must be finite and positive")
        checked_scales.append(float(scale))
    results = []
    for equation, residual, scale in zip(
        system.equations, system_residuals(system, x, y, values=values), checked_scales
    ):
        array = np.asarray(residual, dtype=float)
        if array.size == 0 or not np.all(np.isfinite(array)):
            raise ExpressionError("Constraint residual is empty or non-finite")
        magnitude = float(np.max(np.abs(array)))
        normalized = magnitude / scale
        if not math.isfinite(normalized):
            raise ExpressionError("Normalized constraint residual is non-finite")
        results.append(ResidualDiagnostic(
            equation.dimension, scale, magnitude, normalized, normalized <= tolerance
        ))
    return tuple(results)
