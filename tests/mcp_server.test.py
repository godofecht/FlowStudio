#!/usr/bin/env python3
"""Stdio contract tests for the FlowStudio MCP server.

These exercise the real JSON-RPC framing and the guarded forwarding to the
native HTTP API. The only server-dependent assertions run when FlowStudio
is already listening on 127.0.0.1:8751 (verify_native.py starts that);
everything else runs standalone in CI.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "mcp" / "flowstudio_mcp.py"

LEGAL_FLOW = (
    "function main() -> i32 {\n"
    "    let values: array<f64, 2> = [1.0, 2.0]\n"
    "    for i in 0 to 2 {\n"
    "        let scaled: f64 = values[i] * 2.0\n"
    "        print(\"scaled\", scaled)\n"
    "    }\n"
    "    return 0\n"
    "}\n"
)

READER_FLOW = (
    "function main() -> i32 {\n"
    "    for row in Reader { path: \"x\" } {\n"
    "        print(\"r\", row)\n"
    "    }\n"
    "    return 0\n"
    "}\n"
)


URL = os.environ.get("FLOWSTUDIO_URL", "http://127.0.0.1:8751").rstrip("/")


def server_is_up() -> bool:
    try:
        with urllib.request.urlopen(URL + "/health", timeout=3) as reply:
            return reply.status == 200
    except OSError:
        return False


class McpServerContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.proc = subprocess.Popen(
            [sys.executable, str(SERVER)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        try:
            cls.proc.stdin.close()
        except OSError:
            pass
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.proc.kill()

    def rpc(self, message: dict) -> dict:
        assert self.proc.stdin is not None
        assert self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        self.assertTrue(line, "MCP server closed stdout unexpectedly")
        return json.loads(line)

    def test_initialize_lists_capabilities_and_tools(self) -> None:
        reply = self.rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        info = reply["result"]["serverInfo"]
        self.assertEqual(info["name"], "flowstudio")
        self.assertTrue(reply["result"]["protocolVersion"])
        listed = self.rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        names = {tool["name"] for tool in listed["result"]["tools"]}
        self.assertLessEqual({
            "flowstudio_health", "flowstudio_run_code", "flowstudio_check_code",
            "flowstudio_read_workspace_file", "flowstudio_write_workspace_file",
            "flowstudio_flow_help",
        }, names)
        for tool in listed["result"]["tools"]:
            self.assertIn("inputSchema", tool)
            self.assertTrue(tool["description"].strip())

    def test_unknown_method_returns_jsonrpc_error(self) -> None:
        reply = self.rpc({"jsonrpc": "2.0", "id": 3, "method": "no/such", "params": {}})
        self.assertEqual(reply["error"]["code"], -32601)

    def test_unknown_tool_returns_jsonrpc_error(self) -> None:
        reply = self.rpc({
            "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": {"name": "no_such_tool", "arguments": {}},
        })
        self.assertEqual(reply["error"]["code"], -32602)

    def test_invalid_json_line_gets_parse_error_and_server_survives(self) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write("not json at all\n")
        self.proc.stdin.flush()
        error = json.loads(self.proc.stdout.readline())
        self.assertEqual(error["error"]["code"], -32700)
        reply = self.rpc({"jsonrpc": "2.0", "id": 5, "method": "ping", "params": {}})
        self.assertEqual(reply["id"], 5)

    def test_plain_buffer_with_headers_still_framed(self) -> None:
        body = json.dumps({"jsonrpc": "2.0", "id": 6, "method": "ping", "params": {}})
        framed = "Content-Length: %d\r\n\r\n%s" % (len(body), body)
        assert self.proc.stdin is not None
        self.proc.stdin.write(framed + "\n")
        self.proc.stdin.flush()
        reply = json.loads(self.proc.stdout.readline())
        self.assertEqual(reply["id"], 6)

    def test_refuses_absolute_escape_paths_without_touching_the_server(self) -> None:
        reply = self.rpc({
            "jsonrpc": "2.0", "id": 7, "method": "tools/call",
            "params": {"name": "flowstudio_read_workspace_file",
                       "arguments": {"path": "/etc/passwd"}},
        })
        self.assertTrue(reply["result"]["isError"])
        self.assertIn("Refused", reply["result"]["content"][0]["text"])

    @unittest.skipUnless(server_is_up(), "FlowStudio native server is not running")
    def test_run_code_runs_real_flow(self) -> None:
        reply = self.rpc({
            "jsonrpc": "2.0", "id": 8, "method": "tools/call",
            "params": {"name": "flowstudio_run_code",
                       "arguments": {"language": "flow", "code": LEGAL_FLOW}},
        })
        self.assertFalse(reply["result"].get("isError", False))
        self.assertIn("2.000000", reply["result"]["content"][0]["text"])

    @unittest.skipUnless(server_is_up(), "FlowStudio native server is not running")
    def test_run_code_surfaces_parse_errors_not_json_errors(self) -> None:
        reply = self.rpc({
            "jsonrpc": "2.0", "id": 9, "method": "tools/call",
            "params": {"name": "flowstudio_run_code",
                       "arguments": {"language": "flow", "code": READER_FLOW}},
        })
        self.assertTrue(reply["result"]["isError"])
        self.assertIn("parse error", reply["result"]["content"][0]["text"])

    @unittest.skipUnless(server_is_up(), "FlowStudio native server is not running")
    def test_flow_help_returns_real_reference_entry(self) -> None:
        reply = self.rpc({
            "jsonrpc": "2.0", "id": 10, "method": "tools/call",
            "params": {"name": "flowstudio_flow_help", "arguments": {"topic": "for"}},
        })
        self.assertFalse(reply["result"].get("isError", False))
        self.assertIn("for i in 0 to 10", reply["result"]["content"][0]["text"])

    @unittest.skipUnless(server_is_up(), "FlowStudio native server is not running")
    def test_check_code_says_plainly_that_it_passed(self) -> None:
        reply = self.rpc({"jsonrpc": "2.0", "id": 13, "method": "tools/call",
                          "params": {"name": "flowstudio_check_code", "arguments": {"language": "flow", "code": LEGAL_FLOW}}})
        self.assertFalse(reply["result"].get("isError", False))
        text = reply["result"]["content"][0]["text"]
        self.assertNotIn("ensure_flowc", text)
        self.assertIn("passed", text)

    def test_flow_guide_returns_the_verified_guide(self) -> None:
        reply = self.rpc({"jsonrpc": "2.0", "id": 11, "method": "tools/call",
                          "params": {"name": "flowstudio_flow_guide", "arguments": {}}})
        text = reply["result"]["content"][0]["text"]
        self.assertIn("# Flow for AI assistants", text)
        self.assertIn("import flowstudio", text)

    def test_propose_edit_validates_arguments(self) -> None:
        reply = self.rpc({"jsonrpc": "2.0", "id": 12, "method": "tools/call",
                          "params": {"name": "flowstudio_propose_edit",
                                     "arguments": {"file": "a.flow", "content": "x", "mode": "delete"}}})
        self.assertTrue(reply["result"]["isError"])


def post(path: str, body: str = "") -> tuple[int, str]:
    request = urllib.request.Request(URL + path, data=body.encode("utf-8"), method="POST",
                                     headers={"X-FlowStudio-Intent": "run", "Origin": URL})
    with urllib.request.urlopen(request, timeout=30) as reply:
        return reply.status, reply.read().decode("utf-8")


def start_mcp(**env: str) -> subprocess.Popen:
    merged = dict(os.environ)
    merged.update(env)
    return subprocess.Popen([sys.executable, str(SERVER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env=merged)


def call(proc: subprocess.Popen, name: str, arguments: dict, method: str = "tools/call") -> dict:
    params = {"name": name, "arguments": arguments} if method == "tools/call" else {}
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}) + "\n")
    proc.stdin.flush()
    return json.loads(proc.stdout.readline())


def stop(proc: subprocess.Popen) -> None:
    proc.stdin.close()
    proc.wait(timeout=10)
    proc.stdout.close()
    proc.stderr.close()


class AssistantMode(unittest.TestCase):
    """FlowStudio's assistant starts the server with FLOWSTUDIO_MCP_MODE=assistant."""

    def test_assistant_mode_hides_writes_and_runs_when_not_allowed(self) -> None:
        proc = start_mcp(FLOWSTUDIO_MCP_MODE="assistant", FLOWSTUDIO_MCP_RUN="none")
        try:
            names = {tool["name"] for tool in call(proc, "", {}, "tools/list")["result"]["tools"]}
            self.assertNotIn("flowstudio_write_workspace_file", names)
            self.assertNotIn("flowstudio_run_code", names)
            self.assertIn("flowstudio_editor_state", names)
            self.assertIn("flowstudio_propose_edit", names)
            refused = call(proc, "flowstudio_write_workspace_file", {"path": "x.txt", "content": "x"})
            self.assertEqual(refused["error"]["code"], -32602, "a hidden tool cannot be called")
        finally:
            stop(proc)

    def test_assistant_runs_are_flow_only_and_never_graphics(self) -> None:
        proc = start_mcp(FLOWSTUDIO_MCP_MODE="assistant", FLOWSTUDIO_MCP_RUN="flow")
        try:
            python = call(proc, "flowstudio_run_code", {"language": "python", "code": "print(1)"})
            self.assertTrue(python["result"]["isError"])
            self.assertIn("Flow only", python["result"]["content"][0]["text"])
            gfx = call(proc, "flowstudio_run_code", {"language": "flow", "code": 'import "stdlib/gfx.flow"\n'})
            self.assertTrue(gfx["result"]["isError"])
            self.assertIn("window", gfx["result"]["content"][0]["text"])
        finally:
            stop(proc)


