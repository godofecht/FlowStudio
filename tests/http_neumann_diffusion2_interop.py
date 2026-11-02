"""Real base-R trajectory and independent exact-matrix CPython HTTP qualification.

The native Flow scalar fluxdiv2 gate runs separately before this interop check.
"""
from __future__ import annotations

import json
import math

from test_neumann_diffusion2 import COORDS, DT, FACES, INITIAL, SIDE, SPACING, STATES, STEPS

MARKER = "FLOWSTUDIO_NEUMANN2_R_V1"
MAX_SOURCE_BYTES = 128 * 1024
MAX_FRAME_BYTES = 24 * 1024


def _r_matrix(values):
    return "matrix(c(" + ",".join(format(float(values[c]), ".17g") for c in COORDS) + "), nrow=4L, byrow=TRUE)"


def r_source():
    x_faces = {c: FACES.get((0, c), 0) for c in COORDS}
    y_faces = {c: FACES.get((1, c), 0) for c in COORDS}
    source = f"""flowstudio_neumann2_u <- {_r_matrix(INITIAL)}
flowstudio_neumann2_kx <- {_r_matrix(x_faces)}
flowstudio_neumann2_ky <- {_r_matrix(y_faces)}
flowstudio_neumann2_mass <- sum(flowstudio_neumann2_u)
flowstudio_neumann2_energy <- sum(flowstudio_neumann2_u^2)
flowstudio_neumann2_min <- min(flowstudio_neumann2_u)
flowstudio_neumann2_max <- max(flowstudio_neumann2_u)
flowstudio_neumann2_emit <- function(step) {{
  cat('{MARKER}', step,
      paste(sprintf('%.17g', as.vector(t(flowstudio_neumann2_u))), collapse=' '), '\\n')
}}
flowstudio_neumann2_emit(0L)
stopifnot(all(flowstudio_neumann2_kx[4L,] == 0), all(flowstudio_neumann2_ky[,4L] == 0))
for (flowstudio_neumann2_step in seq_len({STEPS}L)) {{
  flowstudio_neumann2_next <- matrix(0, nrow=4L, ncol=4L)
  for (i in seq_len(4L)) for (j in seq_len(4L)) {{
    v <- flowstudio_neumann2_u[i,j]
    fxr <- if (i < 4L) flowstudio_neumann2_kx[i,j] * (flowstudio_neumann2_u[i+1L,j]-v) else 0
    fxl <- if (i > 1L) flowstudio_neumann2_kx[i-1L,j] * (v-flowstudio_neumann2_u[i-1L,j]) else 0
    fyr <- if (j < 4L) flowstudio_neumann2_ky[i,j] * (flowstudio_neumann2_u[i,j+1L]-v) else 0
    fyl <- if (j > 1L) flowstudio_neumann2_ky[i,j-1L] * (v-flowstudio_neumann2_u[i,j-1L]) else 0
    flowstudio_neumann2_next[i,j] <- v + ({float(DT):.17g}) * (
      (fxr-fxl)/({float(SPACING[0]):.17g})^2 +
      (fyr-fyl)/({float(SPACING[1]):.17g})^2)
  }}
  stopifnot(all(is.finite(flowstudio_neumann2_next)),
            abs(sum(flowstudio_neumann2_next)-flowstudio_neumann2_mass) < 1e-10,
            sum(flowstudio_neumann2_next^2) <= flowstudio_neumann2_energy + 1e-10,
            min(flowstudio_neumann2_next) >= flowstudio_neumann2_min - 1e-10,
            max(flowstudio_neumann2_next) <= flowstudio_neumann2_max + 1e-10)
  flowstudio_neumann2_energy <- sum(flowstudio_neumann2_next^2)
  flowstudio_neumann2_u <- flowstudio_neumann2_next
  flowstudio_neumann2_emit(flowstudio_neumann2_step)
}}
stopifnot(flowstudio_neumann2_step == {STEPS}L)
"""
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def python_source(observed, *, sabotage=False, truncate=False):
    assert len(observed) == STEPS + 1
    frame = [[step, list(values)] for step, values in enumerate(observed)]
    if sabotage:
        frame[16][1][7] += 0.25
    if truncate:
        frame.pop()
    payload = json.dumps(frame, separators=(",", ":"), allow_nan=False)
    assert len(payload.encode("utf-8")) < MAX_FRAME_BYTES
    faces = [[axis, COORDS.index(c), str(k)] for (axis, c), k in sorted(FACES.items())]
    initial = [str(INITIAL[c]) for c in COORDS]
    inner = (
        "import json, math\n"
        "from fractions import Fraction as F\n"
        "frame = json.loads(" + repr(payload) + ")\n"
        f"assert len(frame) == {STEPS + 1}, 'Neumann frame invalid'\n"
        f"initial = [F(x) for x in {initial!r}]\n"
        f"faces = {faces!r}\n"
        f"h = [F(x) for x in {[str(s) for s in SPACING]!r}]\n"
        f"dt = F({DT.numerator}, {DT.denominator})\n"
        "n = 16\n"
        "matrix = [[F(int(i==j)) for j in range(n)] for i in range(n)]\n"
        "for axis, index, value in faces:\n"
        "    other = index + (4 if axis == 0 else 1)\n"
        "    assert 0 <= index < n and 0 <= other < n\n"
        "    assert (index//4 < 3 if axis == 0 else index%4 < 3), 'Neumann face boundary invalid'\n"
        "    weight = dt * F(value) / h[axis]**2\n"
        "    assert weight > 0\n"
        "    matrix[index][index] -= weight\n"
        "    matrix[other][other] -= weight\n"
        "    matrix[index][other] += weight\n"
        "    matrix[other][index] += weight\n"
        "assert len(faces) == 24 and all(min(row)>=0 and sum(row)==1 for row in matrix)\n"
        "assert all(sum(matrix[i][j] for i in range(n))==1 for j in range(n))\n"
        "mass, energy = sum(initial), sum(x*x for x in initial)\n"
        "lo, hi = min(initial), max(initial)\n"
        "state = initial\n"
        "for step, record in enumerate(frame):\n"
        "    index, observed = record\n"
        "    assert index == step and len(observed) == n, 'Neumann frame invalid'\n"
        "    assert all(type(v) in (int,float) and math.isfinite(v) for v in observed), 'Neumann frame invalid'\n"
        "    assert all(abs(observed[i]-float(state[i])) < 1e-10 for i in range(n)), 'Neumann oracle mismatch'\n"
        "    assert sum(state) == mass and all(lo<=v<=hi for v in state)\n"
        "    next_state = [sum(matrix[i][j]*state[j] for j in range(n)) for i in range(n)]\n"
        "    next_energy = sum(v*v for v in next_state)\n"
        "    assert next_energy <= energy, 'Neumann energy increase'\n"
        "    state, energy = next_state, next_energy\n"
        "print('neumann2-r-python-exact-matrix-ok')\n"
    )
    source = ("def flowstudio_neumann2_matrix_check():\n"
              + "".join("    " + line for line in inner.splitlines(keepends=True))
              + "try:\n    flowstudio_neumann2_matrix_check()\n"
              + "finally:\n    del flowstudio_neumann2_matrix_check\n")
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def verify_neumann_interop(request, headers):
    status, body = request("POST", "/api/run/r", r_source(), headers)
    assert status == 200, ("Neumann persistent R trajectory", status, body[-500:])
    assert len(body.encode("utf-8")) < MAX_FRAME_BYTES
    records = [line.strip().split() for line in body.splitlines()
               if line.strip().startswith(MARKER + " ")]
    assert len(records) == STEPS + 1, ("Neumann R frame count", len(records))
    observed = []
    for step, record in enumerate(records):
        assert len(record) == SIDE * SIDE + 2 and record[0] == MARKER
        assert int(record[1]) == step, ("Neumann R frame order", step)
        values = tuple(float(v) for v in record[2:])
        assert all(math.isfinite(v) and abs(v - float(STATES[step][c])) < 1e-10
                   for c, v in zip(COORDS, values)), ("Neumann R oracle mismatch", step)
        observed.append(values)

    def run_python(*, sabotage=False, truncate=False):
        return request("POST", "/api/run/python",
                       python_source(observed, sabotage=sabotage, truncate=truncate),
                       headers)

    status, body = run_python()
    assert status == 200 and "neumann2-r-python-exact-matrix-ok" in body, (
        "Neumann exact CPython matrix", status, body[-500:])
    status, body = run_python(sabotage=True)
    assert status == 422 and "Neumann oracle mismatch" in body, (
        "Neumann corrupted state rejection", status, body[-500:])
    status, body = run_python(truncate=True)
    assert status == 422 and "Neumann frame invalid" in body, (
        "Neumann truncated frame rejection", status, body[-500:])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(length(flowstudio_neumann2_u)==16L); "
                           "cat('neumann2-r-persistent-ok\\n')", headers)
    assert status == 200 and "neumann2-r-persistent-ok" in body, (
        "Neumann R recovery", status, body[-500:])
    status, body = run_python()
    assert status == 200 and "neumann2-r-python-exact-matrix-ok" in body, (
        "Neumann Python recovery", status, body[-500:])
    print("PASS: all 33 heterogeneous Neumann 2D states (528 values) through "
          "persistent R and independent exact-matrix CPython HTTP; 422/recovery")
