"""Production R/Python HTTP cross-check of a conservative 3D periodic grid."""
from __future__ import annotations

import json
import math

from test_diffusion3_periodic import CELL_COUNT, DT, periodic_cases

MARKER = "FLOWSTUDIO_PERIODIC_DIFFUSION3_V1"
MAX_SOURCE_BYTES = 128 * 1024
MAX_FRAME_BYTES = 24 * 1024


def r_source(records):
    lines = ["flowstudio_periodic_count <- 0L"]
    for index, (_, expected, values) in enumerate(records):
        vector = ",".join(format(float(v), ".17g") for v in values)
        lines.extend((
            f"v <- c({vector})",
            "answer <- sum((v[9]*(v[3]-v[1])-v[8]*(v[1]-v[2]))/v[14]^2, "
            "(v[11]*(v[5]-v[1])-v[10]*(v[1]-v[4]))/v[15]^2, "
            "(v[13]*(v[7]-v[1])-v[12]*(v[1]-v[6]))/v[16]^2)",
            f"stopifnot(is.finite(answer), abs(answer-({float(expected)})) < 1e-10)",
            f"cat('{MARKER}', {index}, sprintf('%.17g',answer), '\\n')",
            "flowstudio_periodic_count <- flowstudio_periodic_count + 1L",
        ))
    lines.append(f"stopifnot(flowstudio_periodic_count == {CELL_COUNT}L)")
    source = "\n".join(lines)
    assert len(source.encode()) < MAX_SOURCE_BYTES
    return source


def python_source(records, observed, *, sabotage=False, truncate=False):
    assert len(records) == len(observed) == CELL_COUNT
    frame = [[index, [str(v) for v in values], observed[index]]
             for index, (_, _, values) in enumerate(records)]
    if sabotage:
        frame[5][2] += 1.0
    if truncate:
        frame.pop()
    payload = json.dumps(frame, separators=(",", ":"), allow_nan=False)
    assert len(payload.encode()) < MAX_FRAME_BYTES
    inner = (
        "import json, math\n"
        "from fractions import Fraction\n"
        "frame = json.loads(" + repr(payload) + ")\n"
        f"assert len(frame) == {CELL_COUNT}, 'periodic frame invalid'\n"
        "rates, field = [], []\n"
        "for index, values, observed in frame:\n"
        "    assert index == len(rates) and len(values) == 16, 'periodic frame invalid'\n"
        "    v = [Fraction(item) for item in values]\n"
        "    assert all(k >= 0 for k in v[7:13]) and "
        "all(h > 0 for h in v[13:]), 'periodic inputs invalid'\n"
        "    exact = sum((v[8+2*a]*(v[2+2*a]-v[0]) - "
        "v[7+2*a]*(v[0]-v[1+2*a]))/v[13+a]**2 for a in range(3))\n"
        "    assert math.isfinite(observed) and "
        "abs(observed-float(exact)) < 1e-10, 'periodic oracle mismatch'\n"
        "    field.append(v[0]); rates.append(exact)\n"
        "assert sum(rates) == 0, 'periodic mass drift'\n"
        "assert sum(u*r for u,r in zip(field,rates)) < 0, 'periodic dissipation failure'\n"
        f"dt = Fraction({DT.numerator},{DT.denominator})\n"
        "updated = [u+dt*r for u,r in zip(field,rates)]\n"
        "assert sum(updated) == sum(field), 'periodic step mass drift'\n"
        "assert all(min(field) <= u <= max(field) for u in updated), "
        "'periodic maximum principle failure'\n"
        "assert sum(u*u for u in updated) < sum(u*u for u in field), "
        "'periodic energy failure'\n"
        "print('periodic-diffusion3-r-python-oracle-ok')\n"
    )
    source = ("def flowstudio_periodic_check():\n"
              + "".join("    " + line for line in inner.splitlines(keepends=True))
              + "try:\n    flowstudio_periodic_check()\n"
              + "finally:\n    del flowstudio_periodic_check\n")
    assert len(source.encode()) < MAX_SOURCE_BYTES
    return source


def verify_periodic_diffusion3_interop(request, headers):
    records = periodic_cases()
    assert len(records) == CELL_COUNT
    status, body = request("POST", "/api/run/r", r_source(records), headers)
    assert status == 200, ("periodic R execution", status, body[-500:])
    assert len(body.encode()) < MAX_FRAME_BYTES
    frames = [line.strip().split() for line in body.splitlines()
              if line.strip().startswith(MARKER + " ")]
    assert len(frames) == CELL_COUNT, ("periodic R frame count", len(frames))
    observed = []
    for index, fields in enumerate(frames):
        assert len(fields) == 3 and fields[0] == MARKER and int(fields[1]) == index
        value = float(fields[2])
        assert math.isfinite(value) and abs(value-float(records[index][1])) < 1e-10
        observed.append(value)

    def check_python(*, sabotage=False, truncate=False):
        return request("POST", "/api/run/python",
                       python_source(records, observed, sabotage=sabotage,
                                     truncate=truncate), headers)

    status, body = check_python()
    assert status == 200 and "periodic-diffusion3-r-python-oracle-ok" in body, (
        "periodic Python exact oracle", status, body[-500:])
    status, body = check_python(sabotage=True)
    assert status == 422 and "periodic oracle mismatch" in body, (
        "periodic numerical corruption", status, body[-500:])
    status, body = check_python(truncate=True)
    assert status == 422 and "periodic frame invalid" in body, (
        "periodic truncated frame", status, body[-500:])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(flowstudio_periodic_count == 27L); "
                           "cat('periodic-r-recovered\\n')", headers)
    assert status == 200 and "periodic-r-recovered" in body, (
        "periodic R recovery", status, body[-500:])
    status, body = check_python()
    assert status == 200 and "periodic-diffusion3-r-python-oracle-ok" in body, (
        "periodic Python recovery", status, body[-500:])
    print("PASS: 27 shared-face 3D periodic diffusion cells across native "
          "Flow and persistent R/Python HTTP, with mass and energy checks")
