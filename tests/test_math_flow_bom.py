"""Executable UTF-8 BOM regression for both mathematical Flow PDE frontends."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, lex, parse, simulate


class MathFlowBomTest(unittest.TestCase):
    def test_bom_is_only_accepted_at_source_start(self):
        source = "domain FluidDomain {"
        self.assertEqual(lex("\ufeff" + source), lex(source))
        for invalid in (" " + "\ufeff" + source, source + "\ufeff",
                        "domain" + "\ufeff" + " FluidDomain"):
            with self.subTest(source=repr(invalid)):
                with self.assertRaisesRegex(FlowMathError, "unexpected character"):
                    lex(invalid)

    def test_navier_and_heat_files_execute_with_utf8_bom(self):
        navier = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")
        heat = (ROOT / "examples/heat_piecewise_forcing.flow").read_text(encoding="utf-8")
        for source in (navier, heat):
            with self.subTest(frontend=source[:40]):
                normal = parse(source)
                with_bom = parse("\ufeff" + source)
                self.assertEqual((normal.width, normal.height),
                                 (with_bom.width, with_bom.height))
        result = simulate(parse("\ufeff" + navier))
        self.assertEqual(result["steps"], 10)
        self.assertLess(result["max_divergence"], 1e-5)

    def test_bom_heat_evolution_matches_analytic_mean(self):
        import math

        source = (ROOT / "examples/heat_piecewise_forcing.flow").read_text(encoding="utf-8")
        plain = simulate(parse(source))
        with_bom = simulate(parse("\ufeff" + source))
        expected = 300. + (1. - math.cos(2 * math.pi * 1.0)) / math.pi
        self.assertEqual(with_bom["steps"], 100)
        self.assertAlmostEqual(with_bom["mean_temperature"], expected, delta=2e-8)
        self.assertAlmostEqual(with_bom["mean_temperature"], plain["mean_temperature"], delta=1e-12)
        self.assertAlmostEqual(with_bom["temperature_variance"], plain["temperature_variance"], delta=1e-12)

    def test_bom_preserves_token_locations_across_line_endings(self):
        for separator in ("\n", "\r\n", "\r", "\u0085", "\u2028", "\u2029"):
            with self.subTest(separator=repr(separator)):
                tokens = lex("\ufeffalpha" + separator + "# comment" + separator + "beta")
                self.assertEqual(
                    [(token.text, token.line, token.column) for token in tokens],
                    [("alpha", 1, 1), ("beta", 3, 1)],
                )
                with self.assertRaisesRegex(
                    FlowMathError, r"3:1: unexpected character"
                ):
                    lex("\ufeffalpha" + separator + "# comment" + separator + "@")

    def test_bom_counts_toward_exact_utf8_source_limit(self):
        from math_flow import MAX_SOURCE
        self.assertEqual(lex("\ufeff" + " " * (MAX_SOURCE - 3)), [])
        with self.assertRaisesRegex(FlowMathError, "Source exceeds"):
            lex("\ufeff" + " " * (MAX_SOURCE - 2))

    def test_bom_does_not_bypass_source_size_limit(self):
        from math_flow import MAX_SOURCE
        with self.assertRaisesRegex(FlowMathError, "Source exceeds"):
            lex("\ufeff" + " " * MAX_SOURCE)


if __name__ == "__main__":
    unittest.main()
