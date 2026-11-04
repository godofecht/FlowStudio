"""Executable lexer, typed AST and numerical lowering for Greek identifiers."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import lex, Parser, FlowMathError
from math_flow_expr import parse_expression, evaluate, ExpressionError, DIMENSIONLESS, tokenize


class GreekIdentifierTests(unittest.TestCase):
    def test_greek_scalar_lexing_and_typed_evaluation(self):
        for name in ("Α", "Ω", "Δ", "Σ", "ς", "ψ", "Ρυθμος", "Δ_2", "ΔΣ", "Ας", "Δ_Ω2", "ρς"):
            with self.subTest(name=name):
                self.assertEqual([token.text for token in lex(name + " = 2")], [name, "=", "2"])
                self.assertEqual(Parser(lex(name)).identifier(), name)
                expr = parse_expression(name + " + 2", symbols={name: DIMENSIONLESS})
                np.testing.assert_allclose(evaluate(expr, 0.0, 0.0, values={name: 3.0}), 5.0)

    def test_greek_distinct_identifiers_remain_distinct(self):
        expr = parse_expression("Σ + ς", symbols={"Σ": DIMENSIONLESS, "ς": DIMENSIONLESS})
        self.assertEqual(evaluate(expr, 0.0, 0.0, values={"Σ": 7.0, "ς": 11.0}), 18.0)

    def test_unsupported_identifier_characters_rejected(self):
        for name in ("Ж", "中", "Δ🙂"):
            with self.subTest(name=name):
                with self.assertRaises(FlowMathError):
                    lex(name)
                with self.assertRaises(ExpressionError):
                    parse_expression(name, symbols={name: DIMENSIONLESS})

    def test_pi_remains_standalone_constant_with_greek_identifiers(self):
        for source in ("πx", "π(x + 1m)", "2π", "sin(2πx/1m)"):
            with self.subTest(source=source):
                self.assertIn("π", tokenize(source))
                expr = parse_expression(source)
                self.assertTrue(np.isfinite(evaluate(expr, 0.25, 0.0)))

    def test_pi_is_reserved_and_not_a_scalar_identifier(self):
        for name in ("π", "Δπ", "πΔ"):
            with self.subTest(name=name):
                with self.assertRaises(ExpressionError):
                    parse_expression(name + " + 1", symbols={name: DIMENSIONLESS})


if __name__ == "__main__":
    unittest.main()
