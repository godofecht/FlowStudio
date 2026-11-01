"""Real Flow-owned HTTP acceptance for a 32x32 two-species Python/R PDE.

No mocked kernels, HTTP handlers, numerical outputs or plot devices. The
persistent Python runtime generates the initial field and checks R's output
against an independently derived two-mode Fourier solution.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = "FLOWSTUDIO_COUPLED_R_V1 "


def verify_coupled_interop(request, headers: dict[str, str]) -> None:
    python_source = (ROOT / "examples/coupled_interop_python.py").read_text(encoding="utf-8")
    r_source = (ROOT / "examples/coupled_interop_r.R").read_text(encoding="utf-8")
    status, body = request("POST", "/api/run/python", python_source, headers)
    assert status == 200, ("Python coupled initial field", status, body[:300])
    initial = json.loads(body)
    assert set(initial) == {"u", "v"}
    for field in initial.values():
        assert len(field) == 1024 and all(type(v) in (int, float) and math.isfinite(v)
                                          for v in field)

    assignment = "flowstudio_coupled_initial_u <- c(" + ",".join(
        format(value, ".17g") for value in initial["u"]) + ");\n" + (
        "flowstudio_coupled_initial_v <- c(" + ",".join(
            format(value, ".17g") for value in initial["v"]) + ")")
    assert len(assignment.encode("utf-8")) < 131072
    status, body = request("POST", "/api/run/r", assignment, headers)
    assert status == 200, ("R coupled field transfer", status, body[:300])
    status, body = request("POST", "/api/run/r", r_source, headers)
    assert status == 200, ("R coupled PDE integration", status, body[:500])
    frames = [line[len(MARKER):] for line in body.splitlines()
              if line.startswith(MARKER)]
    assert len(frames) == 1 and len(body) < 100000, ("bounded R PDE frame", body[:500])
    numbers = frames[0].split(",")
    assert len(numbers) == 2048, ("R coupled field count", len(numbers))
    values = [float(value) for value in numbers]
    assert all(math.isfinite(value) for value in values)
    result = {"u":values[:1024], "v":values[1024:]}

    def verify_python(frame):
        payload = json.dumps(frame, allow_nan=False, separators=(",", ":"))
        source = ("flowstudio_coupled_result = json.loads(" + repr(payload) + ")\n" +
                  "verify_result(flowstudio_coupled_result)\n" +
                  "print('coupled-python-oracle-ok')")
        assert len(source.encode("utf-8")) < 131072
        return request("POST", "/api/run/python", source, headers)

    status, body = verify_python(result)
    assert status == 200 and "coupled-python-oracle-ok" in body, (
        "Python independent coupled Fourier oracle", status, body[:500])

    # Four spatially separated corruptions must be detected in the real
    # persistent Python interpreter, not by a local-only assertion.
    for species, index in (("u", 0), ("u", 511), ("v", 512), ("v", 1023)):
        corrupt = {key:list(field) for key, field in result.items()}
        corrupt[species][index] += 0.1
        status, body = verify_python(corrupt)
        assert status == 422 and "coupled R Fourier mismatch" in body, (
            "coupled PDE corruption", species, index, status, body[:300])
    for invalid in ({"u":result["u"][:-1], "v":result["v"]},
                    {"u":[None, *result["u"][1:]], "v":result["v"]}):
        status, body = verify_python(invalid)
        assert status == 422 and "coupled R frame must contain" in body, (
            "coupled PDE malformed frame", status, body[:300])

    status, body = request("POST", "/api/plot/r", "", headers)
    assert status == 200, ("R coupled PDE real plot", status, body[:300])
    plot = json.loads(body)
    assert plot["warning"] is None
    if plot["svg"] is not None:
        assert "<svg" in plot["svg"] and "</svg>" in plot["svg"]
    else:
        assert plot["pdf"] is not None and bytes.fromhex(plot["pdf"]).startswith(b"%PDF")

    status, body = request("POST", "/api/run/r",
                           "cat(length(flowstudio_coupled_final_u), ' ', "
                           "length(flowstudio_coupled_final_v), '\\n')", headers)
    assert status == 200 and body.strip() == "1024 1024", (
        "persistent R coupled fields", status, body[:300])
    status, body = verify_python(result)
    assert status == 200 and "coupled-python-oracle-ok" in body, (
        "persistent Python recovery after rejection", status, body[:300])
