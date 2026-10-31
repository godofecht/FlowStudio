# Native rational-affine SI dimension constraints

The real Flow 2.0 compiler executes `src/math_dimension_solver.flow` and
`src/math_dimension_solver_smoke.flow`. This extends the existing single-unknown
scalar equation solver: a root can now introduce a fractional coefficient of
the unknown dimension. It does **not** add numeric root finding, general
symbolic algebra, multiple unknowns, multidimensional PDE field declarations
or upstream Flow grammar syntax.

An intermediate dimension is represented as
`(coefficient * unknown + offset) / denominator`, separately for each of
the four integer SI axes (length, mass, time, temperature). Multiplication,
division and powers transform that affine form. Square and cube roots multiply
its denominator by two and three, respectively. Equal-dimension constraints
are solved by cross-multiplication, with exact divisibility required on every
axis. The resulting dimension is rechecked by the existing native static type
checker, so the solver cannot accept a dimensionally invalid function,
predicate or equation.

For example, `sqrt(x) = 1m` infers square metres, `cbrt(x) = 1m`
infers cubic metres, `sqrt(x * 1m) = 1m²` infers cubic metres, and
`sqrt(cbrt(x)) = 1m` infers metres to the sixth power. Nested constraints
and mixed physical dimensions are checked without numerical evaluation.

The denominator is positive and limited to 4096, the normalized coefficient
and offset exponents to ±1024, the final unknown exponents to ±32, and each
postfix expression to 64 instructions. A common integer factor is removed
after operations to prevent artificial denominator growth. Underdetermined
systems, contradictory constraints, noninteger SI exponents, unsupported
operations and exceeded bounds fail closed.

## Reproduction

Run `flow run src/math_dimension_solver_smoke.flow` with the pinned upstream
Flow 2.0.0 compiler. It executes the original 34 constraints plus 24 root
inference, nested-expression, mixed-unit, contradiction and negative cases.
The same exact checked-in modules are concatenated for anonymous production
`/api/check/flow` and `/api/run/flow` acceptance in
`tests/http_smoke.py`; corrupted expected dimensions must return HTTP 422,
as must malformed compiler syntax. `python3 scripts/verify_native.py --require-r`
builds and tests the production native router; Linux/macOS CI executes these
checks along with the remaining compiler, HTTP, Chromium, Python/R and
numerical suites.

**Qualification at submission:** implementation and acceptance are checked
in on a PR branch; Linux/macOS CI, production HTTP execution and browser
acceptance have not yet been observed for this change. This is not RStudio
parity or general compiler-backed PDE lowering.
