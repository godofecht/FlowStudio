# Executable mathematical Flow subsets (experimental)

## Typed spatial moment reductions (executable)

The bounded mathematical Flow expression AST now compiles `mean(expression)`,
`variance(expression)`, `std(expression)`, and `rms(expression)` to real
NumPy spatial reductions. Variance doubles each physical dimension exponent;
standard deviation and root-mean-square preserve the argument dimension.
RMS uses scaled squaring to avoid avoidable overflow for large finite values.
All reductions reject malformed arity and nonfinite numerical results.

`examples/heat_spatial_moments.flow` evaluates three distinct reductions of a
spatial sine field inside an executable heat-equation forcing coefficient.
Its source term and RK2 Fourier-mode evolution are checked against the exact
semidiscrete analytic solution. Native Linux/macOS CI executes the checked-in
program, and Chromium acceptance renders its actual temperature heatmap.
These operations do **not** imply general coupled PDE support or upstream Flow
2.0 grammar integration.

```sh
python3 src/math_flow.py examples/heat_spatial_moments.flow
python3 -m unittest discover -s tests -p 'test_math_flow_spatial_moments.py' -v
```

## Dimension-checked logarithms (executable)

The experimental scalar expression AST supports `log()` and `ln()` as natural
logarithms, `log10()` as base-ten logarithm, and `log1p()` as the stable
natural logarithm of one plus its argument. All four require dimensionless
inputs and produce dimensionless results. The NumPy lowering rejects nonfinite
results, including logarithms of zero or negative arguments and `log1p`
inputs at or below minus one. These functions work in field-independent heat
forcing and typed initial expressions, not in arbitrary coupled PDEs.

`examples/heat_logarithmic_forcing.flow` executes all four through the actual
Flow mathematical frontend and RK2 solver. Its four inverse-exponential terms
reduce analytically to a prescribed `4K/s * sin(2πx/1m)` source. Tests verify
the discrete Fourier-mode RHS, mean conservation and variance against the
closed-form semidiscrete heat solution. Both Linux and macOS native CI run
`--check` and full numerical execution of this checked-in program.

```sh
python3 src/math_flow.py examples/heat_logarithmic_forcing.flow
python3 -m unittest discover -s tests -p 'test_math_flow_logarithms.py' -v
```


## Typed Navier momentum equation AST (bounded)

`src/math_flow_vector.py` now compiles the checked Navier–Stokes momentum
equation into ordered, immutable `VectorTerm` nodes with physical dimensions
`m/s²`, explicit signs, symbol dependencies and an implicit-pressure marker.
The runtime assembles the advection/diffusion RK2 slopes in **source order**
from those validated nodes; the semantic trace uses the same nodes for
provenance. The pressure-gradient term is represented in the AST but lowered
through the existing discrete pressure projection, rather than falsely
treated as an explicit slope. Rearranging the three supported terms preserves
the numerical solution, and the regression suite verifies the change with
real execution.

The compiler still accepts **exactly** the validated incompressible Navier
term family: negative convective transport, negative pressure gradient,
positive viscous diffusion. It rejects missing, repeated, incorrectly signed,
or arbitrary terms; this is not a general vector equation compiler and does
not change upstream Flow 2.0.

```sh
python3 src/math_flow.py examples/navier_stokes_smoke.flow
python3 -m unittest discover -s tests -p 'test_math_flow_vector_ast.py' -v
```


The repository contains a **separate mathematical Flow frontend** in `src/math_flow.py`. It now dispatches two explicitly supported PDE families: incompressible periodic 2D Navier–Stokes and scalar 2D heat diffusion with periodic or constant face-Dirichlet boundaries. `src/math_flow_heat.py` implements the second family; `src/math_flow_expr.py` provides a bounded, dimension-checked scalar expression AST used by both families' initial conditions. It lexes Unicode source into positioned tokens, parses and validates the domain/model/solver and observation pipeline, and executes the supported two-dimensional incompressible Navier–Stokes equations using NumPy. This is **not** a modification of the upstream Flow 2.0 compiler, and arbitrary mathematical Flow expressions are not supported. Unsupported equations, methods, units, fields, and boundary conditions are errors rather than silently ignored.

## Measured Navier–Stokes RK2 and pressure-projection inspection

