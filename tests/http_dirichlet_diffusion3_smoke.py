#!/usr/bin/env python3
"""Real native Flow compiler/HTTP acceptance for 3D zero-Dirichlet boundaries."""
from pathlib import Path

from http_smoke import request, compact_native_math_identifiers
from http_finite_difference_smoke import bundled_source
from test_dirichlet_diffusion3 import CASES, inject

MAX_SOURCE_BYTES = 128 * 1024


def verify_dirichlet_diffusion3():
    root = Path(__file__).resolve().parents[1]
    base = bundled_source(root, "src/math_flux_divergence_smoke.flow")
    headers = {"X-FlowStudio-Intent": "run"}
    for start in range(0, len(CASES), 3):
        source = compact_native_math_identifiers(
            inject(base, start, min(start + 3, len(CASES))))
        assert len(source.encode("utf-8")) <= MAX_SOURCE_BYTES, (
            "Dirichlet native source budget", start)
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("Dirichlet compile", start, status, body[-500:])
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-flux-divergence-ok" in body, (
            "Dirichlet execute", start, status, body[-500:])
    corrupted = compact_native_math_identifiers(inject(base, sabotage=True))
    assert len(corrupted.encode("utf-8")) <= MAX_SOURCE_BYTES
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("Dirichlet corrupted source compiles", status, body[-500:])
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("Dirichlet corrupted numerical result must fail", status, body[-500:])
    recovered = compact_native_math_identifiers(inject(base))
    status, body = request("POST", "/api/run/flow", recovered, headers)
    assert status == 200 and "native-math-flux-divergence-ok" in body, (
        "Dirichlet interpreter recovery", status, body[-500:])
    print(f"PASS: {len(CASES)} heterogeneous 3D Dirichlet fluxdiv3 native HTTP "
          "stencils, 25-state exact/matrix oracle, HTTP 422 and recovery")


if __name__ == "__main__":
    verify_dirichlet_diffusion3()
