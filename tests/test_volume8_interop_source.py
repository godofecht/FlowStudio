"""Independent source/oracle checks for real Flow/R/Python 3D HTTP acceptance."""
from __future__ import annotations

import contextlib
import io
from pathlib import Path
import unittest

from http_volume8_interop import _python_verifier, MAX_SOURCE_BYTES
from test_native_coupled_volume8_oracle import seeded_initial, sparse_oracle, spatial_energy

ROOT = Path(__file__).resolve().parents[1]


class Volume8InteropSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        state = seeded_initial()
        cls.energies = []
        for _ in range(64):
            state = sparse_oracle(state, 1)
            cls.energies.append(spatial_energy(state))
        cls.values = state[0] + state[1]

    def test_independent_python_kernel_accepts_all_voxels_and_energies(self):
        source = _python_verifier(self.values, self.energies)
        self.assertLess(len(source.encode("utf-8")), MAX_SOURCE_BYTES)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(compile(source, "<volume-http-kernel>", "exec"), {})
        self.assertIn("volume8-r-python-oracle-ok", output.getvalue())

    def test_python_kernel_rejects_finite_corruption_and_truncation(self):
        cases = (
            (self.values[:511] + [self.values[511] + .25] + self.values[512:],
             self.energies, "volume field mismatch"),
            (self.values, self.energies[:31] + [self.energies[31] + 1] +
             self.energies[32:], "volume energy mismatch"),
            (self.values[:-1], self.energies, "volume frame invalid"),
            (self.values, self.energies[:-1], "volume energy frame invalid"),
        )
        for values, energies, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(AssertionError, message):
                    exec(compile(_python_verifier(values, energies),
                                 "<volume-http-kernel>", "exec"), {})

    def test_oracle_does_not_pollute_persistent_python_environment(self):
        namespace = {"flowstudio_persistent": 42}
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(_python_verifier(self.values, self.energies),
                         "<volume-http-kernel>", "exec"), namespace)
        self.assertEqual(namespace["flowstudio_persistent"], 42)
        self.assertEqual(set(namespace) - {"__builtins__"}, {"flowstudio_persistent"})
        corrupted = self.values[:]
        corrupted[511] += .25
        with self.assertRaisesRegex(AssertionError, "volume field mismatch"):
            exec(compile(_python_verifier(corrupted, self.energies),
                         "<volume-http-kernel>", "exec"), namespace)
        self.assertEqual(set(namespace) - {"__builtins__"}, {"flowstudio_persistent"})

    def test_r_example_has_bounded_real_3d_restart_contract(self):
        source = (ROOT / "examples/coupled_volume8_r.R").read_text(encoding="utf-8")
        self.assertLess(len(source.encode("utf-8")), MAX_SOURCE_BYTES)
        for fragment in ("9137", "flowstudio_volume_neighbors", "%% 8L",
                         "flowstudio_volume_step", "seq_len(64L)",
                         "flowstudio_volume_checkpoint", "flowstudio_volume_restarted",
                         "identical(flowstudio_volume_replay, flowstudio_volume_state)",
                         "volume coefficients invalid", "volume physical invariant violated",
                         "FLOWSTUDIO_VOLUME_R_V1", "FLOWSTUDIO_VOLUME_R_ENERGY_V1"):
            self.assertIn(fragment, source)


if __name__ == "__main__":
    unittest.main()
