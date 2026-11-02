#!/usr/bin/env python3
"""Verify heterogeneous 3D energy-dissipating fluxes through real Flow HTTP."""
from pathlib import Path

from http_smoke import request, compact_native_math_identifiers
from http_finite_difference_smoke import bundled_source
from test_flux_energy import CASES, inject


def verify_flux_energy() -> None:
    root = Path(__file__).resolve().parents[1]
    base = bundled_source(root, "src/math_flux_divergence_smoke.flow")
    headers = {"X-FlowStudio-Intent": "run"}
    for start in range(0, len(CASES), 3):
        source = compact_native_math_identifiers(
            inject(base, start, min(start + 3, len(CASES))))
        assert len(source.encode("utf-8")) <= 131072, ("energy HTTP budget", start)
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("energy compile", start, status, body[-500:])
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-flux-divergence-ok" in body, (
            "energy execute", start, status, body[-500:])
    corrupt = compact_native_math_identifiers(inject(base, sabotage=True))
    assert len(corrupt.encode("utf-8")) <= 131072, "energy sabotage budget"
    status, body = request("POST", "/api/check/flow", corrupt, headers)
    assert status == 200, ("energy sabotage compile", status, body[-500:])
    status, body = request("POST", "/api/run/flow", corrupt, headers)
    assert status == 422, ("energy sabotage must fail", status, body[-500:])
    print(f"PASS: {len(CASES)} heterogeneous 3D fluxdiv native HTTP cases, "
          "exact 27-cell energy/conservation oracle and HTTP 422 sabotage")


if __name__ == "__main__":
    verify_flux_energy()
