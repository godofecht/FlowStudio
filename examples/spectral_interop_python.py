"""Deterministic two-dimensional anisotropic heat field for FlowStudio Python/R acceptance.

Only the Python standard library is required. This is the real explicit midpoint
finite-difference evolution, not a generated analytic field. The R consumer
independently verifies every resulting cell against a Fourier eigenmode.
"""
from __future__ import annotations

import json
import math

GRID = 16
MODE_X = 2
MODE_Y = 3
BASE = 300.0
AMPLITUDE = 7.0
DURATION = 0.03
DIFFUSIVITY_X = 0.012
DIFFUSIVITY_Y = 0.018
CROSS_DIFFUSIVITY = 0.004


def initial_field(grid: int = GRID) -> list[float]:
    return [BASE + AMPLITUDE * math.cos(2.0 * math.pi *
            (MODE_X * x + MODE_Y * y) / grid)
            for x in range(grid) for y in range(grid)]


def derivative(values: list[float], grid: int,
               diffusivity_x: float, diffusivity_y: float,
               cross_diffusivity: float) -> list[float]:
    def at(x: int, y: int) -> float:
        return values[(x % grid) * grid + y % grid]

    scale = float(grid * grid)
    result = []
    for x in range(grid):
        for y in range(grid):
            center = at(x, y)
            xx = (at(x + 1, y) - 2.0 * center + at(x - 1, y)) * scale
            yy = (at(x, y + 1) - 2.0 * center + at(x, y - 1)) * scale
            xy = (at(x + 1, y + 1) - at(x + 1, y - 1)
                  - at(x - 1, y + 1) + at(x - 1, y - 1)) * scale * 0.25
            result.append(diffusivity_x * xx + diffusivity_y * yy
                          + 2.0 * cross_diffusivity * xy)
    return result


def integrate(initial: list[float], duration: float, steps: int,
              diffusivity_x: float = DIFFUSIVITY_X,
              diffusivity_y: float = DIFFUSIVITY_Y,
              cross_diffusivity: float = CROSS_DIFFUSIVITY) -> list[float]:
    grid = math.isqrt(len(initial))
    if grid * grid != len(initial) or not (4 <= grid <= 64):
        raise ValueError("grid must be square, with side length 4..64")
    if type(steps) is not int or not (1 <= steps <= 2000):
        raise ValueError("steps must be an integer in 1..2000")
    if not math.isfinite(duration) or duration < 0.0:
        raise ValueError("duration must be finite and nonnegative")
    if not all(math.isfinite(v) for v in initial):
        raise ValueError("initial field must be finite")
    if not all(math.isfinite(v) for v in
               (diffusivity_x, diffusivity_y, cross_diffusivity)):
        raise ValueError("diffusion coefficients must be finite")
    if (diffusivity_x <= 0.0 or diffusivity_y <= 0.0
            or cross_diffusivity * cross_diffusivity >= diffusivity_x * diffusivity_y):
        raise ValueError("diffusion tensor must be positive definite")
    step = duration / steps
    if step * 4.0 * grid * grid * (diffusivity_x + diffusivity_y
                                  + 2.0 * abs(cross_diffusivity)) > 2.0:
        raise ValueError("unstable explicit midpoint time step")
    state = list(initial)
    for _ in range(steps):
        slope = derivative(state, grid, diffusivity_x, diffusivity_y, cross_diffusivity)
        midpoint = [v + 0.5 * step * d for v, d in zip(state, slope)]
        midpoint_slope = derivative(midpoint, grid, diffusivity_x, diffusivity_y,
                                    cross_diffusivity)
        state = [v + step * d for v, d in zip(state, midpoint_slope)]
    return state


def eigenvalue(grid: int = GRID) -> float:
    return (-4.0 * grid * grid * DIFFUSIVITY_X * math.sin(math.pi * MODE_X / grid)**2
            -4.0 * grid * grid * DIFFUSIVITY_Y * math.sin(math.pi * MODE_Y / grid)**2
            -2.0 * grid * grid * CROSS_DIFFUSIVITY
            * math.sin(2.0 * math.pi * MODE_X / grid)
            * math.sin(2.0 * math.pi * MODE_Y / grid))


def verify() -> dict[str, object]:
    initial = initial_field()
    final = integrate(initial, DURATION, 120)
    decay = 1.0 + eigenvalue() * (DURATION / 120.0)
    amplification = (decay + 0.5 * (eigenvalue() * DURATION / 120.0)**2)**120
    expected = [BASE + (v - BASE) * amplification for v in initial]
    max_error = max(abs(a - b) for a, b in zip(final, expected))
    if max_error >= 2e-10:
        raise AssertionError(f"Fourier cell oracle mismatch: {max_error}")
    if abs(sum(final) / len(final) - BASE) >= 2e-10:
        raise AssertionError("periodic diffusion did not conserve the mean")
    if min(final) < BASE - AMPLITUDE or max(final) > BASE + AMPLITUDE:
        raise AssertionError("diffusion violated the field bounds")
    if final != integrate(initial, DURATION, 120):
        raise AssertionError("non-deterministic replay")
    half = integrate(initial, DURATION / 2.0, 60)
    if max(abs(a-b) for a, b in zip(final, integrate(half, DURATION / 2.0, 60))) >= 1e-11:
        raise AssertionError("semigroup mismatch")
    errors = []
    for steps in (30, 60, 120):
        computed = integrate(initial, DURATION, steps)
        exact = [BASE + (v - BASE) * math.exp(eigenvalue() * DURATION) for v in initial]
        errors.append(max(abs(a - b) for a, b in zip(computed, exact)))
    if not (errors[0] > 3.5 * errors[1] and errors[1] > 3.5 * errors[2]):
        raise AssertionError(f"expected RK2 temporal convergence, got {errors}")
    return {"grid": GRID, "mode_x": MODE_X, "mode_y": MODE_Y,
            "duration": DURATION, "steps": 120, "values": final}


if __name__ == "__main__":
    print(json.dumps(verify(), separators=(",", ":"), allow_nan=False))
