"""Independent 3D Laplacian cross-runtime gate over production R/Python HTTP.

Native Flow compiles and executes the same six manufactured stencils in
http_finite_difference_smoke.py. This module independently evaluates their
samples in persistent base R and exact-rational CPython; no mock endpoints.
"""
from __future__ import annotations

from fractions import Fraction
import json
import math

from test_laplacian3_oracle import manufactured_laplacian3_cases

MARKER = "FLOWSTUDIO_LAPLACIAN3_INTEROP_V1"
MAX_SOURCE_BYTES = 128 * 1024
MAX_FRAME_BYTES = 24 * 1024


def stencil(values: list[Fraction]) -> Fraction:
    if len(values) != 10 or min(values[7:]) <= 0:
        raise ValueError("3D stencil needs ten values and positive spacings")
    center = values[0]
    return sum(
        (values[1 + 2 * axis] + values[2 + 2 * axis] - 2 * center)
        / values[7 + axis] ** 2
        for axis in range(3)
    )


def sampled_laplacian3() -> list[tuple[int, list[Fraction], Fraction]]:
    records = []
    for coarse, coarse_value, fine, fine_value, exact in manufactured_laplacian3_cases():
        for expression, expected in ((coarse, coarse_value), (fine, fine_value)):
            assert expression.startswith("laplacian3(") and expression.endswith(")")
            arguments = expression[len("laplacian3("):-1].split(",")
            assert len(arguments) == 10
            assert all(item.endswith("K") for item in arguments[:7])
            assert all(item.endswith("m") for item in arguments[7:])
            values = [Fraction(item[:-1]) for item in arguments]
            assert stencil(values) == expected
            records.append((len(records), values, expected))
        assert coarse_value - exact == 4 * (fine_value - exact)
    assert len(records) == 6
    return records


def r_source(records: list[tuple[int, list[Fraction], Fraction]]) -> str:
    lines = ["flowstudio_laplacian3_count <- 0L"]
    for index, values, expected in records:
        items = ",".join(format(float(value), ".17g") for value in values)
        lines.extend((
            f"v <- c({items})",
            "answer <- (v[2]+v[3]-2*v[1])/v[8]^2 + "
            "(v[4]+v[5]-2*v[1])/v[9]^2 + (v[6]+v[7]-2*v[1])/v[10]^2",
            f"stopifnot(is.finite(answer), abs(answer-({float(expected)})) < 1e-10)",
            f"cat('{MARKER}', {index}, sprintf('%.17g',answer), '\\n')",
            "flowstudio_laplacian3_count <- flowstudio_laplacian3_count + 1L",
        ))
    lines.append(f"stopifnot(flowstudio_laplacian3_count == {len(records)}L)")
    source = "\n".join(lines)
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def python_source(records: list[tuple[int, list[Fraction], Fraction]],
                  observed: list[float], *, sabotage: bool = False,
                  truncate: bool = False) -> str:
    assert len(records) == len(observed) == 6
    frame = [[index, [str(value) for value in values], value]
             for (index, values, _), value in zip(records, observed)]
    if sabotage:
        frame[0][2] += 1.0
    if truncate:
        frame.pop()
    payload = json.dumps(frame, separators=(",", ":"), allow_nan=False)
    assert len(payload.encode("utf-8")) < MAX_FRAME_BYTES
    inner = (
        "import json, math\n"
        "from fractions import Fraction\n"
        "frame = json.loads(" + repr(payload) + ")\n"
        "assert len(frame) == 6, 'laplacian3 frame invalid'\n"
        "results = []\n"
        "for index, values, observed in frame:\n"
        "    assert index == len(results) and len(values) == 10, 'laplacian3 frame invalid'\n"
        "    v = [Fraction(item) for item in values]\n"
        "    assert all(h > 0 for h in v[7:]), 'laplacian3 spacing invalid'\n"
        "    exact = sum((v[1+2*axis]+v[2+2*axis]-2*v[0])/"
        "(v[7+axis]**2) for axis in range(3))\n"
        "    assert math.isfinite(observed) and "
        "abs(observed-float(exact)) < 1e-10, 'laplacian3 oracle mismatch'\n"
        "    results.append(exact)\n"
        "for group, true_value in enumerate((Fraction(0),Fraction(18),Fraction(6))):\n"
        "    assert results[2*group]-true_value == "
        "4*(results[2*group+1]-true_value), 'laplacian3 refinement mismatch'\n"
        "print('laplacian3-r-python-oracle-ok')\n"
    )
    source = ("def flowstudio_laplacian3_check():\n"
              + "".join("    " + line for line in inner.splitlines(keepends=True))
              + "try:\n    flowstudio_laplacian3_check()\n"
              + "finally:\n    del flowstudio_laplacian3_check\n")
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def verify_laplacian3_interop(request, headers: dict[str, str]) -> None:
    records = sampled_laplacian3()
    status, body = request("POST", "/api/run/r", r_source(records), headers)
    assert status == 200, ("real R 3D stencils", status, body[-500:])
    assert len(body.encode("utf-8")) < MAX_FRAME_BYTES
    frames = [line.strip().split() for line in body.splitlines()
              if line.strip().startswith(MARKER + " ")]
    assert len(frames) == 6, ("R 3D stencil frame count", len(frames))
    observed = []
    for index, fields in enumerate(frames):
        assert len(fields) == 3 and fields[0] == MARKER and int(fields[1]) == index
        value = float(fields[2])
        assert math.isfinite(value) and abs(value - float(records[index][2])) < 1e-10
        observed.append(value)

    def check_python(*, sabotage: bool = False, truncate: bool = False):
        return request("POST", "/api/run/python",
                       python_source(records, observed, sabotage=sabotage,
                                     truncate=truncate), headers)

    status, body = check_python()
    assert status == 200 and "laplacian3-r-python-oracle-ok" in body, (
        "persistent Python exact 3D oracle", status, body[-500:])
    status, body = check_python(sabotage=True)
    assert status == 422 and "laplacian3 oracle mismatch" in body, (
        "3D numerical corruption rejection", status, body[-500:])
    status, body = check_python(truncate=True)
    assert status == 422 and "laplacian3 frame invalid" in body, (
        "3D truncated frame rejection", status, body[-500:])
    status, body = request(
        "POST", "/api/run/r",
        "stopifnot(flowstudio_laplacian3_count == 6L); "
        "cat('laplacian3-r-recovered\\n')", headers)
    assert status == 200 and "laplacian3-r-recovered" in body, (
        "persistent R recovery", status, body[-500:])
    status, body = check_python()
    assert status == 200 and "laplacian3-r-python-oracle-ok" in body, (
        "persistent Python recovery", status, body[-500:])
    print("PASS: six 3D manufactured stencils in native Flow, persistent "
          "base R and exact-rational Python; HTTP 422 corruption/truncation")
