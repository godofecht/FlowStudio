# Executable mathematical Flow subsets (experimental)

The repository contains a **separate mathematical Flow frontend** in `src/math_flow.py`. It now dispatches two explicitly supported PDE families: incompressible periodic 2D Navier–Stokes and scalar periodic 2D heat diffusion. `src/math_flow_heat.py` implements the second family; `src/math_flow_expr.py` provides a bounded, dimension-checked scalar expression AST used by both families' initial conditions. It lexes Unicode source into positioned tokens, parses and validates the domain/model/solver and observation pipeline, and executes the supported two-dimensional incompressible Navier–Stokes equations using NumPy. This is **not** a modification of the upstream Flow 2.0 compiler, and arbitrary mathematical Flow expressions are not supported. Unsupported equations, methods, units, fields, and boundary conditions are errors rather than silently ignored.

## Run and validate

```sh
python3 -m pip install 'numpy==2.1.3'
python3 src/math_flow.py --check examples/navier_stokes_proposed.flow
python3 src/math_flow.py examples/navier_stokes_smoke.flow
python3 src/math_flow.py examples/heat_equation_smoke.flow
python3 src/math_flow.py --grid 16 --until 0.001 examples/navier_stokes_proposed.flow
python3 -m unittest discover -s tests -p 'test_mathematical_flow.py' -v
python3 -m unittest discover -s tests -p 'test_math_flow_extensions.py' -v
```

The committed `examples/navier_stokes_smoke.flow` is directly executable without any CLI overrides and is exercised by both numerical unit tests and the native HTTP integration test. The original large example specifies 256 × 256 cells and 10 seconds at 10⁻⁴ seconds per step (100,000 steps); this is a substantial numerical workload. Use `--grid` and `--until` to run a quick numerical acceptance without altering the original program. CLI output is JSON with step count, pressure mean, maximum discrete divergence, kinetic energy, and vorticity RMS. A failed compilation or solve returns nonzero status and JSON diagnostics.

When the native FlowStudio server is running, send source as a UTF-8 POST with `X-FlowStudio-Intent: run` to `/api/check/mathflow` or `/api/run/mathflow`. These routes are handled by the real Flow-owned HTTP server and use the same loopback origin and intent restrictions as existing execution routes. The run route executes the duration and grid specified in source, so the full example can exceed the server's 60-second process deadline. The mathematical Python frontend and NumPy are bundled as source and external dependency respectively; NumPy must be installed on the target machine.

## Implemented numerical semantics

The supported model is incompressible, constant-density, constant-viscosity 2D flow on a periodic rectangular grid. Velocity is cell-centered; centered differences approximate advection and diffusion. The pressure projection uses backward divergence and forward gradient, whose composition is exactly the periodic five-point Laplacian. The mean-zero pressure Poisson problem is solved by actual conjugate gradient, not a mislabeled spectral inversion. Each Runge–Kutta second-order stage is projected. The initial expressions are compiled from a restricted arithmetic/trigonometric AST, never arbitrary Python evaluation. Pressure mean is fixed to zero. Runtime guards check finite state and a conservative explicit stability condition.

The test suite runs the actual Unicode example with a small grid and checks pressure gauge, divergence, energy and numerical convergence against the analytic viscous decay of a shear flow. Native CI additionally runs the real HTTP route and compiled FlowStudio server; the editor's Unicode completion tests are separate.

## Current limitations and remaining work

The frontend recognizes a **specific, explicitly checked** equation, solver, units, initial field types and observation mapping; it is not a general symbolic PDE compiler. Dimensional checks cover the supported literals and declarations, not arbitrary algebraic dimensional inference. There is no general-purpose typed equation AST, no adaptive timestep, no non-periodic boundaries, no generalized visualization data stream, and no upstream Flow 2.0 grammar integration. The original `Visualize` mapping is validated but no graphical renderer is emitted by this CLI. Pressure tolerance is relative conjugate-gradient residual, not an absolute divergence guarantee. The numerical integrator is a demonstrable executable subset rather than a complete fluid mechanics framework.

## Language conventions

Values, fields, parameters and constants use lowerCamelCase; domain, model, solver and type names use UpperCamelCase. The Unicode operators `∂ₜ`, `∇`, `∇ ·`, `∇ ×`, `∇²`, `×`, `·`, `▷`, `½`, `π`, and superscript unit exponents are lexed as distinct tokens with source positions. The executable frontend currently requires the exact supported mathematical form and validates the selected numerical methods and physical units.

## Scalar heat PDE and typed expression compilation

