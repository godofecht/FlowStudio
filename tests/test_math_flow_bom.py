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

    def test_bom_does_not_bypass_source_size_limit(self):
        from math_flow import MAX_SOURCE
        with self.assertRaisesRegex(FlowMathError, "Source exceeds"):
            lex("\ufeff" + " " * MAX_SOURCE)


if __name__ == "__main__":
    unittest.main()
