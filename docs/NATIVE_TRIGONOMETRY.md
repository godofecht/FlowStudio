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
