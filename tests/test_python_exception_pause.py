"""Real CPython exception-pause debugger acceptance; no interpreter mocks."""
import io
import json
import sys
import unittest
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
        return "".join(self.parts).encode("utf-8")


class ExceptionPauseTests(unittest.TestCase):
    def start(self, source, pause=True, points=None):
        session = DebugSession()
        namespace = {"__name__": "__main__"}
        result = session.start(json.dumps({
            "source": source, "breakpoints": points or [],
            "pause_on_exception": pause
        }), namespace, Writer())
        return session, namespace, result

    def test_uncaught_exception_pauses_before_traceback(self):
        session, namespace, result = self.start(
            'x = 1\nraise ValueError("bad")\nx = 99\n')
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["exception"], {"type": "ValueError", "line": 2})
        self.assertEqual(result["stack"][0]["line"], 2)
        self.assertEqual(result["stack"][0]["locals"]["x"]["value"], "1")
        self.assertEqual(session.command("status")["exception"]["type"], "ValueError")
        result = session.command("continue")
        self.assertEqual(result["state"], "done")
        self.assertFalse(result["ok"])
        self.assertIn("ValueError: bad", result["output"])
        self.assertNotIn("exception", namespace)
        self.assertIsNone(result["exception"])

    def test_caught_exception_pauses_once_at_origin(self):
        source = ('def f():\n    raise LookupError("caught")\n'
                  'try:\n    f()\nexcept LookupError:\n    recovered = 42\n')
        session, namespace, result = self.start(source)
        self.assertEqual(result["exception"], {"type": "LookupError", "line": 2})
        self.assertEqual(result["stack"][0]["function"], "f")
        result = session.command("continue")
        self.assertEqual(result["state"], "done")
        self.assertTrue(result["ok"])
        self.assertEqual(namespace["recovered"], 42)

    def test_no_exception_does_not_pause_first_line(self):
        session, namespace, result = self.start("x = 3\ny = x + 1\n")
        self.assertEqual(result["state"], "done")
        self.assertEqual(namespace["y"], 4)

    def test_legacy_request_still_pauses_first_line(self):
        session = DebugSession()
        result = session.start(json.dumps({
            "source": "x = 1", "breakpoints": []
        }), {}, Writer())
        self.assertEqual(result["state"], "paused")
        self.assertIsNone(result["exception"])
        self.assertEqual(session.command("continue")["state"], "done")

    def test_exception_preview_never_invokes_user_repr_or_str(self):
        source = ('class Evil(Exception):\n    def __str__(self):\n'
                  '        raise RuntimeError("str called")\n'
                  '    def __repr__(self):\n'
                  '        raise RuntimeError("repr called")\n'
                  'raise Evil()\n')
        session, _, result = self.start(source)
        self.assertEqual(result["exception"], {"type": "Evil", "line": 6})
        self.assertEqual(session.command("stop")["state"], "stopped")

    def test_invalid_flag_rejected_without_starting_thread(self):
        for value in (1, "true", [], None):
            with self.subTest(value=value):
                session, _, result = self.start("x = 1", pause=value)
                self.assertEqual(result["state"], "idle")
                self.assertFalse(result["ok"])
                self.assertFalse(session.busy())

    def test_breakpoint_after_caught_exception_clears_metadata(self):
        source = ('try:\n    raise ValueError("a")\n'
                  'except ValueError:\n    x = 4\ny = 5\n')
        session, _, result = self.start(source, points=[5])
        self.assertEqual(result["exception"]["line"], 2)
        result = session.command("continue")
        self.assertEqual(result["state"], "paused")
        self.assertIsNone(result["exception"])
        self.assertEqual(result["stack"][0]["line"], 5)
        self.assertEqual(session.command("continue")["state"], "done")

    def test_exception_snapshot_encodes_as_json(self):
        session, _, result = self.start('raise RuntimeError("boom")\n')
        ok, payload = encode(result)
        self.assertTrue(ok)
        self.assertEqual(json.loads(payload)["exception"]["type"], "RuntimeError")
        self.assertEqual(session.command("stop")["state"], "stopped")


if __name__ == "__main__":
    unittest.main()
