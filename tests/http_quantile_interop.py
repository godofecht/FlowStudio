"""Actual persistent R and Python HTTP kernels cross-check Flow Type-7 quantiles."""
from __future__ import annotations

import json
import math

from quantile_oracle import quantile_cases, VALID_COUNT, MAX_SOURCE_BYTES

MARKER = "FLOWSTUDIO_QUANTILE_R_V1 "
MAX_RESPONSE_BYTES = 12 * 1024


def _r_program(cases=None) -> str:
    cases = quantile_cases()[:VALID_COUNT] if cases is None else cases
    lines = []
    for index, (_, _, expected, _, probability, values) in enumerate(cases):
        vector = ",".join(str(v) for v in values)
        lines.extend((
            "local({",
            f"  x <- c({vector})",
            f"  actual <- as.numeric(stats::quantile(x, probs={float(probability):.17g}, type=7, names=FALSE))",
            f"  if (length(actual) != 1L || !is.finite(actual) || "
            f"abs(actual - ({float(expected):.17g})) > 1e-7) stop('R Type-7 quantile mismatch')",
            f"  cat('{MARKER}{index},', sprintf('%.17g', actual), '\\n', sep='')",
            "})",
        ))
    lines.append(f"flowstudio_quantile_r_count <- {len(cases)}L")
    result = "\n".join(lines)
    if len(result.encode("utf-8")) >= MAX_SOURCE_BYTES:
        raise ValueError("R quantile HTTP source budget exceeded")
    return result


def _python_verifier(cases, observed, *, corrupt=False) -> str:
    rows = [[str(probability), list(values)] for _, _, _, _, probability, values in cases]
    measurements = list(observed)
    if corrupt:
        measurements[0] += 1.0
    payload = json.dumps({"cases": rows, "observed": measurements},
                         allow_nan=False, separators=(",", ":"))
    if len(payload.encode("utf-8")) >= MAX_RESPONSE_BYTES:
        raise ValueError("quantile payload budget exceeded")
    body = (
        "import fractions, json, math\n"
        "payload = json.loads(" + repr(payload) + ")\n"
        f"assert len(payload['cases']) == len(payload['observed']) == {VALID_COUNT}, 'quantile frame invalid'\n"
        "for (p, values), measured in zip(payload['cases'], payload['observed']):\n"
        "    assert 2 <= len(values) <= 7 and math.isfinite(measured), 'quantile frame invalid'\n"
        "    ordered = sorted(fractions.Fraction(x) for x in values)\n"
        "    rank = fractions.Fraction(p) * (len(ordered) - 1)\n"
        "    lower = rank.numerator // rank.denominator\n"
        "    upper = min(lower + 1, len(ordered) - 1)\n"
        "    weight = rank - lower\n"
        "    exact = ordered[lower] * (1 - weight) + ordered[upper] * weight\n"
        "    assert abs(measured - float(exact)) < 1e-7, 'quantile numerical mismatch'\n"
        "print('quantile-r-python-oracle-ok')\n"
    )
    source = ("def flowstudio_quantile_check():\n" +
              "".join("    " + line for line in body.splitlines(keepends=True)) +
              "try:\n    flowstudio_quantile_check()\nfinally:\n    del flowstudio_quantile_check\n")
    if len(source.encode("utf-8")) >= MAX_SOURCE_BYTES:
        raise ValueError("Python quantile HTTP source budget exceeded")
    return source


def verify_quantile_interop(request, headers: dict[str, str]) -> None:
    cases = quantile_cases()[:VALID_COUNT]
    status, body = request("POST", "/api/run/r", _r_program(cases), headers)
    assert status == 200, ("real R Type-7 quantile", status, body[:500])
    assert len(body.encode("utf-8")) < MAX_RESPONSE_BYTES
    frames = [line[len(MARKER):] for line in body.splitlines()
              if line.startswith(MARKER)]
    assert len(frames) == VALID_COUNT, ("R quantile frame count", len(frames))
    observed = []
    for index, (frame, (_, _, expected, _, _, _)) in enumerate(zip(frames, cases)):
        fields = frame.split(",")
        assert len(fields) == 2 and int(fields[0]) == index, ("R quantile frame", frame)
        actual = float(fields[1])
        assert math.isfinite(actual) and abs(actual - float(expected)) < 1e-7, (
            "R quantile exact-rational mismatch", index, actual, expected)
        observed.append(actual)

    def run_python(values, *, corrupt=False):
        return request("POST", "/api/run/python",
                       _python_verifier(cases, values, corrupt=corrupt), headers)

    status, body = run_python(observed)
    assert status == 200 and "quantile-r-python-oracle-ok" in body, (
        "real Python Fraction quantile oracle", status, body[:500])
    status, body = run_python(observed, corrupt=True)
    assert status == 422 and "quantile numerical mismatch" in body, (
        "corrupted quantile value", status, body[:500])
    status, body = run_python(observed[:-1])
    assert status == 422 and "quantile frame invalid" in body, (
        "truncated quantile frame", status, body[:500])
    status, body = request("POST", "/api/run/r",
                           f"stopifnot(flowstudio_quantile_r_count == {VALID_COUNT}L); "
                           "cat('quantile-r-persistent-ok\\n')", headers)
    assert status == 200 and "quantile-r-persistent-ok" in body, (
        "R persistent quantile state", status, body[:500])
    status, body = run_python(observed)
    assert status == 200 and "quantile-r-python-oracle-ok" in body, (
        "Python recovery after rejected quantile", status, body[:500])
    print("PASS: 48 seeded native Flow Type-7 SI quantiles independently verified "
          "by persistent base R and Python Fractions; HTTP 422 corruption, "
          "truncation and recovery")
