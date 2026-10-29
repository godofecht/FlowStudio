"""High-complexity, real numerical acceptance for the bounded mathematical Flow runtime.

The Fourier oracle is derived from the *discrete* centered operators, not from
the simulator's implementation or its emitted semantic trace. Every case runs
the production parser and RK2 solver. No mocked compiler or numerical kernel.
"""
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate

PROGRAM = ROOT / "examples/heat_fourier_tensor_validation.flow"
SOURCE = PROGRAM.read_text(encoding="utf-8")
INITIAL = "300K + 10K * sin(4πx / 1m + 6πy / 1m)"
OPERATOR = "∂ₓᵧ(temperature)"


def variant(n=24, kx=2, ky=3, cross=0.01, step="0.0001s", duration="0.01s"):
    """Change only verified source declarations, never construct fake AST nodes."""
    assert INITIAL in SOURCE and "24 × 24" in SOURCE
    assert "0.01m²/s\n    field" in SOURCE
    source = SOURCE.replace("24 × 24", f"{n} × {n}")
    source = source.replace(INITIAL,
                            f"300K + 10K * sin({2*kx}πx / 1m + {2*ky}πy / 1m)")
    source = source.replace("const crossDiffusivity = 0.01m²/s",
                            f"const crossDiffusivity = {cross}m²/s")
    source = source.replace("timeStep = 0.0001s", f"timeStep = {step}")
    source = source.replace("Evolve(until: 0.01s)", f"Evolve(until: {duration})")
    return source


def eigenvalue(n, kx, ky, cross):
    """Independent Fourier eigenvalue for Dxx, Dyy and centered mixed ∂xy."""
    return (-4 * n*n * 0.01 * math.sin(math.pi*kx/n)**2
            -4 * n*n * 0.02 * math.sin(math.pi*ky/n)**2
            -cross * n*n * math.sin(2*math.pi*kx/n)
                         * math.sin(2*math.pi*ky/n))


def amplification(n, kx, ky, cross, duration, steps):
    z = eigenvalue(n, kx, ky, cross) * duration / steps
    return (1 + z + z*z/2)**steps


