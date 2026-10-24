"""Real CPython acceptance for the browser's Pyodide environment helper.

These tests exercise actual Python objects, not a mocked interpreter. They do
not by themselves establish physical-browser Pyodide execution.
"""
import importlib.util
import json
from pathlib import Path
import unittest

HELPER = Path(__file__).resolve().parents[1] / "docs" / "app" / "environment_capture.py"
spec = importlib.util.spec_from_file_location("flowstudio_environment_capture", HELPER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EnvironmentCaptureTests(unittest.TestCase):
    def test_nested_builtin_shapes_and_safe_scalars(self):
        result = module.capture({"x": [1, {"k": (True, "hello")}], "y": 3.25,
                                 "_fs_hidden": 1})
        self.assertEqual([v["name"] for v in result["variables"]], ["x", "y"])
        self.assertEqual(result["variables"][0]["shape"], [2])
        self.assertEqual(result["variables"][0]["children"][1]["children"][0]["name"], '["k"]')
        self.assertEqual(result["variables"][1]["preview"], "3.25")

    def test_user_methods_are_not_invoked(self):
        calls = []

        class Hostile:
            def __repr__(self):
                calls.append("repr")
                raise RuntimeError("repr")

            def __len__(self):
                calls.append("len")
                raise RuntimeError("len")

            def __iter__(self):
                calls.append("iter")
                raise RuntimeError("iter")

            def __str__(self):
                calls.append("str")
                raise RuntimeError("str")

        item = Hostile()
        result = module.capture({"object": item, "nested": [item]})
        self.assertEqual(calls, [])
        self.assertEqual(result["variables"][0]["preview"], "<not evaluated>")
        self.assertEqual(result["variables"][1]["children"][0]["preview"], "<not evaluated>")

    def test_cycles_limits_and_encoding(self):
        cyclic = []
        cyclic.append(cyclic)
        result = module.capture({"cycle": cyclic, "many": list(range(1000)),
                                 **{f"v{i}": i for i in range(300)}})
        self.assertTrue(result["truncated"])
        self.assertTrue(result["variables"][0]["children"][0]["cycle"])
        self.assertLessEqual(len(result["variables"]), 128)
        self.assertLessEqual(len(json.dumps(result, ensure_ascii=True).encode()), 65536)

    def test_invalid_namespace_and_giant_integer(self):
        with self.assertRaises(TypeError):
            module.capture([])
        result = module.capture({"huge": 2 ** 100000})
        self.assertEqual(result["variables"][0]["preview"], "<large integer>")


if __name__ == "__main__":
    unittest.main()
