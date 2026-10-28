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
