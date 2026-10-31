# Native physical fourth roots in mathematical Flow

The executable native Flow 2.0 scalar math parser accepts `root4(expression)` and the prefix Unicode radical `∜`. Both lower to postfix opcode **46**; opcode 45 remains the three-component norm `norm3`.

The native numerical evaluator computes the principal real fourth root using bounded, scale-normalized Newton iteration. Negative radicands fail at runtime. Zero and positive finite radicands are supported within the existing mathematical IR value limits. Static inference is deliberately value-independent: `root4(-16m⁴)` is dimensionally valid even though its numerical evaluation fails.

Every SI base-dimension exponent must be divisible by four. `root4(16*1m⁴)` evaluates to `2m`, whereas `root4(16m⁴)` evaluates to `16m` because the superscript applies to the whole quantity `(16m)⁴`. `root4(16m³)` is rejected. The one-, two-, three-, and four-unknown dimensional equation solvers lower fourth roots as rational affine dimension constraints and verify solutions using the production static checker.

The checked-in executable acceptance is `src/math_fourth_root_smoke.flow`, invoked by the Linux/macOS native CI gate. The production HTTP `/api/check/flow` and `/api/run/flow` paths exercise fourth-root cases in the bundled `src/math_expression_source_http_smoke.flow`. The checked-in Navier–Stokes program remains Python/NumPy-backed; this feature does not implement native PDE execution or alter the upstream Flow grammar.

## Four-unknown, sixteen-equation native regression

The checked-in `src/math_dimension_variable_four_smoke.flow` now includes a
full-rank 16-constraint system using `root4(x)` and Unicode `∜(x)` to
infer `x: length⁴`, `y: length`, `z: time`, and `w: length`.
All sixteen equations must pass the production native static checker.
Three additional executions reject a contradiction in equation 16, an
incompatible cubic exponent, and a rank-deficient four-equation system.
The existing production HTTP and physical Chromium acceptance concatenate
and execute this same checked-in native source, with a 128 KiB request cap.

**Qualification:** PR #290 CI pending. Local native Flow/R and independent
macOS physical-browser execution remain unexecuted. This does not establish
compiler-generated multidimensional fields or RStudio parity.
