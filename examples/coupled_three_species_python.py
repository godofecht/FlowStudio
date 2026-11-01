"""Deterministic three-species anisotropic 2D PDE oracle for real Python/R HTTP."""
from __future__ import annotations

import json
import math
import random

SIDE = 32
STEPS = 48
DT = 0.1
EXCHANGE = 0.07
DIFFUSION_X = (0.08, 0.13, 0.19)
DIFFUSION_Y = (0.17, 0.09, 0.05)
MEANS = (5.0, 9.0, 12.0)
NAMES = ("a", "b", "c")
COUNT = SIDE * SIDE
MAX_WORK = 3 * COUNT * STEPS


def initial_fields() -> tuple[list[float], ...]:
    rng = random.Random(9137)
    return tuple([
        MEANS[s] + rng.uniform(-0.4, 0.4)
        + 0.2 * math.cos(4 * math.pi * x / SIDE)
        + (s + 1) * 0.04 * math.sin(6 * math.pi * y / SIDE)
        for y in range(SIDE) for x in range(SIDE)
    ] for s in range(3))


def integrate(fields: tuple[list[float], ...], steps: int = STEPS
              ) -> tuple[list[float], ...]:
    if type(steps) is not int or steps < 0 or 3 * COUNT * steps > MAX_WORK:
        raise ValueError("three-species PDE resource limit exceeded")
    if not isinstance(fields, (tuple, list)) or len(fields) != 3 or any(
        not isinstance(f, (tuple, list)) or len(f) != COUNT for f in fields
    ):
        raise ValueError("three-species PDE requires three 32x32 fields")
    if any(type(v) not in (int, float) or not math.isfinite(v)
           for f in fields for v in f):
        raise ValueError("three-species PDE requires finite numeric fields")

    def slope(state):
        result = [[0.0] * COUNT for _ in range(3)]
        for y in range(SIDE):
            for x in range(SIDE):
                i = y * SIDE + x
                left, right = y * SIDE + (x - 1) % SIDE, y * SIDE + (x + 1) % SIDE
                up, down = ((y - 1) % SIDE) * SIDE + x, ((y + 1) % SIDE) * SIDE + x
                for s in range(3):
                    f = state[s]
                    result[s][i] = (
                        DIFFUSION_X[s] * (f[left] + f[right] - 2 * f[i])
                        + DIFFUSION_Y[s] * (f[up] + f[down] - 2 * f[i])
                        + EXCHANGE * (state[(s - 1) % 3][i] - f[i])
                    )
        return result

    state = [list(f) for f in fields]
    for _ in range(steps):
        first = slope(state)
        middle = [[v + 0.5 * DT * dv for v, dv in zip(f, d)]
                  for f, d in zip(state, first)]
        second = slope(middle)
        state = [[v + DT * dv for v, dv in zip(f, d)]
                 for f, d in zip(state, second)]
    return tuple(state)


def verify_result(result: object) -> float:
    if not isinstance(result, dict) or set(result) != set(NAMES):
        raise ValueError("three-species frame requires a, b and c")
    fields = [result[name] for name in NAMES]
    if any(not isinstance(f, list) or len(f) != COUNT for f in fields):
        raise ValueError("three-species frame requires 3072 cells")
    if any(type(v) not in (int, float) or not math.isfinite(v)
           for f in fields for v in f):
        raise ValueError("three-species frame requires finite numbers")
    expected = integrate(initial_fields())
    error = max(abs(a - b) for f, g in zip(fields, expected)
                for a, b in zip(f, g))
    if error > 5e-11:
        raise AssertionError("three-species anisotropic stencil mismatch: " + str(error))
    baseline = initial_fields()
    if abs(sum(map(sum, fields)) - sum(map(sum, baseline))) > 3e-9:
        raise AssertionError("three-species total mass mismatch")
    return error


if __name__ == "__main__":
    print(json.dumps(dict(zip(NAMES, initial_fields())),
                     separators=(",", ":"), allow_nan=False))
