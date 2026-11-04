"""Executable lexer, typed AST and numerical lowering for Greek identifier ranges."""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from math_flow import lex, Parser, FlowMathError
from math_flow_expr import parse_expression, evaluate, ExpressionError, DIMENSIONLESS


@pytest.mark.parametrize("name", ["Α", "Ω", "Δ", "Σ", "ς", "ψ", "Ρυθμός", "Δ_2"])
def test_greek_scalar_lexing_and_typed_evaluation(name):
    assert [token.text for token in lex(name + " = 2")] == [name, "=", "2"]
    assert Parser(lex(name)).identifier() == name
    expr = parse_expression(name + " + 2", symbols={name: DIMENSIONLESS})
    np.testing.assert_allclose(evaluate(expr, 0.0, 0.0, values={name: 3.0}), 5.0)


def test_greek_distinct_identifiers_remain_distinct():
    expr = parse_expression("Σ + ς", symbols={"Σ": DIMENSIONLESS, "ς": DIMENSIONLESS})
    assert evaluate(expr, 0.0, 0.0, values={"Σ": 7.0, "ς": 11.0}) == 18.0


@pytest.mark.parametrize("name", ["Ж", "中", "Δ🙂"])
def test_unsupported_identifier_characters_rejected(name):
    with pytest.raises(FlowMathError):
        lex(name)
    with pytest.raises(ExpressionError):
        parse_expression(name, symbols={name: DIMENSIONLESS})
