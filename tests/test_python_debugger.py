"""Real CPython debugger acceptance; no mocks of interpreter execution."""
import io
import json
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from python_debugger import DebugSession, encode, _parse_breakpoints
from debugger_scientific_fixture import (
    BREAKPOINT, HEAT_SOURCE, MAX_STEPS, N, THRESHOLD,
    expected_residual, expected_state, first_hit,
)


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
        source = ("def inner():\n    value = 40\n    return value\n"
                  "answer = inner()\nprint(answer)\n")
        debugger, namespace, result = self.start(source, [4])
        self.assertEqual(result["stack"][0]["line"], 4)
        result = debugger.command("next")
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 5)
        self.assertEqual(result["stack"][0]["function"], "<module>")
        self.assertEqual(debugger.command("continue")["state"], "done")
        self.assertEqual(namespace["answer"], 40)

    def test_step_out_returns_to_calling_source_frame(self):
        source = ("def inner():\n    value = 40\n    return value\n"
                  "answer = inner()\nprint(answer)\n")
        debugger, namespace, result = self.start(source, [2])
        self.assertEqual(result["stack"][0]["function"], "inner")
        result = debugger.command("finish")
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 5)
        self.assertEqual(result["stack"][0]["function"], "<module>")
        self.assertEqual(debugger.command("continue")["state"], "done")
        self.assertEqual(namespace["answer"], 40)

    def test_step_over_honors_breakpoint_inside_called_function(self):
        source = ("def inner():\n    value = 40\n    return value\n"
                  "answer = inner()\nprint(answer)\n")
        debugger, _, result = self.start(source, [2, 4])
        self.assertEqual(result["stack"][0]["line"], 4)
        result = debugger.command("next")
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 2)
        self.assertEqual(debugger.command("continue")["state"], "done")

    def test_step_out_from_module_runs_to_completion(self):
        debugger, namespace, result = self.start("x = 1\ny = 2\n", [])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(debugger.command("finish")["state"], "done")
        self.assertEqual(namespace["y"], 2)

    def test_run_to_line_is_real_temporary_breakpoint(self):
        source = "a = 1\nb = a + 1\nc = b + 1\nprint(c)\n"
        debugger, namespace, result = self.start(source, [2])
        self.assertEqual(result["stack"][0]["line"], 2)
        result = debugger.command("run-to-line", 4)
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 4)
        self.assertEqual(namespace["c"], 3)
        self.assertIsNone(debugger.run_to_line)
        self.assertEqual(debugger.command("continue")["state"], "done")

    def test_run_to_line_invalid_target_does_not_resume(self):
        debugger, namespace, result = self.start("x = 1\ny = 2\n", [1])
        self.assertEqual(result["state"], "paused")
        for target in (None, True, 0, 3, "2", 1.5):
            invalid = debugger.command("run-to-line", target)
            self.assertFalse(invalid["ok"])
            self.assertEqual(invalid["state"], "paused")
            self.assertNotIn("x", namespace)
        self.assertEqual(debugger.command("run-to-line", 2)["stack"][0]["line"], 2)
        self.assertEqual(debugger.command("continue")["state"], "done")

    def test_run_to_line_does_not_override_earlier_breakpoint(self):
        source = "a = 1\nb = 2\nc = 3\nd = 4\n"
        debugger, namespace, result = self.start(source, [1, 3])
        self.assertEqual(result["stack"][0]["line"], 1)
        result = debugger.command("run-to-line", 4)
        self.assertEqual(result["stack"][0]["line"], 3)
        self.assertIsNone(debugger.run_to_line)
        self.assertEqual(debugger.command("continue")["state"], "done")
        self.assertEqual(namespace["d"], 4)

    def test_run_to_line_unreachable_target_completes_without_false_pause(self):
        source = "x = 1\nif False:\n    x = 2\nprint(x)\n"
        debugger, namespace, result = self.start(source, [1])
        self.assertEqual(result["state"], "paused")
        result = debugger.command("run-to-line", 3)
        self.assertEqual(result["state"], "done")
        self.assertIsNone(debugger.run_to_line)
        self.assertEqual(namespace["x"], 1)

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

    def test_live_stack_keeps_current_source_values_after_many_prior_runs(self):
        # A real persistent kernel accumulates globals across dozens of
        # executions. Source-local values must not disappear behind the
        # first 16 unrelated insertion-order entries in the module frame.
        namespace = {"__name__": "__main__"}
        namespace.update({f"earlier_value_{i}": i for i in range(80)})
        debugger = DebugSession()
        result = debugger.start(
            json.dumps({"source": "debug_value = 40\ndebug_value += 2\nprint(debug_value)\n",
                        "breakpoints": [2]}),
            namespace, Writer())
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], 2)
        self.assertEqual(result["stack"][0]["locals"]["debug_value"]["value"], "40")
        self.assertLessEqual(len(result["stack"][0]["locals"]), 16)
        self.assertEqual(debugger.command("continue")["state"], "done")
        self.assertEqual(namespace["debug_value"], 42)

    def test_scientific_breakpoint_executes_two_mode_heat_equation(self):
        # Real CPython tracing, not a simulated debugger or numerical solver.
        # The independent eigenmode oracle does not run the Euler stencil.
        self.assertEqual(N * MAX_STEPS, 12288)
        self.assertLess(len(HEAT_SOURCE.encode("utf-8")), 4096)
        iteration = first_hit()
        self.assertEqual(iteration, 160)
        self.assertGreater(expected_residual(iteration - 1), THRESHOLD)
        self.assertLessEqual(expected_residual(iteration), THRESHOLD)
        debugger, namespace, result = self.start(HEAT_SOURCE, [BREAKPOINT])
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["stack"][0]["line"], BREAKPOINT["line"])
        locals_ = result["stack"][0]["locals"]
        self.assertEqual(locals_["iteration"]["value"], str(iteration))
        self.assertAlmostEqual(float(locals_["residual"]["value"]),
                               expected_residual(iteration), places=12)
        result = debugger.command("continue")
        self.assertEqual(result["state"], "done")
        self.assertTrue(result["ok"])
        self.assertEqual(result["output"], f"{iteration}\n")
        self.assertEqual(namespace["iteration"], iteration)
        self.assertEqual(len(namespace["field"]), N + 1)
        self.assertLess(max(abs(a - b) for a, b in zip(
            namespace["field"], expected_state(iteration + 1))), 2e-12)
        self.assertFalse(debugger.busy())

    def test_scientific_threshold_grammar_and_fail_closed_underflow(self):
        valid = {
            "residual<=1e-3": 0.001,
            "residual>=-2.5E+3": -2500.0,
            "residual>.5e-8": 5e-9,
            "residual==0e-9999": 0.0,
            "residual<1e-320": 1e-320,
            "residual<0.0001": 0.0001,
            "residual<42": 42,
        }
        for expression, expected in valid.items():
            with self.subTest(expression=expression):
                parsed = _parse_breakpoints([{"line": 1, "condition": expression}], 1)
                self.assertEqual(parsed[1][2], expected)
        for expression in (
            "residual<1e309", "residual<1e-9999", "residual<-1E-9999",
            "residual<1e+99999", "residual<1e-3 or True",
            "residual<1e-3*2", "residual<NaN", "residual<Inf",
            "residual<1e-3;pass", "residual<01e-3",
        ):
            with self.subTest(expression=expression):
                with self.assertRaises(ValueError):
                    _parse_breakpoints([{"line": 1, "condition": expression}], 1)

    def test_encode_bounded(self):
        ok, payload = encode({"state": "done", "ok": True, "stack": [],
                              "output": "x" * 140000, "message": ""})
        self.assertTrue(ok)
        self.assertLessEqual(len(payload), 131072)


if __name__ == "__main__":
    unittest.main()
