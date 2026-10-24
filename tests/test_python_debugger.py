"""Real CPython debugger acceptance; no mocks of interpreter execution."""
import io
import json
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from python_debugger import DebugSession, encode


class Writer(io.TextIOBase):
    def __init__(self):
        self.parts = []

    def write(self, value):
        self.parts.append(value)
        return len(value)

    def result(self):
        return "".join(self.parts).encode()


class DebugTests(unittest.TestCase):
    def start(self, source, points):
        debugger = DebugSession()
        namespace = {"__name__": "__main__"}
        result = debugger.start(json.dumps({"source": source, "breakpoints": points}), namespace, Writer())
        return debugger, namespace, result

    def test_breakpoint_step_continue_and_persistence(self):
        debugger, namespace, result = self.start("x = 1\ny = x + 2\nprint(y)\n", [2])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 2)
        self.assertEqual(result["stack"][0]["locals"]["x"]["value"], "1")
        self.assertEqual(debugger.command("step")["stack"][0]["line"], 3)
        result = debugger.command("continue")
        self.assertEqual(result["state"], "done")
        self.assertEqual(result["output"], "3\n")
        self.assertEqual(namespace["y"], 3)
        self.assertFalse(debugger.busy())

    def test_step_over_skips_called_source_frames(self):
        source = ("def inner():\\n    value = 40\\n    return value\\n"
                  "answer = inner()\\nprint(answer)\\n")
        debugger, namespace, result = self.start(source, [4])
        self.assertEqual(result["stack"][0]["line"], 4)
        result = debugger.command("next")
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 5)
        self.assertEqual(result["stack"][0]["function"], "<module>")
        self.assertEqual(debugger.command("continue")["state"], "done")
        self.assertEqual(namespace["answer"], 40)

    def test_step_out_returns_to_calling_source_frame(self):
        source = ("def inner():\\n    value = 40\\n    return value\\n"
                  "answer = inner()\\nprint(answer)\\n")
        debugger, namespace, result = self.start(source, [2])
        self.assertEqual(result["stack"][0]["function"], "inner")
        result = debugger.command("finish")
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 5)
        self.assertEqual(result["stack"][0]["function"], "<module>")
        self.assertEqual(debugger.command("continue")["state"], "done")
        self.assertEqual(namespace["answer"], 40)

    def test_step_over_honors_breakpoint_inside_called_function(self):
        source = ("def inner():\\n    value = 40\\n    return value\\n"
                  "answer = inner()\\nprint(answer)\\n")
        debugger, _, result = self.start(source, [2, 4])
        self.assertEqual(result["stack"][0]["line"], 4)
        result = debugger.command("next")
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 2)
        self.assertEqual(debugger.command("continue")["state"], "done")

    def test_step_out_from_module_runs_to_completion(self):
        debugger, namespace, result = self.start("x = 1\\ny = 2\\n", [])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(debugger.command("finish")["state"], "done")
        self.assertEqual(namespace["y"], 2)

    def test_stop_preserves_unexecuted_lines(self):
        debugger, namespace, result = self.start("x = 1\ny = 2\n", [2])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(debugger.command("stop")["state"], "stopped")
        self.assertNotIn("y", namespace)

    def test_nested_stack_and_error(self):
        source = "def f(a):\n    b = a + 1\n    return b\nz = f(3)\nraise ValueError('boom')\n"
        debugger, namespace, result = self.start(source, [3])
        self.assertEqual(result["state"], "paused")
        self.assertEqual([frame["function"] for frame in result["stack"]], ["f", "<module>"])
        self.assertEqual(result["stack"][0]["locals"]["b"]["value"], "4")
        result = debugger.command("continue")
        self.assertEqual(result["state"], "done")
        self.assertFalse(result["ok"])
        self.assertIn("ValueError", result["output"])

    def test_no_breakpoints_stops_at_first_line(self):
        debugger, namespace, result = self.start("x = 1\ny = 2", [])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 1)
        self.assertEqual(debugger.command("continue")["state"], "done")

    def test_reject_invalid_requests(self):
        debugger = DebugSession()
        for points in [[True], [0], [2], [1, 1], list(range(1, 66))]:
            result = debugger.start(json.dumps({"source": "pass", "breakpoints": points}), {}, Writer())
            self.assertFalse(result["ok"])
            self.assertEqual(result["state"], "idle")
        self.assertFalse(debugger.command("step")["ok"])

    def test_safe_preview_does_not_call_user_repr(self):
        source = ("class Evil:\n    def __repr__(self):\n"
                  "        raise AssertionError('repr invoked')\n"
                  "e = Evil()\nx = 1\n")
        debugger, namespace, result = self.start(source, [5])
        self.assertEqual(result["state"], "paused")
        self.assertNotIn("value", result["stack"][0]["locals"]["e"])
        self.assertEqual(debugger.command("continue")["state"], "done")

    def test_encode_bounded(self):
        ok, payload = encode({"state": "done", "ok": True, "stack": [],
                              "output": "x" * 140000, "message": ""})
        self.assertTrue(ok)
        self.assertLessEqual(len(payload), 131072)


if __name__ == "__main__":
    unittest.main()
