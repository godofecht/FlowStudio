"""Run all 675 heterogeneous Dirichlet values through real R and Python HTTP.

Native Flow scalar fluxdiv3 execution precedes this independent cross-runtime gate.
"""
from __future__ import annotations
import json
import math
from test_dirichlet_diffusion3 import (BOUNDARY, COORDS, DT, INITIAL, INTERIOR,
                                       SIDE, SPACING, STATES, STEPS)

MARKER = "FLOWSTUDIO_DIRICHLET3_R_V1"
MAX_SOURCE_BYTES = 128 * 1024
MAX_FRAME_BYTES = 24 * 1024


def _r_vector(values):
    return "c(" + ",".join(format(float(values.get(c, 0)), ".17g")
                          for c in COORDS) + ")"


def r_source():
    interior = [{c: k for (axis, c), k in INTERIOR.items() if axis == a}
                for a in range(3)]
    low = [{c: k for (axis, c, sign), k in BOUNDARY.items()
            if axis == a and sign == -1} for a in range(3)]
    high = [{c: k for (axis, c, sign), k in BOUNDARY.items()
             if axis == a and sign == 1} for a in range(3)]
    source = f"""flowstudio_dirichlet3_u <- {_r_vector(INITIAL)}
flowstudio_dirichlet3_k <- list({','.join(_r_vector(v) for v in interior)})
flowstudio_dirichlet3_lo <- list({','.join(_r_vector(v) for v in low)})
flowstudio_dirichlet3_hi <- list({','.join(_r_vector(v) for v in high)})
flowstudio_dirichlet3_h <- c({','.join(format(float(h), '.17g') for h in SPACING)})
flowstudio_dirichlet3_stride <- c(9L,3L,1L)
flowstudio_dirichlet3_energy <- sum(flowstudio_dirichlet3_u^2)
flowstudio_dirichlet3_mass <- sum(flowstudio_dirichlet3_u)
flowstudio_dirichlet3_ceiling <- max(flowstudio_dirichlet3_u)
flowstudio_dirichlet3_emit <- function(step) {{
  cat('{MARKER}', step,
      paste(sprintf('%.17g', flowstudio_dirichlet3_u), collapse=' '), '\\n')
}}
flowstudio_dirichlet3_emit(0L)
for (flowstudio_dirichlet3_step in seq_len({STEPS}L)) {{
  flowstudio_dirichlet3_next <- numeric(27L)
  for (i in seq_len(27L)) {{
    coords <- c((i-1L) %/% 9L, ((i-1L) %/% 3L) %% 3L, (i-1L) %% 3L)
    d <- 0
    for (axis in seq_len(3L)) {{
      h <- flowstudio_dirichlet3_h[axis]
      stride <- flowstudio_dirichlet3_stride[axis]
      left <- if (coords[axis] > 0L) {{
        flowstudio_dirichlet3_k[[axis]][i-stride] *
          (flowstudio_dirichlet3_u[i]-flowstudio_dirichlet3_u[i-stride])/h
      }} else 2*flowstudio_dirichlet3_lo[[axis]][i]*flowstudio_dirichlet3_u[i]/h
      right <- if (coords[axis] < 2L) {{
        flowstudio_dirichlet3_k[[axis]][i] *
          (flowstudio_dirichlet3_u[i+stride]-flowstudio_dirichlet3_u[i])/h
      }} else -2*flowstudio_dirichlet3_hi[[axis]][i]*flowstudio_dirichlet3_u[i]/h
      d <- d + (right-left)/h
    }}
    flowstudio_dirichlet3_next[i] <- flowstudio_dirichlet3_u[i] +
      ({float(DT):.17g})*d
  }}
  stopifnot(all(is.finite(flowstudio_dirichlet3_next)),
            all(flowstudio_dirichlet3_next > 0),
            max(flowstudio_dirichlet3_next) <= flowstudio_dirichlet3_ceiling + 1e-10,
            sum(flowstudio_dirichlet3_next) < flowstudio_dirichlet3_mass,
            sum(flowstudio_dirichlet3_next^2) < flowstudio_dirichlet3_energy)
  flowstudio_dirichlet3_mass <- sum(flowstudio_dirichlet3_next)
  flowstudio_dirichlet3_energy <- sum(flowstudio_dirichlet3_next^2)
  flowstudio_dirichlet3_u <- flowstudio_dirichlet3_next
  flowstudio_dirichlet3_emit(flowstudio_dirichlet3_step)
}}
stopifnot(flowstudio_dirichlet3_step == {STEPS}L)
"""
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def python_source(observed, *, sabotage=False, truncate=False):
    assert len(observed) == STEPS + 1
    frame = [[step, list(values)] for step, values in enumerate(observed)]
    if sabotage:
        frame[12][1][13] += 0.25
    if truncate:
        frame.pop()
    payload = json.dumps(frame, separators=(",", ":"), allow_nan=False)
    assert len(payload.encode("utf-8")) < MAX_FRAME_BYTES
    interior = [[axis, COORDS.index(c), str(k)]
                for (axis, c), k in sorted(INTERIOR.items())]
    boundary = [[axis, COORDS.index(c), sign, str(k)]
                for (axis, c, sign), k in sorted(BOUNDARY.items())]
    initial = [str(INITIAL[c]) for c in COORDS]
    inner = (
        "import json, math\n"
        "from fractions import Fraction as F\n"
        "frame = json.loads(" + repr(payload) + ")\n"
        f"assert len(frame) == {STEPS + 1}, 'Dirichlet frame invalid'\n"
        f"state = [F(x) for x in {initial!r}]\n"
        f"interior = {interior!r}\n"
        f"boundary = {boundary!r}\n"
        f"h = [F(x) for x in {[str(s) for s in SPACING]!r}]\n"
        f"dt = F({DT.numerator}, {DT.denominator})\n"
        "n, strides = 27, [9, 3, 1]\n"
        "matrix = [[F(int(i==j)) for j in range(n)] for i in range(n)]\n"
        "for axis, index, value in interior:\n"
        "    stride = strides[axis]\n"
        "    assert 0 <= index < n and (index//stride)%3 < 2, 'Dirichlet interior indexing invalid'\n"
        "    other = index + stride\n"
        "    w = dt * F(value) / h[axis]**2\n"
        "    assert w > 0\n"
        "    matrix[index][index] -= w\n"
        "    matrix[other][other] -= w\n"
        "    matrix[index][other] += w\n"
        "    matrix[other][index] += w\n"
        "for axis, index, sign, value in boundary:\n"
        "    assert 0 <= index < n and sign in (-1,1)\n"
        "    assert (index//strides[axis])%3 == (0 if sign==-1 else 2), 'Dirichlet boundary indexing invalid'\n"
        "    matrix[index][index] -= 2*dt*F(value)/h[axis]**2\n"
        "assert len(interior)==54 and len(boundary)==54\n"
        "assert all(min(row)>=0 and 0<sum(row)<=1 for row in matrix)\n"
        "assert any(sum(row)<1 for row in matrix)\n"
        "mass, energy = sum(state), sum(v*v for v in state)\n"
        "ceiling = max(state)\n"
        "for step, record in enumerate(frame):\n"
        "    index, values = record\n"
        "    assert type(index) is int and index == step and len(values) == n, 'Dirichlet frame invalid'\n"
        "    assert all(type(v) in (int,float) and math.isfinite(v) for v in values), 'Dirichlet frame invalid'\n"
        "    assert all(abs(values[i]-float(state[i])) < 1e-10 for i in range(n)), 'Dirichlet oracle mismatch'\n"
        "    next_state = [sum(matrix[i][j]*state[j] for j in range(n)) for i in range(n)]\n"
        "    next_mass = sum(next_state)\n"
        "    next_energy = sum(v*v for v in next_state)\n"
        "    assert all(0<v<=ceiling for v in next_state)\n"
        "    assert next_mass < mass and next_energy < energy, 'Dirichlet decay failure'\n"
        "    state, mass, energy = next_state, next_mass, next_energy\n"
        "print('dirichlet3-r-python-exact-matrix-ok')\n"
    )
    source = ("def flowstudio_dirichlet3_matrix_check():\n"
              + "".join("    " + line for line in inner.splitlines(keepends=True))
              + "try:\n    flowstudio_dirichlet3_matrix_check()\n"
              + "finally:\n    del flowstudio_dirichlet3_matrix_check\n")
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def verify_dirichlet_interop(request, headers):
    status, body = request("POST", "/api/run/r", r_source(), headers)
    assert status == 200, ("Dirichlet persistent R trajectory", status, body[-500:])
    assert len(body.encode("utf-8")) < MAX_FRAME_BYTES
    records = [line.strip().split() for line in body.splitlines()
               if line.strip().startswith(MARKER + " ")]
    assert len(records) == STEPS + 1, ("Dirichlet R frame count", len(records))
    observed = []
    for step, record in enumerate(records):
        assert len(record) == SIDE ** 3 + 2 and record[0] == MARKER
        assert int(record[1]) == step, ("Dirichlet R frame order", step)
        values = tuple(float(v) for v in record[2:])
        assert all(math.isfinite(v) and abs(v - float(STATES[step][c])) < 1e-10
                   for c, v in zip(COORDS, values)), ("Dirichlet R oracle mismatch", step)
        observed.append(values)

    def run_python(*, sabotage=False, truncate=False):
        return request("POST", "/api/run/python",
                       python_source(observed, sabotage=sabotage, truncate=truncate),
                       headers)

    status, body = run_python()
    assert status == 200 and "dirichlet3-r-python-exact-matrix-ok" in body, (
        "Dirichlet exact CPython matrix", status, body[-500:])
    status, body = run_python(sabotage=True)
    assert status == 422 and "Dirichlet oracle mismatch" in body, (
        "Dirichlet corrupted state rejection", status, body[-500:])
    status, body = run_python(truncate=True)
    assert status == 422 and "Dirichlet frame invalid" in body, (
        "Dirichlet truncated frame rejection", status, body[-500:])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(length(flowstudio_dirichlet3_u)==27L); "
                           "cat('dirichlet3-r-persistent-ok\\n')", headers)
    assert status == 200 and "dirichlet3-r-persistent-ok" in body, (
        "Dirichlet R recovery", status, body[-500:])
    status, body = run_python()
    assert status == 200 and "dirichlet3-r-python-exact-matrix-ok" in body, (
        "Dirichlet Python recovery", status, body[-500:])
    print("PASS: all 25 heterogeneous Dirichlet 3D states (675 values) through "
          "persistent R and independent exact-matrix CPython HTTP; 422/recovery")