The checked-in `examples/navier_stokes_smoke.flow` now produces a **measured**
`semantic_trace` in addition to its actual numerical solution. The first
RK2 step reports the initial and predictor momentum slopes, decomposed into
nonlinear advection and viscous diffusion contributions using the same
finite-difference operations as the numerical solver. Each vector term has
dimension `m/s²`, actual symbol dependencies, mean and maximum vector
magnitude, and a checked maximum decomposition residual.

Three separately measured pressure projections (initial, predictor, corrector)
report discrete divergence before/after projection, velocity correction RMS,
and the mean-zero pressure gauge. The trace also reports the three kinetic
energy values per unit depth and the difference between Euler prediction and
RK2 correction before pressure projection. The native Plots tab validates and
renders these data with an actual stage selector. Python analytic Fourier shear
tests, CLI execution, browser validation, and native HTTP/Chromium acceptance
exercise the same implementation.

Only the **first timestep** is retained, and this trace is specific to the
validated incompressible periodic 2D Navier–Stokes model. The Navier dynamics
are still recognized by a checked equation pattern, **not** by a generalized
Navier equation AST. The descriptions are numerical-method semantics rather
than claims about the author's unstated intent.

```sh
python3 src/math_flow.py examples/navier_stokes_smoke.flow
python3 -m unittest discover -s tests -p 'test_math_flow_navier_semantic.py' -v
```

## Measured semantic RK2 inspection (first step)

The executable heat frontend now emits `semantic_trace` alongside its actual
NumPy simulation. This is **measured execution metadata**, not editor syntax
highlighting, simulated output or a free-form AI explanation. The validated
temperature equation is split into its signed AST terms, classified as diffusion,
cross-diffusion, advection, reaction or prescribed forcing. Each term is evaluated
using the **same typed NumPy lowering and boundary conditions** as the solver
at both the initial and predictor RK2 stages. The inspector reports physical
units (K/s), actual symbol dependencies, contribution mean and extrema, stage
times, and the maximum residual between the signed term sum and the full RHS.

The native workbench presents the two stages with a stage selector, mathematical
roles, numerical contributions and the actual RK2 predictor/corrector mean.
Only the **first timestep** is captured, with a maximum of 16 terms and no
stored full-resolution state snapshots. A larger equation continues to run but
does not emit this trace. The roles describe the validated mathematics; they
do **not** infer the author's unstated intent. This is not an interactive
general-purpose debugger or reverse execution. Navier–Stokes has its own
separately measured first-step inspector described above.

```sh
python3 src/math_flow.py examples/heat_composed_forcing.flow
python3 -m unittest discover -s tests -p 'test_math_flow_semantic_trace.py' -v
```

## Bounded saturating nonlinear reaction (executable)

`examples/heat_saturating_reaction.flow` uses the checked scalar AST and NumPy
backend to evolve a temperature field above **and below** ambient:

```flow
∂ₜtemperature = diffusivity ∇²temperature
                − reactionRate * ambientTemperature
                  * tanh((temperature − ambientTemperature) / ambientTemperature)
```

`tanh` requires a dimensionless argument and is lowered to NumPy arithmetic,
not Python evaluation. The exact reaction pattern must have the declared
positive rate (1/s), positive ambient temperature (K), and negative sign.
The globally bounded reaction Jacobian, `|dR/dT| ≤ reactionRate`, is checked
in the explicit RK2 stability guard at both stages; unlike polynomial
relaxation, the saturating sink admits signed deviations from ambient.
For a spatially uniform field, the exact solution is
`T(t) = A * (1 + asinh(sinh((T0-A)/A) * exp(-k*t)))`.
The regression suite checks this solution from both sides of ambient,
second-order RK2 convergence, the discrete Fourier-mode RHS, malformed
equation rejection, real CLI, native HTTP and Chromium spatial visualization.

```sh
python3 src/math_flow.py examples/heat_saturating_reaction.flow
python3 -m unittest discover -s tests -p 'test_math_flow_saturating.py' -v
```

This is one additional validated scalar reaction family. It does **not**
implement arbitrary nonlinear source terms, coupled PDEs, unrestricted
Unicode operators, or integration with the upstream Flow 2.0 grammar.

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

