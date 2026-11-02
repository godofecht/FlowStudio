"""Real persistent R/Python HTTP qualification of native Flow heterogeneous diffusion."""
from __future__ import annotations

from fractions import Fraction
import json
import math

from test_diffusion3_oracle import diffusion3, seeded_diffusion3_cases

MARKER = "FLOWSTUDIO_DIFFUSION3_V1"
MAX_SOURCE_BYTES = 128 * 1024
MAX_FRAME_BYTES = 24 * 1024


def r_source(records):
    lines = ["flowstudio_diffusion3_count <- 0L"]
    for index, (_, expected, values) in enumerate(records):
        vector = ",".join(format(float(v), ".17g") for v in values)
        lines.extend((
            f"v <- c({vector})",
            "answer <- sum(v[9]*(v[3]-v[1])/v[14]^2 - v[8]*(v[1]-v[2])/v[14]^2, "
            "v[11]*(v[5]-v[1])/v[15]^2 - v[10]*(v[1]-v[4])/v[15]^2, "
            "v[13]*(v[7]-v[1])/v[16]^2 - v[12]*(v[1]-v[6])/v[16]^2)",
            f"stopifnot(is.finite(answer), abs(answer-({float(expected)})) < 1e-10)",
            f"cat('{MARKER}', {index}, sprintf('%.17g',answer), '\\n')",
            "flowstudio_diffusion3_count <- flowstudio_diffusion3_count + 1L",
        ))
    lines.append(f"stopifnot(flowstudio_diffusion3_count == {len(records)}L)")
    source = "\n".join(lines)
    assert len(source.encode()) < MAX_SOURCE_BYTES
    return source


def python_source(records, observed, *, sabotage=False, truncate=False):
    assert len(records) == len(observed) == 24
    frame = [[index, [str(v) for v in values], observed[index]]
             for index, (_, _, values) in enumerate(records)]
    if sabotage:
        frame[4][2] += 1.0
    if truncate:
        frame.pop()
    payload = json.dumps(frame, separators=(",", ":"), allow_nan=False)
    assert len(payload.encode()) < MAX_FRAME_BYTES
    inner = (
        "import json, math\n"
        "from fractions import Fraction\n"
        "frame = json.loads(" + repr(payload) + ")\n"
        "assert len(frame) == 24, 'diffusion3 frame invalid'\n"
        "results = []\n"
        "for index, values, observed in frame:\n"
        "    assert index == len(results) and len(values) == 16, 'diffusion3 frame invalid'\n"
        "    v = [Fraction(item) for item in values]\n"
        "    assert all(k >= 0 for k in v[7:13]) and "
        "all(h > 0 for h in v[13:]), 'diffusion3 inputs invalid'\n"
        "    exact = sum((v[8+2*a]*(v[2+2*a]-v[0]) - "
        "v[7+2*a]*(v[0]-v[1+2*a]))/v[13+a]**2 for a in range(3))\n"
        "    assert math.isfinite(observed) and "
        "abs(observed-float(exact)) < 1e-10, 'diffusion3 oracle mismatch'\n"
        "    results.append(exact)\n"
        "for index in range(0,24,2):\n"
        "    assert results[index] == results[index+1], 'diffusion3 axis swap mismatch'\n"
        "assert results[0] == results[2] == 0, 'diffusion3 zero-flux mismatch'\n"
        "print('diffusion3-r-python-oracle-ok')\n"
    )
    source = ("def flowstudio_diffusion3_check():\n"
              + "".join("    " + line for line in inner.splitlines(keepends=True))
              + "try:\n    flowstudio_diffusion3_check()\n"
              + "finally:\n    del flowstudio_diffusion3_check\n")
    assert len(source.encode()) < MAX_SOURCE_BYTES
    return source


def verify_diffusion3_interop(request, headers):
    records = seeded_diffusion3_cases()
    assert len(records) == 24
    status, body = request("POST", "/api/run/r", r_source(records), headers)
    assert status == 200, ("persistent R diffusion3", status, body[-500:])
    assert len(body.encode()) < MAX_FRAME_BYTES
    frames = [line.strip().split() for line in body.splitlines()
              if line.strip().startswith(MARKER + " ")]
    assert len(frames) == 24, ("R diffusion3 frame count", len(frames))
    observed = []
    for index, fields in enumerate(frames):
        assert len(fields) == 3 and fields[0] == MARKER and int(fields[1]) == index
        value = float(fields[2])
        assert math.isfinite(value) and abs(value - float(records[index][1])) < 1e-10
        observed.append(value)

    def check_python(*, sabotage=False, truncate=False):
        return request("POST", "/api/run/python",
                       python_source(records, observed, sabotage=sabotage,
                                     truncate=truncate), headers)

    status, body = check_python()
    assert status == 200 and "diffusion3-r-python-oracle-ok" in body, (
        "persistent Python exact diffusion3", status, body[-500:])
    status, body = check_python(sabotage=True)
    assert status == 422 and "diffusion3 oracle mismatch" in body, (
        "diffusion3 numerical corruption", status, body[-500:])
    status, body = check_python(truncate=True)
    assert status == 422 and "diffusion3 frame invalid" in body, (
        "diffusion3 truncated frame", status, body[-500:])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(flowstudio_diffusion3_count == 24L); "
                           "cat('diffusion3-r-recovered\\n')", headers)
    assert status == 200 and "diffusion3-r-recovered" in body, (
        "persistent R recovery", status, body[-500:])
    status, body = check_python()
    assert status == 200 and "diffusion3-r-python-oracle-ok" in body, (
        "persistent Python recovery", status, body[-500:])
    print("PASS: 24 heterogeneous diffusion3 cases across native Flow, "
          "persistent R and exact Python HTTP, including 422 corruption")
