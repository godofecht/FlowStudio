"""Production Flow-owned HTTP acceptance for R -> Python numerical roundtrip.

The Rscript kernel performs a new anisotropic midpoint step on the 256-cell
field transferred from Python. Persistent CPython independently checks every
R-computed cell against the analytic periodic Fourier eigenmode at step 121.
No fake HTTP, interpreter, compiler or graphics runtime is used.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = "FLOWSTUDIO_R_TO_PYTHON_V1 "


def python_verification(values: list[float | None]) -> str:
    payload = json.dumps(values, allow_nan=False, separators=(",", ":"))
    return (
        "import json, math\n"
        "r_roundtrip = json.loads(" + repr(payload) + ")\n"
        "if len(r_roundtrip) != 256 or any(type(v) not in (int, float) "
        "or not math.isfinite(v) for v in r_roundtrip):\n"
        "    raise ValueError('r-to-python invalid frame')\n"
        "dt = DURATION / 120\n"
        "z = eigenvalue() * dt\n"
        "amplification = (1 + z + 0.5 * z * z) ** 121\n"
        "expected = [BASE + (v - BASE) * amplification for v in initial_field()]\n"
        "error = max(abs(a - b) for a, b in zip(r_roundtrip, expected))\n"
        "if error > 3e-10:\n"
        "    raise AssertionError('r-to-python spectral mismatch: ' + str(error))\n"
        "if abs(sum(r_roundtrip) / 256 - BASE) > 3e-10:\n"
        "    raise AssertionError('r-to-python mean mismatch')\n"
        "print('spectral-roundtrip-ok')\n"
    )


def verify_spectral_roundtrip(request, headers: dict[str, str]) -> None:
    r_source = (ROOT / "examples/spectral_roundtrip_r.R").read_text(encoding="utf-8")
    status, body = request("POST", "/api/run/r", r_source, headers)
    assert status == 200, ("R anisotropic midpoint execution", status, body[:500])
    frames = [line[len(MARKER):] for line in body.splitlines()
              if line.startswith(MARKER)]
    assert len(frames) == 1 and len(body) < 12000, ("R frame", body[:500])
    fields = frames[0].split(",")
    assert len(fields) == 256, ("R frame cell count", len(fields))
    values = [float(value) for value in fields]
    assert all(math.isfinite(value) and 293 <= value <= 307 for value in values)

    status, body = request("POST", "/api/run/python", python_verification(values), headers)
    assert status == 200 and "spectral-roundtrip-ok" in body, (
        "R to Python independent 256-cell Fourier oracle", status, body[:500])

    # Deterministic corruption at separated spatial locations must fail in
    # the real Python kernel without destroying either persistent session.
    for index in (0, 37, 128, 255):
        tampered = values[:]
        tampered[index] += 0.1
        status, body = request("POST", "/api/run/python",
                               python_verification(tampered), headers)
        assert status == 422 and "r-to-python spectral mismatch" in body, (
            "R to Python mutation rejection", index, status, body[:500])
    for malformed in (values[:-1], [None, *values[1:]]):
        status, body = request("POST", "/api/run/python",
                               python_verification(malformed), headers)
        assert status == 422 and "r-to-python invalid frame" in body, (
            "R to Python malformed frame rejection", status, body[:500])

    status, body = request("POST", "/api/run/r",
                           "cat(length(flowstudio_spectral_next), '\\n')", headers)
    assert status == 200 and body.strip() == "256", ("persistent R result", status, body)
    status, body = request("POST", "/api/run/python", python_verification(values), headers)
    assert status == 200 and "spectral-roundtrip-ok" in body, (
        "Python kernel recovery", status, body[:500])