This remains a restricted, explicit PDE frontend. In particular, Navier–Stokes dynamics and observation clauses are still recognized by checked patterns, while heat dynamics uses a typed RHS AST restricted to validated forms; arbitrary PDEs, coupled systems, boundary types, symbolic differentiation, complete unit inference, upstream Flow 2.0 grammar integration and actual graphical rendering are **not** implemented. The `Visualize` clauses remain validated declarations; the heat route returns numerical observations, not rendered heatmaps.

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

The heat frontend now compiles the complete Unicode right-hand side into a typed `Equation` AST (`src/math_flow_equations.py`). For example, `∂ₜtemperature = diffusivity ∇²temperature + 2K/s` is executable via `examples/heat_equation_forced.flow`. The scalar expression compiler accepts declared typed symbols, including `temperature` (K) and `diffusivity` (m²/s), and recognizes prefix `∇²temperature` as well as `∇²(temperature)`. The full RHS is dimension-checked as K/s, and can be evaluated directly against real NumPy field arrays. The solver evaluates the full validated RHS AST at both RK2 stages using the actual evolving NumPy field arrays.

This deliberately does **not** admit arbitrary scalar equations: the heat RHS must contain precisely the positive `diffusivity ∇²temperature` term, optionally plus an expression that does not depend on the evolving field or diffusivity. Unrecognized nonlinear reactions, alternative spatial operators, coupled fields and invalid dimensions fail compilation. The runtime retains its periodic-grid, time-step, finite-value and workload guards; the added source term does not constitute an unrestricted PDE engine. Analytic tests check the forced mean and the spatial Fourier-mode response, while the native HTTP acceptance executes the checked-in forced program and rejects an invalid field-dependent source.

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

## Constant-velocity scalar advection–diffusion

`examples/heat_advection_diffusion.flow` executes a typed, periodic scalar
advection–diffusion equation with explicit `advectionVelocityX` and
`advectionVelocityY` constants in metres per second:

```flow
∂ₜtemperature = diffusivity ∇²temperature
                − advectionVelocityX ∂ₓ(temperature)
                − advectionVelocityY ∂ᵧ(temperature)
```

The equation compiler checks the dimensions of the entire right-hand-side AST,
requires exactly one positive diffusion term and both negative advection terms,
and rejects duplicated, missing, or incorrectly signed operators. The
NumPy RK2 runtime lowers both derivatives to centered periodic finite
differences on the live temperature state at each stage; it applies a
conservative combined advection/diffusion timestep guard and rejects cell Péclet numbers above 2 for the centered spatial stencil. The checked-in
example and tests compare its final 2D field with the exact **discrete**
Fourier-mode RK2 amplification (including advective phase), validate both
coordinate directions, and check convergence of the variance under grid
refinement. Native HTTP acceptance executes the example through the actual
FlowStudio server on Linux and macOS.

This is **not** an unrestricted advection operator: only constant declared
velocities and a single scalar temperature field with periodic boundaries
are supported; the supported advection, reaction and forcing operators can now be composed in one model.
Centered advection with explicit RK2 is not generally energy-stable in the
zero-diffusion limit; this subset requires positive diffusion, a bounded
timestep, and finite states. It is not an upstream Flow 2.0 grammar extension.

## Composed scalar transport, reaction and forcing

`examples/heat_transport_reaction.flow` executes a single dimension-checked
equation AST containing periodic diffusion, both constant-velocity advection
operators, linear ambient-temperature relaxation, and an independent heat source:

```flow
∂ₜtemperature = diffusivity ∇²temperature
                − advectionVelocityX ∂ₓ(temperature)
                − advectionVelocityY ∂ᵧ(temperature)
                − reactionRate (temperature − ambientTemperature)
                + 2K/s
```

The parser requires complete declarations for each optional operator family;
partial constants, incorrect signs, duplicated reaction terms, and invalid
dimensions are rejected. The existing NumPy RK2 runtime evaluates the full
typed equation AST against both actual stage fields, including nonlinear
quadratic relaxation combined with transport when its bounded positivity and
stability requirements hold.

The checked-in test compares the final field against exact discrete Fourier
amplification factors for two independently advected modes, plus the forced
uniform-mode recurrence. It also checks continuum grid refinement, nonlinear
uniform Riccati relaxation, CLI execution, native FlowStudio HTTP execution on
Linux/macOS and rendered SVG plots in Linux Chromium acceptance.

```sh
python3 src/math_flow.py examples/heat_transport_reaction.flow
python3 -m unittest discover -s tests -p 'test_math_flow_transport_reaction.py' -v
```

