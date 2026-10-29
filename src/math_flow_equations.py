"""Typed, bounded scalar parabolic equation AST and operator validation.

The entire RHS is parsed and dimension-checked. Supported operators are
typed diffusion, optional space/time-dependent field-independent forcing, optional constant
advection, and optional linear or bounded polynomial relaxation toward a
declared ambient temperature. The supported terms can be composed.
No arbitrary nonlinear or coupled equation is accepted.
"""
from __future__ import annotations

from dataclasses import dataclass
from math_flow_expr import Expression, ExpressionError, TEMPERATURE, parse_expression

DIFFUSIVITY = (2, 0, -1, 0)
REACTION_RATE = (0, 0, -1, 0)
TEMPERATURE_RATE = (0, 0, -1, 1)
SYMBOLS = {"temperature": TEMPERATURE, "diffusivity": DIFFUSIVITY,
           "t": (0, 0, 1, 0)}
REACTION_SYMBOLS = {"reactionRate": REACTION_RATE, "ambientTemperature": TEMPERATURE}
ANISOTROPIC_SYMBOLS = {"diffusivityX": DIFFUSIVITY, "diffusivityY": DIFFUSIVITY}
CROSS_SYMBOLS = {"crossDiffusivity": DIFFUSIVITY}
ADVECTION_SYMBOLS = {"advectionVelocityX": (1, 0, -1, 0),
                     "advectionVelocityY": (1, 0, -1, 0)}


@dataclass(frozen=True)
class Equation:
    field: str
    rhs: Expression
    forcing: Expression | None
    reaction: Expression | None = None
    nonlinear: bool = False
    advection: bool = False
    reaction_power: int = 1
    reaction_kind: str = "linear"


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


def _anisotropic_diffusion(expr: Expression, axis: str) -> bool:
    """Match a declared directional diffusivity and a centered second derivative."""
    if expr.operator != "mul" or len(expr.operands) != 2:
        return False
    a, b = expr.operands
    symbol = "diffusivityX" if axis == "x" else "diffusivityY"
    derivative = "∂ₓ²" if axis == "x" else "∂ᵧ²"
    def matches(node: Expression) -> bool:
        return (node.operator == derivative and len(node.operands) == 1
                and _name(node.operands[0], "temperature"))
    return ((_name(a, symbol) and matches(b))
            or (_name(b, symbol) and matches(a)))


def _mixed_diffusion(expr: Expression) -> bool:
    """A typed cross coefficient times the nested periodic centered derivatives."""
    if expr.operator != "mul" or len(expr.operands) != 2:
        return False
    a, b = expr.operands
    def derivative(node: Expression) -> bool:
        return (node.operator == "∂ₓ" and len(node.operands) == 1
                and node.operands[0].operator == "∂ᵧ"
                and len(node.operands[0].operands) == 1
                and _name(node.operands[0].operands[0], "temperature"))
    return (_name(a, "crossDiffusivity") and derivative(b)
            or _name(b, "crossDiffusivity") and derivative(a))


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


def _mean_field_relaxation(expr: Expression) -> bool:
    """Match a spatially uniform negative feedback on the *actual* field mean.

    reactionRate * (mean(temperature) - ambientTemperature) has K/s units.
    The nonlocal mean is evaluated from each live RK2 stage, not from an
    initial snapshot, an editor preview, or a postprocessed observation.
    """
    if expr.operator != "mul" or len(expr.operands) != 2:
        return False
    a, b = expr.operands
    response = b if _name(a, "reactionRate") else a if _name(b, "reactionRate") else None
    if response is None or response.operator != "sub" or len(response.operands) != 2:
        return False
    mean, ambient = response.operands
    return (mean.operator == "mean" and len(mean.operands) == 1
            and _name(mean.operands[0], "temperature")
            and _name(ambient, "ambientTemperature"))


def _quadratic_relaxation(expr: Expression) -> bool:
    """Match reactionRate * (temperature - ambient)^2 / ambient, using explicit products.

    The squared deviation is deliberately parsed as a typed AST product,
    not rewritten into Python or accepted as arbitrary polynomial kinetics.
    """
    if expr.operator != "div" or len(expr.operands) != 2:
        return False
    numerator, denominator = expr.operands
    if not _name(denominator, "ambientTemperature"):
        return False
    if numerator.operator != "mul" or len(numerator.operands) != 2:
        return False
    left, right = numerator.operands

    def squared_deviation(node: Expression) -> bool:
        return (node.operator == "pow" and len(node.operands) == 2
                and node.operands[1].operator == "literal"
                and node.operands[1].value == 2
                and node.operands[0].operator == "sub"
                and len(node.operands[0].operands) == 2
                and _name(node.operands[0].operands[0], "temperature")
                and _name(node.operands[0].operands[1], "ambientTemperature"))

    if ((_name(left, "reactionRate") and squared_deviation(right))
            or (_name(right, "reactionRate") and squared_deviation(left))):
        return True

    def deviation(node: Expression) -> bool:
        return (node.operator == "sub" and len(node.operands) == 2
                and _name(node.operands[0], "temperature")
                and _name(node.operands[1], "ambientTemperature"))

    def rate_times_deviation(node: Expression) -> bool:
        return (node.operator == "mul" and len(node.operands) == 2
                and ((_name(node.operands[0], "reactionRate")
                      and deviation(node.operands[1]))
                     or (_name(node.operands[1], "reactionRate")
                         and deviation(node.operands[0]))))

    return (rate_times_deviation(left) and deviation(right)
            or rate_times_deviation(right) and deviation(left))


