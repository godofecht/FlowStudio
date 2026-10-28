#!/usr/bin/env python3
"""Stdio contract tests for the FlowStudio MCP server.

These exercise the real JSON-RPC framing and the guarded forwarding to the
native HTTP API. The only server-dependent assertions run when FlowStudio
is already listening on 127.0.0.1:8751 (verify_native.py starts that);
everything else runs standalone in CI.
"""
from __future__ import annotations

import json
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


def server_is_up() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8751/health", timeout=3) as reply:
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
        self.assertIn("Program finished", reply["result"]["content"][0]["text"])
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


if __name__ == "__main__":
    unittest.main()
