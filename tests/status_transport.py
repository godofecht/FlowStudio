#!/usr/bin/env python3
"""Exercise HTTP failure status codes against the real C transport harness.

Run: python3 tests/status_transport.py
"""
import unittest
import transport_smoke


class ExecutionStatusTransportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        transport_smoke.TransportTest.setUpClass()

    @classmethod
    def tearDownClass(cls):
        transport_smoke.TransportTest.tearDownClass()

    def test_nonzero_exit_response(self):
        self.assertEqual(transport_smoke.request(path="/status/422"),
                         (422, b"execution failed"))

    def test_missing_interpreter_response(self):
        self.assertEqual(transport_smoke.request(path="/status/503"),
                         (503, b"interpreter unavailable"))

    def test_execution_timeout_response(self):
        self.assertEqual(transport_smoke.request(path="/status/504"),
                         (504, b"execution timed out"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
