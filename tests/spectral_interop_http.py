"""Real Flow-owned HTTP acceptance: CPython -> Rscript -> native R graphics.

This module is invoked only by tests/http_smoke.py against a running native
FlowStudio server. No HTTP/router/runtime mocks or optional R skip here.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from spectral_roundtrip_http import verify_spectral_roundtrip
from coupled_interop_http import verify_coupled_interop
from coupled_three_species_http import verify_three_species_interop

ROOT = Path(__file__).resolve().parents[1]


def verify_spectral_interop(request, headers: dict[str, str]) -> None:
    python_source = (ROOT / "examples/spectral_interop_python.py").read_text(encoding="utf-8")
    r_source = (ROOT / "examples/spectral_interop_r.R").read_text(encoding="utf-8")

    # Source is executed by the real persistent CPython kernel through Flow's
    # HTTP route, not by a local Python subprocess or mock implementation.
    status, body = request("POST", "/api/run/python", python_source, headers)
    assert status == 200, ("Python spectral solver", status, body[:500])
    payload = json.loads(body)
    assert (payload["grid"], payload["mode_x"], payload["mode_y"], payload["steps"]) == (16, 2, 3, 120)
    values = payload["values"]
    assert isinstance(values, list) and len(values) == 256
    assert all(type(value) in (float, int) and math.isfinite(value) for value in values)

    # The cross-language transfer is explicit and validated. Only finite
    # numeric literals are constructed; no Python stdout is interpolated as R
    # source. The R session persists between the assignment and the analysis.
    assignment = "flowstudio_spectral_values <- c(" + ",".join(
        format(value, ".17g") for value in values) + ")"
    status, body = request("POST", "/api/run/r", assignment, headers)
    assert status == 200, ("R numeric transfer", status, body[:500])
    status, body = request("POST", "/api/run/r", r_source, headers)
    assert status == 200 and "spectral-r-ok" in body, ("R Fourier oracle", status, body[:500])

    # The R analysis must create a real graphic, retrievable through the
    # separate Flow-owned plot endpoint, rather than a textual plot placeholder.
    status, plot_body = request("POST", "/api/plot/r", "", headers)
    assert status == 200, ("R spectral plot", status, plot_body[:200])
    plot = json.loads(plot_body)
    assert plot["warning"] is None, plot
    if plot["svg"] is not None:
        assert "<svg" in plot["svg"] and "</svg>" in plot["svg"]
    else:
        assert plot["pdf"] is not None and bytes.fromhex(plot["pdf"]).startswith(b"%PDF")

    # Tamper with one transferred sample. The independent R oracle must
    # reject the field, return HTTP 422, and leave the interpreter usable.
    status, body = request("POST", "/api/run/r",
                           "flowstudio_spectral_values[1] <- flowstudio_spectral_values[1] + 0.1",
                           headers)
    assert status == 200, (status, body)
    status, body = request("POST", "/api/run/r", r_source, headers)
    assert status == 422 and "spectral mismatch" in body, ("R tamper rejection", status, body[:500])
    status, body = request("POST", "/api/run/r", assignment, headers)
    assert status == 200, ("R restore", status, body[:500])
    status, body = request("POST", "/api/run/r", r_source, headers)
    assert status == 200 and "spectral-r-ok" in body, ("R replay", status, body[:500])

    status, body = request("POST", "/api/inspect/r", "", headers)
    assert status == 200, ("R environment", status, body[:500])
    variables = {entry["name"]: entry for entry in json.loads(body)["variables"]}
    assert "flowstudio_spectral_values" in variables, variables
    assert variables["flowstudio_spectral_values"]["size"] == 256, variables

    # R independently advances the Python field, then persistent CPython
    # validates every returned cell against a step-121 Fourier oracle.
    verify_spectral_roundtrip(request, headers)

    # Independent 32x32 two-species R midpoint integration, real R plot and
    # complete 2,048-cell verification in the persistent Python kernel.
    verify_coupled_interop(request, headers)

    # Three anisotropic 32x32 fields, directed nonreversible exchange, true
    # R midpoint integration and complete 3,072-cell Python stencil oracle.
    verify_three_species_interop(request, headers)
