"""Native Python environment inspection must be bounded and non-executing."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("flowstudio_python_kernel", ROOT / "src/python_kernel.py")
assert spec and spec.loader
kernel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kernel)


class NativePythonEnvironmentTest(unittest.TestCase):
    def test_builtin_metadata_and_unicode(self):
        result = json.loads(kernel.inspect_namespace({
            "__name__": "__main__", "café": [1, 2], "number": 42,
            "mapping": {"x": 1}, "empty": None,
        }))
        entries = {item["name"]: item for item in result["variables"]}
        self.assertNotIn("__name__", entries)
        self.assertEqual(entries["café"]["name"], "café")
        self.assertEqual(entries["café"]["type"], "list")
        self.assertEqual(entries["café"]["size"], 2)
        self.assertEqual([child["name"] for child in entries["café"]["children"]], ["[0]", "[1]"])
        self.assertEqual(entries["number"]["type"], "int")
        self.assertIsNone(entries["number"]["size"])
        self.assertEqual(entries["mapping"]["size"], 1)
        self.assertFalse(result["truncated"])

    def test_does_not_invoke_user_repr_or_len(self):
        calls = []
        class Adversarial:
            def __repr__(self):
                calls.append("repr")
                raise RuntimeError("repr executed")
            def __len__(self):
                calls.append("len")
                raise RuntimeError("len executed")
        result = json.loads(kernel.inspect_namespace({"object": Adversarial()}))
        self.assertEqual(calls, [])
        self.assertEqual(result["variables"][0]["type"], "Adversarial")
        self.assertIsNone(result["variables"][0]["size"])

    def test_nested_containers_and_cycles_are_bounded(self):
        loop = []
        loop.append(loop)
        nested = {"items": [1, {"deep": [2]}], "cycle": loop}
        result = json.loads(kernel.inspect_namespace({"nested": nested}))
        root = result["variables"][0]
        self.assertEqual(root["type"], "dict")
        self.assertEqual(root["children"][0]["name"], '["items"]')
        self.assertEqual(root["children"][0]["children"][0]["type"], "int")
        self.assertEqual(root["children"][1]["children"][0]["type"], "list")
        # Recursive descent is bounded to two child levels, even on cycles.
        self.assertLessEqual(len(json.dumps(result)), 65536)

    def test_nested_values_do_not_invoke_user_defined_methods(self):
        called = []
        class Dangerous:
            def __repr__(self):
                called.append("repr")
                raise RuntimeError("repr")
            def __iter__(self):
                called.append("iter")
                raise RuntimeError("iter")
            def __getitem__(self, key):
                called.append("getitem")
                raise RuntimeError("getitem")
            def __len__(self):
                called.append("len")
                raise RuntimeError("len")
        bad = Dangerous()
        data = {"x": [bad], bad: bad}
        result = json.loads(kernel.inspect_namespace({"data": data}))
        self.assertEqual(called, [])
        children = result["variables"][0]["children"]
        self.assertEqual(children[0]["children"][0]["type"], "Dangerous")
        self.assertTrue(result["truncated"])

    def test_child_limits_and_json_budget(self):
        huge = [{"long": "a" * 500000} for _ in range(20)]
        result = json.loads(kernel.inspect_namespace({"huge": huge}))
        self.assertTrue(result["truncated"])
        self.assertEqual(len(result["variables"][0]["children"]), 12)
        self.assertTrue(result["variables"][0]["truncated"])
        many = {f"v{i}": list(range(20)) for i in range(128)}
        raw = kernel.inspect_namespace(many)
        self.assertLessEqual(len(raw), 65536)
        self.assertTrue(json.loads(raw)["truncated"])

    def test_entry_and_size_limits(self):
        result = json.loads(kernel.inspect_namespace({f"v{i}": i for i in range(200)}))
        self.assertEqual(len(result["variables"]), 128)
        self.assertTrue(result["truncated"])
        giant = "n" * 10000
        result = kernel.inspect_namespace({f"{i}{giant}": 0 for i in range(128)})
        self.assertLessEqual(len(result), 65536)
        self.assertEqual(len(json.loads(result)["variables"]), 128)


if __name__ == "__main__":
    unittest.main()
