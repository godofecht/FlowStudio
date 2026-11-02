"""Fail-closed runtime and declaration tests for both executable PDE frontends."""
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import (FlowMathError, parse, simulate, validated_grid,
                       validated_pde_geometry, MAX_PDE_CELL_STEPS)

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


    def test_both_backends_reject_nonfinite_non_numeric_and_huge_durations(self):
        from decimal import Decimal
        bad_durations = (float("nan"), float("inf"), -float("inf"),
                         0.0, -0.01, False, True, "0.01",
                         Decimal("0.01"), 1 + 0j, [], {},
                         10**1000, -(10**1000), 1e308)
        for source in (NAVIER, HEAT):
            model = parse(source)
            for duration in bad_durations:
                with self.subTest(model=type(model).__name__,
                                  duration=type(duration).__name__):
                    with self.assertRaisesRegex(FlowMathError,
                                                "duration must be finite and positive|between 1 and 200000 steps"):
                        simulate(model, grid=16, until=duration)

    def test_both_backends_reject_excessive_finite_step_counts(self):
        for source in (NAVIER, HEAT):
            model = parse(source)
            for duration in (model.step * 200001, 1e300):
                with self.subTest(model=type(model).__name__, duration=duration):
                    with self.assertRaisesRegex(FlowMathError,
                                                "between 1 and 200000 steps"):
                        simulate(model, grid=16, until=duration)

    def test_both_backends_execute_deterministic_bounded_duration_override(self):
        for source, expected_steps, observable in (
            (NAVIER, 50, "kinetic_energy"),
            (HEAT, 50, "mean_temperature"),
        ):
            model = parse(source)
            first = simulate(model, grid=16, until=0.005)
            second = simulate(model, grid=16, until=0.005)
            self.assertEqual(first["steps"], expected_steps)
            self.assertEqual(first["grid"], [16, 16])
            self.assertEqual(first["time"], 0.005)
            self.assertTrue(math.isfinite(first[observable]))
            self.assertEqual(first[observable], second[observable])


    def test_production_cli_executes_and_rejects_duration_overrides(self):
        import json
        import subprocess
        for example, expected_steps, observable in (
            ("navier_stokes_smoke.flow", 50, "kinetic_energy"),
            ("heat_piecewise_forcing.flow", 50, "mean_temperature"),
        ):
            base = [sys.executable, str(ROOT / "src/math_flow.py"),
                    str(ROOT / "examples" / example), "--grid", "16", "--until"]
            with self.subTest(example=example, duration="0.005"):
                completed = subprocess.run(base + ["0.005"], capture_output=True,
                                           text=True, timeout=15, check=False)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                result = json.loads(completed.stdout)
                self.assertTrue(result["ok"])
                self.assertEqual(result["steps"], expected_steps)
                self.assertEqual(result["grid"], [16, 16])
                self.assertEqual(result["time"], 0.005)
                self.assertTrue(math.isfinite(result[observable]))
            for invalid in ("nan", "inf", "-inf", "-0.01", "0", "1e308"):
                with self.subTest(example=example, duration=invalid):
                    completed = subprocess.run(base[:-1] + [f"--until={invalid}"], capture_output=True,
                                               text=True, timeout=15, check=False)
                    self.assertEqual(completed.returncode, 2, completed.stderr)
                    failure = json.loads(completed.stderr)
                    self.assertIs(failure["ok"], False)
                    self.assertRegex(failure["error"],
                                     "duration must be finite and positive|between 1 and 200000 steps")


    def test_exact_cell_step_budget_boundary(self):
        self.assertEqual(MAX_PDE_CELL_STEPS, 4_194_304)
        self.assertEqual(validated_pde_geometry(1.0, 1.0, 512, 512, 16),
                         (1 / 512, 1 / 512))
        with self.assertRaisesRegex(FlowMathError, "cell-step budget"):
            validated_pde_geometry(1.0, 1.0, 512, 512, 17)

    def test_both_real_pde_backends_fail_closed_before_excessive_work(self):
        for source in (NAVIER, HEAT):
            model = parse(source)
            with self.subTest(model=type(model).__name__):
                with self.assertRaisesRegex(FlowMathError, "cell-step budget"):
                    simulate(model, grid=512, until=0.005)

    def test_both_real_pde_backends_reject_unresolvable_cell_geometry(self):
        for source in (NAVIER, HEAT):
            for axes in ("1e-300m × 1m", "1m × 1e-300m",
                         "1e308m × 1m", "1m × 1e308m"):
                with self.subTest(model="heat" if source == HEAT else "navier", axes=axes):
                    altered = source.replace("extent     = 1m × 1m",
                                             f"extent     = {axes}", 1)
                    self.assertNotEqual(altered, source)
                    model = parse(altered)
                    with self.assertRaisesRegex(FlowMathError, "cell geometry"):
                        simulate(model, grid=16, until=0.0001)

    def test_production_cli_reports_structured_geometry_and_work_errors(self):
        import json
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            for example, source in (("navier", NAVIER), ("heat", HEAT)):
                altered = source.replace("extent     = 1m × 1m",
                                         "extent     = 1e-300m × 1m", 1)
                self.assertNotEqual(altered, source)
                source_file = Path(directory) / f"{example}.flow"
                source_file.write_text(altered, encoding="utf-8")
                cases = (
                    (source_file, "16", "0.0001", "cell geometry"),
                    (ROOT / "examples" / ("navier_stokes_smoke.flow"
                                          if example == "navier" else "heat_piecewise_forcing.flow"),
                     "512", "0.005", "cell-step budget"),
                )
                for path, grid, until, expected in cases:
                    with self.subTest(example=example, expected=expected):
                        completed = subprocess.run(
                            [sys.executable, str(ROOT / "src/math_flow.py"),
                             str(path), "--grid", grid, "--until", until],
                            capture_output=True, text=True, timeout=15, check=False)
                        self.assertEqual(completed.returncode, 2, completed.stderr)
                        self.assertEqual(completed.stdout, "")
                        failure = json.loads(completed.stderr)
                        self.assertIs(failure["ok"], False)
                        self.assertIn(expected, failure["error"])


if __name__ == "__main__":
    unittest.main()
