"""Real CPython acceptance for side-effect-free conditional source breakpoints."""
import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from python_debugger import DebugSession


class Writer(io.TextIOBase):
    def __init__(self):
        self.parts = []

    def write(self, value):
        self.parts.append(value)
        return len(value)

    def result(self):
        return "".join(self.parts).encode("utf-8")


class ConditionalBreakpointTests(unittest.TestCase):
    def start(self, source, breakpoints):
        session = DebugSession()
        namespace = {"__name__": "__main__"}
        result = session.start(json.dumps({"source": source, "breakpoints": breakpoints}),
                               namespace, Writer())
        return session, namespace, result

    def test_repeated_conditional_hits_use_live_local_values(self):
        source = "for i in range(5):\n    observed = i\nprint(observed)\n"
        session, namespace, result = self.start(
            source, [{"line": 2, "condition": "i>=3"}])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 2)
        self.assertEqual(result["stack"][0]["locals"]["i"]["value"], "3")
        result = session.command("continue")
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["locals"]["i"]["value"], "4")
        self.assertEqual(session.command("continue")["state"], "done")
        self.assertEqual(namespace["observed"], 4)

    def test_conditional_miss_runs_to_completion(self):
        session, namespace, result = self.start(
            "x = 1\ny = x + 1\n", [{"line": 2, "condition": "x>9"}])
        self.assertEqual(result["state"], "done")
        self.assertTrue(result["ok"])
        self.assertEqual(namespace["y"], 2)
        self.assertFalse(session.busy())

    def test_numeric_float_comparison_and_legacy_unconditional(self):
        session, namespace, result = self.start(
            "x = 0.75\ny = x + 1\n", [{"line": 2, "condition": "x>0.5"}])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(session.command("continue")["state"], "done")
        session, namespace, result = self.start("x = 1\ny = 2\n", [2])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(session.command("continue")["state"], "done")

    def test_custom_comparison_is_never_invoked(self):
        source = ("class Hostile:\n"
                  "    def __ge__(self, other):\n"
                  "        raise AssertionError('user comparison invoked')\n"
                  "value = Hostile()\n"
                  "for i in range(2):\n"
                  "    current = value\n"
                  "print('finished')\n")
        session, _, result = self.start(
            source, [{"line": 6, "condition": "current>=3"}])
        self.assertEqual(result["state"], "done")
        self.assertTrue(result["ok"])
        self.assertIn("finished", result["output"])

    def test_step_overrides_false_condition(self):
        session, _, result = self.start(
            "x = 1\ny = 2\n", [1, {"line": 2, "condition": "x>100"}])
        self.assertEqual(result["stack"][0]["line"], 1)
        result = session.command("step")
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 2)
        self.assertEqual(session.command("continue")["state"], "done")

    def test_reject_invalid_and_duplicate_conditional_breakpoints(self):
        invalid = [
            [{"line": 1, "condition": "x>=3"}, 1],
            [{"line": True, "condition": "x>=3"}],
            [{"line": 1, "condition": "__import__('os')"}],
            [{"line": 1, "condition": "x.__class__==3"}],
            [{"line": 1, "condition": "x==nan"}],
            [{"line": 1, "condition": "x>=1e9"}],
            [{"line": 1, "condition": "x>=3", "extra": 1}],
            [{"line": 2, "condition": "x>=3"}],
            [{"line": 1, "condition": "x>=3" * 30}],
            [False],
        ]
        for points in invalid:
            with self.subTest(points=points):
                session, _, result = self.start("x = 1\n", points)
                self.assertFalse(result["ok"])
                self.assertEqual(result["state"], "idle")
                self.assertFalse(session.busy())


if __name__ == "__main__":
    unittest.main()
