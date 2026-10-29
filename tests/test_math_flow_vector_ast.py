"""Executable vector momentum AST, physical dimensions and source-order lowering."""
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from math_flow import FlowMathError, parse, simulate
from math_flow_vector import VELOCITY_RATE

SOURCE = (ROOT / "examples/navier_stokes_smoke.flow").read_text(encoding="utf-8")
ORIGINAL = "∂ₜvelocity = −(velocity · ∇)velocity − ∇pressure / density\n                   + kinematicViscosity ∇²velocity"
REORDERED = "∂ₜvelocity = kinematicViscosity ∇²velocity\n                   − ∇pressure / density − (velocity · ∇)velocity"


class VectorEquationTest(unittest.TestCase):
    def test_typed_ast_and_implicit_pressure_projection(self):
        model = parse(SOURCE)
        equation = model.equation
        self.assertEqual(equation.field, "velocity")
        self.assertEqual([(term.role, term.sign, term.implicit) for term in equation.terms],
                         [("advection", -1, False), ("pressureGradient", -1, True),
                          ("diffusion", 1, False)])
        self.assertTrue(all(term.dimension == VELOCITY_RATE for term in equation.terms))
        self.assertEqual(equation.terms[1].symbols, ("pressure", "density"))

    def test_reordered_equation_executes_and_semantics_follow_source(self):
        self.assertIn(ORIGINAL, SOURCE)
        original = simulate(parse(SOURCE))
        reordered = simulate(parse(SOURCE.replace(ORIGINAL, REORDERED)))
        self.assertEqual([term.role for term in reordered["semantic_trace"]["stages"][0]["terms"]],
                         ["diffusion", "advection"])
        self.assertEqual([term.sign for term in reordered["semantic_trace"]["stages"][0]["terms"]],
                         [1, -1])
        self.assertLess(abs(original["kinetic_energy"] - reordered["kinetic_energy"]), 1e-10)
        self.assertLess(reordered["max_divergence"], 1e-5)
        self.assertLess(reordered["semantic_trace"]["stages"][0]["maximumDecompositionResidual"], 1e-10)

    def test_rejects_missing_duplicated_or_wrong_sign_terms(self):
        self.assertIn(ORIGINAL, SOURCE)
        for expression in (
            "∂ₜvelocity = −(velocity · ∇)velocity + ∇pressure / density + kinematicViscosity ∇²velocity",
            "∂ₜvelocity = −(velocity · ∇)velocity − ∇pressure / density",
            "∂ₜvelocity = −(velocity · ∇)velocity − ∇pressure / density + kinematicViscosity ∇²velocity + kinematicViscosity ∇²velocity",
            "∂ₜvelocity = −(velocity · ∇)velocity − ∇pressure / density + 2kinematicViscosity ∇²velocity",
            "∂ₜvelocity = −(velocity · ∇)velocity − ∇pressure / density + kinematicViscosity ∇²velocity + 1m/s²",
        ):
            with self.subTest(expression=expression), self.assertRaises(FlowMathError):
                parse(SOURCE.replace(ORIGINAL, expression))


if __name__ == "__main__":
    unittest.main()