# These write the server's editor snapshot and proposal queue, which a
# browser on that server would show, so they run only against a server named
# explicitly in FLOWSTUDIO_URL.
@unittest.skipUnless("FLOWSTUDIO_URL" in os.environ and server_is_up(), "set FLOWSTUDIO_URL to a test server")
class EditorStateAndProposals(unittest.TestCase):
    SNAPSHOT = {
        "active": {"name": "app.flow", "path": "demo/app.flow", "language": "flow", "dirty": True,
                   "text": "function main() -> i32 {\n    return 0\n}\n"},
        "cursor": {"line": 2, "column": 5},
        "selection": {"text": "return 0", "startLine": 2, "endLine": 2},
        "openFiles": [{"name": "app.flow", "path": "demo/app.flow", "language": "flow", "active": True},
                      {"name": "notes.py", "path": "demo/notes.py", "language": "python", "text": "x = 1\n"}],
        "diagnostics": [{"line": 2, "column": 5, "message": "Undefined variable 'total'"}],
        "console": "> run app.flow\nhello\n",
        "proposals": [{"id": 3, "file": "demo/app.flow", "status": "accepted"}],
    }

    def setUp(self) -> None:
        self.assertEqual(post("/api/assistant/context", json.dumps(self.SNAPSHOT))[0], 200)
        post("/api/assistant/proposals")
        self.proc = start_mcp()

    def tearDown(self) -> None:
        stop(self.proc)
        post("/api/assistant/proposals")

    def test_editor_state_reports_what_the_user_sees(self) -> None:
        text = call(self.proc, "flowstudio_editor_state", {"include_other_files": True})["result"]["content"][0]["text"]
        self.assertIn("Active file: demo/app.flow (flow, unsaved changes)", text)
        self.assertIn("Cursor: line 2, column 5", text)
        self.assertIn("Selection: lines 2 to 2", text)
        self.assertIn("    return 0", text)
        self.assertIn("Other open files: demo/notes.py", text)
        self.assertIn("x = 1", text)
        self.assertIn("line 2, column 5: Undefined variable 'total'", text)
        self.assertIn("hello", text)
        self.assertIn("#3 demo/app.flow accepted", text)

    def test_propose_edit_queues_a_proposal_for_the_browser(self) -> None:
        reply = call(self.proc, "flowstudio_propose_edit",
                     {"file": "demo/app.flow", "content": "# new\n", "mode": "insert", "line": 1,
                      "summary": "Add a comment"})
        self.assertFalse(reply["result"].get("isError", False), reply)
        queued = json.loads(post("/api/assistant/proposals")[1])
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0]["proposal"],
                         {"file": "demo/app.flow", "mode": "insert", "content": "# new\n", "line": 1,
                          "summary": "Add a comment"})

    def test_propose_edit_refuses_a_file_that_is_not_open(self) -> None:
        reply = call(self.proc, "flowstudio_propose_edit", {"file": "other.flow", "content": "x"})
        self.assertTrue(reply["result"]["isError"])
        self.assertIn("No open file is called other.flow", reply["result"]["content"][0]["text"])
        self.assertEqual(json.loads(post("/api/assistant/proposals")[1]), [])


if __name__ == "__main__":
    unittest.main()
