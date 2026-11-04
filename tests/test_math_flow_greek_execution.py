"""Executable regression for Unicode model/solver names in the bounded PDE frontend.

This exercises the production parser and numerical solver, not upstream flowc.
"""
from pathlib import Path
import unittest

from src.math_flow import FlowMathError, parse, simulate


EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "navier_stokes_smoke.flow"


class GreekProgramExecutionTests(unittest.TestCase):
    def test_greek_model_and_solver_names_execute_identically(self):
        original = EXAMPLE.read_text(encoding="utf-8")
        renamed = original.replace("NavierStokes", "αModel").replace(
            "FluidSolver", "βSolver"
        )
        self.assertNotEqual(original, renamed)
        latin = simulate(parse(original))
        greek = simulate(parse(renamed))
        self.assertEqual(greek, latin)
        self.assertEqual(simulate(parse(renamed)), greek)

    def test_unknown_unicode_identifier_fails_closed(self):
        original = EXAMPLE.read_text(encoding="utf-8")
        malformed = original.replace("NavierStokes", "😀Model")
        with self.assertRaises(FlowMathError):
            parse(malformed)

    def test_unbound_greek_model_reference_fails_closed(self):
        original = EXAMPLE.read_text(encoding="utf-8")
        renamed_declaration_only = original.replace(
            "model NavierStokes on", "model αModel on"
        )
        with self.assertRaises(FlowMathError):
            parse(renamed_declaration_only)


if __name__ == "__main__":
    unittest.main()
