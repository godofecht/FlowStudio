"""Final PDE spatial fields are bounded, finite, and numerically derived."""
from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import parse, simulate
from math_flow_spatial import spatial_snapshot


class SpatialNumericsTest(unittest.TestCase):
    def test_sampler_preserves_true_endpoint_values_and_bounds(self):
        field = np.arange(64 * 48, dtype=float).reshape((64, 48))
        sample = spatial_snapshot({"temperature": field}, (2.0, 3.0))
        self.assertEqual(sample["grid"], [24, 24])
        self.assertEqual(sample["source_grid"], [64, 48])
        self.assertEqual(sample["extent"], [2.0, 3.0])
        self.assertEqual(sample["fields"]["temperature"][0][0], 0.0)
        self.assertEqual(sample["fields"]["temperature"][-1][-1], field[-1, -1])
        with self.assertRaises(ValueError):
            spatial_snapshot({"bad": np.array([[float("nan"), 0], [1, 2]])}, (1, 1))
        with self.assertRaises(ValueError):
            spatial_snapshot({"a": np.ones((8, 8)), "b": np.ones((7, 8))}, (1, 1))

    def test_heat_returns_actual_final_temperature_grid(self):
        source = (ROOT / "examples/heat_equation_smoke.flow").read_text(encoding="utf-8")
        result = simulate(parse(source))
        spatial = result["spatial"]
        self.assertEqual(spatial["source_grid"], [32, 32])
        self.assertEqual(spatial["grid"], [24, 24])
        values = np.array(spatial["fields"]["temperature"])
        self.assertEqual(values.shape, (24, 24))
        self.assertTrue(np.all(np.isfinite(values)))
        self.assertGreater(float(np.max(values) - np.min(values)), 0)
        self.assertGreaterEqual(float(np.min(values)), result["temperature_min"] - 1e-12)
        self.assertLessEqual(float(np.max(values)), result["temperature_max"] + 1e-12)

    def test_navier_returns_velocity_and_vorticity_after_projection(self):
        source = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")
        result = simulate(parse(source))
        spatial = result["spatial"]
        self.assertEqual(spatial["grid"], [16, 16])
        self.assertEqual(set(spatial["fields"]), {"velocity_x", "velocity_y", "vorticity"})
        for field in spatial["fields"].values():
            self.assertTrue(np.all(np.isfinite(np.array(field))))
        vorticity = np.array(spatial["fields"]["vorticity"])
        self.assertAlmostEqual(float(np.sqrt(np.mean(vorticity ** 2))),
                               result["vorticity_rms"], places=10)


if __name__ == "__main__":
    unittest.main()
