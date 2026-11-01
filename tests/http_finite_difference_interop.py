"""Cross-check the 27 native Flow finite-difference fixtures in real R/Python HTTP kernels.

R evaluates the sampled stencils directly; CPython independently reconstructs
the same exact-rational operators. Neither kernel is a stand-in for native Flow.
"""
from __future__ import annotations

import json
import math
import re
from fractions import Fraction

from test_finite_difference_oracle import finite_difference_cases

MARKER = "FLOWSTUDIO_FD_INTEROP_V1"
MAX_SOURCE_BYTES = 128 * 1024
MAX_FRAME_BYTES = 24 * 1024


def sampled_stencils() -> list[tuple[int, list[int], Fraction]]:
    records = []
    for index, (expression, expected) in enumerate(finite_difference_cases()):
        numbers = [int(value) for value in re.findall(r"-?\\d+", expression.partition("(")[2])]
        arity = 3 if index < 9 else 4 if index < 18 else 7
        assert len(numbers) == arity, (index, expression, numbers)
        records.append((index, numbers, expected))
    assert len(records) == 27
    return records


def exact_stencil(index: int, values: list[int]) -> Fraction:
    v = [Fraction(x) for x in values]
    if index < 9:
        return (v[1] - v[0]) / (2 * v[2])
    if index < 18:
        return (v[0] - 2 * v[1] + v[2]) / (v[3] ** 2)
    return ((v[1] - 2 * v[0] + v[2]) / v[5] ** 2
            + (v[3] - 2 * v[0] + v[4]) / v[6] ** 2)


def r_source(records: list[tuple[int, list[int], Fraction]]) -> str:
    lines = ["flowstudio_fd_count <- 0L"]
    for index, values, expected in records:
        items = ",".join(str(v) for v in values)
        formula = ("(v[2]-v[1])/(2*v[3])" if index < 9 else
                   "(v[1]-2*v[2]+v[3])/(v[4]^2)" if index < 18 else
                   "(v[2]-2*v[1]+v[3])/(v[6]^2)+(v[4]-2*v[1]+v[5])/(v[7]^2)")
        lines.extend((
            f"v <- c({items})",
            f"answer <- {formula}",
            f"stopifnot(is.finite(answer), abs(answer-({float(expected)})) < 1e-10)",
            f"cat('{MARKER}', {index}, sprintf('%.17g',answer), '\\n')",
            "flowstudio_fd_count <- flowstudio_fd_count + 1L",
        ))
    lines.append(f"stopifnot(flowstudio_fd_count == {len(records)}L)")
    source = "\n".join(lines)
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def python_source(records: list[tuple[int, list[int], Fraction]],
                  observed: list[float], *, sabotage: bool = False) -> str:
    data = [[index, values, value] for (index, values, _), value
            in zip(records, observed)]
    assert len(data) == 27
    if sabotage:
        data[0][2] += 1.0
    payload = json.dumps(data, separators=(",", ":"), allow_nan=False)
    assert len(payload.encode("utf-8")) < MAX_FRAME_BYTES
    source = (
        "import json as _fd_json, fractions as _fd_fractions, math as _fd_math\n"
        "_fd_records = _fd_json.loads(" + repr(payload) + ")\n"
        "assert len(_fd_records) == 27\n"
        "for _fd_i, _fd_v, _fd_actual in _fd_records:\n"
        "    _fd_x = [_fd_fractions.Fraction(x) for x in _fd_v]\n"
        "    if _fd_i < 9:\n"
        "        _fd_expected = (_fd_x[1]-_fd_x[0])/(2*_fd_x[2])\n"
        "    elif _fd_i < 18:\n"
        "        _fd_expected = (_fd_x[0]-2*_fd_x[1]+_fd_x[2])/(_fd_x[3]**2)\n"
        "    else:\n"
        "        _fd_expected = ((_fd_x[1]-2*_fd_x[0]+_fd_x[2])/(_fd_x[5]**2)"
        "+(_fd_x[3]-2*_fd_x[0]+_fd_x[4])/(_fd_x[6]**2))\n"
        "    assert _fd_math.isfinite(_fd_actual) and "
        "abs(_fd_actual-float(_fd_expected)) < 1e-10, 'fd oracle mismatch'\n"
        "print('finite-difference-interoperability-oracle-ok')\n"
        "del _fd_records, _fd_i, _fd_v, _fd_actual, _fd_x, _fd_expected\n"
        "del _fd_json, _fd_fractions, _fd_math\n"
    )
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def verify_fd_interop(request, headers: dict[str, str]) -> None:
    records = sampled_stencils()
    assert all(exact_stencil(i, v) == expected for i, v, expected in records)
    source = r_source(records)
    status, body = request("POST", "/api/run/r", source, headers)
    assert status == 200, ("R stencil execution", status, body[-500:])
    assert len(body.encode("utf-8")) < MAX_FRAME_BYTES
    frames = [line.strip().split() for line in body.splitlines()
              if line.strip().startswith(MARKER + " ")]
    assert len(frames) == 27, ("R stencil count", len(frames), body[-500:])
    observed = []
    for index, fields in enumerate(frames):
        assert len(fields) == 3 and fields[0] == MARKER and int(fields[1]) == index
        value = float(fields[2])
        assert math.isfinite(value) and abs(value - float(records[index][2])) < 1e-10
        observed.append(value)
    source = python_source(records, observed)
    status, body = request("POST", "/api/run/python", source, headers)
    assert status == 200 and "finite-difference-interoperability-oracle-ok" in body, (
        "Python exact rational stencil oracle", status, body[-500:])
    status, body = request("POST", "/api/run/python",
                           python_source(records, observed, sabotage=True), headers)
    assert status == 422 and "fd oracle mismatch" in body, (
        "Python corruption rejection", status, body[-500:])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(flowstudio_fd_count == 27L); cat('fd-r-recovered\\n')",
                           headers)
    assert status == 200 and "fd-r-recovered" in body, ("R recovery", status, body[-500:])
    status, body = request("POST", "/api/run/python", source, headers)
    assert status == 200 and "finite-difference-interoperability-oracle-ok" in body, (
        "Python recovery", status, body[-500:])
    print("PASS: 27 native Flow SI finite differences independently checked "
          "through real persistent R and Python HTTP; corruption HTTP 422")
