"""Real R/Python HTTP cross-check of native Flow median and unscaled MAD.

Native Flow independently executes these same 48 deterministic SI cases in
http_robust_statistics_smoke.py. This gate requires actual persistent R and
Python HTTP kernels, not a substitute evaluator.
"""
from __future__ import annotations

from fractions import Fraction
import json
import math
import re
import statistics

from robust_statistics_oracle import robust_cases

MARKER = "FLOWSTUDIO_ROBUST_R_V1 "
MAX_SOURCE_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 12 * 1024
VALID_COUNT = 48


def _case_values(expression: str) -> tuple[str, tuple[int, ...]]:
    match = re.fullmatch(r"(median|mad)\((.+)\)", expression)
    if match is None:
        raise ValueError("unexpected robust-statistics expression")
    operation, arguments = match.groups()
    tokens = arguments.split(",")
    if not 1 <= len(tokens) <= 8:
        raise ValueError("invalid robust-statistics arity")
    values = []
    family = None
    for token in tokens:
        part = re.fullmatch(r"(-?\d+)(km|m|s)?", token)
        if part is None:
            raise ValueError("unsupported SI literal")
        number, unit = part.groups()
        dimension = "length" if unit in ("m", "km") else ("time" if unit == "s" else "")
        if family is not None and dimension != family:
            raise ValueError("mixed dimensions in valid case")
        family = dimension
        values.append(int(number) * (1000 if unit == "km" else 1))
    return operation, tuple(values)


def _valid_cases():
    cases = robust_cases()[:VALID_COUNT]
    if len(cases) != VALID_COUNT or any(kind != "valid" for kind, *_ in cases):
        raise ValueError("unexpected robust-statistics fixture shape")
    return cases


def _r_program(cases=None) -> str:
    cases = _valid_cases() if cases is None else cases
    lines = []
    for index, (_, expression, expected, _) in enumerate(cases):
        operation, values = _case_values(expression)
        vector = ",".join(str(value) for value in values)
        calculation = "median(x)" if operation == "median" else "mad(x, constant=1)"
        lines.extend((
            "local({",
            f"  x <- c({vector})",
            f"  actual <- {calculation}",
            f"  if (!is.finite(actual) || abs(actual - ({float(expected):.17g})) > 1e-9) "
            "stop('R robust-statistics mismatch')",
            f"  cat('{MARKER}{index},', sprintf('%.17g', actual), '\\n', sep='')",
            "})",
        ))
    lines.append(f"flowstudio_robust_r_count <- {len(cases)}L")
    source = "\n".join(lines)
    if len(source.encode("utf-8")) >= MAX_SOURCE_BYTES:
        raise ValueError("R robust-statistics source budget exceeded")
    return source


def _python_verifier(cases, observed, corrupt: bool = False) -> str:
    raw = [_case_values(expression) for _, expression, _, _ in cases]
    values = list(observed)
    if corrupt:
        values[0] += 0.5
    payload = json.dumps({"cases": raw, "observed": values},
                         allow_nan=False, separators=(",", ":"))
    if len(payload.encode("utf-8")) >= MAX_RESPONSE_BYTES:
        raise ValueError("robust-statistics payload budget exceeded")
    body = (
        "import fractions, json, math, statistics\n"
        "payload = json.loads(" + repr(payload) + ")\n"
        f"assert len(payload['cases']) == len(payload['observed']) == {VALID_COUNT}, 'robust frame invalid'\n"
        "for (operation, numbers), measured in zip(payload['cases'], payload['observed']):\n"
        "    assert 1 <= len(numbers) <= 8 and math.isfinite(measured), 'robust frame invalid'\n"
        "    samples = [fractions.Fraction(number) for number in numbers]\n"
        "    center = statistics.median(samples)\n"
        "    exact = center if operation == 'median' else statistics.median([abs(x-center) for x in samples])\n"
        "    assert abs(measured - float(exact)) < 1e-9, 'robust-statistics mismatch'\n"
        "print('robust-r-python-oracle-ok')\n"
    )
    source = ("def flowstudio_robust_check():\n" +
              "".join("    " + line for line in body.splitlines(keepends=True)) +
              "try:\n    flowstudio_robust_check()\nfinally:\n    del flowstudio_robust_check\n")
    if len(source.encode("utf-8")) >= MAX_SOURCE_BYTES:
        raise ValueError("Python robust-statistics source budget exceeded")
    return source


def verify_robust_interop(request, headers: dict[str, str]) -> None:
    cases = _valid_cases()
    source = _r_program(cases)
    status, body = request("POST", "/api/run/r", source, headers)
    assert status == 200, ("real R median/MAD", status, body[:500])
    assert len(body.encode("utf-8")) < MAX_RESPONSE_BYTES
    frames = [line[len(MARKER):] for line in body.splitlines()
              if line.startswith(MARKER)]
    assert len(frames) == VALID_COUNT, ("R robust frame count", len(frames))
    observed = []
    for index, (frame, (_, _, expected, _)) in enumerate(zip(frames, cases)):
        fields = frame.split(",")
        assert len(fields) == 2 and int(fields[0]) == index, ("R robust frame", frame)
        actual = float(fields[1])
        assert math.isfinite(actual) and abs(actual - float(expected)) < 1e-9, (
            "R exact rational mismatch", index, actual, expected)
        observed.append(actual)

    def run_python(values, corrupt=False):
        return request("POST", "/api/run/python",
                       _python_verifier(cases, values, corrupt=corrupt), headers)

    status, body = run_python(observed)
    assert status == 200 and "robust-r-python-oracle-ok" in body, (
        "real Python Fraction/statistics oracle", status, body[:500])
    status, body = run_python(observed, corrupt=True)
    assert status == 422 and "robust-statistics mismatch" in body, (
        "corrupted robust numerical result", status, body[:500])
    status, body = run_python(observed[:-1])
    assert status == 422 and "robust frame invalid" in body, (
        "truncated robust numerical frame", status, body[:500])
    status, body = request("POST", "/api/run/r",
                           f"stopifnot(flowstudio_robust_r_count == {VALID_COUNT}L); "
                           "cat('robust-r-persistent-ok\\n')", headers)
    assert status == 200 and "robust-r-persistent-ok" in body, (
        "R persistent robust state", status, body[:500])
    status, body = run_python(observed)
    assert status == 200 and "robust-r-python-oracle-ok" in body, (
        "Python recovery after rejected frame", status, body[:500])
    print("PASS: 48 seeded native Flow SI median/MAD cases cross-verified by "
          "real R constant=1 and persistent Python exact fractions; "
          "corruption/truncation HTTP 422 and recovery")
