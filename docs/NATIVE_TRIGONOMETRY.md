# Native sine and cosine (bounded scalar mathematics)

The executable native Flow 2.0 scalar source compiler lowers `sin(x)` and
`cos(x)` to postfix opcodes 28 and 29. The same instructions execute in
`src/math_expression_ir.flow`, static SI-dimensional analysis in
`src/math_static.flow`, and scalar equation residual evaluation in
`src/math_equation.flow`. These are runtime/compiler changes, not editor snippets.

Both functions accept numeric, dimensionless arguments interpreted as
**radians**. Dimensioned quantities and Boolean predicates are rejected.
Runtime inputs must be finite and within [-60, 60] radians, matching the
existing bounded exponential policy; the static type pass does not execute
numeric range checks. Values outside the domain fail with the source
function-name byte offset. Function arity is exactly one.

The native evaluator uses range reduction to [-π, π], quadrant reflection
to [-π/2, π/2], and 16 Taylor correction terms. It does not invoke Python,
NumPy, or platform-specific libm trigonometric functions. The bounded
input range is intentional, not a claim of general-precision argument
reduction for arbitrarily large angles.

Run `flow run src/math_trigonometry_smoke.flow` with upstream Flow 2.0.
The checked-in acceptance program tests analytical values at 0, ±π/2,
±π, ±1, ±10 and ±60, the Pythagorean identity, nested calls, unit
cancellation, invalid dimensions and predicates, out-of-range values,
source spans, malformed arity, static inference, direct IR instructions
and scalar equations. The CI matrix executes this exact native Flow
program on Linux and macOS alongside the checked-in Navier–Stokes
dialect, numerical kernels, HTTP execution and browser acceptance.

This does **not** integrate these functions into upstream Flow 2.0 grammar,
implement symbolic variables or tensors, support native Navier–Stokes
lowering, or provide computed spatial PDE visualization.

## Native inverse sine and cosine (follow-up)

The real Flow 2.0 mathematical source-to-IR path accepts `asin(x)` and
`acos(x)` with strict one-argument, parenthesized syntax. These lower to
native typed postfix opcodes 33 and 34, execute in the same numerical
runtime, participate in scalar equations and static dimensional inference,
and preserve original source-byte spans. Both functions require a
dimensionless, non-Boolean input in the closed interval [-1, 1]. Out-of-range
inputs are runtime errors; static inference validates units and types, not
unknown runtime values.

For numerical stability near either endpoint, the complement is computed
as `sqrt((1 - abs(x)) * (1 + abs(x)))`. The principal results are
`atan2(x, complement)` for arcsine in [-pi/2, pi/2] and
`atan2(complement, x)` for arccosine in [0, pi]. This reuses the existing
native bounded square-root and arctangent2 kernels; no Python or external
trigonometric library is used. Native acceptance is in
`src/math_atan2_smoke.flow` and `src/math_expression_source_smoke.flow`.
The latter is also compiled and executed through the production HTTP
Flow route in `tests/http_smoke.py`.

This is a bounded scalar-language extension, not upstream Flow 2.0 grammar
integration, general tensor/PDE inference, or proof of complete mathematical
Flow support. Linux/macOS CI results must be recorded separately.
