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
        self.assertEqual(entries["café"], {"name": "café", "type": "list", "size": 2})
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
