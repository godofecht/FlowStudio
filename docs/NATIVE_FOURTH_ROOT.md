# Native physical fourth roots in mathematical Flow

The executable native Flow 2.0 scalar math parser accepts `root4(expression)` and the prefix Unicode radical `∜`. Both lower to postfix opcode **46**; opcode 45 remains the three-component norm `norm3`.

The native numerical evaluator computes the principal real fourth root using bounded, scale-normalized Newton iteration. Negative radicands fail at runtime. Zero and positive finite radicands are supported within the existing mathematical IR value limits. Static inference is deliberately value-independent: `root4(-16m⁴)` is dimensionally valid even though its numerical evaluation fails.

Every SI base-dimension exponent must be divisible by four. `root4(16m⁴)` has dimension `m`; `root4(16m³)` is rejected. The one-, two-, three-, and four-unknown dimensional equation solvers lower fourth roots as rational affine dimension constraints and verify solutions using the production static checker.

The checked-in executable acceptance is `src/math_fourth_root_smoke.flow`, invoked by the Linux/macOS native CI gate. The production HTTP `/api/check/flow` and `/api/run/flow` paths exercise fourth-root cases in the bundled `src/math_expression_source_http_smoke.flow`. The checked-in Navier–Stokes program remains Python/NumPy-backed; this feature does not implement native PDE execution or alter the upstream Flow grammar.
