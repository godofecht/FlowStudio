"""The Flow debugger helper drives LLDB on a source-mapped Flow build.

Runs only where `flow` and LLDB with Python support are installed (macOS
with Xcode tools). It speaks the helper's real framed protocol.
"""
import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = """function square(n: i32) -> i32 {
    let r: i32 = n * n
    return r
}

function main() -> i32 {
    let mut total: i32 = 0
    let mut i: i32 = 1
    while i <= 3 {
        total = total + square(i)
        i = i + 1
    }
    println("total", total)
    return 0
}
"""


def helper_command():
    if sys.platform == "darwin" and shutil.which("xcrun"):
        return ["xcrun", "python3", "-u", "src/flow_debugger.py"]
    return ["python3", "-u", "src/flow_debugger.py"]


def lldb_available():
    if not shutil.which("flow") or not shutil.which("lldb"):
        return False
    probe = subprocess.run(helper_command()[:-2] + ["-c",
        "import subprocess,sys; sys.path.insert(0, subprocess.run(['lldb','-P'],capture_output=True,text=True).stdout.strip()); import lldb"],
        capture_output=True, timeout=60)
    return probe.returncode == 0


@unittest.skipUnless(lldb_available(), "flow or LLDB with Python support not installed")
class FlowDebugger(unittest.TestCase):
    def setUp(self):
        self.proc = subprocess.Popen(helper_command(), cwd=ROOT, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def tearDown(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=30)

    def request(self, op, payload=""):
        data = payload.encode()
        self.proc.stdin.write((op + "%08x" % len(data)).encode() + data)
        self.proc.stdin.flush()
        header = self.proc.stdout.read(9)
        body = json.loads(self.proc.stdout.read(int(header[1:], 16)))
        return header[:1] == b"0", body

    def frames(self, body):
        return [(frame["function"], frame["line"]) for frame in body["stack"]]

    def test_breakpoint_step_evaluate_and_finish(self):
        ok, body = self.request("B", json.dumps({"source": SOURCE,
                                                 "breakpoints": [{"line": 10, "condition": "i >= 2"}]}))
        self.assertTrue(ok, body)
        self.assertEqual(body["state"], "paused")
        self.assertEqual(self.frames(body), [("main", 10)])
        self.assertEqual(body["stack"][0]["locals"]["i"]["value"], "2", "condition skipped i == 1")
        ok, body = self.request("S")
        self.assertEqual(self.frames(body), [("square", 2), ("main", 10)])
        self.assertNotIn("r", body["stack"][0]["locals"], "locals declared on the paused line are hidden")
        ok, body = self.request("N")
        self.assertEqual(body["stack"][0]["locals"]["r"]["value"], "4")
        ok, body = self.request("E", "n * 10")
        self.assertEqual(body["evaluation"]["value"], "20")
        ok, body = self.request("F")
        self.assertEqual(self.frames(body)[0], ("main", 10))
        ok, body = self.request("C")
        self.assertEqual(body["stack"][0]["locals"]["i"]["value"], "3")
        ok, body = self.request("C")
        self.assertEqual(body["state"], "done")
        self.assertIn("total 14", body["output"])
        self.assertEqual(body["exit_code"], 0)

    def test_breakpoints_change_while_paused(self):
        ok, body = self.request("B", json.dumps({"source": SOURCE, "breakpoints": [{"line": 10}]}))
        self.assertEqual(self.frames(body), [("main", 10)])
        ok, body = self.request("L", json.dumps({"breakpoints": [{"line": 2}]}))
        self.assertTrue(ok)
        ok, body = self.request("C")
        self.assertEqual(self.frames(body)[0], ("square", 2))
        ok, body = self.request("L", json.dumps({"breakpoints": []}))
        ok, body = self.request("C")
        self.assertEqual(body["state"], "done")

    def test_no_breakpoints_pauses_at_main_and_stop_cleans_up(self):
        ok, body = self.request("B", json.dumps({"source": SOURCE, "breakpoints": []}))
        self.assertEqual(body["state"], "paused")
        self.assertEqual(body["stack"][0]["function"], "main")
        ok, body = self.request("X")
        self.assertEqual(body["state"], "idle")
        ok, body = self.request("N")
        self.assertFalse(ok)

    def test_build_errors_are_reported(self):
        ok, body = self.request("B", json.dumps({"source": "function main() -> i32 {\n    return undefined_name\n}\n",
                                                 "breakpoints": []}))
        self.assertFalse(ok)
        self.assertIn("Flow build failed", body["message"])


if __name__ == "__main__":
    unittest.main()