def _polynomial_relaxation(expr: Expression) -> int | None:
    """Recognize dimensionally checked dissipative powers 2..4, not arbitrary kinetics.

    -reactionRate * (temperature - ambientTemperature)^n / ambientTemperature^(n-1)
    with strictly positive ambient temperature. Exponents are literal AST nodes.
    """
    if expr.operator != "div" or len(expr.operands) != 2:
        return None
    numerator, denominator = expr.operands
    if numerator.operator != "mul" or len(numerator.operands) != 2:
        return None
    a, b = numerator.operands
    power = b if _name(a, "reactionRate") else a if _name(b, "reactionRate") else None
    if power is None or power.operator != "pow" or len(power.operands) != 2:
        return None
    deviation, exponent = power.operands
    if (exponent.operator != "literal" or exponent.value not in (2, 3, 4)
            or deviation.operator != "sub" or len(deviation.operands) != 2
            or not _name(deviation.operands[0], "temperature")
            or not _name(deviation.operands[1], "ambientTemperature")):
        return None
    n = int(exponent.value)
    if n == 2 and _name(denominator, "ambientTemperature"):
        return n
    if (denominator.operator == "pow" and len(denominator.operands) == 2
            and _name(denominator.operands[0], "ambientTemperature")
            and denominator.operands[1].operator == "literal"
            and denominator.operands[1].value == n - 1):
        return n
    return None


def _saturating_relaxation(expr: Expression) -> bool:
    """Recognize a bounded dissipative sink with an exact dimensionless argument.

    reactionRate * ambientTemperature *
        tanh((temperature - ambientTemperature) / ambientTemperature)

    Its Jacobian is -reactionRate * sech²(...), so the stiffness is
    globally bounded by the declared positive reaction rate.
    """
    if expr.operator != "mul" or len(expr.operands) != 2:
        return False
    coefficient, response = expr.operands
    if (coefficient.operator != "mul" or len(coefficient.operands) != 2
            or not ((_name(coefficient.operands[0], "reactionRate")
                     and _name(coefficient.operands[1], "ambientTemperature"))
                    or (_name(coefficient.operands[1], "reactionRate")
                        and _name(coefficient.operands[0], "ambientTemperature")))
            or response.operator != "tanh" or len(response.operands) != 1):
        return False
    argument = response.operands[0]
    if (argument.operator != "div" or len(argument.operands) != 2
            or not _name(argument.operands[1], "ambientTemperature")):
        return False
    difference = argument.operands[0]
    return (difference.operator == "sub" and len(difference.operands) == 2
            and _name(difference.operands[0], "temperature")
            and _name(difference.operands[1], "ambientTemperature"))


def _advection(expr: Expression, axis: str) -> bool:
    """Match a declared constant velocity times a centered spatial derivative."""
    if expr.operator != "mul" or len(expr.operands) != 2:
        return False
    a, b = expr.operands
    velocity = "advectionVelocityX" if axis == "x" else "advectionVelocityY"
    derivative = "∂ₓ" if axis == "x" else "∂ᵧ"
    def derivative_of_temperature(node: Expression) -> bool:
        return (node.operator == derivative and len(node.operands) == 1
                and _name(node.operands[0], "temperature"))
    return ((_name(a, velocity) and derivative_of_temperature(b))
            or (_name(b, velocity) and derivative_of_temperature(a)))


def _independent(expr: Expression) -> bool:
    if expr.operator == "name" and expr.value in ("temperature", "diffusivity", "diffusivityX", "diffusivityY", "crossDiffusivity"):
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


