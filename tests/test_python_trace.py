"""Real CPython execution tracing, without requiring native Flow."""
import io
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from python_trace import MAX_EVENTS, trace_source


class Writer(io.StringIO):
    def result(self):
        return self.getvalue().encode("utf-8")


class TraceTests(unittest.TestCase):
    def run_trace(self, source, namespace=None):
        import json
        state = {} if namespace is None else namespace
        ok, data = trace_source(source, state, Writer())
        return ok, json.loads(data), state

    def test_real_lines_functions_and_persistent_state(self):
        state = {"__name__": "__main__"}
        ok, result, _ = self.run_trace("x = 2\ndef f(y):\n    return x + y\nprint(f(3))", state)
        self.assertTrue(ok)
        self.assertIn("5", result["output"])
        self.assertEqual(state["x"], 2)
        self.assertEqual(state["f"](1), 3)
        self.assertTrue(any(e["function"] == "f" and e["line"] == 3 for e in result["events"]))
        self.assertTrue(any(e["locals"].get("y", {}).get("value") == "3" for e in result["events"]))

    def test_exception_preserves_trace_and_restores_hook(self):
        before = sys.gettrace()
        ok, result, _ = self.run_trace("a = 4\nraise ValueError('boom')")
        self.assertFalse(ok)
        self.assertIn("ValueError: boom", result["output"])
        self.assertEqual(sys.gettrace(), before)
        self.assertTrue(result["events"])

    def test_no_user_repr_called(self):
        ok, result, _ = self.run_trace("class Dangerous:\n    def __repr__(self):\n        raise RuntimeError('repr called')\nobj = Dangerous()\nx = 1")
        self.assertTrue(ok)
        self.assertTrue(any(e["locals"].get("obj", {}).get("type") == "Dangerous" for e in result["events"]))
        self.assertNotIn("repr called", result["output"])

    def test_bound_event_count_and_utf8(self):
        ok, result, _ = self.run_trace("for i in range(2000):\n    x = 'π'")
        self.assertTrue(ok)
        self.assertEqual(len(result["events"]), MAX_EVENTS)
        self.assertTrue(result["truncated"])

    def test_compile_failure_and_followup(self):
        state = {}
        ok, result, _ = self.run_trace("if:", state)
        self.assertFalse(ok)
        self.assertIn("SyntaxError", result["output"])
        self.assertFalse(result["events"])
        ok, result, _ = self.run_trace("x = 7", state)
        self.assertTrue(ok)
        self.assertEqual(state["x"], 7)


if __name__ == "__main__":
    unittest.main()
