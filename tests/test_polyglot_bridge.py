"""The Flow, Python and R bridge.

Offline: value conversion in src/flowstudio_bridge.py and the R bridge
helpers. Live (needs the native server on 127.0.0.1:8751 with R and flow):
every example in examples/polyglot runs, and calls cross in each direction.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

import flowstudio_bridge as bridge  # noqa: E402

URL = "http://127.0.0.1:8751"


def server_up() -> bool:
    try:
        with urllib.request.urlopen(URL + "/health", timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def run(language: str, code: str) -> tuple[int, str]:
    request = urllib.request.Request(URL + "/api/run/" + language, data=code.encode("utf-8"),
                                     method="POST", headers={"X-FlowStudio-Intent": "run",
                                                             "Content-Type": "text/plain"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8")


class ConversionTests(unittest.TestCase):
    def test_python_values_become_r_source(self) -> None:
        self.assertEqual(bridge.to_r(None), "NULL")
        self.assertEqual(bridge.to_r(True), "TRUE")
        self.assertEqual(bridge.to_r(3), "3L")
        self.assertEqual(bridge.to_r(2.5), "2.5")
        self.assertEqual(bridge.to_r(float("nan")), "NaN")
        self.assertEqual(bridge.to_r('say "hi"\n'), '"say \\"hi\\"\\n"')
        self.assertEqual(bridge.to_r([1, 2, None]), "c(1L, 2L, NA_integer_)")
        self.assertEqual(bridge.to_r([1, 2.5]), "c(1.0, 2.5)")
        self.assertEqual(bridge.to_r(["a", None]), 'c("a", NA_character_)')
        self.assertEqual(bridge.to_r([1, "a"]), 'list(1L, "a")')
        self.assertEqual(bridge.to_r({"a b": 1}), "list(`a b` = 1L)")

    def test_records_and_frames_become_data_frames(self) -> None:
        source = bridge.to_r([{"x": 1, "y": "a"}, {"x": 2, "y": "b"}])
        self.assertEqual(source, 'data.frame(`x` = c(1L, 2L), `y` = c("a", "b"), '
                                 'check.names = FALSE, stringsAsFactors = FALSE)')
        frame = bridge.Frame.from_rows([{"x": 1}, {"x": 2, "z": 3}])
        self.assertEqual(frame, {"x": [1, 2], "z": [None, 3]})
        self.assertEqual(frame.nrow, 2)
        self.assertIn("[2 rows x 2 columns]", repr(frame))

    def test_r_json_becomes_python_values(self) -> None:
        value = bridge._from_json(json.loads(
            '{"__frame__":true,"names":["a","b"],"columns":[[1,2],["x",null]]}'))
        self.assertIsInstance(value, bridge.Frame)
        self.assertEqual(value.rows(), [{"a": 1, "b": "x"}, {"a": 2, "b": None}])
        self.assertEqual(bridge._from_json({"__matrix__": [[1, 2], [3, 4]]}), [[1, 2], [3, 4]])

    def test_text_for_flow(self) -> None:
        self.assertEqual(bridge._to_text(None), "")
        self.assertEqual(bridge._to_text(True), "true")
        self.assertEqual(bridge._to_text([1, 2.5]), "1\n2.5")
        self.assertEqual(bridge._to_text([{"a": 1, "b": "x,y"}]), 'a,b\n1,"x,y"')

    def test_evaluate_returns_last_expression_and_trims_tracebacks(self) -> None:
        namespace: dict = {}
        ok, payload = bridge.evaluate(namespace, "t", "x = 4\nprint('hi')\nx * 2")
        self.assertTrue(ok)
        self.assertEqual(payload, b"hi\n8")
        ok, payload = bridge.evaluate(namespace, "r", "[1, 2]")
        self.assertEqual(payload, b'list(value = c(1L, 2L), output = "")')
        ok, payload = bridge.evaluate(namespace, "t", "1 / 0")
        self.assertFalse(ok)
        self.assertIn(b"ZeroDivisionError", payload)
        self.assertNotIn(b"flowstudio_bridge.py", payload)

    def test_program_output_drops_the_build_log(self) -> None:
        log = "Compiling...\n" + "-" * 40 + "\nhello\n" + "-" * 40 + "\nProgram finished\n"
        self.assertEqual(bridge._program_output(log), "hello")


@unittest.skipUnless(shutil.which("Rscript"), "R is not installed")
class RHelperTests(unittest.TestCase):
    def r(self, code: str) -> str:
        script = (
            'json_quote <- function(value) encodeString(value, quote = "\\"")\n'
            'sys.source("src/flowstudio_bridge.R", envir = environment())\n' + code)
        return subprocess.run(["Rscript", "--vanilla", "-e", script], cwd=ROOT,
                              capture_output=True, text=True, check=True).stdout

    def test_r_values_as_json(self) -> None:
        out = self.r('cat(.to_json(data.frame(a = 1:2, b = c("x", NA))), "\\n");'
                     'cat(.to_json(c(1.5, NA, Inf)), "\\n");'
                     'cat(.to_json(list(k = TRUE)), "\\n")')
        frame, vector, listed = [line.strip() for line in out.strip().split("\n")]
        self.assertEqual(json.loads(frame),
                         {"__frame__": True, "names": ["a", "b"], "columns": [[1, 2], ["x", None]]})
        self.assertEqual(vector, "[1.5,null,Infinity]")
        self.assertEqual(json.loads(listed), {"k": True})

    def test_r_values_as_text(self) -> None:
        out = self.r('cat(.to_text(data.frame(a = 1:2, b = c("x", "y"))), "\\n---\\n");'
                     'cat(.to_text(c(TRUE, FALSE)), "\\n")')
        self.assertEqual(out, '"a","b"\n1,"x"\n2,"y" \n---\ntrue\nfalse \n')


@unittest.skipUnless(server_up() and shutil.which("Rscript") and shutil.which("flow"),
                     "the FlowStudio server, R and flow are needed")
class LiveBridgeTests(unittest.TestCase):
    def test_calls_cross_in_every_direction(self) -> None:
        status, out = run("python", "import flowstudio as fs\nfs.R.v = [1, 2, 3]\nprint(fs.r('sum(v)'))")
        self.assertEqual((status, out.strip()), (200, "6"))
        status, out = run("r", 'py$w <- c(2, 4)\ncat(py("sum(w)"), "\\n")')
        self.assertEqual((status, out.strip()), (200, "6"))
        status, out = run("flow", 'import flowstudio { py, r }\nfunction main() -> i32 {\n'
                                  '    println(py("len(w)") + " " + r("sum(v)"))\n    return 0\n}\n')
        self.assertEqual((status, out.strip()), (200, "2 6"))

    def test_reentry_is_refused_with_a_clear_error(self) -> None:
        status, out = run("r", 'py("import flowstudio as fs\\nfs.r(\\"1\\")")')
        self.assertEqual(status, 422)
        self.assertIn("R is busy", out)

    def test_bridge_errors_stop_the_flow_program(self) -> None:
        status, out = run("flow", 'import flowstudio { py }\nfunction main() -> i32 {\n'
                                  '    println(py("1 / 0"))\n    return 0\n}\n')
        self.assertEqual(status, 422)
        self.assertIn("ZeroDivisionError", out)

    def test_every_polyglot_example_runs(self) -> None:
        expected = {
            "python-drives-r": ["R squared: 0.827"],
            "r-drives-python": ["Python parsed 10 requests", "95th percentile latency: 640 ms"],
            "flow-drives-both": ["R: peak on day 36", "Python: mean infected share"],
            "python-runs-flow": ["primes below 2,000,000: 148,933"],
            "epidemic-pipeline": ["Flow sent 3 runs of 120 days", "Python sent 360 rows",
                                  "Python check: 0.1 0.2 0.35"],
        }
        folder = os.path.join(ROOT, "examples", "polyglot")
        for name, needles in expected.items():
            with open(os.path.join(folder, name, "example.json"), encoding="utf-8") as handle:
                meta = json.load(handle)
            output = ""
            for file in meta["files"]:
                language = {"flow": "flow", "py": "python", "R": "r"}[file.rsplit(".", 1)[1]]
                with open(os.path.join(folder, name, file), encoding="utf-8") as handle:
                    status, out = run(language, handle.read())
                self.assertEqual(status, 200, f"{name}/{file}: {out}")
                output += out
            for needle in needles:
                self.assertIn(needle, output, name)


if __name__ == "__main__":
    unittest.main()