The executable `examples/heat_equation_smoke.flow` declares `Scalar<Kelvin>`, positive `m²/s` diffusivity, `∂ₜtemperature = diffusivity ∇²temperature`, periodic boundaries, finite-difference spatial discretization and RK2 stepping. The implementation computes actual mean temperature, temperature variance and minimum/maximum temperature. The discrete Laplacian conserves the mean; the analytic Fourier-mode variance ratio is `exp(-4 diffusivity (2π)² time)` on a unit-square domain. The test suite verifies convergence toward that ratio under grid refinement, and the real native Flow HTTP smoke tests both check and execute the heat program.

Initial scalar expressions are no longer rewritten into Python syntax. The compiler now builds a bounded AST with explicit operator nodes for addition, subtraction, multiplication, division, unary signs and `sin`, `cos`, `exp`, `sqrt`. It supports implicit multiplication such as `2πx`, `×`, `·`, superscript powers of ten and unit-bearing literals. Dimensions are inferred as integer exponents of length, mass, time and temperature; incompatible additions and non-dimensionless trigonometric arguments are rejected at compile time. Supported coordinate variables `x` and `y` have length dimensions. NumPy lowering is restricted to checked AST nodes; no Python `eval` or `exec` is used.

This remains a restricted, explicit PDE frontend. In particular, the full dynamics and observation equations are still recognized by checked patterns rather than a general equation AST; arbitrary PDEs, coupled systems, boundary types, symbolic differentiation, complete unit inference, upstream Flow 2.0 grammar integration and actual graphical rendering are **not** implemented. The `Visualize` clauses remain validated declarations; the heat route returns numerical observations, not rendered heatmaps.

## Sampled observation trajectories

Both executable PDE backends now return an `observations` array with actual solver-state samples, including time zero and the final integration step. Navier–Stokes samples `kineticEnergy` and `maximumDivergence`; heat diffusion samples `meanTemperature` and `temperatureVariance`. The sampling interval is `max(1, ceil(steps / 128))`, capped at 130 points including endpoints even for long runs. These are numerical data suitable for a future LineGraph renderer; **this change does not claim that Visualize already draws charts**. Regression tests compare both endpoints with independently returned final diagnostics.

## Native line-graph visualization

The native workbench now renders an SVG line graph in its **Plots** tab after a successful **Run MathFlow** HTTP execution. Heat runs expose temperature variance and mean temperature; Navier–Stokes runs expose kinetic energy and maximum divergence. The graph is derived from bounded, finite, strictly increasing time-series data returned by the actual NumPy solver, with metric selection and accessible SVG labeling. Rendering uses SVG DOM construction and numeric coordinates, never injected HTML or evaluated source text. Browser acceptance runs real native FlowStudio HTTP, both numerical examples and Chromium, and verifies the resulting SVG paths.

**Limits:** This is real time-series plotting, not spatial heatmaps, vector fields, arbitrary plotting, general equation parsing, or upstream Flow 2.0 syntax support.

## Final-state spatial heatmaps and velocity vectors

The executable NumPy PDE backends now return `spatial` data sampled directly from their **final** solver arrays. A bounded x-major `grid` (at most 24 × 24) and `source_grid` preserve the original resolution, while `extent` records the physical domain dimensions. Heat diffusion returns final `temperature`; Navier–Stokes returns final `vorticity`, `velocity_x`, and `velocity_y`. This is downsampled data, not a complete 512 × 512 field transfer, and it is not a saved time series of spatial snapshots.

The native Plots tab renders actual SVG spatial heatmap cells, and for Navier–Stokes overlays velocity vectors. Rendering validates every coordinate, field shape and finite value before constructing DOM elements. It uses numeric SVG attributes and does not interpret arbitrary source strings as HTML. Native HTTP and Chromium acceptance tests exercise both numerical backends and both SVG spatial outputs. The graph and spatial display still use the explicitly bounded mathematical Flow dialect, not upstream Flow 2.0 parsing; arbitrary PDE equations and non-periodic boundaries remain unsupported.

## Executable Unicode spatial operators in initial expressions

The checked scalar expression compiler now supports `∂ₓ(expression)`, `∂ᵧ(expression)`, and `∇²(expression)` as typed AST nodes. The first two subtract one length exponent from their argument's inferred dimension; the Laplacian subtracts two. Their NumPy lowering computes centered periodic finite differences from the actual two-dimensional, uniformly spaced Cartesian coordinate grid. Unsupported or malformed grids are rejected, not evaluated using Python code execution.

For example, `∂ᵧ(-cos(2πy / 1m) * 1m²/s / (2π))` is a dimensionally valid velocity field. The same operators are available inside the existing heat and Navier–Stokes initial conditions. Fourier-mode refinement tests check second-order convergence, and PDE integration tests execute both solvers using derivative-defined initial fields. This is not yet a general symbolic differentiation engine or arbitrary PDE equation compiler; the domain is periodic and the stencil is finite difference.

