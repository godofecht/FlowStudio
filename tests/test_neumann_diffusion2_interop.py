"""Bounded exact-matrix R/Python Neumann diffusion interop regression tests."""
import subprocess
import sys
import unittest

from test_neumann_diffusion2 import COORDS, STATES, STEPS
from http_neumann_diffusion2_interop import (
    MARKER, MAX_FRAME_BYTES, MAX_SOURCE_BYTES, python_source, r_source,
)


class NeumannInteropTests(unittest.TestCase):
    def test_r_source_and_budgets(self):
        source = r_source()
        self.assertIn("seq_len(32L)", source)
        self.assertIn(MARKER, source)
        self.assertIn("flowstudio_neumann2_kx[4L,] == 0", source)
        self.assertLess(len(source.encode()), MAX_SOURCE_BYTES)

    def test_real_cpython_matrix_and_corruption(self):
        observed = [tuple(float(state[c]) for c in COORDS) for state in STATES]
        self.assertEqual(len(observed), STEPS + 1)
        for sabotage, truncate, expected_success in ((False, False, True),
                                                     (True, False, False),
                                                     (False, True, False)):
            source = python_source(observed, sabotage=sabotage, truncate=truncate)
            self.assertLess(len(source.encode()), MAX_SOURCE_BYTES)
            result = subprocess.run([sys.executable, "-c", source], capture_output=True,
                                    text=True, timeout=20, check=False)
            self.assertEqual(result.returncode == 0, expected_success,
                             (sabotage, truncate, result.stderr[-1000:]))
            if expected_success:
                self.assertIn("neumann2-r-python-exact-matrix-ok", result.stdout)
            else:
                self.assertIn("AssertionError", result.stderr)

    def test_invalid_frames_and_resource_limits(self):
        observed = [tuple(float(state[c]) for c in COORDS) for state in STATES]
        self.assertLess(len(str(observed).encode()), MAX_FRAME_BYTES)
        with self.assertRaises(AssertionError):
            python_source(observed[:-1])
        with self.assertRaises(ValueError):
            python_source([tuple(float("nan") if i == 0 and s == 0 else x
                                 for i, x in enumerate(row))
                           for s, row in enumerate(observed)])


if __name__ == "__main__":
    unittest.main()
