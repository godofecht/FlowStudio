#!/usr/bin/env python3
"""Qualify real native Flow fluxdiv1/2/3 via production check/run HTTP."""
from pathlib import Path

from http_smoke import request, compact_native_math_identifiers
from http_finite_difference_smoke import bundled_source
from test_flux_divergence_oracle import CASES, inject_oracle_assertions


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
    for start in range(0, len(CASES), 3):
        analytic = compact_native_math_identifiers(inject_oracle_assertions(
            base, start=start, stop=min(start + 3, len(CASES))))
        assert len(analytic.encode("utf-8")) <= 131072, ("oracle HTTP budget", start)
        status, body = request("POST", "/api/check/flow", analytic, headers)
        assert status == 200, ("oracle compile", start, status, body[-500:])
        status, body = request("POST", "/api/run/flow", analytic, headers)
        assert status == 200 and "native-math-flux-divergence-ok" in body, (
            "oracle execute", start, status, body[-500:])
    bad_oracle = compact_native_math_identifiers(inject_oracle_assertions(
        base, sabotage=True))
    assert len(bad_oracle.encode("utf-8")) <= 131072
    status, body = request("POST", "/api/check/flow", bad_oracle, headers)
    assert status == 200, ("oracle sabotage compiles", status, body[-500:])
    status, body = request("POST", "/api/run/flow", bad_oracle, headers)
    assert status == 422, ("oracle sabotage must fail", status, body[-500:])
    assert "near(result.result.value,2.0)" in base, "sabotage anchor changed"
    corrupted = compact_native_math_identifiers(
        base.replace("near(result.result.value,2.0)",
                     "near(result.result.value,999.0)", 1))
    assert len(corrupted.encode("utf-8")) <= 131072
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("flux divergence sabotage compilation", status, body[-500:])
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("flux divergence sabotage must fail", status, body[-500:])
    print(f"PASS: {len(CASES)} exact-rational fluxdiv1/2/3 native HTTP cases, "
          "28 smoke assertions, periodic conservation oracle and HTTP 422 sabotage")


if __name__ == "__main__":
    verify_flux_divergence()
