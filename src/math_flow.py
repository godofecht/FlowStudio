#!/usr/bin/env python3
"""Executable, explicitly bounded mathematical Flow dialect.

This is a separate compiler frontend for FlowStudio, not a change to upstream
Flow 2.0's grammar. Its backend is NumPy finite-difference Navier-Stokes.
Unsupported equations and numerical methods fail closed.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import math
from pathlib import Path
import re
import sys
from math_flow_expr import parse_expression, evaluate, ExpressionError, VELOCITY

TOKEN = re.compile(
    r"\s+|#[^\n]*|10[⁻−-][⁰¹²³⁴⁵⁶⁷⁸⁹0-9]+|"
    r"\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|"
    r"[A-Za-z_][A-Za-z_0-9]*|[∂∇∫ₜπ²³⁻⁰¹⁴⁵⁶⁷⁸⁹×·▷−½]|"
    r"[{}()<>=:,/+*.\-]"
)
SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻", "0123456789-")
MAX_SOURCE = 262144


class FlowMathError(ValueError):
    pass


@dataclass(frozen=True)
class Token:
    text: str
    line: int
    column: int


def lex(source: str) -> list[Token]:
    if len(source.encode("utf-8")) > MAX_SOURCE:
        raise FlowMathError("Source exceeds 256 KiB")
    tokens: list[Token] = []
    pos, line, column = 0, 1, 1
    while pos < len(source):
        match = TOKEN.match(source, pos)
        if match is None:
            raise FlowMathError(f"{line}:{column}: unexpected character {source[pos]!r}")
        value = match.group()
        if not value.isspace() and not value.startswith("#"):
            tokens.append(Token(value, line, column))
        for char in value:
            if char == "\n":
                line, column = line + 1, 1
            else:
                column += 1
        pos = match.end()
    return tokens


class Parser:
    def __init__(self, tokens: list[Token]):
        self.tokens = tokens
        self.index = 0

    def peek(self) -> str:
        return self.tokens[self.index].text if self.index < len(self.tokens) else "<EOF>"

    def pop(self, expected: str | None = None) -> str:
        value = self.peek()
        if expected is not None and value != expected:
            where = self.tokens[self.index] if self.index < len(self.tokens) else None
            location = f"{where.line}:{where.column}" if where else "end of file"
            raise FlowMathError(f"{location}: expected {expected!r}, got {value!r}")
        if value == "<EOF>":
            raise FlowMathError("Unexpected end of file")
        self.index += 1
        return value

    def identifier(self) -> str:
        value = self.pop()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", value):
            raise FlowMathError(f"Expected identifier, got {value!r}")
        return value

    def block(self) -> list[Token]:
        self.pop("{")
        start = self.index
        depth = 1
        while self.index < len(self.tokens):
            token = self.pop()
            if token == "{":
                depth += 1
            elif token == "}":
                depth -= 1
                if depth == 0:
                    return self.tokens[start:self.index - 1]
        raise FlowMathError("Unclosed block")

    def statement(self) -> list[str]:
        if self.index >= len(self.tokens):
            return []
        start_line = self.tokens[self.index].line
        values = []
        depth = 0
        while self.index < len(self.tokens):
            token = self.tokens[self.index]
            if token.line > start_line and depth == 0:
                break
            if token.text in ("(", "<"):
                depth += 1
            if token.text in (")", ">"):
                depth -= 1
            values.append(self.pop())
        return values


def lines(tokens: list[Token]) -> list[list[str]]:
    # A statement can continue onto the next line after = or a binary operator.
    if not tokens:
        return []
    result: list[list[str]] = []
    current: list[str] = []
    previous_line = tokens[0].line
    depth = 0
    continuations = {"=", "+", "-", "−", "*", "/", "·", "∇", "▷"}
    for token in tokens:
        if token.line > previous_line and depth == 0 and current and current[-1] not in continuations:
            result.append(current)
            current = []
        current.append(token.text)
        if token.text == "(":
            depth += 1
        elif token.text == ")":
            depth -= 1
        previous_line = token.line
    if current:
        result.append(current)
    return result


def split_sections(tokens: list[Token]) -> tuple[list[list[str]], dict[str, list[Token]]]:
    p = Parser(tokens)
    statements = []
    sections: dict[str, list[Token]] = {}
    while p.peek() != "<EOF>":
        if p.peek() in ("dynamics", "constraint", "initial", "spatial", "temporal", "pressure"):
            name = p.pop()
            if p.peek() == "{":
                if name in sections:
                    raise FlowMathError(f"Duplicate {name} section")
                sections[name] = p.block()
                continue
            p.index -= 1
        start = p.index
        line = p.tokens[p.index].line
        while p.index < len(p.tokens) and p.tokens[p.index].line == line:
            p.index += 1
        statements.append([t.text for t in p.tokens[start:p.index]])
    return statements, sections


def assignments(tokens: list[Token]) -> dict[str, list[str]]:
    result = {}
    for line in lines(tokens):
        if len(line) < 3 or line[1] != "=":
            raise FlowMathError(f"Expected assignment, got {' '.join(line)}")
        if line[0] in result:
            raise FlowMathError(f"Duplicate assignment {line[0]}")
        result[line[0]] = line[2:]
    return result


def expect_keys(data: dict, required: set[str], name: str) -> None:
    if set(data) != required:
        raise FlowMathError(f"{name}: expected {sorted(required)}, got {sorted(data)}")


def number(tokens: list[str], unit: list[str] | None = None) -> float:
    text = "".join(tokens).replace("−", "-")
    if unit:
        suffix = "".join(unit)
        if not text.endswith(suffix):
            raise FlowMathError(f"Expected unit {suffix!r}, got {text!r}")
        text = text[:-len(suffix)]
    text = text.translate(SUPERSCRIPTS)
    if text.startswith("10-") and "e" not in text:
        text = "1e" + text[2:]
    try:
        value = float(text)
    except ValueError as exc:
        raise FlowMathError(f"Invalid numerical literal {text!r}") from exc
    if not math.isfinite(value):
        raise FlowMathError("Non-finite numerical literal")
    return value


@dataclass(frozen=True)
class Model:
    width: int
    height: int
    length_x: float
    length_y: float
    density: float
    viscosity: float
    velocity_x: list[str]
    velocity_y: list[str]
    step: float
    tolerance: float
    until: float


def parse(source: str) -> Model:
    tokens = lex(source)
    # Dispatch on an actual field declaration, never a comment or editor snippet.
    if any(tokens[i].text == "field" and tokens[i + 1].text == "temperature"
           for i in range(len(tokens) - 1)):
        from math_flow_heat import parse_heat
        return parse_heat(source, sys.modules[__name__])
    p = Parser(tokens)
    p.pop("domain")
    domain_name = p.identifier()
    if not domain_name[0].isupper():
        raise FlowMathError("Domain type must start uppercase")
    domain_stmts, domain_sections = split_sections(p.block())
    if domain_sections:
        raise FlowMathError("Unexpected domain sections")
    d = assignments_tokens(domain_stmts)
    expect_keys(d, {"grid", "extent", "boundaries"}, "domain")
    if d["boundaries"] != ["Periodic"]:
        raise FlowMathError("Only Periodic boundaries are implemented")
    grid = d["grid"]
    if len(grid) != 3 or grid[1] != "×":
        raise FlowMathError("grid requires width × height")
    width, height = int(number(grid[:1])), int(number(grid[2:]))
    if not (8 <= width <= 512 and 8 <= height <= 512):
        raise FlowMathError("Grid dimensions must be between 8 and 512")
    extent = d["extent"]
    if len(extent) != 5 or extent[1] != "m" or extent[2] != "×" or extent[4] != "m":
        raise FlowMathError("extent requires length m × length m")
    length_x, length_y = number(extent[:1]), number(extent[3:4])
    if min(length_x, length_y) <= 0:
        raise FlowMathError("Domain extent must be positive")
    p.pop("model")
    model_name = p.identifier()
    p.pop("on")
    p.pop(domain_name)
    model_statements, sections = split_sections(p.block())
    expect_keys(sections, {"dynamics", "constraint", "initial"}, "model")
    consts = {}
    fields = {}
    for stmt in model_statements:
        if len(stmt) >= 4 and stmt[0] == "const" and stmt[2] == "=":
            consts[stmt[1]] = stmt[3:]
        elif len(stmt) >= 4 and stmt[0] == "field" and stmt[2] == ":":
            fields[stmt[1]] = stmt[3:]
        else:
            raise FlowMathError(f"Unsupported model declaration: {' '.join(stmt)}")
    expect_keys(consts, {"density", "kinematicViscosity"}, "model constants")
    expect_keys(fields, {"velocity", "pressure"}, "model fields")
    if fields["velocity"] != ["Vector", "²", "<", "MetersPerSecond", ">"]:
        raise FlowMathError("velocity must be Vector²<MetersPerSecond>")
    if fields["pressure"] != ["Scalar", "<", "Pascals", ">"]:
        raise FlowMathError("pressure must be Scalar<Pascals>")
    density = number(consts["density"], ["k", "g", "/", "m", "³"])
    viscosity = number(consts["kinematicViscosity"], ["m", "²", "/", "s"])
    if density <= 0 or viscosity < 0:
        raise FlowMathError("Density must be positive and viscosity nonnegative")
    dynamics = "".join(t.text for t in sections["dynamics"])
    required = "∂ₜvelocity=−(velocity·∇)velocity−∇pressure/density+kinematicViscosity∇²velocity"
    if dynamics != required:
        raise FlowMathError("Unsupported dynamics: expected 2D incompressible Navier-Stokes equation")
    if "".join(t.text for t in sections["constraint"]) != "∇·velocity=0":
        raise FlowMathError("Only incompressibility constraint ∇ · velocity = 0 is implemented")
    initial = assignments(sections["initial"])
    expect_keys(initial, {"velocity", "pressure"}, "initial")
    if initial["pressure"] != ["0", "Pa"]:
        raise FlowMathError("Initial pressure must be 0Pa")
    velocity = initial["velocity"]
    if not velocity or velocity[0] != "(" or velocity[-1] != ")":
        raise FlowMathError("Initial velocity must be a two-component tuple")
    inner, depth, parts = velocity[1:-1], 0, [[]]
    for token in inner:
        if token == "(":
            depth += 1
        elif token == ")":
            depth -= 1
        if token == "," and depth == 0:
            parts.append([])
        else:
            parts[-1].append(token)
    if len(parts) != 2:
        raise FlowMathError("Initial velocity requires exactly two components")
    for component in parts:
        try:
            expression = parse_expression("".join(component))
        except ExpressionError as exc:
            raise FlowMathError(f"Invalid initial velocity expression: {exc}") from exc
        if expression.dimension != VELOCITY:
            raise FlowMathError(f"Initial velocity dimension must be {VELOCITY}, got {expression.dimension}")
    p.pop("solver")
    solver_name = p.identifier()
    p.pop("for")
    p.pop(model_name)
    solver_statements, solver_sections = split_sections(p.block())
    expect_keys(solver_sections, {"spatial", "temporal", "pressure"}, "solver")
    spatial = assignments(solver_sections["spatial"])
    temporal = assignments(solver_sections["temporal"])
    pressure = assignments(solver_sections["pressure"])
    expect_keys(spatial, {"method", "gradient", "divergence", "diffusion"}, "spatial")
    for key, value in {"method": "FiniteDifference", "gradient": "ForwardDifference",
                       "divergence": "BackwardDifference", "diffusion": "CentralDifference"}.items():
        if spatial[key] != [value]:
            raise FlowMathError(f"Unsupported spatial {key}: {spatial[key]}")
    expect_keys(temporal, {"method", "timeStep"}, "temporal")
    if temporal["method"] != ["RungeKuttaSecondOrder"]:
        raise FlowMathError("Only RungeKuttaSecondOrder is implemented")
    step = number(temporal["timeStep"], ["s"])
    expect_keys(pressure, {"method", "tolerance", "gauge"}, "pressure")
    if pressure["method"] != ["ConjugateGradient"] or pressure["gauge"] != ["ZeroMean"]:
        raise FlowMathError("Only ConjugateGradient / ZeroMean pressure is supported")
    tolerance = number(pressure["tolerance"])
    if step <= 0 or tolerance <= 0:
        raise FlowMathError("Time step and tolerance must be positive")
    if solver_statements != [["enforce", "∇", "·", "velocity", "=", "0", "via", "PressureProjection"]]:
        raise FlowMathError("Solver must enforce incompressibility via PressureProjection")
    # Parse the executable pipeline; observation declarations are checked separately.
    p.pop("let")
    p.pop("simulation")
    p.pop("=")
    p.pop(model_name)
    p.pop("▷")
    p.pop(solver_name)
    p.pop("▷")
    p.pop("Evolve")
    p.pop("(")
    p.pop("until")
    p.pop(":")
    until_tokens = []
    while p.peek() != ")":
        until_tokens.append(p.pop())
    p.pop(")")
    until = number(until_tokens, ["s"])
    if until <= 0:
        raise FlowMathError("Evolution duration must be positive")
    p.pop("simulation")
    p.pop("▷")
    p.pop("Observe")
    observed = assignments(p.block())
    expect_keys(observed, {"vorticity", "divergence", "kineticEnergy"}, "Observe")
    if "".join(observed["vorticity"]) != "∇×velocity" or "".join(observed["divergence"]) != "∇·velocity":
        raise FlowMathError("Unsupported observation operators")
    if "".join(observed["kineticEnergy"]) != "½density∫(velocity·velocity)":
        raise FlowMathError("Unsupported kinetic-energy expression")
    p.pop("▷")
    p.pop("Visualize")
    visualized = assignments(p.block())
    if visualized != {"velocity": ["VectorField"], "vorticity": ["Heatmap"],
                      "kineticEnergy": ["LineGraph"]}:
        raise FlowMathError("Unsupported visualization mapping")
    if p.peek() != "<EOF>":
        raise FlowMathError(f"Unexpected trailing token {p.peek()}")
    return Model(width, height, length_x, length_y, density, viscosity,
                 parts[0], parts[1], step, tolerance, until)


def assignments_tokens(statements: list[list[str]]) -> dict[str, list[str]]:
    data = {}
    for stmt in statements:
        if len(stmt) < 3 or stmt[1] != "=" or stmt[0] in data:
            raise FlowMathError(f"Invalid or duplicate assignment: {' '.join(stmt)}")
        data[stmt[0]] = stmt[2:]
    return data


def initial_component(tokens: list[str], x, y):
    """Compile a typed Unicode expression AST and lower it to NumPy."""
    try:
        return evaluate(parse_expression("".join(tokens)), x, y,
                        expected_dimension=VELOCITY)
    except ExpressionError as exc:
        raise FlowMathError(f"Invalid initial velocity expression: {exc}") from exc


def simulate(model: Model, *, grid: int | None = None, until: float | None = None) -> dict:
    from math_flow_heat import HeatModel, simulate_heat
    if isinstance(model, HeatModel):
        return simulate_heat(model, grid=grid, until=until, error_type=FlowMathError)
    import numpy as np
    nx = ny = grid if grid is not None else None
    nx = nx or model.width
    ny = ny or model.height
    if min(nx, ny) < 8 or max(nx, ny) > 512:
        raise FlowMathError("Grid override must be between 8 and 512")
    dx, dy = model.length_x / nx, model.length_y / ny
    x, y = np.meshgrid((np.arange(nx) + .5) * dx,
                       (np.arange(ny) + .5) * dy, indexing="ij")
    u = np.broadcast_to(initial_component(model.velocity_x, x, y), (nx, ny)).copy()
    v = np.broadcast_to(initial_component(model.velocity_y, x, y), (nx, ny)).copy()
    duration = until if until is not None else model.until
    steps = math.ceil(duration / model.step)
    if not (0 < duration and 1 <= steps <= 200000):
        raise FlowMathError("Evolution must have between 1 and 200000 steps")
    dt = duration / steps
    if dt * max(np.max(np.abs(u)) / dx + np.max(np.abs(v)) / dy,
                2 * model.viscosity * (1 / dx**2 + 1 / dy**2)) > .8:
        raise FlowMathError("Time step violates conservative advection/diffusion stability bound")
    # The positive operator -D_backward G_forward is symmetric positive
    # semidefinite. Zero-mean pressure removes its periodic nullspace.
    def pressure_solve(rhs):
        b = -rhs + np.mean(rhs)
        solution = np.zeros_like(b)
        residual = b.copy()
        direction = residual.copy()
        rr = float(np.sum(residual * residual))
        initial_norm = math.sqrt(rr)
        if initial_norm == 0.0:
            return solution
        threshold = model.tolerance * initial_norm
        for _ in range(min(8 * max(nx, ny), 5000)):
            applied = -laplacian(direction)
            denom = float(np.sum(direction * applied))
            if denom <= 0:
                raise FlowMathError("Pressure conjugate gradient lost positive definiteness")
            alpha = rr / denom
            solution += alpha * direction
            residual -= alpha * applied
            next_rr = float(np.sum(residual * residual))
            if math.sqrt(next_rr) <= threshold:
                return solution - np.mean(solution)
            beta = next_rr / rr
            direction = residual + beta * direction
            rr = next_rr
        raise FlowMathError("Pressure conjugate gradient did not converge")

    def forward(a, axis, h):
        return (np.roll(a, -1, axis=axis) - a) / h

    def backward(a, axis, h):
        return (a - np.roll(a, 1, axis=axis)) / h

    def center(a, axis, h):
        return (np.roll(a, -1, axis=axis) - np.roll(a, 1, axis=axis)) / (2 * h)

    def laplacian(a):
        return (np.roll(a, -1, axis=0) + np.roll(a, 1, axis=0) - 2 * a) / dx**2 + \
               (np.roll(a, -1, axis=1) + np.roll(a, 1, axis=1) - 2 * a) / dy**2

    def divergence(a, b):
        return backward(a, 0, dx) + backward(b, 1, dy)

    def project(a, b, stage_dt):
        rhs = divergence(a, b) * model.density / stage_dt
        pressure = pressure_solve(rhs)
        return (a - stage_dt * forward(pressure, 0, dx) / model.density,
                b - stage_dt * forward(pressure, 1, dy) / model.density, pressure)

    def rhs(a, b):
        ux, uy = center(a, 0, dx), center(a, 1, dy)
        vx, vy = center(b, 0, dx), center(b, 1, dy)
        return (-a * ux - b * uy + model.viscosity * laplacian(a),
                -a * vx - b * vy + model.viscosity * laplacian(b))

    u, v, pressure = project(u, v, dt)
    initial_energy = .5 * model.density * dx * dy * np.sum(u*u + v*v)
    observations = [{"time": 0.0, "kineticEnergy": float(initial_energy),
                     "maximumDivergence": float(np.max(np.abs(divergence(u, v))))}]
    sample_stride = max(1, math.ceil(steps / 128))
    for step_index in range(steps):
        du, dv = rhs(u, v)
        stage_u, stage_v, _ = project(u + dt * du, v + dt * dv, dt)
        du2, dv2 = rhs(stage_u, stage_v)
        u, v, pressure = project(u + .5 * dt * (du + du2),
                                 v + .5 * dt * (dv + dv2), dt)
        if not (np.all(np.isfinite(u)) and np.all(np.isfinite(v))):
            raise FlowMathError("Non-finite velocity during integration")
        if (step_index + 1) % sample_stride == 0 or step_index + 1 == steps:
            observations.append({"time": float((step_index + 1) * dt),
                                 "kineticEnergy": float(.5 * model.density * dx * dy * np.sum(u*u + v*v)),
                                 "maximumDivergence": float(np.max(np.abs(divergence(u, v))))})
    final_divergence = float(np.max(np.abs(divergence(u, v))))
    energy = float(.5 * model.density * dx * dy * np.sum(u*u + v*v))
    vorticity = center(v, 0, dx) - center(u, 1, dy)
    return {"steps": steps, "grid": [nx, ny], "time": duration,
            "max_divergence": final_divergence,
            "initial_kinetic_energy": float(initial_energy),
            "kinetic_energy": energy,
            "vorticity_rms": float(np.sqrt(np.mean(vorticity*vorticity))),
            "pressure_mean": float(np.mean(pressure)),
            "pressure_solver": "conjugate gradient of periodic -D_backward G_forward",
            "observations": observations,
            "spatial": __import__("math_flow_spatial").spatial_snapshot(
                {"velocity_x": u, "velocity_y": v, "vorticity": vorticity},
                (model.length_x, model.length_y))}


def main() -> int:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("source", type=Path)
    cli.add_argument("--check", action="store_true")
    cli.add_argument("--grid", type=int)
    cli.add_argument("--until", type=float)
    args = cli.parse_args()
    try:
        model = parse(args.source.read_text(encoding="utf-8"))
        if args.check:
            result = {"ok": True, "frontend": "math-flow", "backend": "numpy",
                      "grid": [model.width, model.height], "until": model.until}
        else:
            result = simulate(model, grid=args.grid, until=args.until)
            result["ok"] = True
        print(json.dumps(result, sort_keys=True, allow_nan=False))
        return 0
    except (FlowMathError, OSError, ValueError, ImportError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
