#!/usr/bin/env python3
"""Run heterogeneous Neumann 2D flux stencils through production Flow HTTP."""
from pathlib import Path

from http_smoke import request, compact_native_math_identifiers
from http_finite_difference_smoke import bundled_source
from test_neumann_diffusion2 import CASES, inject


def verify_neumann_diffusion2() -> None:
    root = Path(__file__).resolve().parents[1]
    base = bundled_source(root, "src/math_flux_divergence_smoke.flow")
    headers = {"X-FlowStudio-Intent": "run"}
    for start in range(0, len(CASES), 3):
        source = compact_native_math_identifiers(
            inject(base, start, min(start + 3, len(CASES))))
        assert len(source.encode("utf-8")) <= 131072, ("Neumann source budget", start)
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("Neumann compile", start, status, body[-500:])
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-flux-divergence-ok" in body, (
            "Neumann execute", start, status, body[-500:])
    corrupted = compact_native_math_identifiers(inject(base, sabotage=True))
    assert len(corrupted.encode("utf-8")) <= 131072
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("Neumann corrupted compile", status, body[-500:])
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("Neumann corrupted execution must fail", status, body[-500:])
    # The persistent server must recover from a failed run.
    status, body = request("POST", "/api/run/flow",
                           compact_native_math_identifiers(inject(base)), headers)
    assert status == 200 and "native-math-flux-divergence-ok" in body, (
        "Neumann interpreter recovery", status, body[-500:])
    print(f"PASS: {len(CASES)} zero-flux Neumann 2D native HTTP cases, "
          "exact 33-state conservation/energy oracle, HTTP 422 and recovery")


if __name__ == "__main__":
    verify_neumann_diffusion2()
