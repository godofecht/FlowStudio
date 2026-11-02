"""Isolated exact-matrix and payload tests; production HTTP runs in native CI."""
import subprocess
import sys
import unittest

from test_dirichlet_diffusion3 import COORDS, STATES, STEPS
from http_dirichlet_diffusion3_interop import (MAX_FRAME_BYTES, MAX_SOURCE_BYTES,
                                               MARKER, python_source, r_source)


class DirichletInteropTests(unittest.TestCase):
    @staticmethod
    def frames():
        return [tuple(float(state[c]) for c in COORDS) for state in STATES]

    def test_r_source_full_3d_faces_and_resource_limit(self):
        source = r_source()
        self.assertLess(len(source.encode("utf-8")), MAX_SOURCE_BYTES)
        self.assertIn(MARKER, source)
        self.assertIn("seq_len(24L)", source)
        self.assertIn("flowstudio_dirichlet3_stride <- c(9L,3L,1L)", source)
        self.assertIn("flowstudio_dirichlet3_lo", source)
        self.assertIn("flowstudio_dirichlet3_hi", source)

    def test_independent_exact_matrix_all_675_values(self):
        frames = self.frames()
        self.assertEqual((len(frames), len(frames[0])), (STEPS + 1, 27))
        source = python_source(frames)
        self.assertLess(len(source.encode("utf-8")), MAX_SOURCE_BYTES)
        result = subprocess.run([sys.executable, "-c", source], capture_output=True,
                                text=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("dirichlet3-r-python-exact-matrix-ok", result.stdout)

    def test_corruption_and_truncated_frame_fail_closed(self):
        for kwargs, diagnostic in (({"sabotage": True}, "Dirichlet oracle mismatch"),
                                   ({"truncate": True}, "Dirichlet frame invalid")):
            with self.subTest(kwargs=kwargs):
                result = subprocess.run([sys.executable, "-c",
                                         python_source(self.frames(), **kwargs)],
                                        capture_output=True, text=True, timeout=15,
                                        check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(diagnostic, result.stderr)

    def test_nonfinite_and_oversized_frames_rejected(self):
        frames = self.frames()
        frames[3] = tuple(float("nan") if i == 5 else v
                          for i, v in enumerate(frames[3]))
        with self.assertRaises(ValueError):
            python_source(frames)
        frames = self.frames()
        frames[4] = tuple(1e200 for _ in COORDS)
        self.assertLess(MAX_FRAME_BYTES, MAX_SOURCE_BYTES)
        with self.assertRaises(AssertionError):
            python_source(frames * 2)


if __name__ == "__main__":
    unittest.main()
