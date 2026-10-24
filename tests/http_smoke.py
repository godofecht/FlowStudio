#!/usr/bin/env python3
"""End-to-end smoke tests for a RUNNING local FlowStudio process.

Start ./build/flowstudio first, then execute:
    python3 tests/http_smoke.py
No external Python dependencies.
"""
from __future__ import annotations

import json
import socket
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


def oversized_body_status() -> int:
    """Exercise header-level 413 without racing an early-close against sendall.

    The Flow transport rejects Content-Length above 128 KiB before reading
    the body. Sending the body as well can cause a TCP reset on macOS while
    urllib is still writing, even when the server correctly returned 413.
    """
    request_headers = (
        b"POST /api/run/python HTTP/1.1\r\n"
        b"Host: 127.0.0.1:8751\r\n"
        b"X-FlowStudio-Intent: run\r\n"
        b"Content-Length: 131073\r\n"
        b"Connection: close\r\n\r\n"
    )
    with socket.create_connection(("127.0.0.1", 8751), timeout=10) as connection:
        connection.sendall(request_headers)
        chunks = []
        while chunk := connection.recv(4096):
            chunks.append(chunk)
    response = b"".join(chunks)
    status_line = response.split(b"\r\n", 1)[0]
    assert status_line.startswith(b"HTTP/1.1 "), status_line
    return int(status_line.split()[1])


