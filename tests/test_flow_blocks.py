"""Python and R blocks inside Flow (src/flow_blocks.py).

Offline: the shared cases (tests/fixtures/flow_blocks_cases.json, also read
by tests/flow_blocks.test.js), the line-keeping rewrite, its column map, the
generated helpers and the Python side of a block call.

Live (needs the native server at FLOWSTUDIO_URL, with flow, Python and R):
Run, Check Flow and the console session each run blocks, return typed
values, report type errors, and map Python and R errors to Flow lines.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

import flow_blocks as fb  # noqa: E402
import flowstudio_bridge as bridge  # noqa: E402

URL = os.environ.get("FLOWSTUDIO_URL", "http://127.0.0.1:8751").rstrip("/")
CASES = json.load(open(os.path.join(ROOT, "tests", "fixtures", "flow_blocks_cases.json"), encoding="utf-8"))
CHECK_PATH = re.compile(r"/tmp/flowstudio-check-[A-Za-z0-9]{6}/prog\.flow:([0-9]+):([0-9]+):\s*(.+)$", re.M)


def server_up() -> bool:
    try:
        with urllib.request.urlopen(URL + "/health", timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def post(route: str, body: str) -> tuple[int, str]:
    request = urllib.request.Request(URL + route, data=body.encode("utf-8"), method="POST",
                                     headers={"X-FlowStudio-Intent": "run", "Content-Type": "text/plain",
                                              "Origin": URL})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


def request(kind: str, line: int, first: int, values: str, code: str) -> str:
    return f"FSBLOCK 1\n{kind}\n{line}\n{first}\n{values}code\n{code}"


class SharedCases(unittest.TestCase):
    def test_every_case(self) -> None:
        self.assertGreaterEqual(len(CASES), 25)
        for case in CASES:
            with self.subTest(case["name"]):
                if "error" in case:
                    with self.assertRaises(fb.BlockError) as caught:
                        fb.find_blocks(case["source"])
                    self.assertEqual((caught.exception.line, caught.exception.column, caught.exception.message),
                                     (case["error"]["line"], case["error"]["column"], case["error"]["message"]))
                else:
                    self.assertEqual([block.to_json() for block in fb.find_blocks(case["source"])], case["blocks"])


class Rewrite(unittest.TestCase):
    SOURCE = ('function main() -> i32 {\n'
              '    let xs: array<f64, 3> = [1.0, 2.0, 3.0]\n'
              '    let m: f64 = python(xs, k = 2) -> f64 {\n'
              '        s = "a\\\\b\\t\\"q\\""\n'
              '        sum(xs) * k\n'
              '    } + 1.0\n'
              '    println(m)\n'
              '    return 0\n'
              '}\n')

    def rewritten(self) -> fb.Rewrite:
        blocks = fb.find_blocks(self.SOURCE)
        return fb.rewrite(self.SOURCE, blocks, {0: ["array<f64, 3>", "i32"]})

    def test_lines_stay_where_they_were(self) -> None:
        before = self.SOURCE.split("\n")
        after = self.rewritten().text.split("\n")
        self.assertEqual(len(before), len(after))
        for number in (0, 1, 6, 7, 8):
            self.assertEqual(before[number], after[number])
        self.assertEqual(after[3:5], ["", ""])
        self.assertEqual(after[5], "    )) + 1.0")

    def test_the_call_carries_typed_values_and_escaped_code(self) -> None:
        line = self.rewritten().text.split("\n")[2]
        self.assertTrue(line.startswith('    let m: f64 = flowstudio_f64(flowstudio_call("p", "f64", 3, 4, '), line)
        self.assertIn('"s = \\"a\\\\\\\\b\\\\t\\\\\\"q\\\\\\"\\"\\nsum(xs) * k"', line)
        self.assertIn('flowstudio_arg_f64s("xs", xs) + flowstudio_arg_i64("k", (2) as i64)', line)

    def test_columns_map_back(self) -> None:
        result = self.rewritten()
        line = result.text.split("\n")[2]
        original = self.SOURCE.split("\n")[2]
        at = line.index('"xs", xs') + 6
        self.assertEqual(result.original_column(2, at), original.index("(xs") + 1)
        self.assertEqual(result.original_column(2, 4), 4)
        self.assertEqual(result.original_column(2, 40), original.index("python"))
        # After the closing brace: "    } + 1.0" became "    )) + 1.0".
        self.assertEqual(result.original_column(5, 7), 6)

    def test_unsupported_values_name_the_argument(self) -> None:
        blocks = fb.find_blocks("let p = python(q) { 1 }\n")
        with self.assertRaises(fb.BlockError) as caught:
            fb.rewrite("let p = python(q) { 1 }\n", blocks, {0: ["ptr<f64>"]})
        self.assertEqual((caught.exception.line, caught.exception.column), (1, 16))
        self.assertIn("'q' cannot be passed", caught.exception.message)

    def test_probe_messages_give_types(self) -> None:
        blocks = fb.find_blocks("let a = python(x, y) { 1 }\nlet b = r(z) { 2 }\n")
        report = ("prog.flow:1:9: error: No matching overload for function 'flowstudio_probe_0' with arguments "
                  "(array<f64, 3>, i32)\nprog.flow:2:9: error: No matching overload for function "
                  "'flowstudio_probe_1' with arguments (Obs)\n")
        self.assertEqual(fb.read_probe(report, blocks), {0: ["array<f64, 3>", "i32"], 1: ["Obs"]})

    def test_helpers_are_generated_from_the_program(self) -> None:
        structs = fb.struct_fields("struct Obs {\n    x: f64,\n    label: string\n}\nstruct Bad { p: ptr<f64> }\n")
        self.assertEqual(structs["Obs"], [("x", "f64"), ("label", "string")])
        self.assertIsNone(structs["Bad"])
        text = ("flowstudio_take_f64_5(x) flowstudio_take_string_2(y) flowstudio_rows_Obs(a, b) "
                "flowstudio_rec_Obs(c, d) flowstudio_strings_3(e, f)")
        helpers = "\n".join(fb.support(text, structs))
        for name in ("flowstudio_take_f64_5", "flowstudio_take_string_2", "flowstudio_rows_Obs",
                     "flowstudio_rec_Obs", "flowstudio_strings_3"):
            self.assertIn(f"function {name}(", helpers)
        self.assertIn('flowstudio_buf_put("2\\nf\\nx\\ns\\nlabel\\n")', helpers)

    def test_python_syntax_errors_are_on_flow_lines(self) -> None:
        source = "let a = 1\npython() {\n    x = 1\n    def f(:\n}\n"
        errors = fb.python_syntax(fb.find_blocks(source))
        self.assertEqual([error.line for error in errors], [4])
        self.assertIn("Python syntax error", errors[0].message)


class PythonSide(unittest.TestCase):
    """flowstudio_bridge.block, the Python end of a block call."""

    def test_values_arrive_typed_and_the_result_is_typed(self) -> None:
        namespace: dict = {"name": "kept", "sorted": "user value"}
        values = ("F\nxs\n3\n1.5\n2.5\n3\n" "i\nn\n4\n" "b\nflag\n1\n" "s\nname\na%20b%C3%A9\n"
                  "d\np\n2\nf\nx\ns\nlabel\n0.5\nq\n"
                  "R\nrows\n2\n2\nf\nx\nf\ny\n1\n2\n3\n4\n")
        code = ("assert list(xs) == [1.5, 2.5, 3.0], xs\nassert n == 4 and flag is True and name == 'a bé'\n"
                "assert p == {'x': 0.5, 'label': 'q'}\nprint('rows', len(rows))\nfloat(sum(xs)) * n")
        ok, reply = bridge.block(namespace, request("f64", 10, 11, values, code))
        self.assertTrue(ok, reply)
        self.assertEqual(reply, b"7\nrows 2\n28")
        # The passed values were there for the block only.
        self.assertEqual(namespace["name"], "kept")
        self.assertNotIn("n", namespace)
        namespace["captured"] = []
        ok, reply = bridge.block(namespace, request("void", 1, 1, "R\nrows\n2\n2\nf\nx\nf\ny\n1\n2\n3\n4\n",
                                                    "captured.append(rows)\nkept_by_block = 1"))
        self.assertTrue(ok, reply)
        self.assertEqual(namespace["kept_by_block"], 1, "names the block assigns stay")
        self.assertNotIn("rows", namespace)
        rows = namespace["captured"][0]
        if bridge._optional("pandas"):
            self.assertEqual(type(rows).__name__, "DataFrame")
        else:
            self.assertIsInstance(rows, bridge.Rows)
            self.assertEqual(rows[1], {"x": 3.0, "y": 4.0})
        self.assertEqual(len(rows), 2)
        self.assertEqual(list(rows["y"]), [2.0, 4.0])

    def test_a_passed_name_never_replaces_a_builtin_or_session_value(self) -> None:
        namespace: dict = {"total": 99}
        ok, reply = bridge.block(namespace, request("f64", 1, 1, "F\nsorted\n2\n2\n1\nf\ntotal\n5\n",
                                                    "float(sum(sorted)) + total"))
        self.assertTrue(ok, reply)
        self.assertEqual(reply, b"0\n8")
        self.assertEqual(namespace["total"], 99)
        self.assertNotIn("sorted", namespace)
        ok, _ = bridge.block(namespace, request("f64", 1, 1, "f\ntotal\n5\n", "1 / 0"))
        self.assertFalse(ok)
        self.assertEqual(namespace["total"], 99, "an error restores the session value too")

    def test_arrays_of_each_kind(self) -> None:
        for kind, code, expected in (("f64[3]", "[1, 2.5, 3]", b"0\n1\n2.5\n3"),
                                     ("i64[2]", "(4, 5.0)", b"0\n4\n5"),
                                     ("bool[2]", "[True, False]", b"0\n1\n0"),
                                     ("string[2]", "['a b', 'x\\ny']", b"0\na%20b\nx%0Ay"),
                                     ("string", "[1, 2]", b"0\n1\n2"),
                                     ("void", "123", b"0\n")):
            with self.subTest(kind):
                ok, reply = bridge.block({}, request(kind, 1, 1, "", code))
                self.assertTrue(ok, reply)
                self.assertEqual(reply, expected)

    def test_type_errors_name_the_line_and_the_type(self) -> None:
        for kind, code, message in (
                ("i64", "'text'", "line 7: the Python block returned str 'text'; i64 needs a whole number."),
                ("i32", "2 ** 40", "line 7: the Python block returned int 1099511627776; i32 needs a whole number that fits in i32."),
                ("bool", "1", "line 7: the Python block returned int 1; bool needs True or False."),
                ("f64[3]", "[1.0, 2.0]", "line 7: the Python block returned 2 values; array<f64, 3> needs 3."),
                ("f64[2]", "[1.0, 'x']", "line 7: item 1 of the Python block's value is str 'x'; f64 needs a number.")):
            with self.subTest(kind):
                ok, reply = bridge.block({}, request(kind, 7, 8, "", code))
                self.assertFalse(ok)
                self.assertEqual(reply.decode(), message)

    def test_errors_point_at_flow_lines(self) -> None:
        ok, reply = bridge.block({}, request("f64", 20, 21, "", "x = 1\nprint('before')\ny = x / 0\ny"))
        self.assertFalse(ok)
        self.assertEqual(reply.decode(), "before\nline 23: Python error: ZeroDivisionError: division by zero")
        ok, reply = bridge.block({}, request("f64", 20, 21, "", "def f(v):\n    return v / 0\nf(1)"))
        self.assertEqual(reply.decode(), "line 22: Python error: ZeroDivisionError: division by zero\n"
                                         "  called from line 23")
        ok, reply = bridge.block({}, request("f64", 20, 21, "", "x = 1\nx = = 2"))
        self.assertFalse(ok)
        self.assertTrue(reply.decode().startswith("line 22: Python syntax error: "), reply)

    def test_a_malformed_request_is_refused(self) -> None:
        ok, reply = bridge.block({}, "FSBLOCK 1\nf64\n1\n")
        self.assertFalse(ok)
        self.assertIn(b"could not read the block request", reply)


@unittest.skipUnless(server_up(), "native server not running")
@unittest.skipUnless(shutil.which("flow"), "flow is not on PATH")
class Live(unittest.TestCase):
    """Every path through the real server, Python and R sessions."""

    TYPED = '''struct Obs {
    x: f64,
    y: f64,
    group: string
}

function main() -> i32 {
    let xs: array<f64, 4> = [1.0, 2.0, 3.0, 4.0]
    let n: i32 = 4
    let label: string = "trial \\"A\\""
    let obs: array<Obs, 4> = [Obs { x: 1.0, y: 2.1, group: "a" }, Obs { x: 2.0, y: 3.9, group: "a" }, Obs { x: 3.0, y: 6.2, group: "b" }, Obs { x: 4.0, y: 7.8, group: "b" }]
    let mean: f64 = python(xs) {
        import statistics
        statistics.fmean(xs)
    }
    let total: i64 = r(xs, n) { as.integer(sum(xs) * n) }
    let slope: f64 = r(obs) {
        fit <- lm(y ~ x, data = obs)
        unname(coef(fit)[2])
    }
    let groups: string = python(obs) { ",".join(sorted(set(obs["group"]))) }
    let doubled: array<f64, 4> = python(xs, k = n / 2) -> array<f64, 4> { [v * k for v in xs] }
    let names: array<string, 2> = r(label) { c(toupper(label), "b c") }
    let big: bool = python(mean) { mean > 2 }
    let count: i64 = python(obs) -> i64 { len(obs) }
    python(label) {
        print("label:", label)
    }
    printf("%.2f %lld %.2f %s %.1f %s|%s %d %lld\\n", mean, total, slope, groups, doubled[3], names[0], names[1], big, count)
    return 0
}
'''

    def test_run_returns_typed_values(self) -> None:
        status, output = post("/api/run/flow", self.TYPED)
        self.assertEqual(status, 200, output)
        self.assertIn('label: trial "A"\n', output)
        self.assertIn('2.50 40 1.94 a,b 8.0 TRIAL "A"|b c 1 4\n', output)

    def test_run_maps_python_errors_to_flow_lines(self) -> None:
        source = ("function main() -> i32 {\n    let xs: array<i64, 2> = [1, 2]\n    let v: f64 = python(xs) {\n"
                  "        total = int(sum(xs))\n        print('total', total)\n        total / 0\n    }\n"
                  "    println(v)\n    return 0\n}\n")
        status, output = post("/api/run/flow", source)
        self.assertEqual(status, 422, output)
        self.assertIn("total 3\nline 6: Python error: ZeroDivisionError: division by zero", output)

    def test_run_maps_r_errors_and_type_errors(self) -> None:
        source = ("function main() -> i32 {\n    let xs: array<f64, 2> = [1.0, 2.0]\n    let v: f64 = r(xs) {\n"
                  "        m <- mean(xs)\n        stop(\"bad mean \", m)\n    }\n    println(v)\n    return 0\n}\n")
        status, output = post("/api/run/flow", source)
        self.assertEqual(status, 422, output)
        self.assertIn("line 5: R error: bad mean 1.5", output)
        source = ("function main() -> i32 {\n    let v: array<f64, 3> = r() { c(1, 2) }\n    println(v[0])\n"
                  "    return 0\n}\n")
        status, output = post("/api/run/flow", source)
        self.assertEqual(status, 422, output)
        self.assertIn("line 2: the R block returned 2 values; array<f64, 3> needs 3.", output)
        source = "function main() -> i32 {\n    let v: i64 = python() { 'text' }\n    println(v)\n    return 0\n}\n"
        status, output = post("/api/run/flow", source)
        self.assertEqual(status, 422, output)
        self.assertIn("line 2: the Python block returned str 'text'; i64 needs a whole number.", output)

    def test_check_puts_errors_on_flow_lines(self) -> None:
        source = ("function main() -> i32 {\n    let xs: array<f64, 3> = [1.0, 2.0, 3.0]\n"
                  "    let b: i64 = python(xs) -> string { str(xs) }\n    let c: f64 = r(xs, ys) {\n"
                  "        sum(xs)\n    }\n    python() {\n        x = 1\n        def f(:\n    }\n    return 0\n}\n")
        status, output = post("/api/check/flow", source)
        self.assertEqual(status, 422, output)
        found = {(int(m.group(1)), m.group(3).strip()) for m in CHECK_PATH.finditer(output)}
        self.assertIn((3, "error: Variable 'b' initialized with string but annotated as i64"), found)
        self.assertIn((4, "error: Undefined variable 'ys'"), found)
        self.assertTrue(any(line == 9 and "Python syntax error" in message for line, message in found), found)
        undefined = next(m for m in CHECK_PATH.finditer(output) if "'ys'" in m.group(3))
        self.assertEqual(int(undefined.group(2)), source.split("\n")[3].index("ys") + 1)

    def test_check_reports_a_block_written_wrongly(self) -> None:
        status, output = post("/api/check/flow", "function main() -> i32 {\n    let m: f64 = python() {\n"
                                                 "        1.0\n    return 0\n}\n")
        self.assertEqual(status, 422, output)
        match = CHECK_PATH.search(output)
        self.assertIsNotNone(match, output)
        self.assertEqual((match.group(1), match.group(2)), ("2", "27"))
        self.assertIn("has no closing }", match.group(3))
        status, output = post("/api/check/flow", self.TYPED)
        self.assertEqual(status, 200, output)

    def test_old_string_calls_still_work(self) -> None:
        source = ('import flowstudio { py, r, py_num, fmt }\n\nfunction main() -> i32 {\n'
                  '    r("old_x <- c(1, 2, 3)")\n    let m: f64 = py_num("sum([1.5, 2.5])")\n'
                  '    println(fmt(m) + " " + r("sum(old_x)") + " " + py("\'ok\'"))\n    return 0\n}\n')
        status, output = post("/api/run/flow", source)
        self.assertEqual(status, 200, output)
        self.assertIn("4 6 ok", output)

    def test_passed_names_leave_the_sessions_as_they_were(self) -> None:
        source = ('import flowstudio { py, r }\n\nfunction main() -> i32 {\n'
                  '    r("keep_me <- \'r value\'")\n    py("keep_me = \'python value\'")\n'
                  '    let a: f64 = r(keep_me = 5.0) { keep_me * 2 }\n'
                  '    let b: f64 = python(keep_me = 7.0, sorted = 1.0) { keep_me + sorted }\n'
                  '    println(a, b, r("keep_me"), py("keep_me"), py("sorted([3, 1, 2])[0]"))\n'
                  '    return 0\n}\n')
        status, output = post("/api/run/flow", source)
        self.assertEqual(status, 200, output)
        self.assertIn("10.000000 8.000000 r value python value 1", output)

    def test_console_session_runs_blocks(self) -> None:
        post("/api/flow/session/reset", "")
        status, text = post("/api/flow/session/eval", "let xs: array<f64, 3> = [2.0, 4.0, 9.0]")
        self.assertEqual(status, 200, text)
        status, text = post("/api/flow/session/eval", "let med: f64 = r(xs) { median(xs) }\nmed")
        self.assertEqual(status, 200, text)
        reply = json.loads(text)
        self.assertEqual(reply["output"].strip(), "4.0")
        self.assertIn({"name": "med", "type": "f64"}, [{"name": v["name"], "type": v["type"]} for v in reply["variables"]])
        # The value persists, and a later block can take it.
        status, text = post("/api/flow/session/eval", "python(med, xs) -> f64 { med * len(xs) }")
        self.assertEqual(status, 200, text)
        self.assertEqual(json.loads(text)["output"].strip(), "12.0")
        # Errors keep the entry's own line numbers.
        status, text = post("/api/flow/session/eval", "let a: i32 = 1\nlet b: f64 = python(a) {\n    x = a\n"
                                                      "    x / 0\n}\n")
        self.assertEqual(status, 422, text)
        self.assertIn("line 4: Python error: ZeroDivisionError", json.loads(text)["output"])

    def test_console_check_gives_block_diagnostics(self) -> None:
        post("/api/flow/session/reset", "")
        status, text = post("/api/flow/session/check", "let a: i32 = 1\nlet s: f64 = python(a) -> string {\n"
                                                       "    str(a)\n}\n")
        self.assertEqual(status, 422, text)
        diagnostics = json.loads(text)["diagnostics"]
        self.assertTrue(any(d["line"] == 2 and "initialized with string" in d["message"] for d in diagnostics), diagnostics)
        status, text = post("/api/flow/session/check", "let a: i32 = 1\nlet s: f64 = python(a, a) { 1 }\n")
        self.assertEqual(status, 422, text)
        self.assertEqual(json.loads(text)["diagnostics"][0]["line"], 2)


if __name__ == "__main__":
    unittest.main()
