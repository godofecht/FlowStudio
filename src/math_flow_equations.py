"""Typed, bounded scalar parabolic equation AST and operator validation.

The entire RHS is parsed and dimension-checked. Supported operators are
periodic diffusion, optional field-independent forcing, and optional
linear relaxation toward a declared ambient temperature. No arbitrary
nonlinear or coupled equation is accepted.
"""
from __future__ import annotations

from dataclasses import dataclass
from math_flow_expr import Expression, ExpressionError, TEMPERATURE, parse_expression

DIFFUSIVITY = (2, 0, -1, 0)
REACTION_RATE = (0, 0, -1, 0)
TEMPERATURE_RATE = (0, 0, -1, 1)
SYMBOLS = {"temperature": TEMPERATURE, "diffusivity": DIFFUSIVITY}
REACTION_SYMBOLS = {"reactionRate": REACTION_RATE, "ambientTemperature": TEMPERATURE}


@dataclass(frozen=True)
class Equation:
    field: str
    rhs: Expression
    forcing: Expression | None
    reaction: Expression | None = None


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


def _relaxation(expr: Expression) -> bool:
    """Match reactionRate * (temperature - ambientTemperature) exactly."""
    if expr.operator != "mul" or len(expr.operands) != 2:
        return False
    a, b = expr.operands
    def difference(node: Expression) -> bool:
        return (node.operator == "sub" and len(node.operands) == 2
                and _name(node.operands[0], "temperature")
                and _name(node.operands[1], "ambientTemperature"))
    return (_name(a, "reactionRate") and difference(b)
            or _name(b, "reactionRate") and difference(a))


def _independent(expr: Expression) -> bool:
    if expr.operator == "name" and expr.value in ("temperature", "diffusivity"):
        return False
    return all(_independent(child) for child in expr.operands)


def _signed_terms(expr: Expression, sign: int = 1):
    """Flatten only top-level sums/differences, preserving signs."""
    if expr.operator == "add":
        yield from _signed_terms(expr.operands[0], sign)
        yield from _signed_terms(expr.operands[1], sign)
    elif expr.operator == "sub":
        yield from _signed_terms(expr.operands[0], sign)
        yield from _signed_terms(expr.operands[1], -sign)
    elif expr.operator == "neg":
        yield from _signed_terms(expr.operands[0], -sign)
    elif expr.operator == "pos":
        yield from _signed_terms(expr.operands[0], sign)
    else:
        yield expr, sign


def compile_heat_equation(tokens: list[str], *, reaction: bool = False) -> Equation:
    source = "".join(tokens)
    if source.count("=") != 1:
        raise ExpressionError("Heat dynamics requires exactly one equality")
    lhs, rhs_source = source.split("=", 1)
    if lhs != "∂ₜtemperature":
        raise ExpressionError("Heat dynamics must evolve ∂ₜtemperature")
    symbols = {**SYMBOLS, **(REACTION_SYMBOLS if reaction else {})}
    rhs = parse_expression(rhs_source, symbols=symbols)
    if rhs.dimension != TEMPERATURE_RATE:
        raise ExpressionError("Heat equation RHS must have dimensions K/s")
    diffusion_count = 0
    forcing = None
    relaxation = None
    for term, sign in _signed_terms(rhs):
        if sign == 1 and _diffusion(term):
            diffusion_count += 1
        elif reaction and sign == -1 and _relaxation(term) and relaxation is None:
            relaxation = term
        elif _independent(term) and forcing is None and term.dimension == TEMPERATURE_RATE:
            forcing = term if sign == 1 else Expression(
                "neg", (term,), dimension=TEMPERATURE_RATE)
        else:
            raise ExpressionError(
                "Unsupported heat dynamics: expected diffusion, independent forcing "
                "and optional negative linear relaxation")
    if diffusion_count != 1 or (reaction and relaxation is None):
        raise ExpressionError("Heat dynamics requires one diffusion operator and declared relaxation")
    return Equation("temperature", rhs, forcing, relaxation)
