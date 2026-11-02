"""Real parser and numerical acceptance for the executable mathematical Flow subset."""
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, lex, parse, simulate

SOURCE = (ROOT / "examples/navier_stokes_proposed.flow").read_text(encoding="utf-8")
SMOKE = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")


class MathematicalFlowTest(unittest.TestCase):
    def test_unicode_lexing_and_typed_model(self):
        tokens = lex(SOURCE)
        self.assertIn("∇", [token.text for token in tokens])
        self.assertIn("∂", [token.text for token in tokens])
        self.assertIn("10⁻⁴", [token.text for token in tokens])
        model = parse(SOURCE)
        self.assertEqual((model.width, model.height), (256, 256))
        self.assertAlmostEqual(model.step, 0.0001)
        self.assertAlmostEqual(model.tolerance, 0.000001)
        self.assertAlmostEqual(model.viscosity, 0.001)
        self.assertEqual(model.until, 10)

    def test_shared_pde_lexer_recognizes_all_logical_line_boundaries(self):
        # The same source grammar is used by the Navier and heat executors.
        heat = (ROOT / "examples/heat_piecewise_forcing.flow").read_text(encoding="utf-8")
        for separator in ("\\n", "\\r\\n", "\\r", "\\u0085", "\\u2028", "\\u2029"):
            with self.subTest(separator=repr(separator)):
                navier = parse(SMOKE.replace("\\n", separator))
                thermal = parse(heat.replace("\\n", separator))
                self.assertEqual((navier.width, navier.height), (16, 16))
                self.assertEqual((thermal.width, thermal.height), (32, 32))
                tokens = lex("# a comment" + separator +
                             "domain FluidDomain {" + separator + "grid = 16 × 16")
                self.assertEqual([(token.text, token.line, token.column)
                                  for token in tokens[:3]],
                                 [("domain", 2, 1), ("FluidDomain", 2, 8),
                                  ("{", 2, 20)])
                self.assertEqual((tokens[3].text, tokens[3].line, tokens[3].column),
                                 ("grid", 3, 1))

    def test_fractional_grid_axes_fail_before_numerical_execution(self):
        heat = (ROOT / "examples/heat_piecewise_forcing.flow").read_text(encoding="utf-8")
        for source, axes in ((SMOKE, "16 × 16"), (heat, "32 × 32")):
            for replacement in ("16.5 × 16", "16 × 16.25", "7.5 × 16",
                                "512.5 × 16"):
                with self.subTest(original=axes, replacement=replacement):
                    with self.assertRaisesRegex(FlowMathError,
                                                "grid dimensions must be integers|Grid dimensions must be integers"):
                        parse(source.replace(axes, replacement))

    def test_rejects_unsupported_equation(self):
        with self.assertRaisesRegex(FlowMathError, "Unsupported dynamics"):
            parse(SOURCE.replace("kinematicViscosity ∇²velocity",
                                 "kinematicViscosity velocity"))

    def test_rejects_wrong_physical_units(self):
        with self.assertRaisesRegex(FlowMathError, "Expected unit"):
            parse(SOURCE.replace("1kg/m³", "1m/s"))

    def test_rejects_incompatible_pressure_method(self):
        with self.assertRaisesRegex(FlowMathError, "ConjugateGradient"):
            parse(SOURCE.replace("method    = ConjugateGradient",
                                 "method    = Jacobi"))

    def test_rejects_unknown_unicode(self):
        with self.assertRaisesRegex(FlowMathError, "unexpected character"):
            lex("domain Ω { ∀ ☃ }")

    def test_navier_stokes_projection_and_energy(self):
        result = simulate(parse(SMOKE))
        self.assertEqual(result["steps"], 10)
        self.assertLess(result["max_divergence"], 1e-5)
        self.assertLess(abs(result["pressure_mean"]), 1e-8)
        self.assertGreater(result["kinetic_energy"], 0)
        self.assertLessEqual(result["kinetic_energy"], result["initial_kinetic_energy"] * 1.001)
        self.assertIn("conjugate gradient", result["pressure_solver"])

    def test_shear_diffusion_converges_under_grid_refinement(self):
        # This divergence-free shear has zero nonlinear advection and an
        # analytic energy decay exp(-2 nu (2 pi)^2 t).
        shear = SOURCE.replace("sin(2πx / 1m) * 1m/s", "0m/s")
        model = parse(shear)
        duration = 0.01
        target = math.exp(-2 * model.viscosity * (2 * math.pi)**2 * duration)
        errors = []
        for grid in (16, 32):
            result = simulate(model, grid=grid, until=duration)
            ratio = result["kinetic_energy"] / result["initial_kinetic_energy"]
            errors.append(abs(ratio - target))
            self.assertLess(result["max_divergence"], 1e-8)
        self.assertLess(errors[1], errors[0])


if __name__ == "__main__":
    unittest.main()