def compile_heat_equation(tokens: list[str], *, reaction: bool = False,
                          advection: bool = False, anisotropic: bool = False,
                          cross_diffusion: bool = False) -> Equation:
    # The first assignment token separates the evolved field from its RHS.
    # Equality comparisons (==) and inequality (!=) are valid within that RHS;
    # counting every equals character incorrectly rejects executable predicates.
    if "=" not in tokens:
        raise ExpressionError("Heat dynamics requires an assignment equality")
    assignment = tokens.index("=")
    lhs, rhs_source = "".join(tokens[:assignment]), "".join(tokens[assignment + 1:])
    if lhs != "∂ₜtemperature":
        raise ExpressionError("Heat dynamics must evolve ∂ₜtemperature")
    symbols = {**SYMBOLS, **(REACTION_SYMBOLS if reaction else {}),
               **(ADVECTION_SYMBOLS if advection else {}),
                **(ANISOTROPIC_SYMBOLS if anisotropic else {}),
               **(CROSS_SYMBOLS if cross_diffusion else {})}
    rhs = parse_expression(rhs_source, symbols=symbols)
    if rhs.dimension != TEMPERATURE_RATE:
        raise ExpressionError("Heat equation RHS must have dimensions K/s")
    diffusion_count = 0
    directional_axes: set[str] = set()
    forcing = None
    relaxation = None
    nonlinear = False
    reaction_power = 1
    reaction_kind = "linear"
    advection_axes: set[str] = set()
    mixed_count = 0
    for term, sign in _signed_terms(rhs):
        if sign == 1 and not anisotropic and _diffusion(term):
            diffusion_count += 1
        elif sign == 1 and anisotropic and any(
                _anisotropic_diffusion(term, axis) and axis not in directional_axes
                for axis in ("x", "y")):
            directional_axes.add("x" if _anisotropic_diffusion(term, "x") else "y")
        elif cross_diffusion and sign == 1 and _mixed_diffusion(term):
            mixed_count += 1
        elif reaction and sign == -1 and relaxation is None and (
                _relaxation(term) or _quadratic_relaxation(term)
                or _polynomial_relaxation(term) is not None
                or _saturating_relaxation(term) or _mean_field_relaxation(term)):
            relaxation = term
            reaction_power = (2 if _quadratic_relaxation(term)
                              else _polynomial_relaxation(term) or 1)
            reaction_kind = ("meanField" if _mean_field_relaxation(term) else
                             "saturating" if _saturating_relaxation(term) else
                             "polynomial" if reaction_power > 1 else "linear")
            nonlinear = reaction_kind in ("saturating", "polynomial")
        elif advection and sign == -1 and any(
                _advection(term, axis) and axis not in advection_axes for axis in ("x", "y")):
            advection_axes.add("x" if _advection(term, "x") else "y")
        elif _independent(term) and term.dimension == TEMPERATURE_RATE:
            # Keep every independently typed source. The complete RHS is
            # evaluated at each RK2 stage; this AST records the same signed
            # sum rather than rejecting a second source term.
            signed = term if sign == 1 else Expression(
                "neg", (term,), dimension=TEMPERATURE_RATE)
            forcing = (signed if forcing is None else Expression(
                "add", (forcing, signed), dimension=TEMPERATURE_RATE))
        else:
            raise ExpressionError(
                "Unsupported heat dynamics: expected diffusion, independent forcing "
                "and optional negative linear or bounded polynomial relaxation or constant advection")
    if ((anisotropic and directional_axes != {"x", "y"}) or
            (not anisotropic and diffusion_count != 1) or
            (reaction and relaxation is None) or (advection and advection_axes != {"x", "y"})
            or mixed_count != int(cross_diffusion)):
        raise ExpressionError("Heat dynamics requires exactly the declared diffusion operators and relaxation")
    return Equation("temperature", rhs, forcing, relaxation, nonlinear, advection,
                    reaction_power, reaction_kind)

# These categories describe the mathematical meaning of *validated* terms.
# They do not claim to recover the author's unrecorded intention.
SEMANTIC_ROLES = {
    "diffusion": "Spatial redistribution driven by temperature curvature.",
    "crossDiffusion": "Mixed spatial derivative coupling the two coordinate directions.",
    "advection": "Transport by the declared constant velocity.",
    "reaction": "Local relaxation toward the declared ambient temperature.",
    "meanField": "Nonlocal feedback on the live spatial mean of temperature.",
    "forcing": "Prescribed source independent of the evolving temperature field.",
}


def semantic_heat_terms(equation: Equation):
    """Return signed, dimension-checked AST terms with grounded physical roles.

    Classification is performed only after compile_heat_equation has rejected
    unsupported dynamics. No symbolic rewriting or speculative intent inference.
    """
    if equation.field != "temperature" or equation.rhs.dimension != TEMPERATURE_RATE:
        raise ExpressionError("Semantic inspection requires a validated temperature-rate equation")
    classified = []
    for expression, sign in _signed_terms(equation.rhs):
        if (_diffusion(expression) or any(_anisotropic_diffusion(expression, axis)
                                         for axis in ("x", "y"))):
            role = "diffusion"
        elif _mixed_diffusion(expression):
            role = "crossDiffusion"
        elif any(_advection(expression, axis) for axis in ("x", "y")):
            role = "advection"
        elif _mean_field_relaxation(expression):
            role = "meanField"
        elif (_relaxation(expression) or _quadratic_relaxation(expression)
              or _polynomial_relaxation(expression) is not None
              or _saturating_relaxation(expression)):
            role = "reaction"
        elif _independent(expression) and expression.dimension == TEMPERATURE_RATE:
            role = "forcing"
        else:
            raise ExpressionError("Unclassified mathematical term in validated heat equation")
        classified.append((expression, sign, role))
    return tuple(classified)


def expression_symbols(expression: Expression) -> list[str]:
    """Return the actual typed AST symbol dependencies, never inferred prose."""
    names = set()
    def visit(node: Expression):
        if node.operator == "name":
            names.add(str(node.value))
        for child in node.operands:
            visit(child)
    visit(expression)
    return sorted(names)
