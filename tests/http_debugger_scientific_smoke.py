#!/usr/bin/env python3
"""Production Flow-owned HTTP: real CPython scientific debugger + base R oracle.

Requires a running FlowStudio on 127.0.0.1:8751, with R installed.
No fake server, mocked kernel, browser-only evaluator or network dependency.
"""
from __future__ import annotations

import json
import math
import urllib.error
import urllib.request

from debugger_scientific_fixture import (
    BREAKPOINT, HEAT_SOURCE, MAX_STEPS, N, THRESHOLD,
    expected_residual, expected_state, first_hit,
)

ROOT = "http://127.0.0.1:8751"
HEADERS = {"X-FlowStudio-Intent": "run"}
MAX_SOURCE_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 24 * 1024


def request(path: str, source: str) -> tuple[int, str]:
    payload = source.encode("utf-8")
    assert len(payload) <= MAX_SOURCE_BYTES, (path, len(payload))
    req = urllib.request.Request(
        ROOT + path, data=payload, headers=HEADERS, method="POST")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=25) as reply:
            raw = reply.read(MAX_RESPONSE_BYTES + 1)
            status = reply.status
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read(MAX_RESPONSE_BYTES + 1)
    assert len(raw) <= MAX_RESPONSE_BYTES, (path, "oversized HTTP response")
    return status, raw.decode("utf-8", "strict")


def main() -> None:
    assert N * MAX_STEPS == 12288
    assert len(HEAT_SOURCE.encode("utf-8")) < 4096
    iteration = first_hit()
    assert iteration == 160
    assert expected_residual(iteration - 1) > THRESHOLD
    assert expected_residual(iteration) <= THRESHOLD

    status, body = request("/api/debug/python/start", json.dumps({
        "source": HEAT_SOURCE, "breakpoints": [BREAKPOINT]}))
    paused = json.loads(body)
    assert status == 200 and paused["ok"] and paused["state"] == "paused", (status, body)
    frame = paused["stack"][0]
    assert frame["line"] == BREAKPOINT["line"], frame
    assert int(frame["locals"]["iteration"]["value"]) == iteration, frame
    actual_residual = float(frame["locals"]["residual"]["value"])
    assert math.isfinite(actual_residual)
    assert abs(actual_residual - expected_residual(iteration)) < 2e-12

    # The real kernel must reject concurrent normal execution while paused.
    status, body = request("/api/run/python", "print('should not run')")
    assert status == 422 and "debugger is active" in body, (status, body)

    status, body = request("/api/debug/python/continue", "")
    completed = json.loads(body)
    assert status == 200 and completed["ok"] and completed["state"] == "done", (status, body)
    assert completed["output"] == f"{iteration}\n", completed

    indices = (1, 16, 32, 48, 63)
    indices_python = ",".join(map(str, indices))
    status, body = request("/api/run/python",
                           f"print(*(field[i] for i in ({indices_python},)))")
    assert status == 200, (status, body)
    actual = [float(value) for value in body.split()]
    oracle = expected_state(iteration + 1)
    assert len(actual) == len(indices) and all(math.isfinite(x) for x in actual)
    assert max(abs(x - oracle[i]) for x, i in zip(actual, indices)) < 2e-12

    # Independently evaluate the same spectral solution through persistent
    # base R HTTP, not a Python emulation of R or a local R subprocess.
    r_source = (
        "fs_dbg_n <- 64L; fs_dbg_ratio <- 0.4; fs_dbg_steps <- 161L; "
        "fs_dbg_i <- c(1,16,32,48,63); "
        "fs_dbg_q1 <- 1 - 4*fs_dbg_ratio*sin(pi/(2*fs_dbg_n))^2; "
        "fs_dbg_q3 <- 1 - 4*fs_dbg_ratio*sin(3*pi/(2*fs_dbg_n))^2; "
        "fs_dbg_values <- fs_dbg_q1^fs_dbg_steps*sin(pi*fs_dbg_i/fs_dbg_n) + "
        "0.25*fs_dbg_q3^fs_dbg_steps*sin(3*pi*fs_dbg_i/fs_dbg_n); "
        "cat(paste(sprintf('%.17g', fs_dbg_values), collapse=' '))"
    )
    status, body = request("/api/run/r", r_source)
    assert status == 200, (status, body)
    r_values = [float(value) for value in body.split()]
    assert len(r_values) == len(indices) and all(math.isfinite(x) for x in r_values)
    assert max(abs(x - oracle[i]) for x, i in zip(r_values, indices)) < 2e-12
    assert max(abs(a - b) for a, b in zip(actual, r_values)) < 2e-12

    # Reject underflow, overflow and expression injection at the real HTTP
    # boundary. A rejected start must not poison the persistent kernel.
    for expression in (
        "residual<1e-9999", "residual>1e9999",
        "residual<1e-3 or True", "residual<1e-3*2",
    ):
        status, body = request("/api/debug/python/start", json.dumps({
            "source": "residual = 0.5\nprint(residual)\n",
            "breakpoints": [{"line": 2, "condition": expression}]}))
        rejected = json.loads(body)
        assert status == 422 and not rejected["ok"] and rejected["state"] == "idle", (
            expression, status, body)

    # CPython splitlines() excludes a phantom line after a terminal newline.
    # These negative cases exercise the real native HTTP debugger, not a mock.
    for source in ("terminal_line = 1\n", "terminal_line = 1\r\n"):
        status, body = request("/api/debug/python/start", json.dumps({
            "source": source, "breakpoints": [2]}))
        rejected = json.loads(body)
        assert status == 422 and not rejected["ok"] and rejected["state"] == "idle", (
            source, status, body)

    status, body = request("/api/run/python", "print(iteration)")
    assert status == 200 and body.strip() == str(iteration), (status, body)
    print("PASS: real CPython scientific breakpoint on 64-cell heat evolution, "
          "independent spectral oracle, persistent R/Python HTTP, negative 422 and recovery")


if __name__ == "__main__":
    main()
