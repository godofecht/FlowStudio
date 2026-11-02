#!/usr/bin/env python3
"""Independent 2D anisotropic native Flow RK4 -> R/Python HTTP acceptance.

The Flow compiler generates the four coupled ODEs. R checks their exact
Fourier solution; Python independently integrates the 4x4 matrix with RK4.
All three execute through the production FlowStudio router, not mocks.
"""
from __future__ import annotations

import math
from pathlib import Path

from http_smoke import request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "examples/native_evolution_heat2d.flow"
MARKER = "FLOWSTUDIO_HEAT2D_RK4_V1 64"
END = "FLOWSTUDIO_HEAT2D_RK4_END"
HEADERS = {"X-FlowStudio-Intent": "run"}
MAX_SOURCE_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 24 * 1024
INITIAL = (3.6, 1.6, 4.0, 2.8)
STEPS = 64


def derivative(state):
    a, b, c, d = state
    return (0.16 * (b-a) + 0.32 * (c-a),
            0.16 * (a-b) + 0.32 * (d-b),
            0.16 * (d-c) + 0.32 * (a-c),
            0.16 * (c-d) + 0.32 * (b-d))


def matrix_rk4(steps=STEPS):
    assert 1 <= steps <= 4096
    state = INITIAL
    dt = 1.0 / steps
    for _ in range(steps):
        k1 = derivative(state)
        k2 = derivative(tuple(v + dt*k/2 for v, k in zip(state, k1)))
        k3 = derivative(tuple(v + dt*k/2 for v, k in zip(state, k2)))
        k4 = derivative(tuple(v + dt*k for v, k in zip(state, k3)))
        state = tuple(v + dt*(a+2*b+2*c+d)/6
                      for v, a, b, c, d in zip(state, k1, k2, k3, k4))
    return state


def fourier_solution():
    x, y, xy = (math.exp(-0.32), math.exp(-0.64), math.exp(-0.96))
    return (3 + .8*x - .4*y + .2*xy,
            3 - .8*x - .4*y - .2*xy,
            3 + .8*x + .4*y - .2*xy,
            3 - .8*x + .4*y + .2*xy)


def read_frame(body):
    assert len(body.encode("utf-8")) < MAX_RESPONSE_BYTES, "Flow response budget"
    lines = body.splitlines()
    assert lines.count(MARKER) == 1, "missing/duplicate Flow RK4 marker"
    start = lines.index(MARKER)
    assert lines[start + 5] == END, "Flow RK4 frame truncated"
    assert "native-evolution-heat2d-ok" in lines, "Flow assertions did not finish"
    values = tuple(float(x) for x in lines[start + 1:start + 5])
    assert len(values) == 4 and all(math.isfinite(x) for x in values)
    return values


