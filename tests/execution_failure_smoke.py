#!/usr/bin/env python3
"""Live acceptance tests; requires the real FlowStudio server on port 8751.

Run: python3 tests/execution_failure_smoke.py
"""
import shutil
import unittest
from http_smoke import request


HEADERS = {"X-FlowStudio-Intent": "run"}


class ExecutionFailureSmoke(unittest.TestCase):
    def test_python_runtime_exception(self):
        status, output = request("POST", "/api/run/python",
                                 'print("before-error")\nraise ValueError("expected-error")',
                                 HEADERS)
        self.assertEqual(status, 422, output)
        self.assertIn("before-error", output)
        self.assertIn("ValueError", output)

    def test_python_syntax_error(self):
        status, output = request("POST", "/api/run/python", "if :\n    pass", HEADERS)
        self.assertEqual(status, 422, output)
        self.assertIn("SyntaxError", output)

    @unittest.skipUnless(shutil.which("R"), "R is not installed")
    def test_r_runtime_exception(self):
        status, output = request("POST", "/api/run/r", "stop('expected-r-error')", HEADERS)
        self.assertEqual(status, 422, output)
        self.assertIn("expected-r-error", output)

    @unittest.skipUnless(shutil.which("flow"), "Flow is not installed")
    def test_flow_compiler_error(self):
        status, output = request("POST", "/api/run/flow",
                                 "function main() -> i32 { let x: = }", HEADERS)
        self.assertEqual(status, 422, output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
