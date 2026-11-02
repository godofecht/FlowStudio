"""Deterministic two-eigenmode Dirichlet heat equation debugger oracle.

The FlowStudio Python kernel executes the explicit Euler stencil.  The oracle
uses the independent discrete sine eigenvalues, not a second stencil loop.
No random sampling, network, packages or external data are required.
"""
from __future__ import annotations

import math

N = 64
RATIO = 0.4
AMPLITUDE = 0.25
THRESHOLD = 1e-3
MAX_STEPS = 192

HEAT_SOURCE = """from math import sin, pi
field = [sin(pi * i / 64) + 0.25 * sin(3 * pi * i / 64) for i in range(65)]
for iteration in range(192):
    updated = field[:]
    for i in range(1, 64):
        updated[i] = field[i] + 0.4 * (field[i - 1] - 2.0 * field[i] + field[i + 1])
    residual = max(abs(updated[i] - field[i]) for i in range(1, 64))
    field = updated
    if residual <= 1e-3:
        break
print(iteration)
"""
BREAK_LINE = HEAT_SOURCE.splitlines().index("    if residual <= 1e-3:") + 1
BREAKPOINT = {"line": BREAK_LINE, "condition": "residual<=1e-3"}


def eigenvalue(mode: int) -> float:
    return 1.0 - 4.0 * RATIO * math.sin(mode * math.pi / (2.0 * N)) ** 2


def expected_state(step: int) -> list[float]:
    q1, q3 = eigenvalue(1), eigenvalue(3)
    return [
        q1 ** step * math.sin(math.pi * i / N)
        + AMPLITUDE * q3 ** step * math.sin(3.0 * math.pi * i / N)
        for i in range(N + 1)
    ]


def expected_residual(iteration: int) -> float:
    q1, q3 = eigenvalue(1), eigenvalue(3)
    return max(abs(
        (q1 - 1.0) * q1 ** iteration * math.sin(math.pi * i / N)
        + AMPLITUDE * (q3 - 1.0) * q3 ** iteration * math.sin(3.0 * math.pi * i / N)
    ) for i in range(1, N))


def first_hit() -> int:
    for iteration in range(MAX_STEPS):
        if expected_residual(iteration) <= THRESHOLD:
            return iteration
    raise AssertionError("Manufactured heat mode never crosses the breakpoint threshold")