def r_source(observed, *, sabotage=False):
    assert len(observed) == 4
    values = list(observed)
    if sabotage:
        values[2] += 0.25
    encoded = ",".join(format(x, ".17g") for x in values)
    source = f"""flowstudio_heat2d_observed <- c({encoded})
flowstudio_heat2d_exact <- c(
  3+.8*exp(-.32)-.4*exp(-.64)+.2*exp(-.96),
  3-.8*exp(-.32)-.4*exp(-.64)-.2*exp(-.96),
  3+.8*exp(-.32)+.4*exp(-.64)-.2*exp(-.96),
  3-.8*exp(-.32)+.4*exp(-.64)+.2*exp(-.96))
stopifnot(length(flowstudio_heat2d_observed)==4L,
          all(is.finite(flowstudio_heat2d_observed)),
          max(abs(flowstudio_heat2d_observed-flowstudio_heat2d_exact))<1e-9,
          abs(sum(flowstudio_heat2d_observed)-12)<1e-11,
          all(flowstudio_heat2d_observed>1.6),
          all(flowstudio_heat2d_observed<4.0))
flowstudio_heat2d_checked <- TRUE
cat('heat2d-r-fourier-ok\\n')
"""
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def python_source(observed, *, sabotage=False, truncate=False):
    assert len(observed) == 4
    values = list(observed)
    if sabotage:
        values[0] -= 0.25
    if truncate:
        values.pop()
    inner = f"""import math
frame = {values!r}
assert len(frame)==4 and all(type(x) in (int,float) and math.isfinite(x) for x in frame), 'heat2d frame invalid'
u = [3.6,1.6,4.0,2.8]
def derivative(v):
    a,b,c,d=v
    return [0.16*(b-a)+0.32*(c-a),0.16*(a-b)+0.32*(d-b),0.16*(d-c)+0.32*(a-c),0.16*(c-d)+0.32*(b-d)]
dt=1/64
for step in range(64):
    k1=derivative(u)
    k2=derivative([v+dt*k/2 for v,k in zip(u,k1)])
    k3=derivative([v+dt*k/2 for v,k in zip(u,k2)])
    k4=derivative([v+dt*k for v,k in zip(u,k3)])
    u=[v+dt*(a+2*b+2*c+d)/6 for v,a,b,c,d in zip(u,k1,k2,k3,k4)]
assert max(abs(a-b) for a,b in zip(frame,u))<1e-10, 'heat2d matrix RK4 mismatch'
assert abs(sum(frame)-12)<1e-11
print('heat2d-python-matrix-rk4-ok')
"""
    source = ("def flowstudio_heat2d_check():\n"
              + "".join("    " + line for line in inner.splitlines(keepends=True))
              + "try:\n    flowstudio_heat2d_check()\n"
              + "finally:\n    del flowstudio_heat2d_check\n")
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def verify_native_heat2d_interop():
    source = SOURCE.read_text(encoding="utf-8")
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    assert "flow AnisotropicHeat2D {" in source
    assert "AnisotropicHeat2D_step(&state, dt)" in source
    assert "steps > 100000" in source
    status, body = request("POST", "/api/check/flow", source, HEADERS)
    assert status == 200, ("native 2D RK4 compiler", status, body[-500:])
    status, body = request("POST", "/api/run/flow", source, HEADERS)
    assert status == 200, ("native 2D RK4 runtime", status, body[-500:])
    observed = read_frame(body)
    assert max(abs(a-b) for a, b in zip(observed, matrix_rk4())) < 1e-10
    assert max(abs(a-b) for a, b in zip(observed, fourier_solution())) < 1e-9
    status, replay = request("POST", "/api/run/flow", source, HEADERS)
    assert status == 200 and read_frame(replay) == observed, (
        "native 2D deterministic replay", status, replay[-500:])

    status, body = request("POST", "/api/run/r", r_source(observed), HEADERS)
    assert status == 200 and "heat2d-r-fourier-ok" in body, (
        "persistent R Fourier oracle", status, body[-500:])
    status, body = request("POST", "/api/run/python", python_source(observed), HEADERS)
    assert status == 200 and "heat2d-python-matrix-rk4-ok" in body, (
        "persistent Python RK4 oracle", status, body[-500:])

    for bad in (python_source(observed, sabotage=True),
                python_source(observed, truncate=True)):
        status, body = request("POST", "/api/run/python", bad, HEADERS)
        assert status == 422, ("Python frame must fail closed", status, body[-500:])
    status, body = request("POST", "/api/run/r",
                           r_source(observed, sabotage=True), HEADERS)
    assert status == 422, ("R corrupted frame must fail", status, body[-500:])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(isTRUE(flowstudio_heat2d_checked)); "
                           "cat('heat2d-r-recovered\\n')", HEADERS)
    assert status == 200 and "heat2d-r-recovered" in body, (
        "persistent R recovery", status, body[-500:])
    status, body = request("POST", "/api/run/python",
                           python_source(observed), HEADERS)
    assert status == 200 and "heat2d-python-matrix-rk4-ok" in body, (
        "persistent Python recovery", status, body[-500:])

    corrupted = source.replace("if error64 > 0.0000000001 { return 3 }",
                               "if error64 < 0.0000000001 { return 3 }", 1)
    assert corrupted != source
    status, body = request("POST", "/api/check/flow", corrupted, HEADERS)
    assert status == 200, ("corrupted numerical assertion compiles", status, body[-500:])
    status, body = request("POST", "/api/run/flow", corrupted, HEADERS)
    assert status == 422, ("corrupted numerical assertion must fail", status, body[-500:])
    malformed = source.replace("flow AnisotropicHeat2D {",
                               "flow AnisotropicHeat2D", 1)
    assert malformed != source
    status, body = request("POST", "/api/check/flow", malformed, HEADERS)
    assert status == 422, ("malformed native Flow must fail", status, body[-500:])
    status, body = request("POST", "/api/run/flow", source, HEADERS)
    assert status == 200 and read_frame(body) == observed, (
        "Flow runtime recovery", status, body[-500:])
    print("PASS: native compiler-generated anisotropic 2D RK4, 4/4 cells, "
          "64 steps, independent R Fourier/Python matrix HTTP, replay, "
          "negative compiler/runtime/frame tests and persistent recovery")


if __name__ == "__main__":
    verify_native_heat2d_interop()