This is a composable **bounded scalar parabolic PDE family**, not a general
symbolic PDE system. Coupled fields, variable-coefficient transport, non-periodic
boundaries, unrestricted nonlinear operators and upstream Flow 2.0 grammar
integration remain unimplemented.

## Constant face-Dirichlet boundaries for scalar heat equations

The scalar heat backend now supports `boundaries = Dirichlet(300K)` in addition to `Periodic`. The value is parsed as a finite, unit-checked Kelvin temperature. On the cell-centered Cartesian grid, every outer face is held at the declared temperature using a reflected ghost value `2 * boundaryTemperature - cellTemperature`. This is applied to the actual `∂ₓ`, `∂ᵧ`, and `∇²` NumPy AST operators at every RK2 stage, rather than merely validating a boundary declaration. It is available for the existing supported scalar diffusion, advection, reaction, and forcing combinations; Navier–Stokes remains periodic-only. Only one constant temperature shared by all four faces is currently implemented. The returned JSON reports `boundary_condition` and `boundary_temperature`.

```sh
python3 src/math_flow.py examples/heat_dirichlet.flow
python3 -m unittest discover -s tests -p 'test_math_flow_dirichlet.py' -v
```

The checked-in sine-product temperature field is an exact eigenvector of this **discrete** face-Dirichlet Laplacian. Tests compare every returned cell to the closed-form RK2 amplification factor, verify continuum convergence under refinement, reject malformed boundary declarations and units, and execute the program through the native FlowStudio HTTP route. This is not general boundary-condition inference: mixed, time-dependent, spatially varying, Robin and Neumann conditions remain unsupported. Standalone scalar derivative evaluation defaults to periodic unless a validated boundary temperature is explicitly supplied.

## Executable Neumann heat boundaries

The scalar heat frontend also accepts `boundaries = Neumann(0K/m)` or a finite signed constant outward-normal gradient in K/m on **all four faces**. The parser checks physical units and rejects unsupported mixed boundary specifications. At each RK2 stage, the spatial operator uses cell-centered ghost values `T_ghost = T_edge + g Δx` (or `g Δy`) at the corresponding outward face; `g = 0` is insulated, conserving the discrete spatial mean for diffusion-only models. A nonzero `g` produces the integrated boundary flux `d mean(T)/dt = 2 diffusivity g (1/Lx + 1/Ly)` for a rectangular grid. This is a specified outward **temperature gradient**, not a heat flux in watts or a Robin boundary.

`examples/heat_neumann.flow` is a checked-in executable insulated cosine eigenmode. `tests/test_math_flow_neumann.py` verifies the exact discrete RK2 amplification factor, refinement toward the continuum solution, nonzero outward-gradient integrated flux, malformed unit rejection, and actual CLI execution. Native HTTP and Chromium workbench tests exercise this program and display the validated boundary gradient alongside real spatial and time-series SVG plots. Arbitrary per-face, mixed, time-varying, and nonlinear boundary conditions remain unsupported. Navier–Stokes still requires periodic boundaries.

## Independent x/y boundary conditions (mixed thermal faces)

`examples/heat_mixed_boundaries.flow` is an executable scalar heat program with
`boundaries = (Dirichlet(300K), Neumann(0K/m))`. The ordered tuple specifies
the two x-normal faces, then the two y-normal faces; each pair shares a
constant value. `Periodic` may be used for either axis. The compiler checks
the boundary units (`K` for Dirichlet, outward-normal `K/m` for Neumann)
and rejects malformed or unsupported combinations. Each axis uses its own
ghost-cell stencil during both RK2 stages. The native HTTP result exposes
`boundary_condition: "Mixed"` and typed `boundary_axes` metadata, rendered
by the workbench alongside real temperature plots.

Analytic tests compare the final field with exact discrete sine/cosine
eigenmodes for Dirichlet-x/Neumann-y and periodic-x/Dirichlet-y,
including continuum refinement. The committed example is executed through
the CLI, native Flow HTTP integration and Chromium acceptance on CI.

This is not per-face or spatially varying boundary data: each axis has one
boundary type and constant value shared by its opposing faces. General
coupled PDEs and upstream Flow 2.0 grammar integration remain unimplemented.

## Independently specified four-face thermal boundaries

