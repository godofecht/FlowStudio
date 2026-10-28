"""Checked scalar heat-equation frontend and RK2 finite-difference backend.

This supports one validated PDE family, not arbitrary PDEs or an upstream
Flow 2.0 grammar extension.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

from math_flow_spatial import spatial_snapshot
from math_flow_expr import TEMPERATURE, parse_expression, evaluate, ExpressionError
from math_flow_equations import Equation, compile_heat_equation, TEMPERATURE_RATE


@dataclass(frozen=True)
class HeatModel:
    width: int
    height: int
    length_x: float
    length_y: float
    diffusivity: float
    initial: str
    step: float
    until: float
    equation: Equation | None = None
    reaction_rate: float = 0.0
    ambient_temperature: float = 0.0
    advection_velocity_x: float = 0.0
    advection_velocity_y: float = 0.0
    boundary_temperature: float | None = None
    boundary_gradient: float | None = None
    boundary_axes: tuple[tuple[str, float | str | tuple[float, float] | None], ...] | None = None
    boundary_faces: tuple[tuple[str, float | str | tuple[float, float] | None], ...] | None = None
    diffusivity_y: float | None = None
    cross_diffusivity: float = 0.0


def parse_heat(source: str, base) -> HeatModel:
    """Parse a complete scalar heat Flow program using the shared token grammar."""
    error = base.FlowMathError
    p = base.Parser(base.lex(source))
    p.pop("domain")
    domain = p.identifier()
    if not domain[0].isupper():
        raise error("Domain type must start uppercase")
    statements, sections = base.split_sections(p.block())
    if sections:
        raise error("Unexpected domain sections")
    d = base.assignments_tokens(statements)
    base.expect_keys(d, {"grid", "extent", "boundaries"}, "domain")
    boundary_temperature = None
    boundary_gradient = None
    boundary_axes = None
    boundary_faces = None

    def parse_face(tokens):
        if tokens == ["Periodic"]:
            return ("Periodic", None)
        if (len(tokens) < 4 or tokens[1] != "(" or tokens[-1] != ")"
                or tokens[0] not in ("Dirichlet", "Neumann", "Robin")):
            raise error("Heat boundaries must be Periodic, Dirichlet, Neumann or Robin")
        kind = tokens[0]
        if kind == "Robin":
            # Outward heat transfer: ∂n T = (ambient - T_face) / transferLength.
            # Either argument may be a typed, field-independent face profile.
            inner = tokens[2:-1]
            if inner.count(",") != 1:
                raise error("Robin requires ambient temperature and transfer length")
            comma = inner.index(",")

            def robin_argument(argument, unit, dimension, description):
                try:
                    literal = base.number(argument, unit)
                except error:
                    profile = "".join(argument)
                    try:
                        typed = parse_expression(profile, symbols={"t": (0, 0, 1, 0)})
                    except ExpressionError as exc:
                        raise error(f"Invalid Robin {description} profile: {exc}") from exc
                    if typed.dimension != dimension:
                        raise error(f"Robin {description} profile has incorrect physical dimensions")
                    def check_profile(node):
                        if node.operator in ("∂ₓ", "∂ᵧ", "∂ₓ²", "∂ᵧ²", "∇²"):
                            raise error(f"Robin {description} cannot contain spatial derivatives")
                        for child in node.operands:
                            check_profile(child)
                    check_profile(typed)
                    return profile
                if description == "transfer length" and literal <= 0:
                    raise error("Robin transfer length must be positive")
                return literal

            ambient = robin_argument(inner[:comma], ["K"], TEMPERATURE, "ambient temperature")
            length = robin_argument(inner[comma + 1:], ["m"], (1, 0, 0, 0), "transfer length")
            return ("RobinProfile" if isinstance(ambient, str) or isinstance(length, str)
                    else "Robin", (ambient, length))
        unit = ["K"] if kind == "Dirichlet" else ["K", "/", "m"]
        # Preserve literal values while allowing typed, field-independent
        # face profiles. Neumann uses outward-normal K/m, not Kelvin.
        try:
            return (kind, base.number(tokens[2:-1], unit))
        except error:
            profile = "".join(tokens[2:-1])
            try:
                typed = parse_expression(profile, symbols={"t": (0, 0, 1, 0)})
            except ExpressionError as exc:
                raise error(f"Invalid {kind} profile: {exc}") from exc
            expected = TEMPERATURE if kind == "Dirichlet" else (-1, 0, 0, 1)
            if typed.dimension != expected:
                raise error(f"{kind} profile must have {'Kelvin' if kind == 'Dirichlet' else 'Kelvin/metre'} dimensions")
            def check_profile(node):
                if node.operator in ("∂ₓ", "∂ᵧ", "∂ₓ²", "∂ᵧ²", "∇²"):
                    raise error(f"{kind} profiles cannot contain spatial derivatives")
                for child in node.operands:
                    check_profile(child)
            check_profile(typed)
            return (kind + "Profile", profile)

    boundary_tokens = d["boundaries"]
    if boundary_tokens and boundary_tokens[0] == "(":
        if boundary_tokens[-1] != ")":
            raise error("Mixed heat boundaries require (xBoundary, yBoundary)")
        parts = [[]]
        depth = 0
        for token in boundary_tokens[1:-1]:
            if token == "(":
                depth += 1
            elif token == ")":
                depth -= 1
                if depth < 0:
                    raise error("Unbalanced heat boundary declaration")
            if token == "," and depth == 0:
                parts.append([])
            else:
                parts[-1].append(token)
        if depth != 0 or len(parts) not in (2, 4):
            raise error("Heat boundaries require two axis or four face conditions")
        if len(parts) == 2:
            boundary_axes = (parse_face(parts[0]), parse_face(parts[1]))
        else:
            boundary_faces = tuple(parse_face(part) for part in parts)
            # A periodic axis must be periodic on both opposing faces.
            for lower, upper in ((0, 1), (2, 3)):
                if (boundary_faces[lower][0] == "Periodic") != (boundary_faces[upper][0] == "Periodic"):
                    raise error("Periodic boundaries must occur on both faces of an axis")
    else:
        kind, value = parse_face(boundary_tokens)
        if kind in ("Robin", "RobinProfile", "DirichletProfile", "NeumannProfile"):
            boundary_axes = ((kind, value), (kind, value))
        if kind == "Dirichlet":
            boundary_temperature = value
        elif kind == "Neumann":
            boundary_gradient = value
    grid = d["grid"]
    if len(grid) != 3 or grid[1] != "×":
        raise error("grid requires width × height")
    width, height = base.number(grid[:1]), base.number(grid[2:])
    if not (width.is_integer() and height.is_integer() and
            8 <= width <= 512 and 8 <= height <= 512):
        raise error("Heat grid dimensions must be integers between 8 and 512")
    extent = d["extent"]
    if len(extent) != 5 or extent[1] != "m" or extent[2] != "×" or extent[4] != "m":
        raise error("extent requires length m × length m")
    lx, ly = base.number(extent[:1]), base.number(extent[3:4])
    if min(lx, ly) <= 0:
        raise error("Domain extent must be positive")
    p.pop("model")
    name = p.identifier()
    p.pop("on")
    p.pop(domain)
    statements, sections = base.split_sections(p.block())
    base.expect_keys(sections, {"dynamics", "initial"}, "heat model")
    consts, fields = {}, {}
    for stmt in statements:
        if len(stmt) >= 4 and stmt[0] == "const" and stmt[2] == "=":
            if stmt[1] in consts:
                raise error("Duplicate heat constant")
            consts[stmt[1]] = stmt[3:]
        elif len(stmt) >= 4 and stmt[0] == "field" and stmt[2] == ":":
            if stmt[1] in fields:
                raise error("Duplicate heat field")
            fields[stmt[1]] = stmt[3:]
        else:
            raise error(f"Unsupported heat declaration: {' '.join(stmt)}")
    # Infer optional operator families independently; require complete declarations.
    # This permits one equation AST to compose advection and reaction while
    # rejecting partial, misspelled, or undeclared physical constants.
    reaction = bool({"reactionRate", "ambientTemperature"} & consts.keys())
    advection = bool({"advectionVelocityX", "advectionVelocityY"} & consts.keys())
    anisotropic = bool({"diffusivityX", "diffusivityY"} & consts.keys())
    cross_diffusion = "crossDiffusivity" in consts
    if cross_diffusion and not anisotropic:
        raise error("Cross diffusion requires both directional diffusivities")
    if cross_diffusion and (boundary_temperature is not None or boundary_gradient is not None
                            or boundary_axes is not None or boundary_faces is not None):
        raise error("Cross diffusion currently requires periodic boundaries")
    if anisotropic and "diffusivity" in consts:
        raise error("Declare isotropic diffusivity or both directional diffusivities, not both")
    required = {"diffusivityX", "diffusivityY"} if anisotropic else {"diffusivity"}
    if cross_diffusion:
        required.add("crossDiffusivity")
    if reaction:
        required.update({"reactionRate", "ambientTemperature"})
    if advection:
        required.update({"advectionVelocityX", "advectionVelocityY"})
    base.expect_keys(consts, required, "heat constants")
    base.expect_keys(fields, {"temperature"}, "heat fields")
    if fields["temperature"] != ["Scalar", "<", "Kelvin", ">"]:
        raise error("temperature must be Scalar<Kelvin>")
    diffusivity = base.number(consts["diffusivityX" if anisotropic else "diffusivity"], ["m", "²", "/", "s"])
    diffusivity_y = base.number(consts["diffusivityY"], ["m", "²", "/", "s"]) if anisotropic else None
    cross_diffusivity = base.number(consts["crossDiffusivity"], ["m", "²", "/", "s"]) if cross_diffusion else 0.0
    if diffusivity <= 0 or (diffusivity_y is not None and diffusivity_y <= 0):
        raise error("Heat diffusivities must be positive")
    if cross_diffusion and abs(cross_diffusivity) >= 2 * math.sqrt(diffusivity * diffusivity_y):
        raise error("Cross diffusion tensor must be strictly positive definite")
    reaction_rate = base.number(consts["reactionRate"], ["s", "⁻", "¹"]) if reaction else 0.0
    ambient_temperature = base.number(consts["ambientTemperature"], ["K"]) if reaction else 0.0
    if reaction and reaction_rate <= 0:
        raise error("Reaction rate must be positive")
    velocity_x = base.number(consts["advectionVelocityX"], ["m", "/", "s"]) if advection else 0.0
    velocity_y = base.number(consts["advectionVelocityY"], ["m", "/", "s"]) if advection else 0.0
    try:
        equation = compile_heat_equation([token.text for token in sections["dynamics"]],
                                         reaction=reaction, advection=advection, anisotropic=anisotropic,
                                         cross_diffusion=cross_diffusion)
    except ExpressionError as exc:
        raise error(f"Unsupported heat dynamics: {exc}") from exc
    if equation.nonlinear and ambient_temperature <= 0:
        raise error("Quadratic thermal relaxation requires positive ambientTemperature")
    initial = base.assignments(sections["initial"])
    base.expect_keys(initial, {"temperature"}, "heat initial")
    expression = "".join(initial["temperature"])
    try:
        typed = parse_expression(expression)
    except ExpressionError as exc:
        raise error(f"Invalid heat initial expression: {exc}") from exc
    if typed.dimension != TEMPERATURE:
        raise error(f"Heat initial condition must have Kelvin dimensions, got {typed.dimension}")
    p.pop("solver")
    solver = p.identifier()
    p.pop("for")
    p.pop(name)
    statements, sections = base.split_sections(p.block())
    if statements:
        raise error("Unexpected heat solver statements")
    base.expect_keys(sections, {"spatial", "temporal"}, "heat solver")
    spatial = base.assignments(sections["spatial"])
    temporal = base.assignments(sections["temporal"])
    if spatial != {"method": ["FiniteDifference"], "diffusion": ["CentralDifference"]}:
        raise error("Heat solver requires FiniteDifference / CentralDifference")
    base.expect_keys(temporal, {"method", "timeStep"}, "heat temporal")
    if temporal["method"] != ["RungeKuttaSecondOrder"]:
        raise error("Heat solver requires RungeKuttaSecondOrder")
    step = base.number(temporal["timeStep"], ["s"])
    if step <= 0:
        raise error("Heat time step must be positive")
    p.pop("let")
    p.pop("simulation")
    p.pop("=")
    p.pop(name)
    p.pop("▷")
    p.pop(solver)
    p.pop("▷")
    p.pop("Evolve")
    p.pop("(")
    p.pop("until")
    p.pop(":")
    duration = []
    while p.peek() != ")":
        duration.append(p.pop())
    p.pop(")")
    until = base.number(duration, ["s"])
    if until <= 0:
        raise error("Heat evolution duration must be positive")
    p.pop("simulation")
    p.pop("▷")
    p.pop("Observe")
    observed = base.assignments(p.block())
    if {k: "".join(v) for k, v in observed.items()} != {
        "meanTemperature": "Mean(temperature)",
        "temperatureVariance": "Mean((temperature−meanTemperature)²)",
    }:
        raise error("Unsupported heat observation mapping")
    p.pop("▷")
    p.pop("Visualize")
    visualized = base.assignments(p.block())
    if visualized != {"temperature": ["Heatmap"], "temperatureVariance": ["LineGraph"]}:
        raise error("Unsupported heat visualization mapping")
    if p.peek() != "<EOF>":
        raise error(f"Unexpected trailing heat token {p.peek()}")
    return HeatModel(int(width), int(height), lx, ly, diffusivity, expression,
                     step, until, equation, reaction_rate, ambient_temperature,
                     velocity_x, velocity_y, boundary_temperature, boundary_gradient, boundary_axes, boundary_faces,
                     diffusivity_y, cross_diffusivity)


def simulate_heat(model: HeatModel, *, grid: int | None = None, until: float | None = None,
                  error_type: type[ValueError] = ValueError) -> dict:
    """Explicit RK2, centered periodic Laplacian; no hidden numerical fallback."""
    import numpy as np
    nx = ny = grid if grid is not None else None
    nx = nx or model.width
    ny = ny or model.height
    if not (isinstance(nx, int) and isinstance(ny, int) and 8 <= nx <= 512 and 8 <= ny <= 512):
        raise error_type("Heat grid dimensions must be integers between 8 and 512")
    duration = until if until is not None else model.until
    if not math.isfinite(duration) or duration <= 0:
        raise error_type("Heat duration must be finite and positive")
    steps = math.ceil(duration / model.step)
    if not 1 <= steps <= 200000:
        raise error_type("Heat evolution must have between 1 and 200000 steps")
    dt = duration / steps
    dx, dy = model.length_x / nx, model.length_y / ny
    diffusivity_y = model.diffusivity if model.diffusivity_y is None else model.diffusivity_y
    diffusion_stiffness = (model.diffusivity / dx**2 + diffusivity_y / dy**2
                           + abs(model.cross_diffusivity) / (4 * dx * dy))
    linear_reaction_rate = (0.0 if model.equation is not None and model.equation.nonlinear
                            else model.reaction_rate)
    # A conservative combined advective/diffusive CFL guard. Centered
    # advection with explicit RK2 is not stable in the zero-diffusion limit;
    # this bounded dialect requires strictly positive diffusivity.
    # Central differences require cell Peclet <= 2 for a monotone
    # semi-discrete advection-diffusion operator. A small timestep alone
    # cannot repair an advection-dominated centered spatial stencil.
    if (model.equation is not None and model.equation.advection
            and (abs(model.advection_velocity_x) * dx > 2 * model.diffusivity
                 or abs(model.advection_velocity_y) * dy > 2 * diffusivity_y)):
        raise error_type("Advection stability requires cell Peclet number <= 2")
    advective_stiffness = (abs(model.advection_velocity_x) / dx
                           + abs(model.advection_velocity_y) / dy)
    if dt * (diffusion_stiffness + linear_reaction_rate / 4
             + advective_stiffness) > .45:
        raise error_type("Heat time step violates diffusion/reaction stability bound")
    x, y = np.meshgrid((np.arange(nx) + .5) * dx,
                       (np.arange(ny) + .5) * dy, indexing="ij")
    try:
        field = np.broadcast_to(evaluate(parse_expression(model.initial), x, y,
                                         expected_dimension=TEMPERATURE,
                                         boundary_temperature=model.boundary_temperature,
                                         boundary_gradient=model.boundary_gradient,
                boundary_axes=model.boundary_axes,
                boundary_faces=model.boundary_faces), (nx, ny)).copy()
    except ExpressionError as exc:
        raise error_type(str(exc)) from exc
    initial_mean = float(np.mean(field))
    initial_variance = float(np.mean((field - initial_mean)**2))

    def laplacian(a):
        return ((np.roll(a, -1, axis=0) + np.roll(a, 1, axis=0) - 2 * a) / dx**2 +
                (np.roll(a, -1, axis=1) + np.roll(a, 1, axis=1) - 2 * a) / dy**2)

    def rhs(state, time):
        if not np.all(np.isfinite(state)):
            raise error_type("Non-finite temperature during heat integration")
        if model.equation is None:
            return model.diffusivity * laplacian(state)
        if model.equation.nonlinear:
            if model.ambient_temperature <= 0:
                raise error_type("Quadratic thermal relaxation requires positive ambientTemperature")
            if np.any(state < model.ambient_temperature - 1e-10):
                raise error_type("Quadratic thermal relaxation requires temperature >= ambientTemperature")
            maximum_excess = float(np.max(np.maximum(state - model.ambient_temperature, 0.0)))
            # Local linearized reaction eigenvalue is -2*k*(T-A)/A.
            # Check both RK2 stages, not just the initial field.
            if dt * (diffusion_stiffness + advective_stiffness +
                     model.reaction_rate * maximum_excess / (2 * model.ambient_temperature)) > .45:
                raise error_type("Heat time step violates nonlinear reaction stability bound")
        try:
            return np.broadcast_to(evaluate(
                model.equation.rhs, x, y, expected_dimension=TEMPERATURE_RATE,
                values={"temperature": state, "diffusivity": model.diffusivity,
                        "diffusivityX": model.diffusivity, "diffusivityY": diffusivity_y,
                        "crossDiffusivity": model.cross_diffusivity,
                        "reactionRate": model.reaction_rate,
                        "ambientTemperature": model.ambient_temperature,
                        "advectionVelocityX": model.advection_velocity_x,
                        "advectionVelocityY": model.advection_velocity_y,
                        "t": time},
                boundary_temperature=model.boundary_temperature,
                boundary_gradient=model.boundary_gradient,
                boundary_axes=model.boundary_axes,
                boundary_faces=model.boundary_faces), (nx, ny))
        except (ExpressionError, ValueError) as exc:
            raise error_type(f"Invalid heat equation evaluation: {exc}") from exc

    observations = [{"time": 0.0, "meanTemperature": initial_mean,
                     "temperatureVariance": initial_variance}]
    sample_stride = max(1, math.ceil(steps / 128))
    for step_index in range(steps):
        stage_time = step_index * dt
        k1 = rhs(field, stage_time)
        k2 = rhs(field + dt * k1, stage_time + dt)
        field += .5 * dt * (k1 + k2)
        if not np.all(np.isfinite(field)):
            raise error_type("Non-finite temperature during heat integration")
        if (step_index + 1) % sample_stride == 0 or step_index + 1 == steps:
            sampled_mean = float(np.mean(field))
            observations.append({"time": float((step_index + 1) * dt),
                                 "meanTemperature": sampled_mean,
                                 "temperatureVariance": float(np.mean((field - sampled_mean)**2))})
    mean = float(np.mean(field))
    variance = float(np.mean((field - mean)**2))
    return {"steps": steps, "grid": [nx, ny], "time": duration,
            "mean_temperature": mean, "initial_mean_temperature": initial_mean,
            "temperature_variance": variance, "initial_temperature_variance": initial_variance,
            "temperature_min": float(np.min(field)), "temperature_max": float(np.max(field)),
            "method": "centered-difference RK2 scalar reaction-diffusion equation",
            "boundary_condition": ("Faces" if model.boundary_faces is not None
                                   else "Robin" if model.boundary_axes is not None and all(
                                        kind in ("Robin", "RobinProfile") for kind, _ in model.boundary_axes)
                                    else "Mixed" if model.boundary_axes is not None
                                   else "Dirichlet" if model.boundary_temperature is not None
                                   else "Neumann" if model.boundary_gradient is not None
                                   else "Periodic"),
            "boundary_temperature": model.boundary_temperature,
            "boundary_gradient": model.boundary_gradient,
            "boundary_axes": ({"x": {"type": model.boundary_axes[0][0], "value": model.boundary_axes[0][1]},
                               "y": {"type": model.boundary_axes[1][0], "value": model.boundary_axes[1][1]}}
                              if model.boundary_axes is not None else None),
            "boundary_faces": ({name: {"type": condition[0], "value": condition[1]}
                                for name, condition in zip(("x_min", "x_max", "y_min", "y_max"),
                                                           model.boundary_faces)}
                               if model.boundary_faces is not None else None),
            "observations": observations,
            "spatial": spatial_snapshot(
                {"temperature": field}, (model.length_x, model.length_y))}
