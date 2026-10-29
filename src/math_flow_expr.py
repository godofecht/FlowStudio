"""Bounded Unicode scalar expression compiler with physical dimension inference.

This is a checked AST used by the mathematical Flow runtime, not Python eval
or an extension to the upstream Flow 2.0 grammar.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import re

Dimension = tuple[int, int, int, int]  # length, mass, time, temperature
DIMENSIONLESS: Dimension = (0, 0, 0, 0)
LENGTH: Dimension = (1, 0, 0, 0)
VELOCITY: Dimension = (1, 0, -1, 0)
TEMPERATURE: Dimension = (0, 0, 0, 1)
UNITS: dict[str, Dimension] = {
    "m": LENGTH, "s": (0, 0, 1, 0), "kg": (0, 1, 0, 0),
    "Pa": (-1, 1, -2, 0), "K": TEMPERATURE,
}
SUPERSCRIPT = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻−", "0123456789--")
_NUMBER = r"(?:10[⁻−-][⁰¹²³⁴⁵⁶⁷⁸⁹0-9]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)"
_UNIT = r"(?:kg|Pa|m|s|K)(?:[²³⁻⁰¹⁴⁵⁶⁷⁸⁹]*)?(?:/(?:kg|Pa|m|s|K)(?:[²³⁻⁰¹⁴⁵⁶⁷⁸⁹]*))?"
_TOKEN = re.compile(rf"(?P<space>\s+)|(?P<quantity>{_NUMBER}(?:{_UNIT})?)|(?P<name>∂ₓ²|∂ᵧ²|∂ₓ|∂ᵧ|∇²|[A-Za-z_][A-Za-z_0-9]*|π)|(?P<postfix>[²³⁴⁵⁶⁷⁸])|(?P<op>[+\-−*/×·(),^])")
_UNIT_PART = re.compile(r"(kg|Pa|m|s|K)([²³⁻⁰¹⁴⁵⁶⁷⁸⁹]*)\Z")


class ExpressionError(ValueError):
    """Invalid syntax, unsafe operation, or inconsistent physical dimensions."""


@dataclass(frozen=True)
class Expression:
    operator: str
    operands: tuple["Expression", ...] = ()
    value: float | str | None = None
    dimension: Dimension = DIMENSIONLESS


def _plus(a: Dimension, b: Dimension) -> Dimension:
    return tuple(x + y for x, y in zip(a, b))  # type: ignore[return-value]


def _minus(a: Dimension, b: Dimension) -> Dimension:
    return tuple(x - y for x, y in zip(a, b))  # type: ignore[return-value]


def _quantity(raw: str) -> tuple[float, Dimension]:
    match = re.fullmatch(rf"({_NUMBER})({_UNIT})?", raw)
    if match is None:
        raise ExpressionError(f"Invalid quantity {raw!r}")
    literal, unit = match.groups()
    if literal.startswith("10") and any(c in literal for c in "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"):
        exponent = int(literal[2:].translate(SUPERSCRIPT))
        if abs(exponent) > 300:
            raise ExpressionError("Power-of-ten exponent out of range")
        value = 10.0 ** exponent
    else:
        value = float(literal)
    if not math.isfinite(value):
        raise ExpressionError("Non-finite numerical literal")
    dim = DIMENSIONLESS
    if unit:
        for sign, part in ((1, unit.split("/")[0]), (-1, unit.split("/")[1] if "/" in unit else "")):
            if not part:
                continue
            found = _UNIT_PART.fullmatch(part)
            if found is None:
                raise ExpressionError(f"Invalid unit {part!r}")
            name, exponent = found.groups()
            power = int(exponent.translate(SUPERSCRIPT)) if exponent else 1
            if abs(power) > 16:
                raise ExpressionError("Unit exponent out of range")
            dim = _plus(dim, tuple(sign * power * d for d in UNITS[name]))
    return value, dim


def tokenize(source: str) -> tuple[str, ...]:
    if len(source.encode("utf-8")) > 4096:
        raise ExpressionError("Expression exceeds 4096 bytes")
    tokens = []
    offset = 0
    while offset < len(source):
        match = _TOKEN.match(source, offset)
        if match is None:
            raise ExpressionError(f"Unexpected character at offset {offset}: {source[offset]!r}")
        if match.lastgroup != "space":
            tokens.append(match.group())
            if len(tokens) > 256:
                raise ExpressionError("Expression exceeds 256 tokens")
        offset = match.end()
    return tuple(tokens)


class _Parser:
    def __init__(self, tokens: tuple[str, ...], symbols: dict[str, Dimension] | None = None):
        self.tokens = tokens
        self.pos = 0
        self.symbols = symbols or {}

    def peek(self) -> str:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else "<EOF>"

    def take(self) -> str:
        token = self.peek()
        if token == "<EOF>":
            raise ExpressionError("Unexpected end of expression")
        self.pos += 1
        return token

    def expression(self, minimum: int = 0, depth: int = 0) -> Expression:
        if depth > 32:
            raise ExpressionError("Expression nesting exceeds 32")
        first = self.take()
        if first in ("+", "-", "−"):
            inner = self.expression(30, depth + 1)
            left = Expression("neg" if first != "+" else "pos", (inner,), dimension=inner.dimension)
        elif first == "(":
            left = self.expression(0, depth + 1)
            if self.take() != ")":
                raise ExpressionError("Expected closing parenthesis")
        elif first in ("sin", "cos", "exp", "sqrt", "tanh", "∂ₓ", "∂ᵧ", "∂ₓ²", "∂ᵧ²", "∇²"):
            if first == "∇²" and self.peek() != "(":
                # Prefix Unicode Laplacian, as in diffusivity ∇²temperature.
                arg = self.expression(30, depth + 1)
            else:
                if self.take() != "(":
                    raise ExpressionError(f"Expected '(' after {first}")
                arg = self.expression(0, depth + 1)
                if self.take() != ")":
                    raise ExpressionError("Expected closing parenthesis")
            if first in ("sin", "cos", "exp", "tanh") and arg.dimension != DIMENSIONLESS:
                raise ExpressionError(f"{first} requires a dimensionless argument")
            if first == "sqrt" and any(x % 2 for x in arg.dimension):
                raise ExpressionError("sqrt requires even physical dimension exponents")
            if first == "sqrt":
                dim = tuple(x // 2 for x in arg.dimension)
            elif first in ("∂ₓ", "∂ᵧ"):
                dim = _minus(arg.dimension, LENGTH)
            elif first in ("∂ₓ²", "∂ᵧ²"):
                dim = _minus(arg.dimension, (2, 0, 0, 0))
            elif first == "∇²":
                dim = _minus(arg.dimension, (2, 0, 0, 0))
            else:
                dim = DIMENSIONLESS
            left = Expression(first, (arg,), dimension=dim)
        elif first in ("x", "y", "π", "pi"):
            left = Expression("name", value="pi" if first in ("π", "pi") else first,
                              dimension=LENGTH if first in ("x", "y") else DIMENSIONLESS)
        elif first in self.symbols:
            left = Expression("name", value=first, dimension=self.symbols[first])
        elif re.fullmatch(rf"{_NUMBER}(?:{_UNIT})?", first):
            value, dim = _quantity(first)
            left = Expression("literal", value=value, dimension=dim)
        else:
            raise ExpressionError(f"Unknown symbol or operator {first!r}")
        while True:
            nxt = self.peek()
            if nxt in ("^", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸"):
                operator, precedence = "pow", 40
            elif nxt in ("+", "-", "−"):
                operator, precedence = ("add" if nxt == "+" else "sub"), 10
            elif nxt in ("*", "×", "·", "/"):
                operator, precedence = ("div" if nxt == "/" else "mul"), 20
            elif nxt in ("(", "π", "pi", "x", "y", "sin", "cos", "exp", "sqrt", "tanh", "∂ₓ", "∂ᵧ", "∂ₓ²", "∂ᵧ²", "∇²") or nxt in self.symbols or re.fullmatch(rf"{_NUMBER}(?:{_UNIT})?", nxt):
                operator, precedence = "mul", 20
            else:
                break
            if precedence < minimum:
                break
            if operator == "pow":
                self.take()
                if nxt in ("²", "³", "⁴", "⁵", "⁶", "⁷", "⁸"):
                    right = Expression("literal", value=float("²³⁴⁵⁶⁷⁸".index(nxt) + 2))
                else:
                    right = self.expression(precedence, depth + 1)
                if (right.operator == "neg" and len(right.operands) == 1
                        and right.operands[0].operator == "literal"):
                    right = Expression("literal", value=-float(right.operands[0].value))
                if (right.operator != "literal" or right.dimension != DIMENSIONLESS
                        or not float(right.value).is_integer() or abs(float(right.value)) > 8):
                    raise ExpressionError("Power requires a literal integer exponent between -8 and 8")
                exponent = int(right.value)
                left = Expression("pow", (left, right),
                                  dimension=tuple(exponent * power for power in left.dimension))
                continue
            if nxt in ("+", "-", "−", "*", "×", "·", "/"):
                self.take()
            right = self.expression(precedence + 1, depth + 1)
            if operator in ("add", "sub"):
                if left.dimension != right.dimension:
                    raise ExpressionError(f"Cannot {operator} dimensions {left.dimension} and {right.dimension}")
                dim = left.dimension
            elif operator == "mul":
                dim = _plus(left.dimension, right.dimension)
            else:
                dim = _minus(left.dimension, right.dimension)
            left = Expression(operator, (left, right), dimension=dim)
        return left


def parse_expression(source: str, *, symbols: dict[str, Dimension] | None = None) -> Expression:
    if symbols:
        for name, dimension in symbols.items():
            if (not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", name)
                    or name in ("x", "y", "pi", "sin", "cos", "exp", "sqrt", "tanh")
                    or len(dimension) != 4 or any(type(power) is not int for power in dimension)):
                raise ExpressionError(f"Invalid typed symbol {name!r}")
    parser = _Parser(tokenize(source), symbols)
    expression = parser.expression()
    if parser.peek() != "<EOF>":
        raise ExpressionError(f"Unexpected trailing token {parser.peek()!r}")
    return expression


def evaluate(expression: Expression, x, y, *, expected_dimension: Dimension | None = None,
             values: dict[str, object] | None = None,
             boundary_temperature: float | None = None,
             boundary_gradient: float | None = None,
             boundary_axes: tuple[tuple[str, float | str | tuple[float | str, float | str] | None], ...] | None = None,
             boundary_faces: tuple[tuple[str, float | str | tuple[float | str, float | str] | None], ...] | None = None):
    """Lower a validated expression tree to NumPy arithmetic, with no eval/exec."""
    import numpy as np
    if expected_dimension is not None and expression.dimension != expected_dimension:
        raise ExpressionError(f"Expected dimension {expected_dimension}, got {expression.dimension}")
    if boundary_temperature is not None and not math.isfinite(boundary_temperature):
        raise ExpressionError("Dirichlet boundary temperature must be finite")
    if boundary_gradient is not None and not math.isfinite(boundary_gradient):
        raise ExpressionError("Neumann boundary gradient must be finite")
    if boundary_temperature is not None and boundary_gradient is not None:
        raise ExpressionError("Cannot combine Dirichlet and Neumann boundary conditions")
    def validate_condition(condition):
        if not isinstance(condition, tuple) or len(condition) != 2:
            raise ExpressionError("Invalid boundary condition")
        kind, value = condition
        if kind == "Periodic":
            if value is not None:
                raise ExpressionError("Periodic boundary must not carry a value")
        elif kind in ("Dirichlet", "Neumann"):
            if type(value) not in (int, float) or not math.isfinite(value):
                raise ExpressionError("Boundary value must be finite")
        elif kind in ("DirichletProfile", "NeumannProfile"):
            if not isinstance(value, str):
                raise ExpressionError(f"{kind} must be a typed expression")
            profile = parse_expression(value, symbols={"t": (0, 0, 1, 0)})
            expected = TEMPERATURE if kind == "DirichletProfile" else (-1, 0, 0, 1)
            if profile.dimension != expected:
                raise ExpressionError(f"{kind} has incorrect physical dimensions")
            def check_profile(node):
                if node.operator in ("∂ₓ", "∂ᵧ", "∂ₓ²", "∂ᵧ²", "∇²"):
                    raise ExpressionError(f"{kind} cannot contain spatial derivatives")
                for child in node.operands:
                    check_profile(child)
            check_profile(profile)
        elif kind in ("Robin", "RobinProfile"):
            if not isinstance(value, tuple) or len(value) != 2:
                raise ExpressionError("Robin requires ambient temperature and transfer length")
            for argument, expected, description in (
                (value[0], TEMPERATURE, "ambient temperature"),
                (value[1], LENGTH, "transfer length"),
            ):
                if type(argument) in (int, float):
                    if not math.isfinite(argument) or (description == "transfer length" and argument <= 0):
                        raise ExpressionError(f"Robin {description} must be finite and positive where required")
                    continue
                if kind != "RobinProfile" or not isinstance(argument, str):
                    raise ExpressionError(f"Robin {description} must be a typed expression")
                profile = parse_expression(argument, symbols={"t": (0, 0, 1, 0)})
                if profile.dimension != expected:
                    raise ExpressionError(f"Robin {description} has incorrect physical dimensions")
                def check_robin_profile(node):
                    if node.operator in ("∂ₓ", "∂ᵧ", "∂ₓ²", "∂ᵧ²", "∇²"):
                        raise ExpressionError(f"Robin {description} cannot contain spatial derivatives")
                    for child in node.operands:
                        check_robin_profile(child)
                check_robin_profile(profile)
        else:
            raise ExpressionError("Unsupported boundary condition")

    if boundary_faces is not None:
        if boundary_temperature is not None or boundary_gradient is not None or boundary_axes is not None:
            raise ExpressionError("Cannot combine face boundaries with other boundaries")
        if not isinstance(boundary_faces, tuple) or len(boundary_faces) != 4:
            raise ExpressionError("Face boundaries require exactly four conditions")
        for condition in boundary_faces:
            validate_condition(condition)
        for lower, upper in ((0, 1), (2, 3)):
            if (boundary_faces[lower][0] == "Periodic") != (boundary_faces[upper][0] == "Periodic"):
                raise ExpressionError("Periodic boundaries must occur on both faces of an axis")
    if boundary_axes is not None:
        if boundary_temperature is not None or boundary_gradient is not None:
            raise ExpressionError("Cannot combine axis boundaries with uniform boundaries")
        if not isinstance(boundary_axes, tuple) or len(boundary_axes) != 2:
            raise ExpressionError("Axis boundaries require exactly two conditions")
        for condition in boundary_axes:
            validate_condition(condition)

    def cartesian_grid():
        coordinates_x = np.asarray(x, dtype=np.float64)
        coordinates_y = np.asarray(y, dtype=np.float64)
        if (coordinates_x.ndim != 2 or coordinates_x.shape != coordinates_y.shape
                or min(coordinates_x.shape) < 3):
            raise ExpressionError("Spatial derivatives require a two-dimensional Cartesian coordinate grid")
        if not (np.all(np.isfinite(coordinates_x)) and np.all(np.isfinite(coordinates_y))):
            raise ExpressionError("Spatial derivative coordinates must be finite")
        spacing_x = float(coordinates_x[1, 0] - coordinates_x[0, 0])
        spacing_y = float(coordinates_y[0, 1] - coordinates_y[0, 0])
        if (spacing_x <= 0 or spacing_y <= 0
                or not np.allclose(coordinates_x, coordinates_x[:, :1], rtol=1e-12, atol=1e-12)
                or not np.allclose(coordinates_y, coordinates_y[:1, :], rtol=1e-12, atol=1e-12)
                or not np.allclose(np.diff(coordinates_x[:, 0]), spacing_x, rtol=1e-12, atol=1e-12)
                or not np.allclose(np.diff(coordinates_y[0, :]), spacing_y, rtol=1e-12, atol=1e-12)):
            raise ExpressionError("Spatial derivatives require a uniformly spaced Cartesian grid")
        return coordinates_x.shape, spacing_x, spacing_y

    def neighbor(field, axis: int, forward: bool, spacing: float):
        """Cell-centered ghost cells, independently selected for x and y."""
        shifted = np.roll(field, -1 if forward else 1, axis=axis)
        if boundary_faces is not None:
            kind, value = boundary_faces[2 * axis + (1 if forward else 0)]
        elif boundary_axes is not None:
            kind, value = boundary_axes[axis]
        elif boundary_temperature is not None:
            kind, value = "Dirichlet", boundary_temperature
        elif boundary_gradient is not None:
            kind, value = "Neumann", boundary_gradient
        else:
            kind, value = "Periodic", None
        if kind != "Periodic":
            shifted = shifted.copy()
            face = -1 if forward else 0
            target = (face, slice(None)) if axis == 0 else (slice(None), face)
            if kind in ("DirichletProfile", "NeumannProfile"):
                # Evaluate at the actual face, not at cell centers. In particular
                # a time-dependent boundary uses the current RK2 stage time.
                coordinate_x = np.full_like(x, float(x[0, 0] - spacing / 2) if axis == 0 and not forward
                                            else float(x[-1, 0] + spacing / 2)) if axis == 0 else x
                coordinate_y = np.full_like(y, float(y[0, 0] - spacing / 2) if axis == 1 and not forward
                                            else float(y[0, -1] + spacing / 2)) if axis == 1 else y
                profile = parse_expression(value, symbols={"t": (0, 0, 1, 0)})
                expected = TEMPERATURE if kind == "DirichletProfile" else (-1, 0, 0, 1)
                boundary_values = np.broadcast_to(evaluate(
                    profile, coordinate_x, coordinate_y, expected_dimension=expected,
                    values={"t": values["t"]} if values is not None and "t" in values else {}),
                    field.shape)
                shifted[target] = (2 * boundary_values[target] - field[target]
                                   if kind == "DirichletProfile"
                                   else field[target] + spacing * boundary_values[target])
            elif kind in ("Robin", "RobinProfile"):
                ambient, transfer_length = value
                if kind == "RobinProfile":
                    # Evaluate both independently typed profiles at the physical
                    # face and current RK2 stage, never at interior cell centers.
                    coordinate_x = np.full_like(x, float(x[0, 0] - spacing / 2) if axis == 0 and not forward
                                                else float(x[-1, 0] + spacing / 2)) if axis == 0 else x
                    coordinate_y = np.full_like(y, float(y[0, 0] - spacing / 2) if axis == 1 and not forward
                                                else float(y[0, -1] + spacing / 2)) if axis == 1 else y
                    stage_values = {"t": values["t"]} if values is not None and "t" in values else {}
                    def face_argument(argument, dimension):
                        if not isinstance(argument, str):
                            return argument
                        result = evaluate(
                            parse_expression(argument, symbols={"t": (0, 0, 1, 0)}),
                            coordinate_x, coordinate_y, expected_dimension=dimension,
                            values=stage_values)
                        return np.broadcast_to(result, field.shape)[target]
                    ambient = face_argument(ambient, TEMPERATURE)
                    transfer_length = face_argument(transfer_length, LENGTH)
                if not np.all(np.isfinite(transfer_length)) or np.any(np.asarray(transfer_length) <= 0):
                    raise ExpressionError("Robin transfer length must be positive and finite at every face point")
                if not np.all(np.isfinite(ambient)):
                    raise ExpressionError("Robin ambient temperature must be finite at every face point")
                # Face temperature is the mean of interior and ghost.
                # ∂n T = (ambient - T_face) / transfer_length.
                shifted[target] = field[target] + spacing * (ambient - field[target]) / (
                    transfer_length + spacing / 2)
            else:
                shifted[target] = (2 * value - field[target] if kind == "Dirichlet"
                                   else field[target] + value * spacing)
        return shifted

    def visit(node: Expression):
        if node.operator in ("∂ₓ", "∂ᵧ", "∂ₓ²", "∂ᵧ²", "∇²"):
            shape, spacing_x, spacing_y = cartesian_grid()
            if (boundary_temperature is not None or boundary_gradient is not None
                    or (boundary_axes is not None and any(kind != "Periodic" for kind, _ in boundary_axes))
                    or (boundary_faces is not None and any(kind != "Periodic" for kind, _ in boundary_faces))) and not (
                    node.operands[0].operator == "name"
                    and node.operands[0].value == "temperature"
                    and node.operands[0].dimension == TEMPERATURE):
                raise ExpressionError("Non-periodic derivatives require the temperature field")
            field = np.broadcast_to(np.asarray(visit(node.operands[0]), dtype=np.float64), shape)
            if node.operator == "∂ₓ":
                return (neighbor(field, 0, True, spacing_x) - neighbor(field, 0, False, spacing_x)) / (2 * spacing_x)
            if node.operator == "∂ᵧ":
                return (neighbor(field, 1, True, spacing_y) - neighbor(field, 1, False, spacing_y)) / (2 * spacing_y)
            if node.operator == "∂ₓ²":
                return (neighbor(field, 0, True, spacing_x) + neighbor(field, 0, False, spacing_x) - 2 * field) / spacing_x**2
            if node.operator == "∂ᵧ²":
                return (neighbor(field, 1, True, spacing_y) + neighbor(field, 1, False, spacing_y) - 2 * field) / spacing_y**2
            return ((neighbor(field, 0, True, spacing_x) + neighbor(field, 0, False, spacing_x) - 2 * field) / spacing_x**2
                    + (neighbor(field, 1, True, spacing_y) + neighbor(field, 1, False, spacing_y) - 2 * field) / spacing_y**2)
        if node.operator == "literal":
            return float(node.value)
        if node.operator == "name":
            if node.value in ("x", "y", "pi"):
                return {"x": x, "y": y, "pi": math.pi}[node.value]
            if values is None or node.value not in values:
                raise ExpressionError(f"Missing numerical value for {node.value!r}")
            return values[node.value]
        args = tuple(visit(arg) for arg in node.operands)
        if node.operator == "add": return args[0] + args[1]
        if node.operator == "sub": return args[0] - args[1]
        if node.operator == "mul": return args[0] * args[1]
        if node.operator == "pow":
            with np.errstate(over="ignore", divide="ignore", invalid="ignore"):
                return np.power(args[0], int(node.operands[1].value))
        if node.operator == "div":
            with np.errstate(divide="ignore", invalid="ignore"):
                return np.divide(args[0], args[1])
        if node.operator == "neg": return -args[0]
        if node.operator == "pos": return args[0]
        if node.operator in ("sin", "cos", "exp", "sqrt", "tanh"):
            with np.errstate(over="ignore", invalid="ignore"):
                return getattr(np, node.operator)(args[0])
        raise ExpressionError(f"Unsupported operator {node.operator!r}")
    result = np.asarray(visit(expression), dtype=np.float64)
    if not np.all(np.isfinite(result)):
        raise ExpressionError("Expression evaluates to non-finite values")
    return result