`examples/heat_per_face_boundaries.flow` is an executable mathematical Flow
program with four independently typed, constant face conditions:

```flow
boundaries = (Dirichlet(300K), Neumann(0K/m), Neumann(0K/m), Neumann(0K/m))
```

The ordered entries are **x-min, x-max, y-min, y-max**. A periodic axis
requires `Periodic` at **both** opposing faces; an unmatched periodic face
is rejected by the parser and runtime. Non-periodic faces may mix Dirichlet
temperature (K) and outward-normal Neumann gradient (K/m), including different
values on opposite faces. The finite-difference evaluator selects the
appropriate cell-centered ghost value at each face at both actual RK2 stages,
rather than treating the syntax as editor-only.

The checked-in example is a mixed Dirichlet/Neumann half-sine eigenmode.
`tests/test_math_flow_per_face.py` compares the returned field with the
exact discrete RK2 eigenmode, verifies continuum refinement, and checks the
exact integrated heat flux for unequal outward gradients. Native Flow HTTP
acceptance and Chromium visualization tests execute and display this program.
Results report `boundary_condition: "Faces"` and the typed
`boundary_faces` object. The existing one-condition and two-axis forms remain
backward compatible.

```sh
python3 src/math_flow.py examples/heat_per_face_boundaries.flow
python3 -m unittest discover -s tests -p 'test_math_flow_per_face.py' -v
```

These are constant per-face conditions, not spatially or temporally varying
boundary functions. General coupled PDE systems and upstream Flow 2.0 grammar
integration remain outstanding.

## Dimension-checked Unicode radicals and division

The opt-in scalar mathematical Flow frontend now compiles `√`, `∛` and
`÷` directly to the checked expression AST. The ASCII functions `sqrt()`
and `cbrt()` use the same typed runtime operators. The square root requires
every physical dimension exponent to be even; the real cube root requires
every exponent to be divisible by three. Division subtracts dimension
exponents. Invalid dimensions, non-finite arithmetic and unknown functions
fail closed; no Python `eval` is used.

```flow
∂ₜtemperature = diffusivity ∇²temperature
               + 1K/s * √(4m²) ÷ 2m * ∛(sin(2πx / 1m)³)
```

The checked-in `examples/heat_unicode_radicals.flow` executes that
equation using the finite-difference NumPy runtime. Its tests verify the
discrete Fourier forcing against the analytic mode response, CLI execution,
physical dimensions and error rejection. Native HTTP and Chromium acceptance
also exercise its actual spatial and temporal plots.

```sh
python3 src/math_flow.py --check examples/heat_unicode_radicals.flow
python3 src/math_flow.py examples/heat_unicode_radicals.flow
python3 -m unittest discover -s tests -p 'test_math_flow_unicode_radicals.py' -v
```

These are bounded scalar expression operators, **not** an upstream Flow 2.0
grammar extension or arbitrary equation-system compilation.

## Typed inverse trigonometry and Euclidean norm

The experimental mathematical Flow expression compiler accepts `asin()`,
`acos()`, `atan()`, `atan2(y, x)` and `hypot(a, b)`. Inverse
trigonometric functions produce dimensionless radians. Their unary inputs
must be dimensionless; the two arguments of `atan2` must have identical
physical dimensions. `hypot` also requires matching input dimensions
and preserves them in the output. The runtime rejects inverse-sine/cosine
arguments outside [-1, 1], non-finite results and the undefined `atan2(0, 0)`
case. All calls are typed AST nodes lowered to NumPy, not editor snippets.

`examples/heat_inverse_trigonometry.flow` contains a genuine executable
periodic Fourier-forced heat equation using all five functions. The forcing
simplifies analytically to `5 K/s * sin(2πx / 1m)`; the regression tests
compare the numerical field and variance against its closed-form discrete
Laplacian eigenmode response. CI executes the checked-in source on native
Linux and macOS.

```sh
python3 src/math_flow.py --check examples/heat_inverse_trigonometry.flow
python3 src/math_flow.py examples/heat_inverse_trigonometry.flow
python3 -m unittest discover -s tests -p 'test_math_flow_inverse_trigonometry.py' -v
```

This extends the opt-in scalar expression language only. General coupled
PDEs, upstream Flow 2.0 grammar integration and unrestricted mathematical
equation compilation remain incomplete.
