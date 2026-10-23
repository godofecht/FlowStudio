import json
import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "docs" / "app"))
from data_capture import capture

class CaptureTests(unittest.TestCase):
    def test_rows(self):
        result = json.loads(capture("records", {"records": [[1, None], [3, "abc"]]}))
        self.assertEqual(result["columns"], ["Column 1", "Column 2"])
        self.assertEqual(result["rows"], [["1", ""], ["3", "abc"]])

    def test_records(self):
        result = json.loads(capture("items", {"items": [{"a": 1}, {"b": 2}]}))
        self.assertEqual(result["rows"], [["1", ""], ["", "2"]])

    def test_bounded(self):
        result = json.loads(capture("x", {"x": [["z" * 1000] * 40 for _ in range(300)]}))
        self.assertTrue(result["truncated"])
        self.assertEqual(len(result["rows"]), 200)
        self.assertEqual(len(result["columns"]), 32)
        self.assertEqual(len(result["rows"][0][0]), 160)

    def test_reject_expression(self):
        with self.assertRaises(ValueError):
            capture("__import__('os').system('true')", {})

    def test_missing_and_unsupported(self):
        with self.assertRaises(KeyError):
            capture("x", {})
        with self.assertRaises(TypeError):
            capture("x", {"x": 5})

    def test_does_not_call_user_code_as_expression(self):
        class Evil:
            def __str__(self):
                raise RuntimeError("no")
        result = json.loads(capture("x", {"x": [[Evil()]]}))
        self.assertEqual(result["rows"], [["<unprintable>"]])

if __name__ == "__main__":
    unittest.main()
