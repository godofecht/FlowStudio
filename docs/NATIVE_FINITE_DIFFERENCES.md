# Native physical finite differences (bounded scalar Flow 2.0 dialect)

This adds **executable** finite-difference operators to the existing native
Flow 2.0 source parser, typed postfix IR, static SI inference and production
HTTP workbench. These are finite-difference stencils, not symbolic derivative
operators or general PDE ASTs.

`fd1(left, right, h)` computes `(right-left)/(2h)`, with output units
`[field]/[h]`. `fd2(left, center, right, h)` computes
`(left-2center+right)/h²`, with output units `[field]/[h]²`.
Both accept positive physical spacing of any SI dimension (time or length
are common).

`laplacian2(center, left, right, down, up, dx, dy)` computes the
five-point axis-aligned 2D Laplacian, allowing `dx != dy` and requiring
positive spatial lengths for both spacings. Its output dimension is
`[field]/m²`.

The actual source parser lowers calls to opcodes 84–86, with exact
argument counts and UTF-8 byte spans. The native evaluator checks all
sample dimensions, predicate types, positive nonzero spacing, bounded
finite values and result dimensions. The independent static pass checks
units and predicates without evaluating spacing values (so a zero
spacing can be statically well typed but must fail at runtime).

Reproduce with the pinned upstream Flow compiler:

```sh
flow run src/math_finite_difference_smoke.flow
python3 -m unittest discover -s tests -p 'test_finite_difference_oracle.py' -v
python3 scripts/verify_native.py --require-r
```

The checked-in native smoke exercises 34 analytical, parser, unit,
equation and negative assertions. The Python oracle independently
generates 27 exact-rational linear/quadratic 1D and 2D polynomial cases.
The HTTP gate compiles and executes them through the production
`/api/check/flow` and `/api/run/flow` endpoints in bounded batches,
and deliberately corrupts a numerical expectation to require HTTP 422.
CI runs the native smoke on Linux and macOS alongside the existing
Navier–Stokes, heat, analytical PDE and Chromium acceptance.

Limits: scalar samples only, fixed second-order centered differences,
no boundary conditions, arbitrary tensor ASTs, symbolic differential
equations, adaptive grids, native Navier–Stokes solver or general
upstream Flow grammar integration. The Python-backed Navier–Stokes
dialect remains separate and opt-in. Tracks #198.

## Manufactured-solution refinement qualification

The checked-in independent `Fraction` oracle also generates three
non-quadratic manufactured fields. At the origin, `x³+2x`,
`3x²+x⁴`, and `3x²+2y²+x⁴+2y⁴` have exact first derivative,
second derivative and Laplacian values 2, 6 and 10 respectively.
Coarse/fine native stencil outputs are 6/3, 14/8 and 54/21;
halving each relevant grid spacing reduces the nonzero truncation error
by **exactly four** in each case. The anisotropic Laplacian uses
`(dx,dy)=(2m,3m)` and `(1m,1.5m)`.

These six numerical evaluations and the 4:1 ratios are executed by the
production native Flow HTTP compiler/runtime, with a deliberately corrupted
coarse-grid expectation required to return HTTP 422. The Python test
independently derives the expected values using exact rational arithmetic.
This is a second-order *stencil* convergence check, not evidence of a
general PDE solver, symbolic derivative AST, or mesh-refinement framework.
