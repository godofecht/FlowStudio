"""Numerical observation series are real sampled solver states, not UI placeholders."""
from pathlib import Path
import math
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import parse, simulate

class ObservationSeriesTest(unittest.TestCase):
    def test_navier_series_matches_final_diagnostics(self):
        source = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")
        result = simulate(parse(source))
        series = result["observations"]
        self.assertEqual(len(series), result["steps"] + 1)
        self.assertEqual(series[0]["time"], 0.0)
        self.assertAlmostEqual(series[-1]["time"], result["time"])
        self.assertAlmostEqual(series[0]["kineticEnergy"], result["initial_kinetic_energy"])
        self.assertAlmostEqual(series[-1]["kineticEnergy"], result["kinetic_energy"])
        self.assertAlmostEqual(series[-1]["maximumDivergence"], result["max_divergence"])
        self.assertTrue(all(math.isfinite(row["kineticEnergy"]) for row in series))

    def test_heat_series_matches_final_diagnostics_and_is_bounded(self):
        source = (ROOT / "examples/heat_equation_smoke.flow").read_text(encoding="utf-8")
        result = simulate(parse(source))
        series = result["observations"]
        self.assertLessEqual(len(series), 130)
        self.assertEqual(series[0]["time"], 0.0)
        self.assertAlmostEqual(series[-1]["time"], result["time"])
        self.assertAlmostEqual(series[0]["temperatureVariance"], result["initial_temperature_variance"])
        self.assertAlmostEqual(series[-1]["temperatureVariance"], result["temperature_variance"])
        self.assertAlmostEqual(series[-1]["meanTemperature"], result["mean_temperature"])
        self.assertTrue(all(series[i]["time"] < series[i + 1]["time"] for i in range(len(series) - 1)))
        self.assertTrue(all(math.isfinite(row["temperatureVariance"]) for row in series))

if __name__ == "__main__":
    unittest.main()
