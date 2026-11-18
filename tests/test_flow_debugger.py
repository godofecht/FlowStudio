"""The Flow debugger helper drives LLDB on a source-mapped Flow build.

Runs only where `flow` and LLDB with Python support are installed (macOS
with Xcode tools). It speaks the helper's real framed protocol.
"""
import importlib.util
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

GFX_SOURCE = """import "stdlib/gfx.flow"

function main() -> i32 {
    let w: i32 = 64
    let h: i32 = 48
    if w < 0 {
        let g = gfx_open(w, h, "never opened")
        gfx_close(g)
    }
    println("gfx size", w * h)
    return 0
}
"""

# What `flow debug` printed for a gfx program before the Flow fix.
GFX_LINK_FAILURE = """Compiling main.flow (debug)...
FLOW to C (debug): main.debug.c
Undefined symbols for architecture arm64:
  "_flow_gfx_blit_rgb", referenced from:
      _gfx_blit_rgb in main-ef27f6.o
  "_flow_gfx_clear", referenced from:
      _gfx_clear in main-ef27f6.o
ld: symbol(s) not found for architecture arm64
clang: error: linker command failed with exit code 1 (use -v to see invocation)
C compilation/linking failed
"""


def load_helper():
    spec = importlib.util.spec_from_file_location("flow_debugger", ROOT / "src" / "flow_debugger.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BuildFailureMessage(unittest.TestCase):
    """The message for a failed build needs no LLDB, so it runs everywhere."""

    def setUp(self):
        self.helper = load_helper()

    def test_gfx_link_failure_is_one_plain_message(self):
        message = self.helper.build_failure_message(GFX_SOURCE, GFX_LINK_FAILURE)
        self.assertIn("cannot build graphics programs for debugging", message)
        self.assertIn("https://github.com/flooooooooooow/flow/pull/1702", message)
        self.assertIn("Run works", message)
        self.assertNotIn("flow_gfx_", message)
        self.assertNotIn("ld:", message)

    def test_unresolved_gfx_symbols_alone_are_recognised(self):
        message = self.helper.build_failure_message("function main() -> i32 {\n    return 0\n}\n",
                                                    GFX_LINK_FAILURE)
        self.assertIn("cannot build graphics programs for debugging", message)

    def test_gfx_program_with_a_flow_error_shows_the_error(self):
        text = "main.flow:4: error: undefined name 'gfx_opne'\nFLOW compilation failed\n"
        message = self.helper.build_failure_message(GFX_SOURCE, text)
        self.assertTrue(message.startswith("Flow build failed:"), message)
        self.assertIn("gfx_opne", message)


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

    def test_gfx_program_debugs_or_says_why_not(self):
        ok, body = self.request("B", json.dumps({"source": GFX_SOURCE, "breakpoints": [{"line": 10}]}))
        self.assertNotIn("flow_gfx_", body["message"], "no linker output in the Debug Console")
        if ok:
            # This `flow debug` links the gfx backend: debugging proceeds.
            self.assertEqual(self.frames(body), [("main", 10)])
            ok, body = self.request("C")
            self.assertEqual(body["state"], "done")
            self.assertIn("gfx size 3072", body["output"])
        else:
            self.assertIn("cannot build graphics programs for debugging", body["message"])
            self.assertIn("https://github.com/flooooooooooow/flow/pull/1702", body["message"])


if __name__ == "__main__":
    unittest.main()
