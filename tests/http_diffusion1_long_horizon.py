#!/usr/bin/env python3
"""Compile 20 exact-oracle 1D diffusion rates through production Flow HTTP."""
from pathlib import Path

from http_smoke import request, compact_native_math_identifiers
from http_finite_difference_smoke import bundled_source
from test_diffusion1_long_horizon import CASE_COUNT, inject_assertions
from http_diffusion1_long_horizon_interop import verify_long_horizon_interop


def verify_long_horizon() -> None:
    root = Path(__file__).resolve().parents[1]
    base = bundled_source(root, "src/math_diffusion1_smoke.flow")
    headers = {"X-FlowStudio-Intent": "run"}
    for start in range(0, CASE_COUNT, 3):
        source = compact_native_math_identifiers(inject_assertions(
            base, start=start, stop=min(start + 3, CASE_COUNT)))
        assert len(source.encode("utf-8")) <= 131072, (
            "long-horizon diffusion1 HTTP source budget", start)
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("long-horizon diffusion1 compile", start, status, body)
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-diffusion1-ok" in body, (
            "long-horizon diffusion1 execute", start, status, body)
    sabotaged = compact_native_math_identifiers(inject_assertions(base, sabotage=True))
    assert len(sabotaged.encode("utf-8")) <= 131072
    status, body = request("POST", "/api/check/flow", sabotaged, headers)
    assert status == 200, ("sabotaged long-horizon compiles", status, body)
    status, body = request("POST", "/api/run/flow", sabotaged, headers)
    assert status == 422, ("sabotaged long-horizon must fail", status, body)
    verify_long_horizon_interop(request, headers)
    print(f"PASS: {CASE_COUNT} exact 64-step-trajectory native diffusion1 "
          "HTTP rates and deliberate HTTP 422")


if __name__ == "__main__":
    verify_long_horizon()
