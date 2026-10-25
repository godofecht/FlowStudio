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
from pathlib import Path
import uuid
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
    status, session_script = request("GET", "/app/session_snapshot.js")
    assert status == 200 and "FlowStudioSessionSnapshot" in session_script, (status, session_script[:100])
    assert 'id="exportSession"' in browser and 'id="importSession"' in browser
    # The Pyodide environment helper must be available from the real Flow
    # static-asset allowlist, not only from GitHub Pages.
    status, capture_helper = request("GET", "/app/environment_capture.py")
    assert status == 200 and "def capture(namespace):" in capture_helper, (status, capture_helper[:100])
    status, _ = request("GET", "/app/not-a-real-asset.js")
    assert status == 404, status

    accepted_headers = {"X-FlowStudio-Intent": "run"}
    # Real Flow HTTP -> C IPC -> persistent Rscript top-level stepping.
    # No interpreter mocks: the native acceptance job installs actual R.
    for route in ("/api/debug/r/start", "/api/debug/r/step",
                  "/api/debug/r/stop", "/api/debug/r/status"):
        assert request("POST", route, "", {})[0] == 404
        assert request("POST", route, "",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
    status, body = request("POST", "/api/debug/r/start",
                           "fs_debug_http <- 41L\ncat(fs_debug_http + 1L)",
                           accepted_headers)
    assert status == 200, (status, body)
    debug = json.loads(body)
    assert debug["state"] == "paused" and debug["next_line"] == 1, debug
    assert request("POST", "/api/run/r", "fs_debug_http <- 999L",
                   accepted_headers)[0] == 422
    status, body = request("POST", "/api/debug/r/step", "", accepted_headers)
    assert status == 200 and json.loads(body)["next_line"] == 2, (status, body)
    status, body = request("POST", "/api/debug/r/step", "", accepted_headers)
    assert status == 200, (status, body)
    debug = json.loads(body)
    assert debug["state"] == "done" and debug["output"] == "42", debug
    status, body = request("POST", "/api/debug/r/stop", "", accepted_headers)
    assert status == 200 and json.loads(body)["state"] == "idle", (status, body)
    # Native Git reads and writes require the existing intent/origin gate.
    assert request("GET", "/api/git/status")[0] == 404
    for route in ("/api/git/status", "/api/git/diff", "/api/git/diff/staged",
                  "/api/git/stage", "/api/git/unstage", "/api/git/commit"):
        assert request("POST", route, "")[0] == 404
    assert request("POST", "/api/git/stage", "file.py",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    assert request("POST", "/api/git/commit", "message",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    assert request("POST", "/api/git/unstage", "file.py",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    assert request("POST", "/api/git/stage", ".", accepted_headers)[0] == 400
    assert request("POST", "/api/git/unstage", ".", accepted_headers)[0] == 400
    assert request("POST", "/api/git/unstage", "", accepted_headers)[0] == 400
    assert request("POST", "/api/git/commit", "", accepted_headers)[0] == 400
    assert request("POST", "/api/git/status", "",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    status, git_client = request("GET", "/app/git_panel.js")
    assert status == 200 and "FlowStudioGitPanel" in git_client
    assert 'id="gitRefresh"' in browser and 'id="gitDiff"' in browser
    assert 'id="gitStage"' in browser and 'id="gitUnstage"' in browser
    assert 'id="gitCommit"' in browser
    assert 'id="gitStagedDiff"' in browser
    if shutil.which("git"):
        probe = Path(__file__).resolve().parents[1] / ("flowstudio_git_probe_" + uuid.uuid4().hex + ".txt")
        try:
            probe.write_text("native Git status acceptance\\n", encoding="utf-8")
            git_code, git_text = request("POST", "/api/git/status", "", accepted_headers)
            assert git_code == 200 and probe.name in git_text, (git_code, git_text)
            diff_code, diff_text = request("POST", "/api/git/diff", "", accepted_headers)
            assert diff_code == 200 and "fatal:" not in diff_text, (diff_code, diff_text)
            staged_code, staged_text = request("POST", "/api/git/diff/staged", "", accepted_headers)
            assert staged_code == 200 and "fatal:" not in staged_text, (staged_code, staged_text)
        finally:
            probe.unlink(missing_ok=True)
    else:
        assert request("POST", "/api/git/status", "", accepted_headers)[0] == 503
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

    # Interactive source debugging is real CPython execution in the same
    # persistent kernel, with Flow-owned origin/intent-gated HTTP routes.
    status, debug_script = request("GET", "/app/python_debug_panel.js")
    assert status == 200 and "FlowStudioPythonDebugPanel" in debug_script
    assert 'id="pythonDebugStart"' in browser and 'id="pythonDebugStep"' in browser
    assert request("POST", "/api/debug/python/start", "{}")[0] == 404
    assert request("POST", "/api/debug/python/step", "",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404
    debug_source = "debug_value = 40\ndebug_value += 2\nprint(debug_value)\n"
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": debug_source, "breakpoints": [2]}),
                              accepted_headers)
    assert status == 200, (status, payload)
    paused = json.loads(payload)
    assert paused["state"] == "paused" and paused["stack"][0]["line"] == 2, paused
    assert paused["stack"][0]["locals"]["debug_value"]["value"] == "40", paused
    status, output = request("POST", "/api/run/python", "print('must not run')", accepted_headers)
    assert status == 422 and "debugger is active" in output, (status, output)
    status, payload = request("POST", "/api/debug/python/step", "", accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 3, (status, payload)
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "done", (status, payload)
    assert "42" in json.loads(payload)["output"], payload
    status, output = request("POST", "/api/run/python", "print(debug_value)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": "debug_stop = 1\ndebug_unreached = 2",
                                          "breakpoints": [2]}), accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "paused", (status, payload)
    status, payload = request("POST", "/api/debug/python/stop", "", accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "stopped", (status, payload)
    status, output = request("POST", "/api/run/python",
                             "print('debug_unreached' in globals())", accepted_headers)
    assert status == 200 and output.strip() == "False", (status, output)

    # Real CPython frame-depth stepping: next skips callees; finish exits them.
    depth_source = ("def depth_inner():\n    depth_local = 40\n    return depth_local\n"
                    "depth_result = depth_inner()\nprint(depth_result)\n")
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": depth_source, "breakpoints": [4]}),
                              accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 4, (status, payload)
    status, payload = request("POST", "/api/debug/python/next", "", accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 5, (status, payload)
    assert request("POST", "/api/debug/python/continue", "", accepted_headers)[0] == 200
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": depth_source, "breakpoints": [2]}),
                              accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 2, (status, payload)
    status, payload = request("POST", "/api/debug/python/finish", "", accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["line"] == 5, (status, payload)
    assert request("POST", "/api/debug/python/continue", "", accepted_headers)[0] == 200
    assert request("POST", "/api/debug/python/next", "")[0] == 404
    assert request("POST", "/api/debug/python/finish", "",
                   {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})[0] == 404

    # Conditional breakpoints run in real CPython through Flow's HTTP router.
    # They inspect exact numeric locals only, without evaluating expressions.
    conditional_source = ("for condition_i in range(5):\n"
                          "    condition_seen = condition_i\n"
                          "print(condition_seen)\n")
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": conditional_source,
                                          "breakpoints": [{"line": 2, "condition": "condition_i>=3"}]}),
                              accepted_headers)
    conditional = json.loads(payload)
    assert status == 200 and conditional["state"] == "paused", (status, payload)
    assert conditional["stack"][0]["locals"]["condition_i"]["value"] == "3", payload
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 200 and json.loads(payload)["stack"][0]["locals"]["condition_i"]["value"] == "4", (status, payload)
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "done", (status, payload)
    assert "4" in json.loads(payload)["output"], payload
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": "x = 1\n",
                                          "breakpoints": [{"line": 1, "condition": "__import__('os')"}]}),
                              accepted_headers)
    assert status == 422 and not json.loads(payload)["ok"], (status, payload)

    # Exception pause uses real CPython trace events through Flow's HTTP router.
    # Caught exceptions pause once at their origin, without evaluating repr/str.
    exception_source = ('try:\n    raise LookupError("caught")\n'
                        'except LookupError:\n    exception_recovered = 42\n')
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": exception_source,
                                          "breakpoints": [],
                                          "pause_on_exception": True}),
                              accepted_headers)
    exception_pause = json.loads(payload)
    assert status == 200 and exception_pause["state"] == "paused", (status, payload)
    assert exception_pause["exception"] == {"type": "LookupError", "line": 2}, payload
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 200 and json.loads(payload)["state"] == "done", (status, payload)
    assert json.loads(payload)["exception"] is None, payload
    status, output = request("POST", "/api/run/python",
                             "print(exception_recovered)", accepted_headers)
    assert status == 200 and output.strip() == "42", (status, output)
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": 'raise ValueError("uncaught")\n',
                                          "breakpoints": [],
                                          "pause_on_exception": True}),
                              accepted_headers)
    assert status == 200 and json.loads(payload)["exception"]["type"] == "ValueError", payload
    status, payload = request("POST", "/api/debug/python/continue", "", accepted_headers)
    assert status == 422 and json.loads(payload)["state"] == "done", (status, payload)
    assert "ValueError: uncaught" in json.loads(payload)["output"], payload
    status, payload = request("POST", "/api/debug/python/start",
                              json.dumps({"source": "pass", "breakpoints": [],
                                          "pause_on_exception": "true"}),
                              accepted_headers)
    assert status == 422 and not json.loads(payload)["ok"], (status, payload)

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
        status, _ = request("POST", "/api/check/r", "value <- 1")
        assert status == 404, status
        status, _ = request("POST", "/api/check/r", "value <- 1",
                            {"X-FlowStudio-Intent": "run", "Origin": "http://attacker.invalid"})
        assert status == 404, status
        status, output = request("POST", "/api/run/r",
                                 'flowstudio_r_value <- 41; cat(flowstudio_r_value, "\\n")',
                                 accepted_headers)
        assert status == 200 and output.strip() == "41", (status, output)
        status, output = request("POST", "/api/check/r",
                                 "flowstudio_r_value <- 999; stop('must not run')",
                                 accepted_headers)
        assert status == 200 and "not executed" in output, (status, output)
        status, output = request("POST", "/api/check/r", "flowstudio_r_value <- )",
                                 accepted_headers)
        assert status == 422 and "R syntax error:" in output and "<text>:" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 'cat(flowstudio_r_value, "\\n")', accepted_headers)
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
        # Native R table preview is a read-only IPC operation in the same session.
        assert request("POST", "/api/table/r", "flowstudio_matrix")[0] == 404
        assert request("POST", "/api/table/r", "flowstudio_matrix",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, table_json = request("POST", "/api/table/r", "flowstudio_matrix",
                                     accepted_headers)
        assert status == 200, (status, table_json)
        table = json.loads(table_json)
        assert table["columns"] == ["Column 1", "Column 2", "Column 3"], table
        assert table["rows"] == [["1", "3", "5"], ["2", "4", "6"]], table
        assert table["totalRows"] == 2 and not table["truncated"], table
        status, _ = request("POST", "/api/run/r",
                            "flowstudio_frame <- data.frame(x=c('a', 'b'), y=c(NA, 42))",
                            accepted_headers)
        assert status == 200, status
        status, table_json = request("POST", "/api/table/r", "flowstudio_frame",
                                     accepted_headers)
        assert status == 200, (status, table_json)
        frame = json.loads(table_json)
        assert frame["columns"] == ["x", "y"], frame
        assert frame["rows"] == [["a", ""], ["b", "42"]], frame
        status, error = request("POST", "/api/table/r",
                                "flowstudio_frame;stop('should not run')", accepted_headers)
        assert status == 422 and "Invalid R table name" in error, (status, error)
        # Read-only native R package inventory is served through Flow, never eval.
        assert request("POST", "/api/packages/r", "")[0] == 404
        assert request("POST", "/api/packages/r", "",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, package_json = request("POST", "/api/packages/r", "", accepted_headers)
        assert status == 200, (status, package_json[:120])
        inventory = json.loads(package_json)
        assert isinstance(inventory["packages"], list) and len(inventory["packages"]) <= 1000
        assert any(item["name"] == "stats" for item in inventory["packages"]), inventory
        assert isinstance(inventory["truncated"], bool)
        # Attach an installed R package through the same Flow-owned session.
        assert request("POST", "/api/packages/r/load", "splines")[0] == 404
        assert request("POST", "/api/packages/r/load", "splines",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/packages/r/load", "splines", accepted_headers)
        assert status == 200 and "Loaded installed R package splines" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 "cat('package:splines' %in% search())", accepted_headers)
        assert status == 200 and output.strip() == "TRUE", (status, output)
        status, output = request("POST", "/api/packages/r/load",
                                 "splines;stop('unsafe')", accepted_headers)
        assert status == 422 and "Invalid R package name" in output, (status, output)
        status, output = request("POST", "/api/packages/r/load",
                                 "FlowStudioPackageDefinitelyMissing", accepted_headers)
        assert status == 422 and "there is no package" in output, (status, output)
        # Native CRAN install is explicit and origin/intent gated. Test a
        # preinstalled base package so CI never requires network access.
        assert request("POST", "/api/packages/r/install", "stats")[0] == 404
        assert request("POST", "/api/packages/r/install", "stats",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/packages/r/install",
                                 "stats", accepted_headers)
        assert status == 200 and "already installed" in output, (status, output)
        status, output = request("POST", "/api/packages/r/install",
                                 "stats;stop('unsafe')", accepted_headers)
        assert status == 422 and "Invalid R package name" in output, (status, output)
        # Updates are explicit and cannot overwrite system libraries or execute
        # injected expressions. Public CRAN network access is not assumed in CI.
        assert request("POST", "/api/packages/r/update", "stats")[0] == 404
        assert request("POST", "/api/packages/r/update", "stats",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/packages/r/update", "stats", accepted_headers)
        assert status == 422 and "system packages cannot be updated" in output, (status, output)
        status, output = request("POST", "/api/packages/r/update",
                                 "stats;stop('unsafe')", accepted_headers)
        assert status == 422 and "Invalid R package name" in output, (status, output)
        # Removal cannot touch system libraries or evaluate arbitrary source.
        assert request("POST", "/api/packages/r/remove", "stats")[0] == 404
        assert request("POST", "/api/packages/r/remove", "stats",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/packages/r/remove",
                                 "stats", accepted_headers)
        assert status == 422 and "system packages cannot be removed" in output, (status, output)
        status, output = request("POST", "/api/packages/r/remove",
                                 "stats;stop('unsafe')", accepted_headers)
        assert status == 422 and "Invalid R package name" in output, (status, output)
        status, output = request("POST", "/api/run/r",
                                 "cat(flowstudio_r_value)", accepted_headers)
        assert status == 200 and output.strip() == "42", (status, output)
        # Real native R graphics are produced by the persistent Rscript
        # device, then retrieved through a separate Flow-owned JSON route.
        assert request("POST", "/api/plot/r", "")[0] == 404
        assert request("POST", "/api/plot/r", "",
                       {"X-FlowStudio-Intent": "run",
                        "Origin": "http://attacker.invalid"})[0] == 404
        status, output = request("POST", "/api/run/r",
                                 "plot(c(1, 2, 3))", accepted_headers)
        assert status == 200, (status, output)
        status, plot_json = request("POST", "/api/plot/r", "", accepted_headers)
        assert status == 200, (status, plot_json[:120])
        captured = json.loads(plot_json)
        assert captured["warning"] is None, captured
        if captured["svg"] is not None:
            assert "<svg" in captured["svg"] and "</svg>" in captured["svg"], captured
            assert captured["pdf"] is None, captured
        else:
            assert bytes.fromhex(captured["pdf"]).startswith(b"%PDF"), captured
        status, output = request("POST", "/api/run/r",
                                 "cat('text only\\n')", accepted_headers)
        assert status == 200, (status, output)
        status, plot_json = request("POST", "/api/plot/r", "", accepted_headers)
        assert status == 200 and json.loads(plot_json)["svg"] is None and json.loads(plot_json)["pdf"] is None, (status, plot_json)
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
