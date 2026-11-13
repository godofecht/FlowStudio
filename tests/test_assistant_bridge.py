#!/usr/bin/env python3
"""The assistant bridge (src/assistant_session.c) against a real server.

Starts ./build/flowstudio on a free loopback port with the fake provider
(tests/fixtures/fake_assistant.py) and drives /api/assistant/* the way the
browser does: start a job, poll for streamed output, cancel it. Checks
streaming, cancel, the timeout, environment scrubbing, the private working
folder, the MCP chain and the proposal queue.

Run: sh scripts/build.sh && python3 tests/test_assistant_bridge.py
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "build" / "flowstudio"
FAKE = ROOT / "tests" / "fixtures" / "fake_assistant.py"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Server:
    def __init__(self, timeout_seconds: int = 4) -> None:
        self.port = free_port()
        self.url = "http://127.0.0.1:%d" % self.port
        env = dict(os.environ)
        env.update({
            "FLOWSTUDIO_PORT": str(self.port),
            "FLOWSTUDIO_ASSISTANT_FAKE": str(FAKE),
            "FLOWSTUDIO_ASSISTANT_TIMEOUT": str(timeout_seconds),
            "ANTHROPIC_API_KEY": "sk-ant-should-not-leak",
            "OPENAI_API_KEY": "sk-should-not-leak",
            "SOME_SERVICE_API_KEY": "should-not-leak",
            "FLOWSTUDIO_TEST_KEEP": "kept",
        })
        self.proc = subprocess.Popen([str(BINARY)], cwd=ROOT, env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                with urllib.request.urlopen(self.url + "/health", timeout=1):
                    return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("server did not start")

    def stop(self) -> None:
        self.proc.terminate()
        self.proc.wait(timeout=10)

    def post(self, path: str, body: str = "", intent: bool = True) -> tuple[int, str]:
        headers = {"Origin": self.url}
        if intent:
            headers["X-FlowStudio-Intent"] = "run"
        request = urllib.request.Request(self.url + path, data=body.encode("utf-8"), method="POST", headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as reply:
                return reply.status, reply.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8", "replace")

    def start(self, prompt: str, provider: str = "fake", runs: str = "1") -> str:
        status, body = self.post("/api/assistant/start", "%s\n\n%s\n%s" % (provider, runs, prompt))
        if status != 200:
            raise AssertionError("start failed: %d %s" % (status, body))
        return body

    def run_to_end(self, job: str, limit: float = 60.0) -> tuple[str, list[str], str]:
        """Polls like the browser. Returns (final state, stdout chunks, stderr tail)."""
        chunks = []
        deadline = time.time() + limit
        while time.time() < deadline:
            status, body = self.post("/api/assistant/poll", job)
            if status != 200:
                raise AssertionError("poll failed: %d %s" % (status, body))
            state, _, rest = body.partition("\n")
            if state == "running":
                if rest:
                    chunks.append(rest)
                time.sleep(0.1)
                continue
            out, _, err = rest.partition("\x1e")
            if out:
                chunks.append(out)
            return state, chunks, err
        raise AssertionError("job did not finish")


def events(chunks: list[str]) -> list[dict]:
    return [json.loads(line) for line in "".join(chunks).splitlines() if line.strip()]


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # A zombie still answers kill(0); ps shows its state.
    state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(state) and not state.startswith("Z")


@unittest.skipUnless(BINARY.exists(), "build/flowstudio is missing: run sh scripts/build.sh")
class AssistantBridge(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = Server()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.stop()

    def test_routes_need_the_intent_header(self) -> None:
        status, _ = self.server.post("/api/assistant/providers", intent=False)
        self.assertEqual(status, 404)

    def test_providers_lists_the_fake_and_the_mcp_server(self) -> None:
        status, body = self.server.post("/api/assistant/providers")
        self.assertEqual(status, 200, body)
        listing = json.loads(body)
        ids = [item["id"] for item in listing["providers"]]
        self.assertEqual(ids[:1], ["fake"])
        self.assertTrue({"claude", "codex", "ollama"} <= set(ids))
        self.assertTrue(listing["mcpServer"].endswith("/mcp/flowstudio_mcp.py"))
        self.assertTrue(Path(listing["mcpServer"]).is_file())
        self.assertEqual(listing["url"], self.server.url)

    def test_environment_is_scrubbed_and_the_folder_is_private(self) -> None:
        state, chunks, _ = self.server.run_to_end(self.server.start("ENV please"))
        self.assertEqual(state, "exit 0")
        text = "".join(event["event"]["delta"]["text"] for event in events(chunks)
                       if event.get("type") == "stream_event")
        report = json.loads(text.split("ENVREPORT ", 1)[1])
        self.assertFalse(report["anthropic_key"], "ANTHROPIC_API_KEY reached the child")
        self.assertFalse(report["openai_key"], "OPENAI_API_KEY reached the child")
        self.assertFalse(report["custom_key"], "a *_API_KEY variable reached the child")
        self.assertEqual(report["kept"], "kept", "ordinary variables must pass through")
        self.assertIn("flowstudio-assistant-", report["cwd"])
        self.assertFalse(os.path.exists(report["cwd"]), "the private folder is removed afterwards")
        self.assertEqual(report["tools"], "", "built-in tools are disabled")
        self.assertTrue(report["strict"])
        self.assertEqual(report["permission"], "dontAsk")
        self.assertIn("mcp__flowstudio__flowstudio_check_code", report["allowed"])
        self.assertNotIn("write_workspace_file", report["allowed"])
        self.assertIn("write_workspace_file", report["disallowed"])
        self.assertTrue(report["guide_in_system_prompt"])
        self.assertEqual(report["mcp_env"]["FLOWSTUDIO_URL"], self.server.url)
        self.assertEqual(report["mcp_env"]["FLOWSTUDIO_MCP_MODE"], "assistant")
        self.assertEqual(report["prompt"].strip(), "ENV please")

    def test_runs_off_reaches_the_mcp_server(self) -> None:
        state, chunks, _ = self.server.run_to_end(self.server.start("ENV", runs="0"))
        self.assertEqual(state, "exit 0")
        text = "".join(event["event"]["delta"]["text"] for event in events(chunks) if event.get("type") == "stream_event")
        self.assertEqual(json.loads(text.split("ENVREPORT ", 1)[1])["mcp_env"]["FLOWSTUDIO_MCP_RUN"], "none")

    def test_output_streams_and_the_mcp_check_runs(self) -> None:
        state, chunks, err = self.server.run_to_end(self.server.start("write a Flow function"))
        self.assertEqual(state, "exit 0", err)
        self.assertGreater(len(chunks), 1, "output must arrive over several polls")
        parsed = events(chunks)
        uses = [block for event in parsed if event.get("type") == "assistant"
                for block in event["message"]["content"] if block.get("type") == "tool_use"]
        self.assertIn("mcp__flowstudio__flowstudio_check_code", [use["name"] for use in uses])
        results = [block for event in parsed if event.get("type") == "user"
                   for block in event["message"]["content"] if block.get("type") == "tool_result"]
        check = [result for result in results if result["tool_use_id"] == "t2"][0]
        self.assertFalse(check["is_error"], check)
        self.assertNotIn("error", check["content"][0]["text"].lower())
        self.assertEqual(parsed[-1]["type"], "result")

    def test_proposals_are_queued_from_the_mcp_tool(self) -> None:
        snapshot = {"active": {"name": "app.flow", "path": "demo/app.flow", "language": "flow",
                               "text": "function main() -> i32 {\n    return 0\n}\n"},
                    "openFiles": [{"name": "app.flow", "path": "demo/app.flow", "active": True}]}
        status, _ = self.server.post("/api/assistant/context", json.dumps(snapshot))
        self.assertEqual(status, 200)
        self.server.post("/api/assistant/proposals")  # drain
        state, _, err = self.server.run_to_end(self.server.start("PROPOSE a fix"))
        self.assertEqual(state, "exit 0", err)
        status, body = self.server.post("/api/assistant/proposals")
        queued = json.loads(body)
        self.assertEqual(len(queued), 1, body)
        self.assertEqual(queued[0]["proposal"]["file"], "demo/app.flow")
        self.assertIn("twice(21)", queued[0]["proposal"]["content"])
        self.assertEqual(json.loads(self.server.post("/api/assistant/proposals")[1]), [], "drained")

    def test_cancel_kills_the_process(self) -> None:
        job = self.server.start("SLEEP")
        pid = None
        deadline = time.time() + 15
        seen = ""
        while pid is None and time.time() < deadline:
            _, body = self.server.post("/api/assistant/poll", job)
            seen += body.partition("\n")[2]
            if "as pid " in seen:
                pid = int(seen.split("as pid ", 1)[1].split()[0].strip('"\\'))
            time.sleep(0.1)
        self.assertIsNotNone(pid)
        self.assertTrue(pid_alive(pid))
        self.assertEqual(self.server.post("/api/assistant/cancel", job)[0], 200)
        state, _, _ = self.server.run_to_end(job, 10)
        self.assertEqual(state, "cancelled")
        self.assertFalse(pid_alive(pid), "the provider process must be gone")
        self.assertEqual(self.server.post("/api/assistant/poll", job)[0], 404, "a finished job is released")

    def test_timeout_stops_a_slow_provider(self) -> None:
        began = time.time()
        state, _, _ = self.server.run_to_end(self.server.start("SLEEP"), 30)
        self.assertEqual(state, "timeout")
        self.assertLess(time.time() - began, 15)

    def test_bad_requests(self) -> None:
        self.assertEqual(self.server.post("/api/assistant/start", "nobody\n\n1\nhi")[0], 400)
        self.assertEqual(self.server.post("/api/assistant/start", "fake\n\n1\n")[0], 400)
        self.assertEqual(self.server.post("/api/assistant/start", "ollama\n\n1\nhi")[0] in (400, 503), True)
        self.assertEqual(self.server.post("/api/assistant/poll", "999999")[0], 404)
        self.assertEqual(self.server.post("/api/assistant/context", "not json")[0], 400)
        self.assertEqual(self.server.post("/api/assistant/propose", "[1]")[0], 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
