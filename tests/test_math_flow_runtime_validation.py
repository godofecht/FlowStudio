"""Fail-closed runtime and declaration tests for both executable PDE frontends."""
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate, validated_grid

NAVIER = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")
HEAT = (ROOT / "examples/heat_piecewise_forcing.flow").read_text(encoding="utf-8")


class RuntimeValidationTest(unittest.TestCase):
    def test_navier_duplicate_constants_and_fields_fail_closed(self):
        for declaration, expected in (
            ("    const density            = 1kg/m³", "Duplicate model constant density"),
            ("    field velocity: Vector²<MetersPerSecond>", "Duplicate model field velocity"),
        ):
            with self.subTest(declaration=declaration):
                duplicated = NAVIER.replace(declaration, declaration + "\n" + declaration, 1)
                self.assertNotEqual(duplicated, NAVIER)
                with self.assertRaisesRegex(FlowMathError, expected):
                    parse(duplicated)

    def test_both_backends_reject_invalid_runtime_grid_overrides(self):
        for source in (NAVIER, HEAT):
            model = parse(source)
            for grid in (False, True, 0, -1, 7, 513, 16.0, 16.5,
                         float("nan"), float("inf"), "16", [], {}):
                with self.subTest(source=type(model).__name__, grid=repr(grid)):
                    with self.assertRaisesRegex(FlowMathError, "override must be an integer"):
                        simulate(model, grid=grid)
            self.assertEqual(validated_grid(model.width, model.height, None),
                             (model.width, model.height))
            self.assertEqual(validated_grid(model.width, model.height, 16), (16, 16))

    def test_valid_overrides_execute_real_pde_backends(self):
        for source in (NAVIER, HEAT):
            model = parse(source)
            result = simulate(model, grid=16)
            self.assertEqual(result["steps"], 10 if source == NAVIER else 100)
            self.assertTrue(math.isfinite(result["kinetic_energy"]
                                          if source == NAVIER else result["mean_temperature"]))

    def test_navier_nonfinite_or_invalid_duration_fails_as_flow_error(self):
        model = parse(NAVIER)
        for duration in (float("nan"), float("inf"), -float("inf"),
                         0.0, -0.01, True, "0.01"):
            with self.subTest(duration=repr(duration)):
                with self.assertRaisesRegex(FlowMathError, "duration must be finite and positive"):
                    simulate(model, until=duration)


if __name__ == "__main__":
    unittest.main()
