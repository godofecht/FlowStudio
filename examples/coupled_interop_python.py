"""Real Python/R 32x32 two-species PDE interchange, with an independent Fourier oracle.

The Python kernel defines the source and checks R's complete numerical output.
R integrates the coupled system independently; no Python numerical result is
passed off as an R computation. Only the standard library is required.
"""
from __future__ import annotations

import json
import math

SIDE = 32
STEPS = 64
STEP = 0.1
DIFFUSION = 0.12
EXCHANGE = 0.05
MODE_X = 2
MODE_Y = 3
MEANS = (10.0, 20.0)
AMPLITUDES = (0.8, -0.4)
COUNT = SIDE * SIDE
MAX_WORK = 131072


def mode(x: int, y: int) -> float:
    return (math.cos(2 * math.pi * MODE_X * x / SIDE) *
            math.cos(2 * math.pi * MODE_Y * y / SIDE))


def initial_fields() -> tuple[list[float], list[float]]:
    shape = [mode(x, y) for y in range(SIDE) for x in range(SIDE)]
    return tuple([mean + amplitude * value for value in shape]
                 for mean, amplitude in zip(MEANS, AMPLITUDES))


def expected_fields(steps: int = STEPS) -> tuple[list[float], list[float]]:
    if type(steps) is not int or not 0 <= steps <= STEPS:
        raise ValueError("invalid coupled PDE step count")
    eigen = 2 * (math.cos(2 * math.pi * MODE_X / SIDE) +
                 math.cos(2 * math.pi * MODE_Y / SIDE) - 2)

    def midpoint_factor(rate: float) -> float:
        z = rate * STEP
        return (1 + z + 0.5 * z * z) ** steps

    mean_sum = 0.5 * sum(MEANS)
    mean_difference = 0.5 * (MEANS[0] - MEANS[1]) * midpoint_factor(-2 * EXCHANGE)
    amplitude_sum = 0.5 * sum(AMPLITUDES) * midpoint_factor(DIFFUSION * eigen)
    amplitude_difference = (0.5 * (AMPLITUDES[0] - AMPLITUDES[1]) *
                            midpoint_factor(DIFFUSION * eigen - 2 * EXCHANGE))
    shape = [mode(x, y) for y in range(SIDE) for x in range(SIDE)]
    return ([mean_sum + mean_difference + (amplitude_sum + amplitude_difference) * v
             for v in shape],
            [mean_sum - mean_difference + (amplitude_sum - amplitude_difference) * v
             for v in shape])


def direct_integrate(fields: tuple[list[float], list[float]],
                     steps: int = STEPS) -> tuple[list[float], list[float]]:
    if type(steps) is not int or steps < 0 or 2 * COUNT * steps > MAX_WORK:
        raise ValueError("coupled PDE resource limit exceeded")
    if len(fields) != 2 or any(len(field) != COUNT for field in fields):
        raise ValueError("coupled PDE requires two 32x32 fields")
    if any(type(value) not in (float, int) or not math.isfinite(value)
           for field in fields for value in field):
        raise ValueError("coupled PDE input must be finite")

    def slope(u: list[float], v: list[float]) -> tuple[list[float], list[float]]:
        result_u, result_v = [], []
        for y in range(SIDE):
            for x in range(SIDE):
                index = y * SIDE + x
                neighbors = ((y * SIDE + (x - 1) % SIDE),
                             (y * SIDE + (x + 1) % SIDE),
                             (((y - 1) % SIDE) * SIDE + x),
                             (((y + 1) % SIDE) * SIDE + x))
                lap_u = sum(u[i] for i in neighbors) - 4 * u[index]
                lap_v = sum(v[i] for i in neighbors) - 4 * v[index]
                result_u.append(DIFFUSION * lap_u + EXCHANGE * (v[index] - u[index]))
                result_v.append(DIFFUSION * lap_v + EXCHANGE * (u[index] - v[index]))
        return result_u, result_v

    u, v = map(list, fields)
    for _ in range(steps):
        du, dv = slope(u, v)
        mid_u = [a + 0.5 * STEP * b for a, b in zip(u, du)]
        mid_v = [a + 0.5 * STEP * b for a, b in zip(v, dv)]
        du, dv = slope(mid_u, mid_v)
        u = [a + STEP * b for a, b in zip(u, du)]
        v = [a + STEP * b for a, b in zip(v, dv)]
    return u, v


def verify_result(result: object) -> float:
    if not isinstance(result, dict) or set(result) != {"u", "v"}:
        raise ValueError("coupled R frame must contain u and v")
    values = [result["u"], result["v"]]
    if any(not isinstance(field, list) or len(field) != COUNT for field in values):
        raise ValueError("coupled R frame must contain 2048 cells")
    if any(type(value) not in (float, int) or not math.isfinite(value)
           for field in values for value in field):
        raise ValueError("coupled R frame must contain finite numbers")
    expected = expected_fields()
    error = max(abs(value - reference) for field, oracle in zip(values, expected)
                for value, reference in zip(field, oracle))
    if error > 5e-11:
        raise AssertionError("coupled R Fourier mismatch: " + str(error))
    if abs((sum(values[0]) + sum(values[1])) / COUNT - sum(MEANS)) > 5e-11:
        raise AssertionError("coupled R total mass mismatch")
    return error


if __name__ == "__main__":
    u, v = initial_fields()
    print(json.dumps({"u":u, "v":v}, separators=(",", ":"), allow_nan=False))
