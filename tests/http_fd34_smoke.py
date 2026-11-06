#!/usr/bin/env python3
"""Real native Flow HTTP compilation and execution of fd3/fd4 oracle cases."""
from pathlib import Path

from http_smoke import compact_native_math_identifiers
from http_finite_difference_smoke import request
from http_finite_difference_smoke import bundled_source
from test_fd34_oracle import CASE_COUNT, inject_analytic_assertions


def verify_fd34() -> None:
    root = Path(__file__).resolve().parents[1]
    base = compact_native_math_identifiers(
        bundled_source(root, "src/math_fd34_smoke.flow"))
    headers = {"X-FlowStudio-Intent": "run"}
    for start in range(0, CASE_COUNT, 3):
        source = inject_analytic_assertions(
            base, start=start, stop=min(start + 3, CASE_COUNT))
        assert len(source.encode("utf-8")) <= 131072, "fd3/fd4 HTTP source budget"
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("fd3/fd4 compile", start, status, body)
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-fd34-ok" in body, (
            "fd3/fd4 native execution", start, status, body)
    sabotaged = inject_analytic_assertions(base, sabotage=True)
    assert len(sabotaged.encode("utf-8")) <= 131072
    status, body = request("POST", "/api/check/flow", sabotaged, headers)
    assert status == 200, ("sabotaged fd3/fd4 compiles", status, body)
    status, body = request("POST", "/api/run/flow", sabotaged, headers)
    assert status == 422, ("sabotaged fd3/fd4 must fail", status, body)
    print(f"PASS: {CASE_COUNT} native fd3/fd4 exact-rational polynomial cases "
          "and deliberate HTTP 422")


if __name__ == "__main__":
    verify_fd34()
