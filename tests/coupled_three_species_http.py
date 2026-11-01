"""Production Flow HTTP acceptance for three anisotropic, directed-coupled R fields."""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = "FLOWSTUDIO_THREE_R_V1 "


def verify_three_species_interop(request, headers: dict[str, str]) -> None:
    python_source = (ROOT / "examples/coupled_three_species_python.py").read_text(encoding="utf-8")
    r_source = (ROOT / "examples/coupled_three_species_r.R").read_text(encoding="utf-8")
    status, body = request("POST", "/api/run/python", python_source, headers)
    assert status == 200, ("three-species Python seed", status, body[:300])
    initial = json.loads(body)
    assert set(initial) == {"a", "b", "c"}
    assert all(len(f) == 1024 and all(type(v) in (float, int) and math.isfinite(v)
                                      for v in f) for f in initial.values())

    assignment = ";\n".join(
        "flowstudio_three_initial_" + name + " <- c(" +
        ",".join(format(value, ".17g") for value in initial[name]) + ")"
        for name in ("a", "b", "c")
    )
    assert len(assignment.encode("utf-8")) < 131072
    status, body = request("POST", "/api/run/r", assignment, headers)
    assert status == 200, ("three-species Python to R transfer", status, body[:300])
    status, body = request("POST", "/api/run/r", r_source, headers)
    assert status == 200, ("three-species R anisotropic midpoint", status, body[:500])
    frames = [line[len(MARKER):] for line in body.splitlines()
              if line.startswith(MARKER)]
    assert len(frames) == 1 and len(body) < 100000, ("three-species bounded R frame", body[:300])
    numbers = frames[0].split(",")
    assert len(numbers) == 3072, ("three-species R cell count", len(numbers))
    values = [float(value) for value in numbers]
    assert all(math.isfinite(value) for value in values)
    result = {name: values[i * 1024:(i + 1) * 1024]
              for i, name in enumerate(("a", "b", "c"))}

    def verify_python(frame):
        payload = json.dumps(frame, allow_nan=False, separators=(",", ":"))
        source = (
            "flowstudio_three_result = json.loads(" + repr(payload) + ")\n"
            "verify_result(flowstudio_three_result)\n"
            "print('three-species-anisotropic-oracle-ok')"
        )
        assert len(source.encode("utf-8")) < 131072
        return request("POST", "/api/run/python", source, headers)

    status, body = verify_python(result)
    assert status == 200 and "three-species-anisotropic-oracle-ok" in body, (
        "three-species independent Python stencil", status, body[:500])
    for species, index in (("a", 0), ("b", 511), ("c", 1023)):
        corrupted = {name: f[:] for name, f in result.items()}
        corrupted[species][index] += 0.1
        status, body = verify_python(corrupted)
        assert status == 422 and "anisotropic stencil mismatch" in body, (
            "three-species corruption", species, index, status, body[:300])
    for malformed in ({**result, "a": result["a"][:-1]},
                      {**result, "c": [None, *result["c"][1:]]}):
        status, body = verify_python(malformed)
        assert status == 422 and "three-species frame requires" in body, (
            "three-species malformed frame", status, body[:300])

    status, body = request("POST", "/api/plot/r", "", headers)
    assert status == 200, ("three-species actual R graphics", status, body[:300])
    plot = json.loads(body)
    assert plot["warning"] is None
    if plot["svg"] is not None:
        assert "<svg" in plot["svg"] and "</svg>" in plot["svg"]
    else:
        assert plot["pdf"] is not None and bytes.fromhex(plot["pdf"]).startswith(b"%PDF")

    status, body = request(
        "POST", "/api/run/r",
        "cat(length(flowstudio_three_final_a), length(flowstudio_three_final_b), "
        "length(flowstudio_three_final_c), '\\n')", headers
    )
    assert status == 200 and body.split() == ["1024", "1024", "1024"], (
        "three-species persistent R state", status, body[:300])
    status, body = verify_python(result)
    assert status == 200 and "three-species-anisotropic-oracle-ok" in body, (
        "three-species Python recovery after 422", status, body[:300])
