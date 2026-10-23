#!/usr/bin/env python3
"""End-to-end smoke tests for a RUNNING local FlowStudio process.

Start ./build/flowstudio first, then execute:
    python3 tests/http_smoke.py
No external Python dependencies.
"""
from __future__ import annotations

import json
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
        with urllib.request.urlopen(req, timeout=80 if path in ("/api/run/flow", "/api/check/flow") else 25) as reply:
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
    status, _ = request("POST", "/api/check/flow", "function main() -> i32 { return 0 }")
    assert status == 404, status

    status, browser = request("GET", "/app/")
    assert status == 200 and "FlowStudioNativeFlow.run(code)" in browser, (status, browser[:100])
    status, client = request("GET", "/app/native_flow.js")
    assert status == 200 and '"/api/run/flow"' in client, (status, client[:100])
    status, recovery_script = request("GET", "/app/notebook_recovery.js")
    assert status == 200 and "FlowStudioNotebookRecovery" in recovery_script, (status, recovery_script[:100])
    status, _ = request("GET", "/app/not-a-real-asset.js")
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

    # A single Python kernel retains variables between HTTP requests.
    status, output = request("POST", "/api/run/python",
                             "flowstudio_persistent = 40 + 2", accepted_headers)
    assert status == 200, (status, output)
    status, output = request("POST", "/api/run/python",
                             "print(flowstudio_persistent)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, snapshot = request("POST", "/api/inspect/python", "", accepted_headers)
    assert status == 200, (status, snapshot)
    variables = {item["name"]: item for item in json.loads(snapshot)["variables"]}
    assert variables["flowstudio_persistent"]["type"] == "int", variables
    status, _ = request("POST", "/api/inspect/python", "")
    assert status == 404, status
    status, output = request("POST", "/api/run/python",
                             "raise ValueError('session-error')", accepted_headers)
    assert status == 422 and "ValueError: session-error" in output, (status, output)
    status, output = request("POST", "/api/run/python",
                             "print(flowstudio_persistent)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, output = request("POST", "/api/reset/python", "", accepted_headers)
    assert status == 200 and "reset" in output, (status, output)
    status, snapshot = request("POST", "/api/inspect/python", "", accepted_headers)
    assert status == 200, (status, snapshot)
    assert not any(item["name"] == "flowstudio_persistent"
                   for item in json.loads(snapshot)["variables"])
    status, output = request("POST", "/api/run/python",
                             "print('flowstudio_persistent' in globals())", accepted_headers)
    assert status == 200 and output.strip() == "False", (status, output)
    status, _ = request("POST", "/api/reset/python", "")
    assert status == 404, status

    if shutil.which("Rscript"):
        status, output = request("POST", "/api/run/r",
                                 'flowstudio_r_value <- 41; cat(flowstudio_r_value, "\\n")',
                                 accepted_headers)
        assert status == 200 and output.strip() == "41", (status, output)
        status, output = request("POST", "/api/run/r",
                                 'flowstudio_r_value <- flowstudio_r_value + 1; cat(flowstudio_r_value, "\\n")',
                                 accepted_headers)
        assert status == 200 and output.strip() == "42", (status, output)
        status, output = request("POST", "/api/run/r",
                                 'stop("expected native R error")', accepted_headers)
        assert status == 422 and "expected native R error" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 'cat(flowstudio_r_value, "\\n")', accepted_headers)
        assert status == 200 and output.strip() == "42", (status, output)
        status, output = request("POST", "/api/reset/r", "", accepted_headers)
        assert status == 200 and "reset" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 'cat(exists("flowstudio_r_value", inherits=FALSE), "\\n")',
                                 accepted_headers)
        assert status == 200 and output.strip() == "FALSE", (status, output)
        status, _ = request("POST", "/api/reset/r", "")
        assert status == 404, status
    else:
        print("SKIP native R persistence: Rscript is not installed")

    if shutil.which("flow"):
        code = 'function main() -> i32 {\n    println("flowstudio-flow-ok")\n    return 0\n}\n'
        status, output = request("POST", "/api/run/flow",
                                 code, accepted_headers)
        assert status == 200 and "flowstudio-flow-ok" in output, (status, output)

        # Strict Flow-to-C compilation must never execute the submitted program.
        check_source = ('function main() -> i32 {\n'
                        '    println("THIS-MUST-NOT-EXECUTE")\n'
                        '    return 0\n}\n')
        status, output = request("POST", "/api/check/flow",
                                 check_source, accepted_headers)
        assert status == 200 and "THIS-MUST-NOT-EXECUTE" not in output, (status, output)
        status, output = request("POST", "/api/check/flow",
                                 "function main( -> i32 {", accepted_headers)
        assert status == 422 and output.strip(), (status, output)
    else:
        print("SKIP Flow subprocess: executable not on PATH")

    print("PASS: localhost HTTP, editor, intent controls, limits, runtimes")


if __name__ == "__main__":
    main()
