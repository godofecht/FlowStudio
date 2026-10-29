"""Bounded, dimension-checked vector momentum equation AST.

The pressure gradient is represented explicitly but lowered through the
validated pressure-projection solver, not evaluated as an explicit RK2 slope.
This is a deliberately restricted compiler for incompressible Navier-Stokes,
not an arbitrary vector-calculus parser.
"""
from dataclasses import dataclass

# Dimensions are (length, mass, time, temperature) powers.
VELOCITY = (1, 0, -1, 0)
PRESSURE = (-1, 1, -2, 0)
DENSITY = (-3, 1, 0, 0)
KINEMATIC_VISCOSITY = (2, 0, -1, 0)
LENGTH = (1, 0, 0, 0)
TIME = (0, 0, 1, 0)
VELOCITY_RATE = (1, 0, -2, 0)


def _add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def _sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


_TERM_DIMENSIONS = {
    "advection": _add(VELOCITY, _sub(VELOCITY, LENGTH)),
    "pressureGradient": _sub(_sub(PRESSURE, LENGTH), DENSITY),
    "diffusion": _add(KINEMATIC_VISCOSITY, _sub(VELOCITY, (2, 0, 0, 0))),
}


@dataclass(frozen=True)
class VectorTerm:
    role: str
    sign: int
    dimension: tuple[int, int, int, int]
    symbols: tuple[str, ...]
    implicit: bool = False


@dataclass(frozen=True)
class VectorEquation:
    field: str
    terms: tuple[VectorTerm, ...]

    @property
    def explicit_terms(self):
        return tuple(term for term in self.terms if not term.implicit)


# Each supported term has a dimensionally validated physical interpretation.
# The pressure term is implicit in the incompressibility projection.
_PATTERNS = {
    "(velocity·∇)velocity": ("advection", -1, ("velocity",), False),
    "∇pressure/density": ("pressureGradient", -1, ("pressure", "density"), True),
    "kinematicViscosity∇²velocity": (
        "diffusion", 1, ("kinematicViscosity", "velocity"), False),
}


def compile_vector_equation(tokens: list[str]) -> VectorEquation:
    source = "".join(tokens)
    if source.count("=") != 1:
        raise ValueError("Vector dynamics requires exactly one equality")
    lhs, _ = source.split("=", 1)
    if lhs != "∂ₜvelocity":
        raise ValueError("Vector dynamics must evolve ∂ₜvelocity")

    # Split additive terms only at top level; preserve the parentheses in
    # (velocity · ∇)velocity, and reject unbalanced or nested surprises.
    equals = tokens.index("=")
    rhs = tokens[equals + 1:]
    if not rhs:
        raise ValueError("Missing vector momentum RHS")
    groups: list[tuple[int, str]] = []
    depth = 0
    current: list[str] = []
    sign = 1
    expecting_term = True
    for token in rhs:
        if token in ("+", "-", "−") and depth == 0:
            if current:
                groups.append((sign, "".join(current)))
                current = []
                expecting_term = True
            elif not expecting_term:
                raise ValueError("Empty vector momentum term")
            sign = 1 if token == "+" else -1
            continue
        if token == "(":
            depth += 1
        elif token == ")":
            depth -= 1
            if depth < 0:
                raise ValueError("Unbalanced vector momentum parentheses")
        current.append(token)
        expecting_term = False
    if depth != 0 or not current:
        raise ValueError("Incomplete vector momentum equation")
    groups.append((sign, "".join(current)))

    found: dict[str, VectorTerm] = {}
    terms = []
    for sign, expression in groups:
        if expression not in _PATTERNS:
            raise ValueError(f"Unsupported vector momentum term: {expression}")
        role, expected_sign, symbols, implicit = _PATTERNS[expression]
        if sign != expected_sign:
            raise ValueError(f"Incorrect sign for {role} term")
        if role in found:
            raise ValueError(f"Duplicate {role} term")
        dimension = _TERM_DIMENSIONS[role]
        if dimension != _sub(VELOCITY, TIME):
            raise ValueError(f"Invalid physical dimension for {role}")
        term = VectorTerm(role, sign, dimension, symbols, implicit)
        found[role] = term
        terms.append(term)
    if set(found) != {"advection", "pressureGradient", "diffusion"}:
        raise ValueError("Vector momentum requires advection, pressure gradient and diffusion exactly once")
    return VectorEquation("velocity", tuple(terms))