def main() -> None:
    status, body = request("GET", "/health")
    assert status == 200 and body == "FlowStudio ready", (status, body)

    status, html = request("GET", "/")
    assert status == 200 and "<title>FlowStudio" in html, (status, html[:100])

    # Native editor must fetch the same multiline-safe source-cell parser tested
    # by Node; a missing Flow static route silently breaks Run Cell.
    assert '<script src="/source_cells.js"></script>' in html
    status, source_cells = request("GET", "/source_cells.js")
    assert status == 200 and "function scanLine(line, state)" in source_cells, (status, source_cells[:100])

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
    status, search_engine = request("GET", "/app/editor_find.js")
    assert status == 200 and "FlowStudioEditorFind" in search_engine, (status, search_engine[:100])
    status, search_panel = request("GET", "/app/find_panel.js")
    assert status == 200 and "FlowStudioFindPanel" in search_panel, (status, search_panel[:100])
    assert 'id="findQuery"' in browser and 'id="replaceAll"' in browser
    status, transfer_script = request("GET", "/app/variable_transfer.js")
    assert status == 200 and "FlowStudioVariableTransfer" in transfer_script, (status, transfer_script[:100])
    assert 'id="transferVariable"' in browser and 'id="transferDirection"' in browser
    status, _ = request("GET", "/app/not-a-real-asset.js")
    assert status == 404, status

    accepted_headers = {"X-FlowStudio-Intent": "run"}
    status, _ = request(
        "POST", "/api/run/python", 'print("bad")',
        {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"},
    )
    assert status == 404, status

    assert oversized_body_status() == 413

    status, output = request(
        "POST", "/api/run/python", 'print("flowstudio-python-ok")',
        accepted_headers,
    )
    assert status == 200 and "flowstudio-python-ok" in output, (status, output)

    # Flow itself orchestrates both persistent language kernels in one request.
    if shutil.which("Rscript"):
        status, mixed = request("POST", "/api/demo/python-r", "", accepted_headers)
        assert status == 200, (status, mixed)
        assert "Python sum = 15" in mixed, mixed
        assert "R sqrt(sum) = " in mixed, mixed
        r_value = float(mixed.split("R sqrt(sum) = ", 1)[1].strip())
        assert abs(r_value - (15 ** 0.5)) < 0.0001, mixed

    # Native Flow-owned Python trace executes in the persistent CPython kernel.
    status, _ = request("POST", "/api/trace/python", "print('blocked')")
    assert status == 404, status
    status, trace_js = request("GET", "/app/python_trace_view.js")
    assert status == 200 and "FlowStudioPythonTraceView" in trace_js, status
    status, traced = request(
        "POST", "/api/trace/python",
        "native_trace_variable = 40\nprint(native_trace_variable + 2)",
        accepted_headers,
    )
    assert status == 200, (status, traced)
    trace_data = json.loads(traced)
    assert trace_data["ok"] and "42" in trace_data["output"], trace_data
    assert [entry["line"] for entry in trace_data["events"]] == [1, 2], trace_data
    status, output = request(
        "POST", "/api/run/python", "print(native_trace_variable)", accepted_headers,
    )
    assert status == 200 and output.strip() == "40", (status, output)
    status, traced = request(
        "POST", "/api/trace/python", "raise ValueError('trace error')",
        accepted_headers,
    )
    assert status == 422 and "trace error" in json.loads(traced)["output"], (status, traced)

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
    status, output = request("POST", "/api/run/python",
                             "flowstudio_nested = {'numbers': [1, 2, 3], 'meta': {'ok': True}}",
                             accepted_headers)
    assert status == 200, (status, output)
    status, snapshot = request("POST", "/api/inspect/python", "", accepted_headers)
    assert status == 200, (status, snapshot)
    nested = next(item for item in json.loads(snapshot)["variables"]
                  if item["name"] == "flowstudio_nested")
    assert nested["type"] == "dict" and nested["size"] == 2, nested
    assert nested["children"][0]["name"] == '["numbers"]', nested
    assert [item["type"] for item in nested["children"][0]["children"]] == [
        "int", "int", "int"], nested
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
        status, snapshot = request("POST", "/api/inspect/r", "", accepted_headers)
        assert status == 200, (status, snapshot)
        r_snapshot = json.loads(snapshot)
        r_variables = {item["name"]: item for item in r_snapshot["variables"]}
        assert r_variables["flowstudio_r_value"]["type"] == "double", r_variables
        assert r_variables["flowstudio_r_value"]["size"] == 1, r_variables
        status, output = request("POST", "/api/run/r",
                                 "flowstudio_matrix <- matrix(1:6, nrow=2)",
                                 accepted_headers)
        assert status == 200, (status, output)
        status, snapshot = request("POST", "/api/inspect/r", "", accepted_headers)
        assert status == 200, (status, snapshot)
        matrix_variables = {item["name"]: item for item in json.loads(snapshot)["variables"]}
        assert matrix_variables["flowstudio_matrix"]["dimensions"] == [2, 3], matrix_variables
        assert matrix_variables["flowstudio_r_value"]["dimensions"] is None, matrix_variables
        status, output = request("POST", "/api/run/r",
                                 'flowstudio_nested <- list(numbers=list(answer=42L), values=c(1,2))',
                                 accepted_headers)
        assert status == 200, (status, output)
        status, snapshot = request("POST", "/api/inspect/r", "", accepted_headers)
        assert status == 200, (status, snapshot)
        nested = {item["name"]: item for item in json.loads(snapshot)["variables"]}["flowstudio_nested"]
        assert nested["type"] == "list" and nested["size"] == 2, nested
        assert nested["children"][0]["name"] == "[[1]] numbers", nested
        assert nested["children"][0]["children"][0]["type"] == "integer", nested
        status, _ = request("POST", "/api/inspect/r", "")
        assert status == 404, status
        status, output = request("POST", "/api/run/r",
                                 'stop("expected native R error")', accepted_headers)
        assert status == 422 and "expected native R error" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 'cat(flowstudio_r_value, "\\n")', accepted_headers)
        assert status == 200 and output.strip() == "42", (status, output)
        status, output = request("POST", "/api/reset/r", "", accepted_headers)
        assert status == 200 and "reset" in output, (status, output)
        status, snapshot = request("POST", "/api/inspect/r", "", accepted_headers)
        assert status == 200 and json.loads(snapshot)["variables"] == [], (status, snapshot)
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
