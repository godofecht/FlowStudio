"""Independent persistent R/Python HTTP checks for native Flow SI dispersion.

The same 48 seeded expressions are executed separately by native Flow HTTP;
R computes standard library statistics and Python reconstructs exact moments.
"""
from __future__ import annotations

import json
import math
import re
from fractions import Fraction

from dispersion_oracle import dispersion_cases, VALID_CASES

MARKER = "FLOWSTUDIO_DISPERSION_R_V1"
MAX_SOURCE_BYTES = 128 * 1024
MAX_FRAME_BYTES = 24 * 1024


def valid_records() -> list[tuple[int, str, list[int], float]]:
    records = []
    for index, (kind, expression, expected, _) in enumerate(
        dispersion_cases()[:VALID_CASES]
    ):
        assert kind == "valid"
        match = re.fullmatch(r"(stddev|sample_variance|sample_stddev)\((.*)\)", expression)
        if match is None:
            raise ValueError("unexpected dispersion expression")
        operation, arguments = match.groups()
        values = []
        for token in arguments.split(","):
            part = re.fullmatch(r"(-?\d+)(km|m|s)?", token)
            if part is None:
                raise ValueError("unexpected SI sample")
            values.append(int(part[1]) * (1000 if part[2] == "km" else 1))
        assert 2 <= len(values) <= 8
        records.append((index, operation, values, expected))
    assert len(records) == VALID_CASES
    return records


def r_source(records: list[tuple[int, str, list[int], float]]) -> str:
    lines = []
    for index, operation, values, expected in records:
        vector = ",".join(str(value) for value in values)
        formula = {
            "stddev": "sqrt(mean((x-mean(x))^2))",
            "sample_variance": "var(x)",
            "sample_stddev": "sd(x)",
        }[operation]
        lines.extend((
            "local({",
            f"  x <- c({vector})",
            f"  actual <- {formula}",
            f"  stopifnot(is.finite(actual), abs(actual-({expected:.17g})) <= "
            f"1e-9*max(1,abs({expected:.17g})))",
            f"  cat('{MARKER}', {index}, sprintf('%.17g',actual), '\\n')",
            "})",
        ))
    lines.append(f"flowstudio_dispersion_count <- {len(records)}L")
    source = "\n".join(lines)
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def python_source(records: list[tuple[int, str, list[int], float]],
                  observed: list[float], *, sabotage: bool = False) -> str:
    assert len(records) == VALID_CASES and len(observed) == VALID_CASES
    data = [[index, operation, values, value]
            for (index, operation, values, _), value in zip(records, observed)]
    if sabotage:
        data[0][3] += 1.0 + abs(data[0][3]) * 0.1
    payload = json.dumps(data, separators=(",", ":"), allow_nan=False)
    assert len(payload.encode("utf-8")) < MAX_FRAME_BYTES
    source = (
        "import json as _disp_json, fractions as _disp_fraction, math as _disp_math\n"
        "_disp_rows = _disp_json.loads(" + repr(payload) + ")\n"
        "assert len(_disp_rows) == 48\n"
        "for _disp_index, _disp_op, _disp_values, _disp_actual in _disp_rows:\n"
        "    _disp_x = [_disp_fraction.Fraction(x) for x in _disp_values]\n"
        "    _disp_mean = sum(_disp_x, _disp_fraction.Fraction(0))/len(_disp_x)\n"
        "    _disp_denom = len(_disp_x) if _disp_op == 'stddev' else len(_disp_x)-1\n"
        "    _disp_var = sum(((x-_disp_mean)**2 for x in _disp_x), "
        "_disp_fraction.Fraction(0))/_disp_denom\n"
        "    _disp_expected = float(_disp_var) if _disp_op == 'sample_variance' "
        "else _disp_math.sqrt(float(_disp_var))\n"
        "    assert _disp_math.isfinite(_disp_actual) and "
        "abs(_disp_actual-_disp_expected) <= "
        "1e-9*max(1,abs(_disp_expected)), 'dispersion oracle mismatch'\n"
        "print('dispersion-interoperability-oracle-ok')\n"
        "del _disp_rows, _disp_index, _disp_op, _disp_values, _disp_actual\n"
        "del _disp_x, _disp_mean, _disp_denom, _disp_var, _disp_expected\n"
        "del _disp_json, _disp_fraction, _disp_math\n"
    )
    assert len(source.encode("utf-8")) < MAX_SOURCE_BYTES
    return source


def verify_dispersion_interop(request, headers: dict[str, str]) -> None:
    records = valid_records()
    status, body = request("POST", "/api/run/r", r_source(records), headers)
    assert status == 200, ("R dispersion execution", status, body[-500:])
    assert len(body.encode("utf-8")) < MAX_FRAME_BYTES
    frames = [line.strip().split() for line in body.splitlines()
              if line.strip().startswith(MARKER + " ")]
    assert len(frames) == VALID_CASES, ("R dispersion frame count", len(frames))
    observed = []
    for (index, _, _, expected), fields in zip(records, frames):
        assert len(fields) == 3 and fields[0] == MARKER and int(fields[1]) == index
        actual = float(fields[2])
        assert math.isfinite(actual) and abs(actual - expected) <= 1e-9 * max(1, abs(expected))
        observed.append(actual)
    oracle = python_source(records, observed)
    status, body = request("POST", "/api/run/python", oracle, headers)
    assert status == 200 and "dispersion-interoperability-oracle-ok" in body, (
        "Python exact dispersion oracle", status, body[-500:])
    status, body = request("POST", "/api/run/python",
                           python_source(records, observed, sabotage=True), headers)
    assert status == 422 and "dispersion oracle mismatch" in body, (
        "Python corrupted dispersion rejection", status, body[-500:])
    status, body = request("POST", "/api/run/r",
                           "stopifnot(flowstudio_dispersion_count == 48L); "
                           "cat('dispersion-r-recovered\\n')", headers)
    assert status == 200 and "dispersion-r-recovered" in body, (
        "R dispersion recovery", status, body[-500:])
    status, body = request("POST", "/api/run/python", oracle, headers)
    assert status == 200 and "dispersion-interoperability-oracle-ok" in body, (
        "Python dispersion recovery", status, body[-500:])
    print("PASS: 48 native Flow dispersion cases cross-verified through "
          "persistent base R and exact-rational Python HTTP; corruption HTTP 422")
