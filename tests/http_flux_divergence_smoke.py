#!/usr/bin/env python3
"""Qualify real native Flow fluxdiv1/2/3 via production check/run HTTP."""
from pathlib import Path

from http_smoke import request, compact_native_math_identifiers
from http_finite_difference_smoke import bundled_source


def verify_flux_divergence() -> None:
    root = Path(__file__).resolve().parents[1]
    base = bundled_source(root, "src/math_flux_divergence_smoke.flow")
    headers = {"X-FlowStudio-Intent": "run"}
    source = compact_native_math_identifiers(base)
    assert len(source.encode("utf-8")) <= 131072, "flux divergence HTTP source budget"
    status, body = request("POST", "/api/check/flow", source, headers)
    assert status == 200, ("flux divergence compilation", status, body[-500:])
    status, body = request("POST", "/api/run/flow", source, headers)
    assert status == 200 and "native-math-flux-divergence-ok" in body, (
        "flux divergence native execution", status, body[-500:])
    assert "near(result.result.value,2.0)" in base, "sabotage anchor changed"
    corrupted = compact_native_math_identifiers(
        base.replace("near(result.result.value,2.0)",
                     "near(result.result.value,999.0)", 1))
    assert len(corrupted.encode("utf-8")) <= 131072
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("flux divergence sabotage compilation", status, body[-500:])
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("flux divergence sabotage must fail", status, body[-500:])
    print("PASS: native SI fluxdiv1/2/3 HTTP compilation, execution and HTTP 422 sabotage")


if __name__ == "__main__":
    verify_flux_divergence()
