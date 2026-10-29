"""Executable numerical regression for the production CPython tensor solver.

Independent stencil-symbol oracle and subprocess acceptance. Native HTTP is
exercised separately by tests/http_smoke.py on Linux/macOS CI.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
sys.path.insert(0, str(EXAMPLES))
import complex_multimode_tensor as complex_case
from spectral_interop_python import derivative, integrate


class ComplexMultimodeTensorTests(unittest.TestCase):
    def test_full_executable_four_mode_program(self):
        result = subprocess.run(
            [sys.executable, str(EXAMPLES / "complex_multimode_tensor.py")],
            capture_output=True, text=True, timeout=25, check=True)
        self.assertTrue(result.stdout.startswith("complex-multimode-ok "), result.stdout)
        payload = json.loads(result.stdout.removeprefix("complex-multimode-ok "))
        self.assertEqual((payload["grid"], payload["modes"], payload["steps"]), (24, 4, 80))
        self.assertLess(payload["max_discrete_error"], 3e-10)
        self.assertAlmostEqual(payload["mean"], 50.0, delta=2e-11)
        coarse, medium, fine = payload["temporal_errors"]
        self.assertGreater(coarse, 3.4 * medium)
        self.assertGreater(medium, 3.4 * fine)

    def test_independent_discrete_operator_symbol_every_cell(self):
        n = complex_case.GRID
        for wx, wy, amplitude, phase in complex_case.MODES:
            with self.subTest(wave=(wx, wy)):
                samples = [complex_case.mode(x, y, wx, wy, phase)
                           for x in range(n) for y in range(n)]
                actual = derivative(samples, n, *complex_case.TENSOR)
                eigenvalue = complex_case.eigenvalue(wx, wy)
                for value, gradient in zip(samples, actual):
                    self.assertAlmostEqual(gradient, eigenvalue * value, delta=3e-12)

    def test_multiple_grid_sizes_against_independent_mode_oracle(self):
        xx, yy, xy = .009, .014, .002
        for n in (8, 12, 16):
            with self.subTest(grid=n):
                wx, wy = 1, -2
                initial = [7 + 3 * math.cos(2 * math.pi * (wx*x+wy*y)/n + .2)
                           for x in range(n) for y in range(n)]
                rate = (-4*n*n*xx*math.sin(math.pi*wx/n)**2
                        -4*n*n*yy*math.sin(math.pi*wy/n)**2
                        -2*n*n*xy*math.sin(2*math.pi*wx/n)*math.sin(2*math.pi*wy/n))
                gain = (1 + rate*.025/40 + .5*(rate*.025/40)**2)**40
                expected = [7 + (v-7)*gain for v in initial]
                actual = integrate(initial, .025, 40, xx, yy, xy)
                self.assertEqual(len(actual), n*n)
                self.assertLess(max(abs(a-b) for a,b in zip(actual, expected)), 2e-11)

    def test_oracle_detects_a_solver_that_does_not_evolve(self):
        with patch.object(complex_case, "solve", side_effect=lambda values, steps, duration=complex_case.DURATION: values):
            with self.assertRaisesRegex(AssertionError, "cellwise discrete Fourier oracle"):
                complex_case.verify()


if __name__ == "__main__":
    unittest.main()