## Typed scalar equation AST and additive source terms

The heat frontend now compiles the complete Unicode right-hand side into a typed `Equation` AST (`src/math_flow_equations.py`). For example, `∂ₜtemperature = diffusivity ∇²temperature + 2K/s` is executable via `examples/heat_equation_forced.flow`. The scalar expression compiler accepts declared typed symbols, including `temperature` (K) and `diffusivity` (m²/s), and recognizes prefix `∇²temperature` as well as `∇²(temperature)`. The full RHS is dimension-checked as K/s, and can be evaluated directly against real NumPy field arrays. The solver lowers the recognized periodic diffusion operator and independent additive forcing to its existing RK2 finite-difference kernel, computing forcing from the typed AST once per run.

This deliberately does **not** admit arbitrary scalar equations: the heat RHS must contain precisely the positive `diffusivity ∇²temperature` term, optionally plus an expression that does not depend on the evolving field or diffusivity. Nonlinear reactions, alternative spatial operators, coupled fields and invalid dimensions fail compilation. The runtime retains its periodic-grid, time-step, finite-value and workload guards; the added source term does not constitute an unrestricted PDE engine. Analytic tests check the forced mean and the spatial Fourier-mode response, while the native HTTP acceptance executes the checked-in forced program and rejects an invalid field-dependent source.

```sh
python3 src/math_flow.py examples/heat_equation_forced.flow
python3 -m unittest discover -s tests -p 'test_math_flow_equations.py' -v
```

## Typed linear reaction-diffusion and full-RHS RK2 lowering

`examples/heat_reaction_diffusion.flow` now runs a periodic scalar parabolic PDE with
`reactionRate = 0.5s⁻¹`, `ambientTemperature = 300K`, and the typed dynamics

```flow
∂ₜtemperature = diffusivity ∇²temperature
                − reactionRate (temperature − ambientTemperature)
                + 2K/s
```

The parser builds one dimension-checked equation AST for the **entire** RHS. The
RK2 solver evaluates that AST against the actual temperature field at each
stage; it does not treat a field-dependent reaction as a constant source.
Only the explicitly validated negative linear relaxation term is accepted,
and its positive rate participates in the explicit timestep stability bound.
Arbitrary nonlinear reaction kinetics, time-dependent forcing, coupled PDEs,
non-periodic boundaries, and upstream Flow 2.0 grammar integration remain
unsupported. Unsupported forms fail rather than being silently simplified.

The new tests compare the numerical mean with the discrete RK2 relaxation
formula and Fourier variance against the exact amplification factor of the
periodic finite-difference Laplacian plus reaction. They also check
grid-refinement convergence, invalid dimensions and signs, the CLI, and
native FlowStudio HTTP execution. The workbench's existing real heatmap and
line-graph visualization consumes the returned temperature fields and
observation samples.

```sh
python3 src/math_flow.py examples/heat_reaction_diffusion.flow
python3 -m unittest discover -s tests -p 'test_math_flow_reaction.py' -v
```


## Executable quadratic thermal relaxation (bounded nonlinear PDE)

`examples/heat_nonlinear_reaction.flow` extends the typed scalar heat equation
to one explicitly recognized nonlinear reaction term:

```flow
∂ₜtemperature = diffusivity ∇²temperature
                − reactionRate (temperature − ambientTemperature)
                               (temperature − ambientTemperature)
                               / ambientTemperature
```

The full dimension-checked RHS is evaluated against **both actual RK2 stage fields**.
This is nonlinear numerical execution, not a source-string substitution or editor
snippet. The dimension of the sink is K/s. The implementation requires a positive
ambient temperature and temperatures at or above ambient throughout both stages.
A conservative, state-dependent local linearized reaction stiffness is checked at
each stage alongside the diffusion timestep bound. These constraints deliberately
reject unbounded or unstable cases rather than claiming arbitrary nonlinear PDE
support.

The checked-in example has a nonuniform initial field above ambient. Unit tests
compare the compiled RHS against a discrete Fourier Laplacian and quadratic sink,
then compare a uniform-temperature case with the analytic Riccati solution
`T(t) = A + (T(0)-A)/(1 + reactionRate*(T(0)-A)*t/A)`, verifying temporal
refinement. CI also executes the example via the real CLI and native Flow HTTP
check/run routes on Linux and macOS.

```sh
python3 src/math_flow.py examples/heat_nonlinear_reaction.flow
python3 -m unittest discover -s tests -p 'test_math_flow_nonlinear.py' -v
```

This is still a **restricted** standalone mathematical Flow frontend: general
nonlinear kinetics, arbitrary coupled fields, non-periodic boundary conditions,
and upstream Flow 2.0 grammar/compiler integration remain unfinished.
