#!/usr/bin/env python3
"""Opt-in live test: the real Claude Code CLI writes Flow that compiles.

    FLOWSTUDIO_LIVE_AI=1 python3 tests/test_assistant_live.py

Starts ./build/flowstudio on a free port, sends one prompt through the
assistant bridge to `claude` (your own login; API key variables are removed
from its environment), and asserts that the last ```flow block in the
answer passes the strict check and runs. This uses your Claude subscription
for one short request.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_assistant_bridge import BINARY, Server, events  # noqa: E402

PROMPT = ("Write a Flow function `mean_of(xs: span<f64>) -> f64` that returns the arithmetic mean, "
          "and a main that prints the mean of 2.0, 4.0, 4.0, 5.0 and 7.0. Reply with the whole program "
          "in one ```flow block.")


@unittest.skipUnless(os.environ.get("FLOWSTUDIO_LIVE_AI") == "1", "set FLOWSTUDIO_LIVE_AI=1 to call the real claude CLI")
@unittest.skipUnless(BINARY.exists() and shutil.which("claude"), "needs build/flowstudio and claude")
class LiveClaude(unittest.TestCase):
    def test_claude_writes_flow_that_compiles(self) -> None:
        server = Server(timeout_seconds=600)
        try:
            server.post("/api/assistant/context", json.dumps({"active": {"name": "scratch.flow", "language": "flow", "text": ""},
                                                              "openFiles": [{"name": "scratch.flow", "active": True}]}))
            state, chunks, err = server.run_to_end(server.start(PROMPT, provider="claude"), 600)
            parsed = events(chunks)
            tools = [block["name"] for event in parsed if event.get("type") == "assistant"
                     for block in event["message"]["content"] if block.get("type") == "tool_use"]
            final = [event for event in parsed if event.get("type") == "result"]
            answer = final[-1].get("result", "") if final else ""
            print("\nstate:", state)
            print("tools called:", tools)
            print("answer:\n" + answer)
            if err.strip():
                print("stderr tail:", err[-1500:])
            self.assertEqual(state, "exit 0", err[-2000:])
            blocks = re.findall(r"```flow\n(.*?)```", answer, re.S)
            self.assertTrue(blocks, "the answer has a ```flow block")
            status, checked = server.post("/api/check/flow", blocks[-1])
            print("strict check:", status, checked.strip()[-300:])
            self.assertEqual(status, 200, checked)
            status, ran = server.post("/api/run/flow", blocks[-1])
            print("run:", status, ran.strip()[-300:])
            self.assertEqual(status, 200, ran)
            self.assertIn("4.4", ran)
            self.assertIn("mcp__flowstudio__flowstudio_check_code", tools, "the model checked its code")
        finally:
            server.stop()


if __name__ == "__main__":
    unittest.main(verbosity=2)
