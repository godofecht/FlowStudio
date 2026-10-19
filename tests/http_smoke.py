#!/usr/bin/env python3
"""End-to-end smoke tests for a RUNNING local FlowStudio process.

Start ./build/flowstudio first, then execute:
    python3 tests/http_smoke.py
No external Python dependencies.
"""
from __future__ import annotations

import shutil
import urllib.error
import urllib.request

ROOT = "http://127.0.0.1:8751"


def request(method: str, path: str, body: str | None = None,
            headers: dict[str, str] | None = None) -> tuple[int, str]:
    data = None if body is None else body.encode("utf-8")
    req = urllib.request.Request(
        ROOT + path, data=data, method=method, headers=headers or {}
    )
    try:
        with urllib.request.urlopen(req, timeout=80 if path == "/api/run/flow" else 25) as reply:
            return reply.status, reply.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def main() -> None:
    status, body = request("GET", "/health")
    assert status == 200 and body == "FlowStudio ready", (status, body)

    status, html = request("GET", "/")
    assert status == 200 and "<title>FlowStudio" in html, (status, html[:100])

    status, _ = request("POST", "/api/run/python", 'print("bad")')
    assert status == 404, status

    accepted_headers = {"X-FlowStudio-Intent": "run"}
    status, _ = request(
        "POST", "/api/run/python", 'print("bad")',
        {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"},
    )
    assert status == 404, status

    status, _ = request("POST", "/api/run/python", "x" * 131073,
                        accepted_headers)
    assert status == 413, status

    status, output = request(
        "POST", "/api/run/python", 'print("flowstudio-python-ok")',
        accepted_headers,
    )
    assert status == 200 and "flowstudio-python-ok" in output, (status, output)

    # State persists across HTTP requests, survives language exceptions, and resets.
    status, _ = request("POST", "/api/inspect/python", "")
    assert status == 404, status
    status, _ = request("POST", "/api/reset/python", "",
                        {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})
    assert status == 404, status

    status, output = request("POST", "/api/run/python", "flowstudio_counter = 41", accepted_headers)
    assert status == 200, (status, output)
    status, output = request("POST", "/api/run/python",
                             "flowstudio_counter += 1\nprint(flowstudio_counter)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, output = request("POST", "/api/inspect/python", "", accepted_headers)
    assert status == 200, (status, output)
    import json
    variables = json.loads(output)["variables"]
    assert any(v["name"] == "flowstudio_counter" and v["type"] == "int"
               for v in variables), variables
    status, output = request("POST", "/api/run/python", "raise ValueError('expected')", accepted_headers)
    assert status == 422 and "ValueError" in output, (status, output)
    status, output = request("POST", "/api/run/python", "print(flowstudio_counter)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, output = request("POST", "/api/reset/python", "", accepted_headers)
    assert status == 200, (status, output)
    status, output = request("POST", "/api/run/python", "print(flowstudio_counter)", accepted_headers)
    assert status == 422 and "NameError" in output, (status, output)
    status, output = request("POST", "/api/inspect/python", "", accepted_headers)
    assert status == 200 and not any(v["name"] == "flowstudio_counter"
                                     for v in json.loads(output)["variables"]), (status, output)

    # The persistent kernel has a stricter source limit than the HTTP transport.
    status, output = request("POST", "/api/run/python", "x" * 65537, accepted_headers)
    assert status == 413 and "64 KiB" in output, (status, output)
    status, output = request("POST", "/api/run/python", "print(1234)", accepted_headers)
    assert status == 200 and output.strip() == "1234", (status, output)
    status, output = request("POST", "/api/run/python", "while True: pass", accepted_headers)
    assert status == 504 and "timed out" in output, (status, output)
    status, output = request("POST", "/api/run/python", "print(5678)", accepted_headers)
    assert status == 200 and output.strip() == "5678", (status, output)

    if shutil.which("R"):
        status, output = request("POST", "/api/run/r", "flowstudio_counter <- 41", accepted_headers)
        assert status == 200, (status, output)
        status, output = request("POST", "/api/run/r", "flowstudio_counter + 1", accepted_headers)
        assert status == 200 and "42" in output, (status, output)
        status, output = request("POST", "/api/inspect/r", "", accepted_headers)
        assert status == 200 and any(v["name"] == "flowstudio_counter"
                                     for v in json.loads(output)["variables"]), (status, output)
        status, output = request("POST", "/api/reset/r", "", accepted_headers)
        assert status == 200, (status, output)
        status, output = request("POST", "/api/run/r", "flowstudio_counter", accepted_headers)
        assert status == 422, (status, output)

    if shutil.which("R"):
        status, output = request("POST", "/api/run/r",
                                 'cat("flowstudio-r-ok\\n")',
                                 accepted_headers)
        assert status == 200 and "flowstudio-r-ok" in output, (status, output)
    else:
        print("SKIP R interpreter: not installed")

    if shutil.which("flow"):
        code = 'function main() -> i32 {\n    println("flowstudio-flow-ok")\n    return 0\n}\n'
        status, output = request("POST", "/api/run/flow",
                                 code, accepted_headers)
        assert status == 200 and "flowstudio-flow-ok" in output, (status, output)
    else:
        print("SKIP Flow subprocess: executable not on PATH")

    print("PASS: localhost HTTP, editor, intent controls, limits, runtimes")


if __name__ == "__main__":
    main()
