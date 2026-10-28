"""Typed equation AST for a deliberately bounded scalar parabolic PDE family.

The full right-hand side is parsed and dimension-checked. The numerical
backend accepts the periodic heat operator plus optional field-independent
forcing; it rejects nonlinear and otherwise unvalidated dynamics.
"""
from __future__ import annotations

from dataclasses import dataclass
from math_flow_expr import Expression, ExpressionError, TEMPERATURE, parse_expression

DIFFUSIVITY = (2, 0, -1, 0)
TEMPERATURE_RATE = (0, 0, -1, 1)
SYMBOLS = {"temperature": TEMPERATURE, "diffusivity": DIFFUSIVITY}


@dataclass(frozen=True)
class Equation:
    field: str
    rhs: Expression
    forcing: Expression | None


def _name(expr: Expression, value: str) -> bool:
    return expr.operator == "name" and expr.value == value


def _diffusion(expr: Expression) -> bool:
    if expr.operator != "mul" or len(expr.operands) != 2:
        return False
    a, b = expr.operands
    def laplacian(node: Expression) -> bool:
        return (node.operator == "∇²" and len(node.operands) == 1
                and _name(node.operands[0], "temperature"))
    return (_name(a, "diffusivity") and laplacian(b)
            or _name(b, "diffusivity") and laplacian(a))


def _independent(expr: Expression) -> bool:
    if expr.operator == "name" and expr.value in SYMBOLS:
        return False
    return all(_independent(child) for child in expr.operands)


def compile_heat_equation(tokens: list[str]) -> Equation:
    source = "".join(tokens)
    if source.count("=") != 1:
        raise ExpressionError("Heat dynamics requires exactly one equality")
    lhs, rhs_source = source.split("=", 1)
    if lhs != "∂ₜtemperature":
        raise ExpressionError("Heat dynamics must evolve ∂ₜtemperature")
    rhs = parse_expression(rhs_source, symbols=SYMBOLS)
    if rhs.dimension != TEMPERATURE_RATE:
        raise ExpressionError("Heat equation RHS must have dimensions K/s")
    forcing = None
    if not _diffusion(rhs):
        if rhs.operator != "add" or len(rhs.operands) != 2:
            raise ExpressionError("Unsupported heat dynamics: expected diffusion plus independent forcing")
        a, b = rhs.operands
        if _diffusion(a) and _independent(b):
            forcing = b
        elif _diffusion(b) and _independent(a):
            forcing = a
        else:
            raise ExpressionError("Unsupported heat dynamics: expected diffusion plus independent forcing")
        if forcing.dimension != TEMPERATURE_RATE:
            raise ExpressionError("Heat forcing must have dimensions K/s")
    return Equation("temperature", rhs, forcing)
