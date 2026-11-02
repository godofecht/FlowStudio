"""Independent persistent base-R/CPython HTTP qualification of 64-step diffusion."""
from __future__ import annotations

import json
import math

from test_diffusion1_long_horizon import SIDE, STEPS, DT, DX, initial_state, trajectory

MARKER = "FLOWSTUDIO_LONG_DIFFUSION_R_V1"
MAX_SOURCE_BYTES = 128 * 1024
MAX_FRAME_BYTES = 24 * 1024


def r_source():
    field, faces = initial_state()
    values = ",".join(str(float(x)) for x in field)
    coefficients = ",".join(str(float(x)) for x in faces)
    source = f"""flowstudio_long_state <- c({values})
flowstudio_long_faces <- c({coefficients})
flowstudio_long_mass <- sum(flowstudio_long_state)
flowstudio_long_energy <- sum(flowstudio_long_state^2)
flowstudio_long_emit <- function(step) {{
  cat('{MARKER}', step,
      paste(sprintf('%.17g', flowstudio_long_state), collapse=' '), '\\n')
}}
flowstudio_long_emit(0L)
for (flowstudio_long_step in seq_len({STEPS}L)) {{
  flowstudio_long_next <- numeric({SIDE}L)
  for (flowstudio_long_i in seq_len({SIDE}L)) {{
    flowstudio_long_left <- if (flowstudio_long_i == 1L) {SIDE}L else flowstudio_long_i - 1L
    flowstudio_long_right <- if (flowstudio_long_i == {SIDE}L) 1L else flowstudio_long_i + 1L
    flowstudio_long_next[flowstudio_long_i] <- flowstudio_long_state[flowstudio_long_i] +
      ({float(DT)}/{float(DX * DX)}) * (
        flowstudio_long_faces[flowstudio_long_i] *
          (flowstudio_long_state[flowstudio_long_right] - flowstudio_long_state[flowstudio_long_i]) -
        flowstudio_long_faces[flowstudio_long_left] *
          (flowstudio_long_state[flowstudio_long_i] - flowstudio_long_state[flowstudio_long_left]))
  }}
  stopifnot(all(is.finite(flowstudio_long_next)),
            abs(sum(flowstudio_long_next) - flowstudio_long_mass) < 1e-10,
            sum(flowstudio_long_next^2) <= flowstudio_long_energy + 1e-10)
  flowstudio_long_energy <- sum(flowstudio_long_next^2)
  flowstudio_long_state <- flowstudio_long_next
  flowstudio_long_emit(flowstudio_long_step)
}}
stopifnot(flowstudio_long_step == {STEPS}L)
"""
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def python_source(observed, *, sabotage=False, truncate=False):
    """Validate R's complete trace using an independently assembled exact matrix."""
    assert len(observed) == STEPS + 1
    frame = [[step, list(values)] for step, values in enumerate(observed)]
    if sabotage:
        frame[32][1][2] += 1.0
    if truncate:
        frame.pop()
    payload = json.dumps(frame, separators=(",", ":"), allow_nan=False)
    assert len(payload.encode("utf-8")) < MAX_FRAME_BYTES
    field, faces = initial_state()
    inner = (
        "import json, math\n"
        "from fractions import Fraction\n"
        "frame = json.loads(" + repr(payload) + ")\n"
        f"assert len(frame) == {STEPS + 1}, 'long diffusion frame invalid'\n"
        f"field = [Fraction(s) for s in {repr([str(v) for v in field])}]\n"
        f"faces = [Fraction(s) for s in {repr([str(v) for v in faces])}]\n"
        f"n = {SIDE}\n"
        f"ratio = Fraction({DT.numerator},{DT.denominator}) / Fraction({DX.numerator},{DX.denominator})**2\n"
        "matrix = [[Fraction(int(i==j)) for j in range(n)] for i in range(n)]\n"
        "for i in range(n):\n"
        "    left, right = ratio*faces[(i-1)%n], ratio*faces[i]\n"
        "    matrix[i][i] -= left+right\n"
        "    matrix[i][(i-1)%n] += left\n"
        "    matrix[i][(i+1)%n] += right\n"
        "assert all(sum(row)==1 and min(row)>=0 for row in matrix)\n"
        "assert all(sum(matrix[i][j] for i in range(n))==1 for j in range(n))\n"
        "mass = sum(field)\n"
        "initial_min, initial_max = min(field), max(field)\n"
        "energy = sum(v*v for v in field)\n"
        "for step, record in enumerate(frame):\n"
        "    index, observed = record\n"
        "    assert index == step and len(observed) == n, 'long diffusion frame invalid'\n"
        "    assert all(isinstance(v,(int,float)) and math.isfinite(v) for v in observed), 'long diffusion frame invalid'\n"
        "    assert all(abs(observed[i]-float(field[i])) < 1e-10 for i in range(n)), 'long diffusion oracle mismatch'\n"
        "    assert sum(field) == mass and all(initial_min<=v<=initial_max for v in field)\n"
        "    next_field = [sum(matrix[i][j]*field[j] for j in range(n)) for i in range(n)]\n"
        "    next_energy = sum(v*v for v in next_field)\n"
        "    assert next_energy <= energy, 'long diffusion energy increase'\n"
        "    field, energy = next_field, next_energy\n"
        "print('long-diffusion-r-python-matrix-ok')\n"
    )
    source = ("def flowstudio_long_diffusion_check():\n"
              + "".join("    " + line for line in inner.splitlines(keepends=True))
              + "try:\n    flowstudio_long_diffusion_check()\n"
              + "finally:\n    del flowstudio_long_diffusion_check\n")
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def verify_long_horizon_interop(request, headers):
    expected, _ = trajectory()
    status, body = request("POST", "/api/run/r", r_source(), headers)
    assert status == 200, ("64-step base R", status, body[-500:])
    assert len(body.encode("utf-8")) < MAX_FRAME_BYTES
    records = [line.strip().split() for line in body.splitlines()
               if line.strip().startswith(MARKER + " ")]
    assert len(records) == STEPS + 1, ("64-step R frame count", len(records))
    observed = []
    for step, record in enumerate(records):
        assert len(record) == SIDE + 2 and record[0] == MARKER
        assert int(record[1]) == step, ("64-step R frame ordering", step)
        values = tuple(float(v) for v in record[2:])
        assert all(math.isfinite(v) and abs(v-float(expected[step][i])) < 1e-10
                   for i, v in enumerate(values)), ("64-step R mismatch", step)
        observed.append(values)

    def run_python(*, sabotage=False, truncate=False):
        return request("POST", "/api/run/python",
                       python_source(observed, sabotage=sabotage, truncate=truncate),
                       headers)

    status, body = run_python()
    assert status == 200 and "long-diffusion-r-python-matrix-ok" in body, (
        "64-step exact Python matrix", status, body[-500:])
    status, body = run_python(sabotage=True)
    assert status == 422 and "long diffusion oracle mismatch" in body, (
        "64-step numerical corruption", status, body[-500:])
    status, body = run_python(truncate=True)
    assert status == 422 and "long diffusion frame invalid" in body, (
        "64-step truncated frame", status, body[-500:])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(length(flowstudio_long_state)==5L); "
                           "cat('long-diffusion-r-recovered\\n')", headers)
    assert status == 200 and "long-diffusion-r-recovered" in body, (
        "64-step R interpreter recovery", status, body[-500:])
    status, body = run_python()
    assert status == 200 and "long-diffusion-r-python-matrix-ok" in body, (
        "64-step Python interpreter recovery", status, body[-500:])
    print("PASS: 65 complete five-cell heterogeneous diffusion states "
          "independently verified by persistent R and exact-matrix Python HTTP")
