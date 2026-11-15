"""The persistent Flow console session (src/flow_session.py).

Offline: splitting entries, literals and the value reader. Live (needs the
native server, at FLOWSTUDIO_URL or 127.0.0.1:8751, with flow on PATH):
values, functions and structs persist between entries, errors leave the
session as it was, and the console can call Python.
"""
from __future__ import annotations

import json
import os
import sys
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

import flow_session as fs  # noqa: E402

URL = os.environ.get("FLOWSTUDIO_URL", "http://127.0.0.1:8751").rstrip("/")


def server_up() -> bool:
    try:
        with urllib.request.urlopen(URL + "/health", timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def call(op: str, body: str = "") -> tuple[int, dict]:
    request = urllib.request.Request(URL + "/api/flow/session/" + op, data=body.encode("utf-8"), method="POST",
                                     headers={"X-FlowStudio-Intent": "run", "Content-Type": "text/plain",
                                              "Origin": URL})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8")
        try:
            return error.code, json.loads(text)
        except ValueError:
            return error.code, {"output": text}


class Offline(unittest.TestCase):
    def test_split_items_keeps_blocks_whole(self) -> None:
        items = fs.split_items('let x = 1\nfunction f() -> i32 {\n    return 1 # }\n}\nif x > 0 {\n    println("{")\n}\nelse {\n    x\n}\n')
        self.assertEqual([item["kind"] for item in items], ["statement", "declaration", "statement"])
        self.assertTrue(items[2]["text"].rstrip().endswith("}"))
        self.assertIn("else", items[2]["text"])

    def test_expressions_and_statements(self) -> None:
        for text in ("x", "x + 1", "sq(4)", "p.a", "xs[2] * 3"):
            self.assertTrue(fs.is_expression(text), text)
        for text in ("let y = 2", "x = 3", "xs[1] += 2", 'println("a")', "while i < 3 {\n}", "return 1"):
            self.assertFalse(fs.is_expression(text), text)

    def test_literals(self) -> None:
        self.assertEqual(fs.flow_string('a"b\\c\nd\te\x01'), '"a\\"b\\\\c\\nd\\te\\x01"')
        self.assertEqual(fs.float_literal(3.0), "3.0")
        self.assertEqual(fs.float_literal(1e-30), "1.0e-30")
        self.assertIsNone(fs.float_literal(float("inf")))
        state = fs.empty_state()
        struct = "struct P {\n    a: f64\n    b: string\n}"
        self.assertEqual(fs.literal(state, [struct], "P", {"a": 1.5, "b": "x"}), 'P { a: 1.5, b: "x" }')
        self.assertEqual(fs.literal(state, [], "array<i32, 3>", [1, 2, 3]), "[1, 2, 3]")
        self.assertFalse(fs.keepable(state, [], "array<f64, 100000>"))
        self.assertFalse(fs.keepable(state, [], "ptr<Thing>"))

    def test_arrays_of_structs_and_nested_structs(self) -> None:
        state = fs.empty_state()
        state["declarations"] = ["struct P {\n    x: f64\n    name: string\n}", "struct Seg { a: P, n: i32 }"]
        self.assertTrue(fs.keepable(state, [], "array<P, 2>"))
        self.assertTrue(fs.keepable(state, [], "Seg"))
        value = [{"x": 1.5, "name": "a"}, {"x": -2.0, "name": "b\n"}]
        self.assertEqual(fs.literal(state, [], "array<P, 2>", value),
                         '[P { x: 1.5, name: "a" }, P { x: -2.0, name: "b\\n" }]')
        nested = {"a": {"x": 0.5, "name": "q"}, "n": 3}
        self.assertEqual(fs.literal(state, [], "Seg", nested), 'Seg { a: P { x: 0.5, name: "q" }, n: 3 }')
        # The dump prints each field of each element, and the reader reads it back.
        lines = fs.dump_lines(state, [], "ps", "array<P, 2>")
        self.assertIn("    while flowstudio_i_ps < 2 {", lines)
        self.assertIn('        printf("%.17g\\n", ((ps)[flowstudio_i_ps]).x)', lines)
        reader = fs.Reader("1.5\n1:a\n-2\n2:b\n\n")
        self.assertEqual(fs.read_value(state, [], reader, "array<P, 2>"), value)
        # A struct that refers to itself stops at the depth limit.
        state["declarations"].append("struct Loop { next: Loop }")
        self.assertFalse(fs.dumpable(state, [], "Loop"))
        self.assertFalse(fs.dumpable(state, [], "array<array<f64, 2>, 2>"))

    def test_large_arrays_dump_a_prefix_without_being_kept(self) -> None:
        state = fs.empty_state()
        self.assertFalse(fs.keepable(state, [], "array<f64, 5000>"))
        self.assertTrue(fs.dumpable(state, [], "array<f64, 5000>"))
        self.assertIn("    while flowstudio_i_w < 1000 {", fs.dump_lines(state, [], "w", "array<f64, 5000>"))
        self.assertEqual(fs.display(state, [], "array<f64, 5000>", [0.5] * 1000, 2), "[0.5, 0.5, ... 4998 more]")

    def test_table_view_flattens_fields_and_caps_rows(self) -> None:
        state = fs.empty_state()
        state["declarations"] = ["struct P { x: f64, name: string }", "struct Seg { a: P, ok: bool }"]
        state["variables"] = [
            {"name": "segs", "type": "array<Seg, 2>", "value": [
                {"a": {"x": 1.0, "name": "a"}, "ok": True}, {"a": {"x": 2.5, "name": "b c"}, "ok": False}]},
            {"name": "w", "type": "array<f32, 5000>", "value": [0.25] * 1000},
            {"name": "n", "type": "i32", "literal": "3"}]
        view = fs.table_view(state, "segs")
        self.assertEqual(view["columns"], ["a.x", "a.name", "ok"])
        self.assertEqual(view["kinds"], ["f64", "string", "bool"])
        self.assertEqual(view["rows"], [["1.0", "a", "true"], ["2.5", "b c", "false"]])
        self.assertEqual((view["total"], view["truncated"]), (2, False))
        wide = fs.table_view(state, "w")
        self.assertEqual((wide["columns"], len(wide["rows"]), wide["total"], wide["truncated"]),
                         (["value"], 1000, 5000, True))
        self.assertFalse(fs.table_view(state, "n")["ok"])
        self.assertFalse(fs.table_view(state, "missing")["ok"])

    def test_reader_handles_strings_with_newlines(self) -> None:
        sentinel = fs.SENTINEL
        text = f"{sentinel}s\n7:a\nb:c d\n{sentinel}n\n12\n"
        reader = fs.Reader(text)
        self.assertEqual(reader.line(), sentinel + "s")
        self.assertEqual(reader.scalar("string"), "a\nb:c d")
        self.assertEqual(reader.line(), sentinel + "n")
        self.assertEqual(reader.scalar("i32"), 12)


@unittest.skipUnless(server_up(), "native server not running")
class Live(unittest.TestCase):
    def setUp(self) -> None:
        status, _ = call("reset")
        self.assertEqual(status, 200)

    def evaluate(self, code: str, ok: bool = True) -> dict:
        status, reply = call("eval", code)
        self.assertEqual(status == 200, ok, f"{code!r}: {status} {reply}")
        return reply

    def variables(self) -> dict:
        _, reply = call("state")
        return {v["name"]: v for v in reply["variables"]}

    def test_values_functions_and_structs_persist(self) -> None:
        self.evaluate("let x = 41")
        self.assertEqual(self.evaluate("x + 1")["output"], "42\n")
        self.evaluate("function sq(n: i32) -> i32 {\n    return n * n\n}")
        self.assertEqual(self.evaluate("sq(x)")["output"], "1681\n")
        self.evaluate("let mut total: f64 = 0.1\ntotal = total * 3.0")
        self.evaluate("struct P {\n    a: f64\n    b: string\n}\nlet p = P { a: 1.5, b: \"tab\\there\" }")
        self.evaluate('let xs: array<f64, 3> = [1.0, 2.5, -3.0]')
        variables = self.variables()
        self.assertEqual(variables["x"]["display"], "41")
        self.assertEqual(variables["total"]["display"], repr(0.1 * 3.0))
        self.assertEqual(variables["p"]["display"], 'P { a: 1.5, b: "tab\\there" }')
        self.assertEqual(variables["xs"]["type"], "array<f64, 3>")
        self.assertEqual(self.evaluate("xs")["output"], "[1.0, 2.5, -3.0]\n")
        self.assertEqual(self.evaluate("p.b")["output"], '"tab\\there"\n')

    def test_arrays_of_structs_persist_and_open_as_tables(self) -> None:
        self.evaluate("struct City { name: string, lat: f64 }")
        self.evaluate('let cities = [City { name: "Oslo", lat: 59.9 }, City { name: "Lima", lat: -12.0 }]')
        variable = self.variables()["cities"]
        self.assertEqual((variable["type"], variable["kept"], variable["viewable"], variable["size"]),
                         ("array<City, 2>", True, True, 2))
        self.assertEqual(self.evaluate("cities[1].name")["output"], '"Lima"\n')
        status, table = call("view", "cities")
        self.assertEqual(status, 200)
        self.assertEqual(table["columns"], ["name", "lat"])
        self.assertEqual(table["rows"], [["Oslo", "59.9"], ["Lima", "-12.0"]])
        status, missing = call("view", "nothing_here")
        self.assertEqual(status, 404)
        self.assertFalse(missing["ok"])

    def test_inferred_float_products_keep_their_type(self) -> None:
        # flowc declares an unannotated `let v = p.x * 4.0` as int32_t in C.
        # The session annotates it with the checked type, so the value is right.
        self.evaluate("struct Q {\n    x: f64\n}\nlet q = Q { x: 1.5 }")
        self.assertEqual(self.evaluate("q.x * 4.0")["output"], "6.0\n")
        self.evaluate("let v = q.x * 4.0")
        self.assertEqual(self.variables()["v"]["display"], "6.0")

    def test_strings_round_trip_exactly(self) -> None:
        self.evaluate('let s = "quote \\" back \\\\ newline \\n tab \\t e\\u00e9"')
        self.evaluate("let n = len(s)")
        self.assertEqual(self.variables()["n"]["display"], "34")  # bytes; e with acute is two
        self.assertEqual(self.evaluate("s")["output"], '"quote \\" back \\\\ newline \\n tab \\t eé"\n')

    def test_errors_leave_the_session_alone(self) -> None:
        self.evaluate("let x = 1")
        reply = self.evaluate("let y: i32 = \"no\"", ok=False)
        self.assertIn("line 1", reply["output"])
        reply = self.evaluate("let a = 2\nnope + 1", ok=False)
        self.assertIn("line 2: Undefined variable 'nope'", reply["output"])
        self.assertEqual(sorted(self.variables()), ["x"])

    def test_mutation_carries_over(self) -> None:
        self.evaluate("let mut acc = 0\nlet mut i = 0\nwhile i < 5 {\n    acc = acc + i\n    i = i + 1\n}")
        self.evaluate("acc = acc * 10")
        self.assertEqual(self.evaluate("acc")["output"], "100\n")

    def test_console_calls_python(self) -> None:
        self.evaluate("import flowstudio { py_num }")
        self.evaluate('let pi = py_num("import math; math.pi")')
        self.assertEqual(self.variables()["pi"]["display"], "3.141592653589793")

    def test_whole_program_runs_unchanged(self) -> None:
        reply = self.evaluate('function main() -> i32 {\n    println("whole")\n    return 0\n}')
        self.assertEqual(reply["output"], "whole\n")
        self.assertEqual(self.variables(), {})

    def test_reset_forgets_everything(self) -> None:
        self.evaluate("let x = 1\nfunction f() -> i32 {\n    return 2\n}")
        call("reset")
        self.assertIn("Undefined", self.evaluate("x", ok=False)["output"])
        self.assertIn("f", self.evaluate("f()", ok=False)["output"])


if __name__ == "__main__":
    unittest.main()
