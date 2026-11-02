"""Bounded reproducible long-horizon R/Python interop payload acceptance."""
import subprocess
import sys
import unittest

from test_diffusion1_long_horizon import SIDE, STEPS, trajectory
from http_diffusion1_long_horizon_interop import (
    MARKER, MAX_FRAME_BYTES, MAX_SOURCE_BYTES, python_source, r_source,
)


class LongHorizonInteropTests(unittest.TestCase):
    def test_r_source_and_resource_budget(self):
        source = r_source()
        self.assertIn("seq_len(64L)", source)
        self.assertIn(MARKER, source)
        self.assertIn("flowstudio_long_energy", source)
        self.assertLess(len(source.encode()), MAX_SOURCE_BYTES)

    def test_real_cpython_matrix_and_sabotage(self):
        states, _ = trajectory()
        observed = [tuple(float(x) for x in row) for row in states]
        self.assertEqual(len(observed), STEPS + 1)
        self.assertTrue(all(len(row) == SIDE for row in observed))
        for corrupt, truncate, expected_status in ((False, False, 0),
                                                   (True, False, 1),
                                                   (False, True, 1)):
            source = python_source(observed, sabotage=corrupt, truncate=truncate)
            self.assertLess(len(source.encode()), MAX_SOURCE_BYTES)
            result = subprocess.run([sys.executable, "-c", source], capture_output=True,
                                    text=True, timeout=15, check=False)
            self.assertEqual(result.returncode == 0, expected_status == 0,
                             (corrupt, truncate, result.stderr[-1000:]))
            if expected_status == 0:
                self.assertIn("long-diffusion-r-python-matrix-ok", result.stdout)
            else:
                self.assertIn("AssertionError", result.stderr)

    def test_frame_size_and_input_rejection(self):
        states, _ = trajectory()
        observed = [tuple(float(x) for x in row) for row in states]
        self.assertLess(len(str(observed).encode()), MAX_FRAME_BYTES)
        with self.assertRaises(AssertionError):
            python_source(observed[:-1])
        with self.assertRaises(ValueError):
            python_source([tuple(float("nan") if i == 0 and s == 0 else x
                                 for i, x in enumerate(row))
                           for s, row in enumerate(observed)])


if __name__ == "__main__":
    unittest.main()