class ComplexPDEAcceptance(unittest.TestCase):
    def test_oblique_tensor_modes_against_exact_discrete_rk2(self):
        # Both signs of the off-diagonal tensor, different wave orientations,
        # and several resolutions, including the zero-cross-term limit.
        cases = ((16, 1, 1, 0.01), (24, 2, 3, 0.01),
                 (32, 2, 3, -0.01), (40, 3, 2, 0.0),
                 (48, 1, 4, 0.012))
        for n, kx, ky, cross in cases:
            with self.subTest(grid=n, wave=(kx, ky), cross=cross):
                model = parse(variant(n, kx, ky, cross))
                result = simulate(model)
                expected_amplitude = 10 * amplification(n, kx, ky, cross, .01, 100)
                self.assertEqual(result["steps"], 100)
                self.assertEqual(result["grid"], [n, n])
                self.assertAlmostEqual(result["mean_temperature"], 300., delta=2e-9)
                self.assertAlmostEqual(result["initial_temperature_variance"],
                                       50., delta=2e-9)
                self.assertAlmostEqual(result["temperature_variance"],
                                       expected_amplitude**2 / 2, delta=2e-7)
                self.assertLess(result["temperature_variance"], 50.)
                self.assertEqual(result["boundary_condition"], "Periodic")
                self.assertEqual(result["spatial"]["source_grid"], [n, n])
                self.assertEqual([t["role"] for t in
                                  result["semantic_trace"]["stages"][0]["terms"]],
                                 ["diffusion", "diffusion", "crossDiffusion"])
                for stage in result["semantic_trace"]["stages"]:
                    self.assertLess(stage["maximumDecompositionResidual"], 1e-8)

    def test_every_spatial_cell_matches_independent_oblique_fourier_oracle(self):
        # n=24 preserves the complete field through the bounded spatial snapshot.
        result = simulate(parse(SOURCE))
        n = 24
        coordinates = (np.arange(n) + .5) / n
        x, y = np.meshgrid(coordinates, coordinates, indexing="ij")
        amplitude = 10 * amplification(n, 2, 3, .01, .01, 100)
        expected = 300 + amplitude * np.sin(4*math.pi*x + 6*math.pi*y)
        self.assertEqual(result["spatial"]["grid"], [24, 24])
        np.testing.assert_allclose(
            np.asarray(result["spatial"]["fields"]["temperature"]),
            expected, rtol=0, atol=2e-8)

    def test_mixed_derivative_notation_is_numerically_identical(self):
        reference = simulate(parse(SOURCE))
        expected = np.asarray(reference["spatial"]["fields"]["temperature"])
        for alternate in ("∂ᵧₓ(temperature)", "∂ₓ(∂ᵧ(temperature))",
                          "∂ᵧ(∂ₓ(temperature))"):
            with self.subTest(operator=alternate):
                result = simulate(parse(SOURCE.replace(OPERATOR, alternate)))
                np.testing.assert_allclose(
                    result["spatial"]["fields"]["temperature"], expected,
                    atol=2e-9, rtol=0)

    def test_second_order_temporal_convergence_to_semidiscrete_solution(self):
        exact = math.exp(eigenvalue(24, 2, 3, .01) * .04)
        errors = []
        for dt in (0.004, 0.002, 0.001):
            model = parse(variant(step=f"{dt}s", duration="0.04s"))
            result = simulate(model)
            amplitude = math.sqrt(result["temperature_variance"] / 50.)
            errors.append(abs(amplitude - exact))
        self.assertGreater(errors[0], 3.5 * errors[1])
        self.assertGreater(errors[1], 3.5 * errors[2])
        self.assertLess(errors[-1], 1e-5)

    def test_repeatability_conservation_and_monotone_variance(self):
        first = simulate(parse(SOURCE))
        second = simulate(parse(SOURCE))
        self.assertEqual(first["observations"], second["observations"])
        self.assertEqual(first["spatial"], second["spatial"])
        observations = first["observations"]
        self.assertEqual(observations[0]["time"], 0.)
        self.assertAlmostEqual(observations[-1]["time"], .01, delta=1e-12)
        for before, after in zip(observations, observations[1:]):
            self.assertLessEqual(after["temperatureVariance"],
                                 before["temperatureVariance"] + 1e-9)
            self.assertAlmostEqual(after["meanTemperature"], 300., delta=2e-9)

    def test_bad_tensor_units_boundaries_grid_and_operators_fail_closed(self):
        bad = (
            SOURCE.replace("crossDiffusivity = 0.01m²/s",
                           "crossDiffusivity = 0.05m²/s"),
            SOURCE.replace("crossDiffusivity = 0.01m²/s",
                           "crossDiffusivity = 0.01K/s"),
            SOURCE.replace("boundaries = Periodic",
                           "boundaries = Dirichlet(300K)"),
            SOURCE.replace("grid       = 24 × 24", "grid       = 7 × 24"),
            SOURCE.replace(OPERATOR, "∂ₓ²(temperature)"),
        )
        for index, source in enumerate(bad):
            with self.subTest(case=index), self.assertRaises(FlowMathError):
                parse(source)

    def test_real_cli_compilation_execution_and_negative_exit(self):
        for flags in (["--check"], []):
            with self.subTest(flags=flags):
                run = subprocess.run(
                    [sys.executable, "src/math_flow.py", *flags, str(PROGRAM)],
                    cwd=ROOT, text=True, capture_output=True, timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                payload = json.loads(run.stdout)
                self.assertTrue(payload["ok"])
                self.assertEqual(payload["grid"], [24, 24])
                if not flags:
                    self.assertEqual(payload["steps"], 100)
                    self.assertAlmostEqual(payload["mean_temperature"], 300.,
                                           delta=2e-9)
        with tempfile.TemporaryDirectory() as directory:
            invalid = Path(directory) / "invalid.flow"
            invalid.write_text(SOURCE.replace("crossDiffusivity = 0.01m²/s",
                                              "crossDiffusivity = 0.05m²/s"),
                               encoding="utf-8")
            run = subprocess.run(
                [sys.executable, "src/math_flow.py", "--check", str(invalid)],
                cwd=ROOT, text=True, capture_output=True, timeout=20)
            self.assertEqual(run.returncode, 2)
            self.assertFalse(json.loads(run.stderr)["ok"])

    def test_independent_existing_complex_pde_families_execute(self):
        # Exercise actual numerical paths, not a visual fixture or a mock router.
        for filename in ("heat_spatial_moments.flow",
                         "heat_logarithmic_forcing.flow",
                         "heat_saturating_reaction.flow",
                         "navier_stokes_smoke.flow"):
            with self.subTest(example=filename):
                source = (ROOT / "examples" / filename).read_text(encoding="utf-8")
                result = simulate(parse(source))
                self.assertGreater(result["steps"], 0)
                self.assertTrue(result["observations"])
                self.assertIn("spatial", result)
                if filename.startswith("navier"):
                    self.assertLess(result["max_divergence"], 1e-5)
                    self.assertAlmostEqual(result["pressure_mean"], 0., delta=1e-8)
                else:
                    self.assertTrue(math.isfinite(result["mean_temperature"]))
                    self.assertTrue(math.isfinite(result["temperature_variance"]))
                    self.assertGreaterEqual(result["temperature_variance"], 0.)


if __name__ == "__main__":
    unittest.main()
