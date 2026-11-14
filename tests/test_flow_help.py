"""Flow help index (src/flow_help.py).

Offline against a small fake toolchain, so the parsing is pinned down, and
against the real toolchain when `flow` is on PATH.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

import flow_help  # noqa: E402

MATH = '''# Math helpers.

export const TAU: f64 = 6.283185307179586

# Square root of x.
# Domain: x >= 0.
@libm
export function sqrt(x: f32) -> f32 {
    return x
}

# Two numbers.
export struct Pair {
    a: f64,
    b: f64
}

export function blend(a: f64,
                      b: f64,
                      t: f64) -> f64 {
    return a
}

function private_helper() -> i32 {
    return 1
}
'''

CATALOG = '''export function builtin_function_params(name: string) -> string {
    if t_eq(name, "hypot") {
        return "x: f64, y: f64"
    }
    return ""
}

export function builtin_function_return(name: string) -> string {
    if t_eq(name, "hypot") {
        return "f64"
    }
    return ""
}

export function builtin_function_doc(name: string) -> string {
    if t_eq(name, "hypot") {
        return "Length of (x, y): \\342\\210\\232(x\\302\\262 + y\\302\\262)."
    }
    return ""
}

export function syntax_hover_text(key: string) -> string {
    if t_eq(key, "while") {
        return "**`while`** - conditional loop.\\n\\n```flow\\nwhile i < n {\\n    i = i + 1\\n}\\n```"
    }
    return ""
}
'''


class FakeToolchain(unittest.TestCase):
    def setUp(self) -> None:
        self.root = tempfile.mkdtemp(prefix="flow-help-")
        os.makedirs(os.path.join(self.root, "lib", "stdlib"))
        os.makedirs(os.path.join(self.root, "tools", "lsp"))
        with open(os.path.join(self.root, "lib", "stdlib", "math.flow"), "w") as handle:
            handle.write(MATH)
        with open(os.path.join(self.root, "tools", "lsp", "catalog.flow"), "w") as handle:
            handle.write(CATALOG)
        self.saved = os.environ.get("FLOWSTUDIO_FLOW_ROOT")
        os.environ["FLOWSTUDIO_FLOW_ROOT"] = self.root

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)
        if self.saved is None:
            os.environ.pop("FLOWSTUDIO_FLOW_ROOT", None)
        else:
            os.environ["FLOWSTUDIO_FLOW_ROOT"] = self.saved

    def test_stdlib_signature_doc_and_import(self) -> None:
        reply = flow_help.search("sqrt")
        entry = next(e for e in reply["entries"] if e["kind"] == "function")
        self.assertEqual(entry["signature"], "function sqrt(x: f32) -> f32")
        self.assertEqual(entry["doc"], "Square root of x.\nDomain: x >= 0.")
        self.assertEqual(entry["usage"], "import std.math { sqrt }")
        self.assertEqual(entry["path"], "lib/stdlib/math.flow")
        self.assertEqual(entry["line"], 8)

    def test_multiline_signatures_structs_and_consts(self) -> None:
        self.assertEqual(flow_help.search("blend")["entries"][0]["signature"],
                         "function blend(a: f64,\n                      b: f64,\n                      t: f64) -> f64")
        pair = flow_help.search("Pair")["entries"][0]
        self.assertEqual(pair["kind"], "struct")
        self.assertEqual(pair["signature"], "struct Pair {\n    a: f64,\n    b: f64\n}")
        self.assertEqual(pair["doc"], "Two numbers.")
        self.assertEqual(flow_help.search("TAU")["entries"][0]["signature"], "const TAU: f64 = 6.283185307179586")
        # Only exported names of a module with exports are listed.
        self.assertEqual(flow_help.search("private_helper")["entries"], [])

    def test_catalog_builtins_and_keywords(self) -> None:
        entry = flow_help.search("hypot")["entries"][0]
        self.assertEqual(entry["kind"], "builtin")
        self.assertEqual(entry["signature"], "function hypot(x: f64, y: f64) -> f64")
        self.assertEqual(entry["doc"], "Length of (x, y): √(x² + y²).")
        keyword = flow_help.search("while")["entries"][0]
        self.assertEqual(keyword["kind"], "keyword")
        self.assertEqual(keyword["doc"], "**`while`** - conditional loop.")
        self.assertEqual(keyword["examples"][0]["code"], "while i < n {\n    i = i + 1\n}")

    def test_guide_topics_mentions_and_related(self) -> None:
        topics = [item["name"] for item in flow_help.search("")["related"]]
        self.assertIn("Structs", topics)
        structs = flow_help.search("structs")["entries"][0]
        self.assertEqual((structs["kind"], structs["name"]), ("guide", "Structs"))
        self.assertTrue(structs["examples"])
        # println has no declaration; the guide's notes and examples answer.
        println = flow_help.search("println")["entries"][0]
        self.assertEqual(println["kind"], "guide")
        self.assertIn("`println`", println["doc"])
        self.assertTrue(all("println" in example["code"] for example in println["examples"]))
        self.assertIn("sqrt", [item["name"] for item in flow_help.search("sq")["related"]])
        # A dotted name looks up its last part.
        self.assertEqual(flow_help.search("std.math.sqrt")["entries"][0]["name"], "sqrt")

    def test_unknown_and_hostile_queries_find_nothing(self) -> None:
        for query in ("no_such_name_anywhere", "'; rm -rf /", "\x00\x01"):
            reply = flow_help.search(query)
            self.assertTrue(reply["ok"])
            self.assertEqual(reply["entries"], [])
        self.assertEqual(len(flow_help.search("x" * 500)["query"]), flow_help.QUERY_LIMIT)

    def test_command_line_reads_stdin_and_prints_json(self) -> None:
        completed = subprocess.run([sys.executable, os.path.join(ROOT, "src", "flow_help.py")], input=b"Pair",
                                   capture_output=True, check=True, env=dict(os.environ))
        self.assertEqual(json.loads(completed.stdout)["entries"][0]["name"], "Pair")


@unittest.skipUnless(shutil.which("flow"), "flow is not on PATH")
class RealToolchain(unittest.TestCase):
    def setUp(self) -> None:
        self.saved = os.environ.pop("FLOWSTUDIO_FLOW_ROOT", None)

    def tearDown(self) -> None:
        if self.saved is not None:
            os.environ["FLOWSTUDIO_FLOW_ROOT"] = self.saved

    def test_standard_library_is_indexed(self) -> None:
        reply = flow_help.search("io_read_text")
        self.assertTrue(reply["sources"]["stdlib"])
        entry = next(e for e in reply["entries"] if e["kind"] == "function")
        self.assertEqual(entry["signature"], "function io_read_text(path: string) -> FileRead")
        self.assertEqual(entry["usage"], "import std.io { io_read_text }")
        self.assertTrue(entry["doc"])


if __name__ == "__main__":
    unittest.main()
