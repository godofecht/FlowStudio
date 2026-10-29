"""Independent local gate for the actual Python half of FlowStudio spectral interop.

The real Flow-owned HTTP Python->R->plot acceptance is in tests/http_smoke.py;
this suite does not pretend to execute R when Rscript is unavailable.
"""
from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROGRAM = ROOT / "examples" / "spectral_interop_python.py"
SPEC = importlib.util.spec_from_file_location("spectral_interop_python", PROGRAM)
assert SPEC and SPEC.loader
spectral = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(spectral)


class SpectralInteropTests(unittest.TestCase):
    def test_real_program_json_and_every_cell_against_discrete_fourier_oracle(self):
        run = subprocess.run([sys.executable, str(PROGRAM)], capture_output=True,
                             text=True, timeout=20, check=True)
        payload = json.loads(run.stdout)
        self.assertEqual((payload["grid"], payload["mode_x"], payload["mode_y"],
                          payload["steps"]), (16, 2, 3, 120))
        values = payload["values"]
        self.assertEqual(len(values), 256)
        eigenvalue = (-4 * 16**2 * .012 * math.sin(math.pi * 2 / 16)**2
                      -4 * 16**2 * .018 * math.sin(math.pi * 3 / 16)**2
                      -2 * 16**2 * .004 * math.sin(2 * math.pi * 2 / 16)
                      * math.sin(2 * math.pi * 3 / 16))
        z = eigenvalue * .03 / 120
        amplitude = 7 * (1 + z + z*z/2)**120
        for x in range(16):
            for y in range(16):
                expected = 300 + amplitude * math.cos(2 * math.pi * (2*x+3*y)/16)
                self.assertAlmostEqual(values[x*16+y], expected, delta=2e-10)
        self.assertAlmostEqual(sum(values)/256, 300, delta=2e-10)

    def test_fail_closed_on_invalid_tensors_grids_and_resource_limits(self):
        initial = spectral.initial_field()
        cases = [
            (initial[:-1], .03, 120, .012, .018, .004),
            (initial, -.03, 120, .012, .018, .004),
            (initial, .03, 0, .012, .018, .004),
            (initial, .03, 2001, .012, .018, .004),
            (initial, .03, 120, -.012, .018, .004),
            (initial, .03, 120, .012, .018, .02),
            (initial, .03, 120, .012, .018, float("nan")),
            (initial, 100., 1, .012, .018, .004),
        ]
        for case in cases:
            with self.subTest(case=case[1:]), self.assertRaises(ValueError):
                spectral.integrate(*case)
        with self.assertRaises(ValueError):
            spectral.integrate([float("nan")] + initial[1:], .03, 120)

    def test_zero_duration_and_cross_diffusion_change_the_solution(self):
        initial = spectral.initial_field()
        self.assertEqual(spectral.integrate(initial, 0., 120), initial)
        with_cross = spectral.integrate(initial, .03, 120)
        without_cross = spectral.integrate(initial, .03, 120, .012, .018, 0.)
        self.assertGreater(max(abs(a-b) for a,b in zip(with_cross, without_cross)), .01)
        self.assertEqual(with_cross, spectral.integrate(initial, .03, 120))


if __name__ == "__main__":
    unittest.main()
