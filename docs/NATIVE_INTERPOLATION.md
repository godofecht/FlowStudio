# Native dimension-checked linear interpolation

The bounded Flow 2.0 mathematical source parser now lowers `lerp(a, b, t)` into native typed postfix opcode 66. `a` and `b` must have identical SI dimensions, `t` must be a dimensionless numeric scalar, and runtime interpolation is restricted to the closed interval `0 <= t <= 1`. Boolean arguments, incompatible units, malformed arity and nonfinite or out-of-range results fail closed with source-byte diagnostics.

`lerp(2m, 8m, 0.25)` evaluates to `3.5m`. The runtime uses the convex combination `a * (1 - t) + b * t` rather than forming `b - a`, which can overflow for opposite-sign bounded endpoints. Static inference checks operand types without evaluating the weight; a statically well-typed `lerp(2m, 8m, 2)` therefore fails at runtime, not during static inference.

`flow run src/math_dot_smoke.flow` exercises 18 new assertions for native execution, endpoint behavior, signed extreme values, physical units, malformed arguments, source spans, static inference and equation residuals. The existing `src/math_expression_source_http_smoke.flow` adds three production HTTP/Chromium acceptance assertions. CI also executes the checked-in Python-backed Navier–Stokes program and independent analytical PDE regressions on Linux and macOS.

This is a real bounded native scalar expression operation, **not** upstream Flow grammar integration, generalized tensors/PDEs, fully native Navier–Stokes or a generalized computed visualization backend.
